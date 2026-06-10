const {
  resolveEffectiveLiferayConnection,
} = require('../utils/liferayEnv.cjs');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');
const { logger } = require('../utils/logger.cjs');
const crypto = require('crypto');

const { PATH, CUSTOM_OBJECTS, q } = require('../utils/liferayPaths.cjs');
const { ASSET_TYPE } = require('../utils/liferayPermissions.cjs');
const { ERC_PREFIX, OP_MAP, ENV } = require('../utils/constants.cjs');
const { findContract } = require('../utils/contractMappings.cjs');
const { delay, createERC } = require('../utils/misc.cjs');
const { sanitizedERC } = require('../utils/normalize.cjs');
const { ErrorHandler } = require('../utils/errorHandler.cjs');
const { parse } = require('csv-parse/sync');

const { getBatchCacheTTLms } = require('../utils/ttl.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');
const { asItems, asCount } = require('../utils/liferayUtils.cjs');

const SOFT_STATUS_BY_OP = {
  'accounts:list': [404],
  'products:list': [404],
  'orders:list': [404],
  'import-task': [404],
  'options:list': [404],
  'pricelists:list': [404],
  'get-price-list-by-erc': [404],
  'get-account-by-erc': [404],
  'get-product-by-erc': [404],
  'get-warehouse-by-erc': [404],
  'get-sku-by-erc': [404],
  'specifications:list': [404],
  'optionCategories:list': [404],
  'warehouse:items': [404],
  'price-entries:list': [404],
};

class LiferayRestService {
  constructor(ctx) {
    this.ctx = ctx;
    this.axiosInstance = null;
  }

  _stringifySafe(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return '[Unserializable object]';
    }
  }

  _getBaseCallbackUrl(config, session = null) {
    if (process.env.LIFERAY_BATCH_CALLBACK_URL) {
      return process.env.LIFERAY_BATCH_CALLBACK_URL;
    }

    const url =
      config?.microserviceUrl ||
      session?.context?.config?.microserviceUrl ||
      session?.context?.microserviceUrl ||
      session?.context?.microserviceURL ||
      ENV.MICROSERVICE_URL;

    if (!url) {
      const loggerToUse = this.ctx?.logger || logger;
      loggerToUse.warn(
        'microserviceUrl is not configured. Callbacks will likely fail.',
        {
          correlationId: config?.correlationId || session?.correlationId,
          hasConfig: !!config,
          hasSession: !!session,
          contextKeys: session?.context ? Object.keys(session.context) : [],
        }
      );
      return null;
    }
    return `${url}/api/v1/batch/callback`;
  }

  _buildCallbackURL(baseUrl, meta = {}) {
    if (!baseUrl) return null;
    try {
      const u = new URL(baseUrl);
      if (meta.entity) u.searchParams.set('entity', String(meta.entity));
      if (meta.op) {
        const raw = String(meta.op).toUpperCase();
        const opCode = OP_MAP[raw] || 'X';
        u.searchParams.set('opCode', opCode);
      }

      const batchERC = meta.batchExternalReferenceCode || meta.batchERC;
      if (batchERC) {
        u.searchParams.set('batchExternalReferenceCode', String(batchERC));
      }

      if (meta.sessionId)
        u.searchParams.set('sessionId', String(meta.sessionId));

      if (meta.correlationId)
        u.searchParams.set('correlationId', String(meta.correlationId));

      return u.toString();
    } catch {
      return baseUrl;
    }
  }

  _buildSoftFallback(op, status) {
    return {
      items: [],
      page: 1,
      pageSize: 0,
      lastPage: 1,
      totalCount: 0,
      status,
      softEmpty: true,
      op,
    };
  }

  async _request(
    config,
    {
      method = 'GET',
      url,
      data,
      params,
      headers,
      op,
      friendly,
      fullResponse = false,
      responseType = 'json',
    } = {}
  ) {
    // RUNTIME CONTRACT VALIDATION
    if (data && (ENV.NODE_ENV === 'development' || ENV.NODE_ENV === 'test')) {
      const contract = findContract(url, method);
      if (contract && !contract.isBatch && this.ctx.contractValidator) {
        try {
          if (contract.isArray) {
            this.ctx.contractValidator.validateArray(
              contract.spec,
              contract.schema,
              data
            );
          } else {
            this.ctx.contractValidator.validate(
              contract.spec,
              contract.schema,
              data
            );
          }
        } catch (err) {
          if (err.name === 'ContractViolationError') {
            this.ctx.logger.error(
              `Outbound request to ${url} violates Liferay OpenAPI contract`,
              {
                op,
                schema: contract.schema,
                errors: err.errors,
              }
            );
            // In development/test, we want to fail fast to catch schema drifts.
            throw err;
          }
        }
      }
    }

    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = await this._client(config);

        if (
          data &&
          (method === 'POST' || method === 'PATCH' || method === 'PUT')
        ) {
          const raw = JSON.stringify(data);
          logger.trace(
            `Outbound payload structure (${op}): ${raw.substring(0, 1000)}...`,
            { correlationId: config?.correlationId }
          );
        }

        logger.debug('Liferay API Request', {
          operation: op,
          method,
          url,
          correlationId: config?.correlationId,
          data: this._stringifySafe(data),
        });

        const res = await client.request({
          method,
          url,
          data,
          params,
          headers,
          responseType,
          timeout: 30000, // 30 second timeout
        });

        const logData = {
          operation: op,
          status: res.status,
          correlationId: config?.correlationId,
        };

        if (res.data) {
          if (Array.isArray(res.data.items)) {
            logData.itemCount = res.data.items.length;
            logData.totalCount = res.data.totalCount;
          } else if (typeof res.data === 'object') {
            logData.dataKeys = Object.keys(res.data);
          }
        }

        logger.debug('Liferay API Response', {
          ...logData,
          correlationId: config?.correlationId,
        });

        // INBOUND RESPONSE CONTRACT VALIDATION
        const shouldValidateInbound =
          config.validateInboundResponse ||
          (ENV.NODE_ENV === 'development' && !process.env.VITEST);

        if (res.data && shouldValidateInbound) {
          const contract = findContract(url, method);
          if (contract && contract.isInbound && this.ctx.contractValidator) {
            try {
              if (contract.isPage) {
                if (Array.isArray(res.data.items)) {
                  this.ctx.contractValidator.validateArray(
                    contract.spec,
                    contract.schema,
                    res.data.items
                  );
                }
              } else {
                this.ctx.contractValidator.validate(
                  contract.spec,
                  contract.schema,
                  res.data
                );
              }
              logger.debug(
                `Inbound response from ${url} conforms to Liferay OpenAPI contract`,
                {
                  op,
                  schema: contract.schema,
                }
              );
            } catch (err) {
              if (err.name === 'ContractViolationError') {
                logger.error(
                  `Inbound response from ${url} violates Liferay OpenAPI contract`,
                  {
                    op,
                    schema: contract.schema,
                    errors: err.errors,
                  }
                );
                throw err;
              }
            }
          }
        }

        if (fullResponse) {
          return {
            data: res.data,
            headers: res.headers || {},
            status: res.status,
            statusText: res.statusText,
          };
        }

        return res.data;
      } catch (err) {
        // Determine if we should retry
        const isRetryable =
          err.name !== 'ContractViolationError' &&
          ErrorHandler.isRetryableError(err) &&
          attempt < maxRetries;

        if (isRetryable) {
          const baseDelay =
            parseInt(process.env.LIFERAY_RETRY_DELAY_MS, 10) ||
            parseInt(ENV.LIFERAY_RETRY_DELAY_MS, 10) ||
            2000;
          const retryDelay = baseDelay * attempt;
          logger.warn(
            `Liferay API request failed (${op}), retrying ${attempt}/${maxRetries} in ${retryDelay}ms: ${err.message}`,
            {
              correlationId: config?.correlationId,
              status: err.response?.status,
            }
          );
          await delay(retryDelay);
          continue;
        }

        const hasHTTPResponse = !!err?.response;
        const res = err.response;

        const status = hasHTTPResponse ? res.status : undefined;
        const statusText = hasHTTPResponse ? res.statusText : undefined;
        const resHeaders = hasHTTPResponse ? res.headers || {} : {};
        const body = hasHTTPResponse ? res.data : undefined;

        const problem =
          hasHTTPResponse && body && typeof body === 'object'
            ? {
                status: body.status,
                title: body.title,
                type: body.type,
                detail: body.detail,
                errorReference:
                  body.errorReference ||
                  resHeaders['x-liferay-error-reference'],
              }
            : null;

        const existingRef =
          problem?.errorReference ||
          err?.errorReference ||
          err?.response?.headers?.['x-liferay-error-reference'];

        const errorReference = existingRef || createERC(ERC_PREFIX.ERROR);

        const detailMsg =
          (hasHTTPResponse && (problem?.detail || problem?.title)) ||
          friendly ||
          statusText ||
          err?.message ||
          'Request failed';

        if (hasHTTPResponse && op && SOFT_STATUS_BY_OP[op]?.includes(status)) {
          logger?.info?.('Soft HTTP status treated as empty result', {
            op,
            method,
            url,
            status,
            errorReference,
            problem,
            responseBody:
              typeof body === 'string'
                ? body
                : body
                  ? this._stringifySafe(body)
                  : null,
          });

          const softResult = this._buildSoftFallback(op, status);

          if (fullResponse) {
            return {
              data: softResult,
              headers: resHeaders,
              status,
              statusText,
            };
          }

          return softResult;
        }

        if (hasHTTPResponse) {
          logger?.error?.('Request failed (HTTP error)', {
            op,
            friendly,
            method,
            url,
            params,
            status,
            statusText,
            correlationId: config?.correlationId,
            errorReference,
            problem,
            responseBody:
              typeof body === 'string'
                ? body
                : body
                  ? this._stringifySafe(body)
                  : null,
            headers,
            responseHeaders: resHeaders,
          });
        } else {
          logger?.error?.('Request failed (no response from server)', {
            op,
            friendly,
            method,
            url,
            params,
            correlationId: config?.correlationId,
            errorReference,
            errorName: err?.name,
            errorCode: err?.code,
            message: err?.message,
            stack: err?.stack,
          });
        }

        const e = new Error(friendly || op || 'Request failed');
        e.name = 'LiferayRequestError';

        if (hasHTTPResponse) {
          e.status = status;
          e.statusText = statusText;
        }

        e.errorReference = errorReference;
        e.problem = problem || null;
        e.operation = op || friendly || 'request';
        e.userMessage = detailMsg;
        e.response = hasHTTPResponse
          ? { status, statusText, headers: resHeaders, data: body }
          : null;
        e.request = {
          method,
          url,
          params,
          hasData: !!data,
        };

        if (!hasHTTPResponse && err?.code) {
          e.networkCode = err.code;
        }

        throw e;
      }
    }
  }

  async _downloadFile(config, url, destination) {
    const writer = fs.createWriteStream(destination);

    const response = await this._get(
      config,
      url,
      'download-file',
      'Failed to download file',
      { responseType: 'stream' },
      true
    );

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async _client(config) {
    const { persistence } = this.ctx;
    const effective = resolveEffectiveLiferayConnection(
      config,
      this.ctx.oauth,
      persistence
    );
    return this.createAxiosInstance(effective);
  }

  async _get(config, url, op, friendly, opts = {}, fullResponse = false) {
    const { params, headers, responseType } = opts || {};

    const paramsSerializer = (p) =>
      new URLSearchParams(
        Object.entries(p || {}).filter(
          ([, v]) => v !== undefined && v !== null && v !== ''
        )
      ).toString();

    const qs = paramsSerializer(params);
    const finalUrl = qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;

    logger.trace('http:get', { url: finalUrl, params });

    return this._request(config, {
      method: 'GET',
      url: finalUrl,
      headers,
      op,
      friendly,
      fullResponse,
      responseType,
    });
  }

  async _post(
    config,
    url,
    data,
    op,
    friendly,
    onError = 'throw',
    fullResponse = false
  ) {
    return this._request(config, {
      method: 'POST',
      url,
      data,
      op,
      friendly,
      onError,
      fullResponse,
    });
  }

  async _put(config, url, data, op, friendly, fullResponse = false) {
    return this._request(config, {
      method: 'PUT',
      url,
      data,
      op,
      friendly,
      fullResponse,
    });
  }

  async _patch(config, url, data, op, friendly, fullResponse = false) {
    return this._request(config, {
      method: 'PATCH',
      url,
      data,
      op,
      friendly,
      fullResponse,
    });
  }

  async _delete(config, url, data, op, friendly, fullResponse = false) {
    return this._request(config, {
      method: 'DELETE',
      url,
      data,
      op,
      friendly,
      fullResponse,
    });
  }

  async _collectPagedIds(
    config,
    { listUrl, pageSize, filter, search, fields, op, friendly, idKey = 'id' }
  ) {
    let allIds = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await this._get(config, listUrl, op, friendly, {
        params: {
          page,
          pageSize,
          filter,
          search,
          fields,
        },
      });

      const items = asItems(res);
      const ids = items
        .map((it) => it[idKey])
        .filter((id) => id !== undefined && id !== null);
      allIds = allIds.concat(ids);

      const totalCount = asCount(res);
      hasMore = allIds.length < totalCount && items.length > 0;
      page++;
    }

    return allIds;
  }

  _normalizePermissionItems(items = []) {
    const map = new Map();
    for (const { roleName, actionIds } of items) {
      map.set(roleName, new Set(actionIds || []));
    }
    return map;
  }

  _denormalizePermissionMap(map) {
    const items = [];
    for (const [roleName, set] of map.entries()) {
      items.push({ roleName, actionIds: Array.from(set).sort() });
    }
    items.sort((a, b) => a.roleName.localeCompare(b.roleName));
    return items;
  }

  _mergePermissionsItems(existing = [], proposed = [], opts = {}) {
    const { strategy = 'union', remove = {} } = opts;
    const existingMap = this._normalizePermissionItems(existing);
    const proposedMap = this._normalizePermissionItems(proposed);
    const allRoles = new Set([...existingMap.keys(), ...proposedMap.keys()]);
    const out = new Map();

    for (const role of allRoles) {
      const cur = new Set(existingMap.get(role) || []);
      const next = new Set(proposedMap.get(role) || []);
      let merged;

      if (strategy === 'replace' || strategy === 'replaceSelected') {
        merged = proposedMap.has(role) ? next : cur;
      } else {
        merged = new Set([...cur, ...next]);
      }

      for (const r of remove[role] || []) merged.delete(r);
      out.set(role, merged);
    }

    return this._denormalizePermissionMap(out);
  }

  _permissionsOps(assetType) {
    switch (assetType) {
      case ASSET_TYPE.DOCUMENT_FOLDER:
        return {
          getPath: (id) => PATH.DOCUMENT_FOLDER_PERMISSIONS(id),
          putPath: (id) => PATH.DOCUMENT_FOLDER_PERMISSIONS(id),
        };
      case ASSET_TYPE.DOCUMENT:
        return {
          getPath: (id) => PATH.DOCUMENT_PERMISSIONS(id),
          putPath: (id) => PATH.DOCUMENT_PERMISSIONS(id),
        };
      default:
        throw new Error(`Unsupported assetType: ${assetType}`);
    }
  }

  async _getPermissions(config, assetType, id) {
    const ops = this._permissionsOps(assetType);
    const data = await this._get(
      config,
      ops.getPath(id),
      `get-permissions:${assetType}`
    );
    return asItems(data);
  }

  async _putPermissions(config, assetType, id, items) {
    if (!Array.isArray(items)) {
      throw new TypeError('_putPermissions: items must be an array');
    }
    const payload = items.map((it) => ({
      roleName: it?.roleName,
      actionIds: Array.isArray(it?.actionIds) ? it.actionIds.slice() : [],
    }));
    const ops = this._permissionsOps(assetType);
    return this._put(
      config,
      ops.putPath(id),
      payload,
      `put-permissions:${assetType}`
    );
  }

  async createAxiosInstance(config) {
    const { oauth } = this.ctx;
    let authHeader;

    // HARDENING: Fallback to Basic Auth if OAuth is not configured or specifically requested
    const useBasic =
      config.authMethod === 'basic' ||
      (!config.clientId &&
        ENV.LIFERAY_API_USERNAME &&
        ENV.LIFERAY_API_PASSWORD);

    if (useBasic) {
      const user = config.username || ENV.LIFERAY_API_USERNAME;
      const pass = config.password || ENV.LIFERAY_API_PASSWORD;
      const token = Buffer.from(`${user}:${pass}`).toString('base64');
      authHeader = `Basic ${token}`;
      this.ctx.logger.debug('Using Basic Auth for Liferay connection', {
        user,
        passLen: pass ? pass.length : 0,
        liferayUrl: config.liferayUrl,
      });
    } else {
      const accessToken = await oauth.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      authHeader = `Bearer ${accessToken}`;
    }

    return axios.create({
      baseURL: config.liferayUrl,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  async testConnection(config) {
    const { logger, oauth } = this.ctx;
    try {
      try {
        new URL(config.liferayUrl);
      } catch {
        throw new Error(`Invalid URL format: ${config.liferayUrl}`);
      }

      // HARDENING: Only validate OAuth if we aren't using Basic Auth
      const useBasic =
        config.authMethod === 'basic' ||
        ENV.LIFERAY_AUTH_METHOD === 'basic' ||
        (!config.clientId &&
          ENV.LIFERAY_API_USERNAME &&
          ENV.LIFERAY_API_PASSWORD);

      if (!useBasic && !oauth.isLiferayRouteAvailable()) {
        oauth.validateOAuthConfig(config);
      }

      await this._get(config, PATH.ME, 'test-connection');

      return {
        status: 'connected',
        message: 'Successfully connected to Liferay Commerce using OAuth 2',
      };
    } catch (error) {
      logger.error('OAuth connection test failed', {
        error: error.response?.data || error.message,
      });

      const structuredError = {
        success: false,
        error: '',
        errorType: '',
        field: '',
        originalError: error.message,
        status: error.response?.status || error.statusCode || error.status,
      };

      if (
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'EHOSTUNREACH' ||
        error.code === 'ECONNRESET' ||
        error.message.includes('Invalid URL') ||
        error.message.includes('Network Error') ||
        error.message.includes('timeout') ||
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('getaddrinfo') ||
        (!error.response && error.request)
      ) {
        structuredError.error = `Unable to connect to ${config.liferayUrl}. Please verify the URL is correct and the server is accessible.`;
        structuredError.errorType = 'connection';
        structuredError.field = 'liferayUrl';
      } else if (error.message.includes('OAuth configuration missing')) {
        structuredError.error =
          'OAuth configuration is incomplete. Please provide valid Client ID and Client Secret.';
        structuredError.errorType = 'auth_config';
        structuredError.field = 'clientSecret';
      } else if (
        [401, 403].includes(error.response?.status) ||
        [401, 403].includes(error.statusCode) ||
        [401, 403].includes(error.status) ||
        error.message.includes('OAuth authentication failed')
      ) {
        structuredError.error =
          'Authentication failed. Please verify your OAuth Client ID and Client Secret are correct.';
        structuredError.errorType = 'auth_error';
        structuredError.field = 'clientSecret';

        if (error.errorReference) {
          structuredError.errorReference = error.errorReference;
        }
      } else {
        structuredError.error = `Connection failed: ${
          error.response?.statusText || error.message
        }`;
        structuredError.errorType = 'connection';
        structuredError.field = 'liferayUrl';
      }

      const errorReference =
        structuredError.errorReference || createERC(ERC_PREFIX.ERROR);
      logger.error(`Error Reference: ${errorReference}`);
      structuredError.errorReference = errorReference;

      const uiErrorResponse = {
        success: false,
        error: structuredError.error,
        errorType: structuredError.errorType,
        field: structuredError.field,
        status: structuredError.status,
        errorReference,
      };

      const errorResponse = new Error(structuredError.error);
      errorResponse.response = {
        data: uiErrorResponse,
        status: structuredError.status || 500,
      };

      throw errorResponse;
    }
  }

  async getConfig(config, configKey) {
    const erc = String(configKey || '').toUpperCase();

    // MANDATE: Filter-In-Memory. Avoid 'or' filters.
    // We try to find by configKey first.
    const response = await this._get(
      config,
      PATH.CUSTOM_OBJECT_QUERY(CUSTOM_OBJECTS.AICA_CONFIGS, {
        filter: `configKey eq '${configKey}'`,
        pageSize: 500,
      }),
      `get-config:${configKey}`
    );

    // If we found a direct match, return it
    if (response?.items?.length) {
      return response;
    }

    // FALLBACK: Try fetching by ERC directly (another simple filter)
    return await this._get(
      config,
      PATH.CUSTOM_OBJECT_QUERY(CUSTOM_OBJECTS.AICA_CONFIGS, {
        filter: `externalReferenceCode eq '${erc}'`,
        pageSize: 10,
      }),
      `get-config-by-erc:${configKey}`
    );
  }

  async updateConfig(config, configKey, configValue) {
    const erc = String(configKey || '').toUpperCase();
    const existing = await this.getConfig(config, configKey);

    const payload = {
      configKey,
      configValue: configValue || '',
      externalReferenceCode: erc,
    };

    if (existing?.items?.length) {
      const id = existing.items[0].id;
      return await this._patch(
        config,
        `${PATH.CUSTOM_OBJECT(CUSTOM_OBJECTS.AICA_CONFIGS)}/${id}`,
        payload,
        `update-config:${configKey}`
      );
    } else {
      return await this._post(
        config,
        PATH.CUSTOM_OBJECT(CUSTOM_OBJECTS.AICA_CONFIGS),
        payload,
        `create-config:${configKey}`
      );
    }
  }

  async getRegions(config, countryId) {
    const data = await this._get(
      config,
      PATH.COUNTRY_REGIONS(countryId),
      `get-regions:${countryId}`
    );
    return asItems(data);
  }

  async getCatalogs(config) {
    const data = await this._get(config, PATH.CATALOGS, 'get-catalogs');
    return asItems(data);
  }

  async getCatalog(config, catalogId) {
    const data = await this._get(
      config,
      PATH.CATALOG(catalogId),
      'get-catalog'
    );
    return data;
  }

  async patchCatalog(config, catalogId, data) {
    return await this._patch(
      config,
      PATH.CATALOG(catalogId),
      data,
      'patch-catalog',
      'Failed to update catalog configuration'
    );
  }

  async getChannels(config) {
    const data = await this._get(config, PATH.CHANNELS, 'get-channels');
    return asItems(data);
  }

  async getLanguages(config, siteGroupId) {
    if (!siteGroupId) {
      throw new Error('siteGroupId is required for getLanguages');
    }
    const url = PATH.SITE_LANGUAGES(siteGroupId);
    const data = await this._get(
      config,
      url,
      'get-languages',
      'Failed to get site languages'
    );
    return asItems(data);
  }

  async getProductCount(config) {
    let url =
      PATH.PRODUCTS +
      (config.catalogId ? `?filter=catalogId eq ${config.catalogId}` : '');
    const data = await this._get(config, url, 'get-products');
    return asCount(data);
  }

  async getPrimaryAccountId(config) {
    try {
      const me = await this._get(config, PATH.ME, 'get-primary-account-id');
      if (me && typeof me.defaultAccountId === 'number') {
        return me.defaultAccountId;
      }
      if (Array.isArray(me?.accountBriefs) && me.accountBriefs.length > 0) {
        const first = me.accountBriefs[0];
        if (first && typeof first.id === 'number') {
          return first.id;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getAccountCount(config) {
    const data = await this._get(config, PATH.ACCOUNTS, 'get-accounts');
    return asCount(data);
  }

  async getImportTask(config, batchId) {
    let attempts = 0;
    const maxAttempts = 3;
    const backoff = 1000;

    while (attempts < maxAttempts) {
      try {
        return await this._get(
          config,
          PATH.IMPORT_TASK(batchId),
          'import-task',
          'Failed to get import task'
        );
      } catch (error) {
        attempts++;
        if (attempts >= maxAttempts || error.status !== 400) {
          throw error;
        }
        logger.warn(
          `Intermittent 400 error getting import task ${batchId}. Retrying ${attempts}/${maxAttempts}...`,
          {
            correlationId: config?.correlationId,
            error: error.message,
          }
        );
        await delay(backoff * attempts);
      }
    }
  }

  async getImportTaskSubmittedContent(config, batchId) {
    const urlResponse = await this._get(
      config,
      PATH.IMPORT_TASK_SUBMITTED_CONTENT(batchId),
      'import-task-submitted-content',
      'Failed to get import task submitted content',
      { headers: { Accept: '*/*' } }
    );

    logger.info('Received urlResponse from getImportTaskSubmittedContent', {
      batchId,
      urlResponse: JSON.stringify(urlResponse, null, 2),
    });

    if (urlResponse && urlResponse.url) {
      const tempFilePath = path.join(tmpdir(), `${crypto.randomUUID()}.zip`);

      try {
        await this._downloadFile(config, urlResponse.url, tempFilePath);

        const zip = new StreamZip.async({ file: tempFilePath });
        const entries = await zip.entries();
        const jsonEntry = Object.values(entries).find((entry) =>
          entry.name.endsWith('.json')
        );

        if (jsonEntry) {
          const jsonContent = await zip.entryData(jsonEntry);
          return JSON.parse(jsonContent.toString('utf8'));
        }
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    }
    return [];
  }

  async getImportTaskFailedItemReport(config, batchId) {
    const csvContent = await this._get(
      config,
      PATH.IMPORT_TASK_ERROR_REPORT(batchId),
      'import-task-error-report',
      'Failed to get import task error report',
      { headers: { Accept: 'application/octet-stream' } }
    );

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    return records;
  }

  async _postBatch(
    config,
    {
      entityName,
      items,
      externalReferenceCode,
      itemERCKey,
      op,
      friendly,
      path,
      sessionId,
      session = null,
      createStrategy = 'UPSERT',
      skipItemERC = false,
      method = 'POST',
    }
  ) {
    const { logger, cache, config: configService } = this.ctx;

    const prefixKey = `${entityName.toUpperCase()}_BATCH`;
    const erc =
      externalReferenceCode ??
      createERC(ERC_PREFIX[prefixKey] || ERC_PREFIX.BATCH);

    const processedItems = (items || []).map((item) => {
      if (skipItemERC) {
        return { ...item };
      }
      const extERC = sanitizedERC(
        item.externalReferenceCode || item[itemERCKey] || crypto.randomUUID()
      );
      return { ...item, externalReferenceCode: extERC };
    });

    const itemERCs = processedItems.map((i) => i.externalReferenceCode);

    this._cacheItemERCs(erc, null, itemERCs, sessionId);

    // RUNTIME CONTRACT VALIDATION (BATCH)
    if (
      processedItems &&
      processedItems.length > 0 &&
      this.ctx.contractValidator &&
      (ENV.NODE_ENV === 'development' || ENV.NODE_ENV === 'test')
    ) {
      const sampleUrl =
        typeof path === 'function' ? path('http://sample') : path;
      const contract = findContract(sampleUrl, 'POST');
      if (contract && contract.isBatch) {
        try {
          // Validate first 3 items to avoid excessive overhead while still catching patterns
          const sample = processedItems.slice(0, 3);
          for (const item of sample) {
            this.ctx.contractValidator.validate(
              contract.spec,
              contract.schema,
              item
            );
          }
        } catch (err) {
          if (err.name === 'ContractViolationError') {
            this.ctx.logger.error(
              `Batch item for ${entityName} violates Liferay OpenAPI contract`,
              {
                op,
                schema: contract.schema,
                errors: err.errors,
              }
            );
            throw err;
          }
        }
      }
    }

    const batchPayload = {
      batchExternalReferenceCode: erc,
      createStrategy,
      items: processedItems,
    };

    let currentERC = erc;
    let attempts = 0;
    const maxAttempts = 2;
    let lastError;

    while (attempts < maxAttempts) {
      const callbackUrl = this._buildCallbackURL(
        this._getBaseCallbackUrl(config, session),
        {
          batchERC: currentERC,
          sessionId: sessionId,
          correlationId: config?.correlationId || session?.correlationId,
          op: 'create',
        }
      );

      const url = path(callbackUrl);
      const currentBatchPayload = {
        ...batchPayload,
        batchExternalReferenceCode: currentERC,
      };

      logger.debug(`Sending batch ${entityName} creation request`, {
        operation: op,
        count: processedItems.length,
        callbackUrl: url,
        batchExternalReferenceCode: currentERC,
        correlationId: config?.correlationId || session?.correlationId,
      });

      try {
        const data = await this._request(config, {
          method,
          url,
          data: currentBatchPayload,
          op,
          friendly,
        });

        this._cacheItemERCs(currentERC, data?.id, itemERCs, sessionId);

        if (cache && data?.id) {
          cache.set(
            `batch:${data.id}:submission`,
            {
              op: op,
              erc: currentERC,
              itemERCs,
              count: processedItems.length,
              createdAt: new Date().toISOString(),
            },
            getBatchCacheTTLms(configService)
          );
        }

        logger?.trace?.('cache:itemERCs:stored', {
          scopeERC: currentERC,
          sessionId: sessionId || null,
          batchId: data?.id || null,
          count: itemERCs.length,
        });

        logger.debug(`Batch ${entityName} creation initiated`, {
          operation: op,
          batchId: data.id || 'unknown',
          status: data.status || 'submitted',
          batchExternalReferenceCode: currentERC,
          correlationId: config?.correlationId || session?.correlationId,
        });

        return {
          batchId: data.id || `batch-${Date.now()}`,
          status: data.status || 'submitted',
          count: processedItems.length,
          batchExternalReferenceCode: currentERC,
          batchRefs: [
            { taskId: data.id, count: processedItems.length, erc: currentERC },
          ],
        };
      } catch (error) {
        lastError = error;

        const errorTitle = error.problem?.title || '';
        const errorMessage = error.message || '';

        const isDuplicateERC =
          error.status === 400 &&
          (errorTitle.toLowerCase().includes('already in use') ||
            errorMessage.toLowerCase().includes('already in use'));

        if (isDuplicateERC) {
          const isBatchERCCollision =
            errorTitle.includes(currentERC) ||
            errorMessage.includes(currentERC);

          if (isBatchERCCollision && attempts < maxAttempts - 1) {
            const oldERC = currentERC;
            currentERC = createERC(ERC_PREFIX[prefixKey] || ERC_PREFIX.BATCH);
            logger.warn(
              `Batch ERC collision detected for ${entityName}. Regenerating batch ERC and retrying.`,
              {
                oldERC,
                newERC: currentERC,
                sessionId,
                correlationId: config?.correlationId,
              }
            );
            attempts++;
            await delay(500 * attempts);
            continue;
          }

          logger.error(
            `Fatal ERC collision in batch ${op}. One or more items already exist in Liferay.`,
            {
              batchERC: currentERC,
              isBatchCollision: isBatchERCCollision,
              title: errorTitle,
              message: errorMessage,
              correlationId: config?.correlationId,
            }
          );
        }

        throw error;
      }
    }

    throw lastError;
  }

  async _deleteBatchNative(
    config,
    {
      entityName,
      ids,
      externalReferenceCode,
      dryRun,
      sessionId,
      session = null,
      path,
      op,
      friendly,
      idField = 'id',
    }
  ) {
    const { logger } = this.ctx;

    const prefixKey = `${entityName.toUpperCase()}_BATCH`;
    const batchERC =
      externalReferenceCode ??
      createERC(ERC_PREFIX[prefixKey] || ERC_PREFIX.BATCH);

    const taggedCallback = this._buildCallbackURL(
      this._getBaseCallbackUrl(config, session),
      {
        entity: entityName,
        op: 'delete',
        batchERC,
        sessionId,
        correlationId: config?.correlationId || session?.correlationId,
      }
    );

    const batchUrl = path(taggedCallback);

    logger.debug(`Submitting batch delete for ${entityName}`, {
      count: ids.length,
      dryRun,
      callbackUrl: taggedCallback || 'none',
      externalReferenceCode: batchERC,
    });

    const res = await this._deleteByBatch(config, {
      batchUrl,
      ids,
      batchSize: config.batchSize,
      dryRun,
      op: op,
      friendly: friendly,
      idField,
    });
    res.batchRefs = (res.batchRefs || []).map((r) => ({ ...r, erc: batchERC }));
    return res;
  }

  async _deleteByBatch(
    config,
    {
      batchUrl,
      ids,
      batchSize = 100,
      dryRun = false,
      op,
      friendly,
      idField = 'id',
    }
  ) {
    if (!ids || ids.length === 0) return { success: true, count: 0 };

    const chunks = this._chunkArray(ids, batchSize);
    const batchRefs = [];

    for (const chunk of chunks) {
      const payload = chunk.map((id) => ({ [idField]: id }));

      if (dryRun) {
        logger.info(`[DRY RUN] Would delete batch of ${chunk.length} items`, {
          url: batchUrl,
        });
        batchRefs.push({
          taskId: `dry-run-${crypto.randomUUID()}`,
          count: chunk.length,
        });
        continue;
      }

      const res = await this._delete(config, batchUrl, payload, op, friendly);
      batchRefs.push({ taskId: res.id, count: chunk.length });
    }

    return {
      success: true,
      count: ids.length,
      batchRefs,
    };
  }

  async _deleteByIds(
    config,
    {
      baseDeletePath,
      ids,
      concurrency = 5,
      retryOn = [404],
      dryRun = false,
      op,
      friendly,
    }
  ) {
    if (!ids || ids.length === 0) return { success: true, count: 0 };

    let deletedCount = 0;
    const errors = [];

    const chunks = this._chunkArray(ids, concurrency);

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (id) => {
          const url = `${baseDeletePath}/${id}`;
          if (dryRun) {
            logger.info(`[DRY RUN] Would delete entity at ${url}`);
            deletedCount++;
            return;
          }

          try {
            await this._delete(config, url, null, op, friendly);
            deletedCount++;
          } catch (err) {
            if (retryOn && retryOn.includes(err.status)) {
              logger.debug(`Ignored error ${err.status} deleting ${url}`);
              deletedCount++; // Count as "processed"
              return;
            }
            errors.push({ id, error: err.message });
          }
        })
      );
    }

    return {
      success: errors.length === 0,
      count: deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  _chunkArray(arr, size) {
    if (!size || size <= 0) size = 100;
    return Array.from({ length: Math.ceil(arr.length / size) }, (v, i) =>
      arr.slice(i * size, i * size + size)
    );
  }

  async _deleteBatchSimulated(
    config,
    { entityName, ids, dryRun, basePath, op, friendly, concurrency, retryOn }
  ) {
    const { logger } = this.ctx;

    logger.debug(`Submitting simulated batch delete for ${entityName}`, {
      count: ids.length,
      dryRun,
    });

    return await this._deleteByIds(config, {
      baseDeletePath: basePath,
      ids: ids,
      concurrency: concurrency,
      retryOn: retryOn,
      dryRun,
      op: op,
      friendly: friendly,
    });
  }

  async _collectPagedItems(
    config,
    { listUrl, pageSize, filter, search, fields, op, friendly }
  ) {
    let allItems = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await this._get(config, listUrl, op, friendly, {
        params: {
          page,
          pageSize,
          filter,
          search,
          fields,
        },
      });

      const items = asItems(res);
      allItems = allItems.concat(items);

      const totalCount = asCount(res);
      hasMore = allItems.length < totalCount && items.length > 0;
      page++;
    }

    return allItems;
  }

  async createWarehousesBatch(config, warehousesData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'warehouse',
      items: warehousesData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-warehouses-batch',
      friendly: 'Failed to create warehouses batch',
      path: PATH.WAREHOUSES_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      warehouseCount: results.count,
    };
  }

  async createWarehouseItemsBatch(config, itemsData, opts = {}) {
    const warehouseERC = opts.warehouseExternalReferenceCode;
    const warehouseId = opts.warehouseId;

    const results = await this._postBatch(config, {
      entityName: 'inventory',
      items: itemsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-inventory-batch',
      friendly: 'Failed to create inventory batch',
      path: (callback) =>
        PATH.WAREHOUSE_INVENTORY_BATCH_SCOPED(
          warehouseId,
          warehouseERC,
          callback
        ),
      sessionId: opts.sessionId,
      session: opts.session,
      createStrategy: 'UPSERT',
      skipItemERC: true,
    });

    return results;
  }

  async createWarehouse(config, warehouseData) {
    return await this._post(
      config,
      PATH.WAREHOUSES,
      warehouseData,
      'create-warehouse',
      'Failed to create warehouse'
    );
  }

  async deleteWarehouse(config, warehouseId) {
    return await this._delete(
      config,
      `${PATH.WAREHOUSES}/${warehouseId}`,
      null,
      'delete-warehouse',
      'Failed to delete warehouse'
    );
  }

  async updateProductInventory(config, warehouseId, sku, inventoryData) {
    return await this._post(
      config,
      PATH.WAREHOUSE_INVENTORIES(warehouseId),
      { ...inventoryData, sku },
      'update-product-inventory',
      'Failed to update product inventory'
    );
  }

  async getWarehouseItems(
    config,
    warehouseId,
    { filter, page, pageSize } = {}
  ) {
    return await this._get(
      config,
      PATH.WAREHOUSE_INVENTORIES(warehouseId),
      'warehouse:items',
      'Get warehouse items',
      { params: { filter, page, pageSize } }
    );
  }

  async getCurrencies(config) {
    const data = await this._get(config, PATH.CURRENCIES, 'get-currencies');
    const items = asItems(data);
    const lang = config.languageId || 'en_US';

    return items.map((currency) => {
      let name = currency.name?.[lang];

      if (!name && currency.name) {
        // Fallback to en_US
        name = currency.name['en_US'];
      }

      if (!name && currency.name && typeof currency.name === 'object') {
        // Fallback to first available translation
        const values = Object.values(currency.name);
        if (values.length > 0) name = values[0];
      }

      return {
        code: currency.code,
        name: name || currency.code,
      };
    });
  }

  async getProductById(config, productId) {
    return await this._get(
      config,
      PATH.PRODUCT(productId),
      'get-product-by-id'
    );
  }

  async patchProductById(config, productId, data) {
    return await this._patch(
      config,
      PATH.PRODUCT(productId),
      data,
      'patch-product-by-id',
      'Failed to patch product'
    );
  }

  async createProduct(config, productData) {
    const { logger } = this.ctx;
    if (!productData.catalogId && config.catalogId) {
      productData.catalogId = parseInt(config.catalogId, 10);
    }

    logger.debug('Creating product with payload:', {
      sku: productData.sku,
      name: productData.name?.[config.languageId || 'en_US'] || 'N/A',
      catalogId: productData.catalogId,
      productType: productData.productType,
      payloadKeys: Object.keys(productData),
    });

    const data = await this._post(
      config,
      PATH.PRODUCTS,
      productData,
      'create-product',
      'Failed to create product'
    );

    return data;
  }

  async createProductsBatch(config, productsData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'product',
      items: productsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'sku',
      op: 'create-products-batch',
      friendly: 'Failed to create products batch',
      path: PATH.PRODUCTS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      productCount: results.count,
    };
  }

  async createWarehouseChannelsBatch(config, itemsData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'warehouse-channel',
      items: itemsData,
      externalReferenceCode: opts.externalReferenceCode,
      op: 'create-warehouse-channels-batch',
      friendly: 'Failed to create warehouse channels batch',
      path: PATH.WAREHOUSE_CHANNELS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
      createStrategy: 'CREATE',
      skipItemERC: true,
    });

    return results;
  }

  async createWarehouseChannel(config, warehouseId, channelId) {
    // HARDENING: Ensure we only send the primitive IDs to prevent nesting corruption.
    // Liferay Commerce relationship APIs are strict and reject unknown properties.
    const cleanedWarehouseId =
      typeof warehouseId === 'object' ? warehouseId.id : warehouseId;
    const cleanedChannelId =
      typeof channelId === 'object' ? channelId.channelId : channelId;

    const payload = {
      channelId: parseInt(cleanedChannelId, 10),
      warehouseId: parseInt(cleanedWarehouseId, 10),
    };

    try {
      const data = await this._post(
        config,
        PATH.WAREHOUSE_CHANNELS(cleanedWarehouseId),
        payload,
        'create-warehouse-channel',
        'Failed to link warehouse to channel'
      );
      return data;
    } catch (error) {
      if (error.response?.status === 409 || error.status === 409) {
        // Log a warning and bypass since the link relation already exists
        return { status: 'ALREADY_EXISTS' };
      }
      throw error;
    }
  }

  async createAccount(config, accountData) {
    const data = await this._post(
      config,
      PATH.ACCOUNTS,
      accountData,
      'create-account',
      null,
      'handle'
    );

    return data;
  }

  async patchAccount(config, accountId, accountData) {
    return await this._patch(
      config,
      PATH.ACCOUNT(accountId),
      accountData,
      'patch-account',
      'Failed to patch account'
    );
  }

  async patchAccountByERC(config, externalReferenceCode, accountData) {
    return await this._patch(
      config,
      PATH.ACCOUNT_BY_ERC(externalReferenceCode),
      accountData,
      'patch-account-by-erc',
      'Failed to patch account by ERC'
    );
  }

  async getAccountByERC(config, externalReferenceCode) {
    try {
      const res = await this._get(
        config,
        PATH.ACCOUNT_BY_ERC(externalReferenceCode),
        'get-account-by-erc'
      );
      if (res && res.softEmpty) return null;
      return res;
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get account by ERC: ${error.message}`, {
        cause: error,
      });
    }
  }

  async getCountries(config) {
    const { cache, logger } = this.ctx;
    const correlationId = config?.correlationId;
    const cacheKey = 'LIFERAY_COUNTRIES';

    logger.debug('[getCountries] - Start', { correlationId, cacheKey });

    let countries = cache.get(cacheKey);
    if (countries) {
      logger.debug('[getCountries] - Cache hit', {
        correlationId,
        cacheKey,
        countriesCount: countries.length,
      });
      return countries;
    }
    logger.debug('[getCountries] - Cache miss', { correlationId, cacheKey });

    const data = await this._get(
      config,
      PATH.COUNTRIES,
      'get-countries',
      null,
      { params: { pageSize: 1000, active: true } }
    );

    countries = asItems(data);

    logger.debug('[getCountries] - API call completed', {
      correlationId,
      cacheKey,
      countriesCount: countries.length,
    });

    cache.set(cacheKey, countries, 900000);

    logger.debug('[getCountries] - Cache set', {
      correlationId,
      cacheKey,
      countriesCount: countries.length,
    });
    return countries;
  }

  async getCountryRegions(config, countryId) {
    const { cache, logger } = this.ctx;
    const correlationId = config?.correlationId;
    const cacheKey = `LIFERAY_REGIONS_${countryId}`;

    logger.debug('[getCountryRegions] - Start', { correlationId, cacheKey });

    let regions = cache.get(cacheKey);
    if (regions) {
      logger.debug('[getCountryRegions] - Cache hit', {
        correlationId,
        cacheKey,
        regionsCount: regions.length,
      });
      return regions;
    }
    logger.debug('[getCountryRegions] - Cache miss', {
      correlationId,
      cacheKey,
    });

    const data = await this._get(
      config,
      PATH.COUNTRY_REGIONS(countryId),
      'get-country-regions',
      null,
      { params: { pageSize: 1000, active: true } }
    );
    regions = asItems(data);

    logger.debug('[getCountryRegions] - API call completed', {
      correlationId,
      cacheKey,
      regionsCount: regions.length,
    });

    cache.set(cacheKey, regions, 900000);
    logger.debug('[getCountryRegions] - Cache set', {
      correlationId,
      cacheKey,
      regionsCount: regions.length,
    });
    return regions;
  }

  async createAccountAddress(config, accountId, addressData) {
    return await this._post(
      config,
      PATH.ACCOUNT_ADDRESSES(accountId),
      addressData,
      'create-account-address',
      'Failed to create account address'
    );
  }

  async createAccountAddressBatch(config, accountId, addressesData, opts = {}) {
    // HARDENING: Strip accountId from items as it is not allowed in the DTO
    // and is already in the URL path.
    const preparedItems = addressesData.map((addr) => {
      const { accountId: _aid, ...rest } = addr;
      return rest;
    });

    const results = await this._postBatch(config, {
      entityName: 'address',
      items: preparedItems,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'id',
      op: 'create-account-addresses-batch',
      friendly: 'Failed to create account addresses batch',
      path: (callback) => PATH.ACCOUNT_ADDRESSES_BATCH(accountId, callback),
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      addressCount: results.count,
    };
  }

  async createProductSkusBatch(config, skusData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'sku',
      items: skusData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'sku',
      op: 'create-skus-batch',
      friendly: 'Failed to create SKUs batch',
      path: (callback) => {
        if (opts.productId || opts.productExternalReferenceCode) {
          return PATH.PRODUCT_SKUS_BATCH_SCOPED(
            opts.productId,
            opts.productExternalReferenceCode,
            callback
          );
        }
        return PATH.PRODUCTS_SKUS_BATCH(callback);
      },
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      skuCount: results.count,
    };
  }

  async createSpecificationsBatch(config, specificationsData, opts = {}) {
    return await this._postBatch(config, {
      entityName: 'specification',
      items: specificationsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-specifications-batch',
      friendly: 'Failed to create specifications batch',
      path: PATH.SPECIFICATIONS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });
  }

  async createOptionsBatch(config, optionsData, opts = {}) {
    return await this._postBatch(config, {
      entityName: 'option',
      items: optionsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-options-batch',
      friendly: 'Failed to create options batch',
      path: PATH.OPTIONS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });
  }

  async createAccountsBatch(config, accountsData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'account',
      items: accountsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'name',
      op: 'create-accounts-batch',
      friendly: 'Failed to create accounts batch',
      path: PATH.ACCOUNTS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      accountCount: results.count,
    };
  }

  _cacheItemERCs(batchERC, batchId, itemERCs, sessionId = null) {
    const { cache, config: configService, logger } = this.ctx;
    const ttl = getBatchCacheTTLms(configService);

    if (itemERCs && itemERCs.length > 0) {
      if (batchERC) {
        cache.set(`erc:${batchERC}:itemERCs`, itemERCs, ttl);
      }
      if (batchId) {
        cache.set(`batch:${batchId}:itemERCs`, itemERCs, ttl);
      }
      if (sessionId && batchERC) {
        cache.set(
          `session:${sessionId}:itemERCsByBatch:${batchERC}`,
          itemERCs,
          ttl
        );
      }
      logger?.trace?.('cache:itemERCs:stored', {
        scopeERC: batchERC,
        sessionId,
        batchId,
        count: itemERCs.length,
      });
    }
  }

  async createOrdersBatch(config, ordersData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'order',
      items: ordersData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-orders-batch',
      friendly: 'Failed to create orders batch',
      path: PATH.ORDERS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return {
      ...results,
      orderCount: results.count,
    };
  }

  async createOrder(config, orderData) {
    const { logger } = this.ctx;
    if (!orderData.channelId)
      throw new Error('channelId is required for order creation');
    if (!orderData.currencyCode)
      throw new Error('currencyCode is required for order creation');

    orderData.channelId = parseInt(orderData.channelId, 10);

    logger.trace('Creating order with payload', {
      channelId: orderData.channelId,
      currencyCode: orderData.currencyCode,
      accountId: orderData.accountId,
      payloadKeys: Object.keys(orderData),
    });

    return await this._post(
      config,
      PATH.ORDERS,
      orderData,
      'create-order',
      'Failed to create order'
    );
  }

  async createPriceList(config, priceListData) {
    return await this._post(
      config,
      PATH.PRICE_LISTS,
      priceListData,
      'create-price-list',
      'Failed to create price list'
    );
  }

  async patchPriceList(config, priceListId, priceListData) {
    return await this._patch(
      config,
      PATH.PRICE_LIST(priceListId),
      priceListData,
      'patch-price-list',
      'Failed to patch price list'
    );
  }

  async getPriceListByERC(config, externalReferenceCode) {
    try {
      const res = await this._get(
        config,
        PATH.PRICE_LIST_BY_ERC(externalReferenceCode),
        'get-price-list-by-erc'
      );
      if (res && res.softEmpty) return null;
      return res;
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  }

  async getPriceLists(
    config,
    { filter, page, pageSize, search, sort, catalogId } = {}
  ) {
    const params = { filter, page, pageSize, search, sort };
    const res = await this._get(
      config,
      PATH.PRICE_LISTS + q(params),
      'get-price-lists'
    );

    if (catalogId && res.items) {
      const filteredItems = res.items.filter(
        (pl) => parseInt(pl.catalogId, 10) === parseInt(catalogId, 10)
      );
      return {
        ...res,
        items: filteredItems,
        totalCount: filteredItems.length,
      };
    }

    return res;
  }

  async getPriceEntries(config, priceListId, { filter, page, pageSize } = {}) {
    const params = { filter, page, pageSize };
    return await this._get(
      config,
      PATH.PRICE_ENTRIES(priceListId) + q(params),
      'price-entries:list'
    );
  }

  async createPriceListsBatch(config, priceListsData, opts = {}) {
    return await this._postBatch(config, {
      entityName: 'pricelist',
      items: priceListsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-price-lists-batch',
      friendly: 'Failed to create price lists batch',
      path: PATH.PRICE_LISTS_BATCH,
      sessionId: opts.sessionId,
      session: opts.session,
    });
  }

  async createPriceEntriesBatch(config, priceEntriesData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'priceentry',
      items: priceEntriesData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'externalReferenceCode',
      op: 'create-price-entries-batch',
      friendly: 'Failed to create price entries batch',
      method: 'POST',
      path: (callback) => {
        if (opts.priceListExternalReferenceCode || opts.priceListId) {
          return PATH.PRICE_LIST_PRICE_ENTRIES_BATCH(
            opts.priceListExternalReferenceCode,
            callback
          );
        }
        return PATH.PRICE_ENTRIES_BATCH_POST(callback);
      },
      sessionId: opts.sessionId,
      session: opts.session,
    });

    return results;
  }

  async createPriceEntry(config, priceListId, priceEntryData) {
    return await this._post(
      config,
      PATH.PRICE_ENTRIES(priceListId),
      priceEntryData,
      'create-price-entry',
      'Failed to create price entry'
    );
  }

  async createSkuPriceEntry(config, priceListId, skuId, priceEntryData) {
    return await this._post(
      config,
      PATH.PRICE_ENTRIES(priceListId),
      { ...priceEntryData, skuId },
      'create-sku-price-entry',
      'Failed to create SKU price entry'
    );
  }

  async createProductSku(config, productId, skuData) {
    return await this._post(
      config,
      PATH.PRODUCT_SKUS(productId),
      skuData,
      'create-sku',
      'Failed to create SKU'
    );
  }

  async addProductOptions(config, productId, productOptions, productERC) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError;

    // HARDENING: Use ERC-based path if available to bypass Indexing Lag
    const path = productERC
      ? PATH.PRODUCT_OPTIONS_BY_ERC(productERC)
      : PATH.PRODUCT_OPTIONS(productId);

    while (attempts < maxAttempts) {
      try {
        return await this._post(
          config,
          path,
          productOptions,
          'add-product-options',
          'Failed to add product options'
        );
      } catch (error) {
        lastError = error;
        // If 404, the product might not be ready yet
        if (error.problem?.status === 404 || error.status === 404) {
          attempts++;
          if (attempts < maxAttempts) {
            const delayMs = 2000 * attempts;
            logger.warn(
              `Product ${productERC || productId} not found for options link, retrying in ${delayMs}ms...`,
              { attempt: attempts, productId: productId, productERC }
            );
            await delay(delayMs);
            continue;
          }
        }
        throw error;
      }
    }
    throw lastError;
  }

  async addProductChannels(config, productId, channelIds, productERC) {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError;

    const path = productERC
      ? PATH.PRODUCT_CHANNELS_BY_ERC(productERC)
      : PATH.PRODUCT_CHANNELS(productId);

    // DTO expects an array of { channelId: 123 }
    const payload = channelIds.map((id) => ({ channelId: parseInt(id, 10) }));

    while (attempts < maxAttempts) {
      try {
        return await this._post(
          config,
          path,
          payload,
          'add-product-channels',
          'Failed to add product channels'
        );
      } catch (error) {
        lastError = error;
        if (error.problem?.status === 404 || error.status === 404) {
          attempts++;
          if (attempts < maxAttempts) {
            const delayMs = 2000 * attempts;
            logger.warn(
              `Product ${productERC || productId} not found for channels link, retrying in ${delayMs}ms...`,
              { attempt: attempts, productId, productERC }
            );
            await delay(delayMs);
            continue;
          }
        }
        throw error;
      }
    }
    throw lastError;
  }

  async addWarehouseChannel(config, warehouseId, channelId) {
    const path = PATH.WAREHOUSE_CHANNELS(warehouseId);
    const payload = {
      channelId: parseInt(channelId, 10),
      warehouseId: parseInt(warehouseId, 10),
    };

    return await this._post(
      config,
      path,
      payload,
      'add-warehouse-channel',
      'Failed to add warehouse channel'
    );
  }

  async deleteProductOption(config, productId, productOptionId) {
    return await this._delete(
      config,
      PATH.PRODUCT_OPTION(productOptionId),
      null,
      'delete-product-option',
      'Failed to delete product option'
    );
  }

  async getCommerceProductOptions(config, productId) {
    const data = await this._get(
      config,
      PATH.PRODUCT_OPTIONS(productId),
      'get-product-options'
    );
    return asItems(data);
  }

  async deleteProductSpecification(config, productId, productSpecificationId) {
    return await this._delete(
      config,
      PATH.PRODUCT_SPECIFICATION(productSpecificationId),
      null,
      'delete-product-specification',
      'Failed to delete product specification'
    );
  }

  async getCommerceProductSpecifications(config, productId) {
    const data = await this._get(
      config,
      PATH.PRODUCT_SPECIFICATIONS(productId),
      'get-product-specifications'
    );
    return asItems(data);
  }

  async createSpecificationCategory(config, categoryData) {
    return await this._post(
      config,
      PATH.SPECIFICATION_CATEGORIES,
      categoryData,
      'create-specification-category',
      'Failed to create specification category'
    );
  }

  async getSpecificationCategoryByKey(config, key) {
    try {
      const res = await this._get(
        config,
        PATH.SPECIFICATION_CATEGORIES,
        'specification-categories:list',
        'Find spec category by key',
        {
          params: {
            page: 1,
            pageSize: 1,
            filter: `key eq '${key}'`,
            fields: 'id,key,externalReferenceCode',
          },
        }
      );
      const items = asItems(res);
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(
        `Failed to get specification category by key: ${error.message}`,
        { cause: error }
      );
    }
  }

  async createSpecificationCategoryWithReuse(config, payload) {
    const key = payload?.key;
    if (key) {
      try {
        const existing = await this.getSpecificationCategoryByKey(config, key);
        if (existing) {
          return existing;
        }
      } catch (err) {
        // Ignore pre-check lookup errors and fall back to creation
      }
    }

    try {
      return await this.createSpecificationCategory(config, payload);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.status === 400 || // Match 400 duplicate/bad requests as conflicts
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict') ||
        msg.includes('duplicate') ||
        msg.includes('already exists');

      if (!isConflict) throw e;

      if (!key) throw e;

      const existing = await this.getSpecificationCategoryByKey(config, key);
      if (!existing) throw e;

      return existing;
    }
  }

  async createSpecification(config, specificationData) {
    const { logger } = this.ctx;
    logger.debug(`LiferayRestService.createSpecification called with:`, {
      specificationKey: specificationData.key,
      specificationName: specificationData.title?.en_US,
      liferayUrl: config.liferayUrl,
    });

    const data = await this._post(
      config,
      PATH.SPECIFICATIONS,
      specificationData,
      'create-specification',
      'Failed to create specification'
    );

    logger.debug(`✓ Specification created successfully:`, data);
    return data;
  }

  async getSkuByERC(config, erc) {
    return await this._get(
      config,
      PATH.SKU_BY_ERC(erc),
      'get-sku-by-erc',
      'Get SKU by ERC'
    );
  }

  async getSkusByERC(config, ercs) {
    if (!ercs || ercs.length === 0) return [];

    // HARDENING: Switch to REST discovery for SKUs to bypass GQL indexing lag
    const results = await Promise.allSettled(
      ercs.map((erc) => this.getSkuByERC(config, erc))
    );

    return results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  }

  async getSpecificationByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.SPECIFICATION_BY_ERC(externalReferenceCode),
        'get-specification-by-erc'
      );
    } catch (error) {
      // Safely return null on any error (404, 400, 500) to allow graceful fallback to key lookup
      this.ctx.logger.debug(
        `Failed to fetch specification by ERC '${externalReferenceCode}'. Bypassing. Error: ${error.message}`
      );
      return null;
    }
  }

  async getSpecificationByKey(config, key) {
    try {
      const res = await this._get(
        config,
        PATH.SPECIFICATIONS,
        'specifications:list',
        'Find specification by key',
        {
          params: {
            page: 1,
            pageSize: 1,
            filter: `key eq '${key}'`,
            fields: 'id,key,externalReferenceCode',
          },
        }
      );
      const items = asItems(res);
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(`Failed to get specification by key: ${error.message}`, {
        cause: error,
      });
    }
  }

  async updateSpecificationById(config, id, payload) {
    const url = `${PATH.SPECIFICATIONS}/${encodeURIComponent(id)}`;
    return this._put(
      config,
      url,
      payload,
      'update-specification-by-id',
      'Failed to update specification by ID'
    );
  }

  async createSpecificationWithReuse(config, payload) {
    const { logger } = this.ctx;
    const key = payload?.key;
    const erc = payload?.externalReferenceCode;
    let existing = null;

    // 1. Try Lookup-First before posting to prevent duplicate key database crashes
    if (erc) {
      try {
        existing = await this.getSpecificationByERC(config, erc);
      } catch (err) {
        // Ignore and try key
      }
    }
    if (!existing && key) {
      try {
        existing = await this.getSpecificationByKey(config, key);
      } catch (err) {
        // Ignore and fall back to create
      }
    }

    if (existing) {
      // If found, update its ERC if mismatched and return it
      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateSpecificationById(config, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch {
          logger.warn(
            `Failed to update ERC for existing specification '${key}'`
          );
        }
      }
      return existing;
    }

    // 2. Fall back to Creation
    try {
      return await this.createSpecification(config, payload);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.status === 400 || // Match 400 bad requests as potential conflicts
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict') ||
        msg.includes('duplicate') ||
        msg.includes('already exists');

      if (!isConflict) throw e;

      logger.trace(
        `Conflict creating specification, attempting to fetch by key: ${payload.key}`
      );

      if (!key) {
        throw new Error(
          'Conflict on createSpecification, but no key was provided to find existing.',
          { cause: e }
        );
      }

      existing = await this.getSpecificationByKey(config, key);

      if (!existing) {
        throw new Error(
          `Conflict creating specification '${key}', but could not retrieve the existing one.`,
          { cause: e }
        );
      }

      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateSpecificationById(config, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch {
          logger.warn(
            `Failed to update ERC for existing specification '${key}'`
          );
        }
      }
      return existing;
    }
  }

  async createOption(config, optionData) {
    // Last-line-of-defense validation for Commerce constraints
    if (
      optionData.skuContributor &&
      !COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES.includes(
        optionData.fieldType
      )
    ) {
      logger.warn(
        `REST: fieldType '${optionData.fieldType}' is incompatible with skuContributor. Disabling skuContributor.`,
        { optionKey: optionData.key }
      );
      optionData.skuContributor = false;
    }

    logger.debug(`LiferayRestService.createOption called with:`, {
      optionKey: optionData.key,
      optionName: optionData.name?.en_US,
      fieldType: optionData.fieldType,
      liferayUrl: config.liferayUrl,
    });

    const data = await this._post(
      config,
      PATH.OPTIONS,
      optionData,
      'create-option',
      'Failed to create option'
    );

    logger.debug(`✓ Option created successfully:`, data);
    return data;
  }

  async createOptionWithReuse(config, optionData) {
    const erc = optionData?.externalReferenceCode;
    const key = optionData?.key;
    let existing = null;

    // 1. Try Lookup-First before posting to prevent duplicate key database crashes
    if (erc) {
      try {
        existing = await this.getOptionByERC(config, erc);
      } catch (err) {
        // Ignore and try key
      }
    }
    if (!existing && key) {
      try {
        existing = await this.getOptionByKey(config, key);
      } catch (err) {
        // Ignore and fall back to create
      }
    }

    if (existing) {
      // If found, update its ERC if mismatched and return it
      if (
        erc &&
        existing.externalReferenceCode !== erc &&
        typeof this.updateOptionById === 'function'
      ) {
        try {
          await this.updateOptionById(config, existing.id, {
            externalReferenceCode: erc,
          });
        } catch {
          // Ignore
        }
      }
      return existing;
    }

    // 2. Fall back to Creation
    try {
      return await this.createOption(config, optionData);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.status === 400 || // Match 400 bad requests as potential conflicts
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict') ||
        msg.includes('duplicate') ||
        msg.includes('already exists');

      if (!isConflict) throw e;

      // Repeat lookup on conflict to ensure we retrieve it
      if (erc) {
        try {
          existing = await this.getOptionByERC(config, erc);
        } catch (ercError) {
          this.ctx.logger.debug(
            `Failed lookup by ERC '${erc}' after conflict. Error: ${ercError.message}`
          );
        }
      }
      if (!existing && key) {
        try {
          existing = await this.getOptionByKey(config, key);
        } catch (keyError) {
          this.ctx.logger.debug(
            `Failed lookup by Key '${key}' after conflict. Error: ${keyError.message}`
          );
        }
      }
      if (!existing) throw e;

      if (
        erc &&
        existing.externalReferenceCode !== erc &&
        typeof this.updateOptionById === 'function'
      ) {
        try {
          await this.updateOptionById(config, existing.id, {
            externalReferenceCode: erc,
          });
        } catch {
          // Ignore error
        }
      }
      return existing;
    }
  }

  async createOptionValue(config, optionId, optionValueData) {
    return await this._post(
      config,
      PATH.OPTION_VALUES(optionId),
      optionValueData,
      'create-option-value',
      'Failed to create option value'
    );
  }

  async getOptionByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_BY_ERC(externalReferenceCode),
        'get-option-by-erc'
      );
    } catch (error) {
      // Safely return null on any error (404, 400, 500) to allow graceful fallback to key lookup
      this.ctx.logger.debug(
        `Failed to fetch option by ERC '${externalReferenceCode}'. Bypassing. Error: ${error.message}`
      );
      return null;
    }
  }

  async getOptionByKey(config, key) {
    try {
      const res = await this._get(
        config,
        PATH.OPTIONS,
        'options:list',
        'Find option by key',
        {
          params: {
            page: 1,
            pageSize: 1,
            filter: `key eq '${key}'`,
            fields: 'id,key,externalReferenceCode',
          },
        }
      );
      const items = asItems(res);
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(`Failed to get option by key: ${error.message}`, {
        cause: error,
      });
    }
  }

  async updateOptionById(config, id, payload) {
    const url = `${PATH.OPTIONS}/${encodeURIComponent(id)}`;
    return this._put(
      config,
      url,
      payload,
      'update-option-by-id',
      'Failed to update option by ID'
    );
  }

  async getOptionValueByERC(config, optionId, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_VALUE_BY_ERC(optionId, externalReferenceCode),
        'get-option-value-by-erc'
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option value by ERC: ${error.message}`, {
        cause: error,
      });
    }
  }

  async getOptionValueByKey(config, optionId, key) {
    const listUrl = `${PATH.OPTIONS}/${encodeURIComponent(
      optionId
    )}/productOptionValues`;
    const res = await this._get(
      config,
      listUrl,
      'optionValues:list',
      'Find option value by key',
      {
        params: {
          page: 1,
          pageSize: 1,
          search: key,
          fields: 'id,key,externalReferenceCode',
        },
      }
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    return items.find((it) => it.key === key) || null;
  }

  async updateOptionValueById(config, optionId, valueId, payload) {
    const url = PATH.OPTION_VALUE(valueId);
    return this._patch(
      config,
      url,
      payload,
      'update-option-value-by-id',
      'Failed to update option value by ID'
    );
  }

  async updateOptionValueByERC(
    config,
    optionId,
    externalReferenceCode,
    payload
  ) {
    const url = PATH.OPTION_VALUE_BY_ERC(optionId, externalReferenceCode);
    return this._patch(
      config,
      url,
      payload,
      'update-option-value-by-erc',
      'Failed to update option value by ERC'
    );
  }

  async createOptionValueWithReuse(config, optionId, payload) {
    try {
      return await this.createOptionValue(config, optionId, payload);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const problemTitle = String(e?.problem?.title || '').toLowerCase();

      const isConflict =
        e?.status === 409 ||
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict') ||
        problemTitle.includes('duplicate key');

      if (!isConflict) throw e;

      let existing = null;
      const erc = payload?.externalReferenceCode;
      const key = payload?.key;

      if (erc) {
        try {
          existing = await this.getOptionValueByERC(config, optionId, erc);
        } catch {
          // Ignore error
        }
      }
      if (!existing && key) {
        try {
          existing = await this.getOptionValueByKey(config, optionId, key);
        } catch {
          // Ignore error
        }
      }
      if (!existing) throw e;

      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateOptionValueById(config, optionId, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch {
          // Ignore error
        }
      }
      return existing;
    }
  }

  async createOptionCategory(config, optionCategoryData) {
    return await this._post(
      config,
      PATH.OPTION_CATEGORIES,
      optionCategoryData,
      'create-option-category',
      'Failed to create option category'
    );
  }

  async getOptionCategoryByKey(config, key) {
    try {
      const res = await this._get(
        config,
        PATH.OPTION_CATEGORIES,
        'optionCategories:list',
        'Find option category by key',
        {
          params: {
            page: 1,
            pageSize: 1,
            filter: `key eq '${key}'`,
            fields: 'id,key,externalReferenceCode,title,description,priority',
          },
        }
      );
      const items = asItems(res);
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(
        `Failed to get option category by key: ${error.message}`,
        {
          cause: error,
        }
      );
    }
  }

  async _listOptionCategories(
    config,
    {
      search,
      filter,
      pageSize = 200,
      fields = 'id,key,externalReferenceCode',
    } = {}
  ) {
    return this._get(
      config,
      PATH.OPTION_CATEGORIES,
      'optionCategories:list',
      'List option categories',
      {
        params: {
          page: 1,
          pageSize,
          fields,
          ...(search ? { search } : {}),
          ...(filter ? { filter } : {}),
        },
      }
    );
  }

  async updateOptionCategoryById(config, id, payload) {
    const url = PATH.OPTION_CATEGORY(id);
    return this._patch(
      config,
      url,
      payload,
      'update-option-category-by-id',
      'Failed to update option category by ID'
    );
  }

  async createOptionCategoryWithReuse(config, payload) {
    const { logger } = this.ctx;
    try {
      return await this.createOptionCategory(config, payload);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict');

      if (!isConflict) throw e;

      logger.trace(
        `Conflict creating option category, attempting to fetch by key: ${payload.key}`
      );

      const key = payload?.key;
      if (!key) {
        throw new Error(
          'Conflict on createOptionCategory, but no key was provided to find existing.',
          { cause: e }
        );
      }

      const existing = await this.getOptionCategoryByKey(config, key);

      if (!existing) {
        throw new Error(
          `Conflict creating option category '${key}', but could not retrieve the existing one.`,
          { cause: e }
        );
      }

      const erc = payload?.externalReferenceCode;
      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateOptionCategoryById(config, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch {
          logger.warn(
            `Failed to update ERC for existing option category '${key}'`
          );
        }
      }
      return existing;
    }
  }

  async getOptionCategoryByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_CATEGORY_BY_ERC(externalReferenceCode),
        'get-option-category-by-erc'
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(
        `Failed to get option category by ERC: ${error.message}`,
        {
          cause: error,
        }
      );
    }
  }

  async getOptionCategories(
    config,
    { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {}
  ) {
    return this._listOptionCategories(config, { search, pageSize, fields });
  }

  async getPostalAddressByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.POSTAL_ADDRESS_BY_ERC(externalReferenceCode),
        'get-postal-address-by-erc'
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get postal address by ERC: ${error.message}`, {
        cause: error,
      });
    }
  }

  async addProductImage(config, productId, image) {
    return await this._post(
      config,
      PATH.PRODUCT_IMAGES_BY_URL(productId),
      image,
      'add-product-image',
      'Failed to add product image'
    );
  }

  async addProductDocumentAttachment(config, productId, attachment) {
    return await this._post(
      config,
      PATH.PRODUCT_ATTACHMENTS_BY_URL(productId),
      attachment,
      'add-product-document-attachment',
      'Failed to add product document attachment'
    );
  }

  async addProductImageByBase64(config, productERC, image) {
    return await this._post(
      config,
      PATH.PRODUCT_IMAGES_BY_BASE64(productERC),
      image,
      'add-product-image-by-base64',
      'Failed to add product image by base64'
    );
  }

  async addProductDocumentAttachmentByBase64(config, productERC, attachment) {
    return await this._post(
      config,
      PATH.PRODUCT_ATTACHMENTS_BY_BASE64(productERC),
      attachment,
      'add-product-document-attachment-by-base64',
      'Failed to add product document attachment by base64'
    );
  }

  async addProductImageDocumentLibrary(
    config,
    productId,
    { documentId, title, priority = 1 }
  ) {
    const payload = {
      externalReferenceCode: createERC(ERC_PREFIX.IMAGE),
      priority,
      title: typeof title === 'object' ? title : { en_US: title },
      type: 2, // 2 is typically the type for Document Library entries in some Liferay versions, or we use standard URL pattern
      src: documentId, // The internal ID or UUID depending on the endpoint expectation
    };

    return await this._post(
      config,
      PATH.PRODUCT_IMAGES(productId),
      payload,
      'add-product-image-dl',
      'Failed to add product image via Document Library'
    );
  }

  async addProductDocumentAttachmentDocumentLibrary(
    config,
    productId,
    { documentId, title, priority = 1 }
  ) {
    const payload = {
      externalReferenceCode: createERC(ERC_PREFIX.ATTACHMENT),
      priority,
      title: typeof title === 'object' ? title : { en_US: title },
      type: 2,
      src: documentId,
    };

    return await this._post(
      config,
      PATH.PRODUCT_ATTACHMENTS(productId),
      payload,
      'add-product-attachment-dl',
      'Failed to add product attachment via Document Library'
    );
  }

  async _postMultipart(config, url, formData, op, friendly) {
    return await this._request(config, {
      method: 'POST',
      url,
      data: formData,
      headers: formData.getHeaders(),
      op,
      friendly,
    });
  }

  async addProductImageMultipart(
    config,
    productId,
    { fileStream, fileName, title, priority = 1 }
  ) {
    const formData = new FormData();
    formData.append('file', fileStream, fileName);

    const metadata = {
      title: typeof title === 'object' ? title : { en_US: title || fileName },
      priority,
    };
    formData.append('metadata', JSON.stringify(metadata), {
      contentType: 'application/json',
    });

    return await this._postMultipart(
      config,
      PATH.PRODUCT_IMAGES(productId),
      formData,
      'add-product-image-multipart',
      'Failed to add product image via multipart'
    );
  }

  async addProductDocumentAttachmentMultipart(
    config,
    productId,
    { fileStream, fileName, title, priority = 1 }
  ) {
    const formData = new FormData();
    formData.append('file', fileStream, fileName);

    const metadata = {
      title: typeof title === 'object' ? title : { en_US: title || fileName },
      priority,
    };
    formData.append('metadata', JSON.stringify(metadata), {
      contentType: 'application/json',
    });

    return await this._postMultipart(
      config,
      PATH.PRODUCT_ATTACHMENTS(productId),
      formData,
      'add-product-document-attachment-multipart',
      'Failed to add product document attachment via multipart'
    );
  }

  async setBillingAndShippingAddresses(
    config,
    accountId,
    shippingAddressId,
    billingAddressId
  ) {
    const payload = {};
    if (shippingAddressId) payload.defaultShippingAddressId = shippingAddressId;
    if (billingAddressId) payload.defaultBillingAddressId = billingAddressId;

    return await this._patch(
      config,
      PATH.ACCOUNT(accountId),
      payload,
      'set-billing-and-shipping-addresses',
      'Failed to set billing and shipping addresses'
    );
  }
}

LiferayRestService.SOFT_STATUS_BY_OP = SOFT_STATUS_BY_OP;

module.exports = LiferayRestService;
