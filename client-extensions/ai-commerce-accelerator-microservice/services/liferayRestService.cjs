const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');
const liferayConfig = require('../config/liferayConfig.cjs');
const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');

const { PATH } = require('../utils/liferayPaths.cjs');
const {
  ACTION_IDS,
  ROLE,
  ASSET_TYPE,
  VIEWABLE_BY,
  buildPermissionsItems,
} = require('../utils/liferayPermissions.cjs');
const { DEBUG, ERC_PREFIX, OP_MAP } = require('../utils/constants.cjs');
const { delay, createERC } = require('../utils/misc.cjs');
const { sanitizedERC } = require('../utils/normalize.cjs');
const { parse } = require('csv-parse/sync');
const { getBatchCacheTTLms } = require('../utils/ttl.cjs');

const SOFT_STATUS_BY_OP = {
  'accounts:list': [404],
  'products:list': [404],
  'orders:list': [404],
  'import-task': [404],
  'options:list': [404],
  'pricelists:list': [404],
  'specifications:list': [404],
  'optionCategories:list': [404],
};

class LiferayRestService {
  constructor(ctx) {
    this.ctx = ctx;
    this.axiosInstance = null;
    this.baseUrl = liferayConfig.liferayUrl;
  }

  _stringifySafe(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return '[Unserializable object]';
    }
  }

  _getBaseCallbackUrl(config) {
    if (!config.microserviceUrl) {
      logger.warn(
        'microserviceUrl is not configured. Callbacks will likely fail.',
      );
      return null;
    }
    return `${config.microserviceUrl}/api/v1/batch/callback`;
  }

  _buildCallbackURL(baseUrl, meta = {}) {
    if (!baseUrl) return null;
    try {
      const u = new URL(baseUrl);
      if (meta.entity) u.searchParams.set('entity', String(meta.entity));
      if (meta.op) {
        const raw = String(meta.op).toLowerCase();
        const opCode = OP_MAP[raw] || 'X';
        u.searchParams.set('opCode', opCode);
      }
      if (meta.batchERC) u.searchParams.set('batchERC', String(meta.batchERC));
      if (meta.sessionId)
        u.searchParams.set('sessionId', String(meta.sessionId));
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
    } = {},
  ) {
    try {
      const client = await this._client(config);

      logger.debug('Liferay API Request', {
        operation: op,
        method,
        url,
        data: this._stringifySafe(data),
      });

      const res = await client.request({
        method,
        url,
        data,
        params,
        headers,
        responseType,
      });

      logger.debug('Liferay API Response', {
        operation: op,
        status: res.status,
        data: res.data,
      });

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
                body.errorReference || resHeaders['x-liferay-error-reference'],
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

  _asCount(data) {
    return data?.totalCount || data?.items?.totalCount || 0;
  }

  _asItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  async _downloadFile(config, url, destination) {
    const writer = fs.createWriteStream(destination);

    const response = await this._get(
      config,
      url,
      'download-file',
      'Failed to download file',
      { responseType: 'stream' },
      true,
    );

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async _client(config) {
    return this.createAxiosInstance(config);
  }

  async _get(config, url, op, friendly, opts = {}, fullResponse = false) {
    const { params, headers, responseType } = opts || {};

    const paramsSerializer = (p) =>
      new URLSearchParams(
        Object.entries(p || {}).filter(
          ([, v]) => v !== undefined && v !== null && v !== '',
        ),
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
    fullResponse = false,
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
      `get-permissions:${assetType}`,
    );
    return this._asItems(data);
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
      `put-permissions:${assetType}`,
    );
  }

  async createAxiosInstance(config) {
    const { oauth } = this.ctx;
    const accessToken = await oauth.getAccessToken(
      config.liferayUrl,
      config.clientId,
      config.clientSecret,
    );

    return axios.create({
      baseURL: config.liferayUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

      if (!oauth.isLiferayRouteAvailable()) oauth.validateOAuthConfig(config);

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
    return await this._get(
      config,
      PATH.CONFIG(configKey),
      `get-config:${configKey}`,
    );
  }

  async getCatalogs(config) {
    const data = await this._get(config, PATH.CATALOGS, 'get-catalogs');
    return this._asItems(data);
  }

  async getCatalog(config, catalogId) {
    const data = await this._get(
      config,
      PATH.CATALOG(catalogId),
      'get-catalog',
    );
    return data;
  }

  async getChannels(config) {
    const data = await this._get(config, PATH.CHANNELS, 'get-channels');
    return this._asItems(data);
  }

  async getProducts(config) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    const excludedProducts = excludeLists?.excludedProducts || [];

    const params = new URLSearchParams();
    const filters = [];

    if (config.catalogId) {
      filters.push(`catalogId eq ${config.catalogId}`);
    }

    if (excludedProducts.length > 0) {
      excludedProducts.forEach((exclusion) => {
        if (exclusion.entityId) {
          filters.push(`id ne ${exclusion.entityId}`);
        }
        if (exclusion.erc) {
          filters.push(`externalReferenceCode ne '${exclusion.erc}'`);
        }
        if (exclusion.name) {
          filters.push(`name ne '${exclusion.name}'`);
        }
      });
    }

    if (filters.length > 0) {
      params.append('filter', filters.join(' and '));
    }

    params.append('nestedFields', 'skus');
    params.append('fields', 'id,name,skus,productStatus,published');

    const url = `${PATH.PRODUCTS}?${params.toString()}`;
    const data = await this._get(config, url, 'get-products');
    return this._asItems(data);
  }

  async getProductCount(config) {
    let url =
      PATH.PRODUCTS +
      (config.catalogId ? `?filter=catalogId eq ${config.catalogId}` : '');
    const data = await this._get(config, url, 'get-products');
    return this._asCount(data);
  }

  async getCommerceOrders(
    config,
    { channelId, pageSize = 200, fields = 'id' } = {},
  ) {
    const filters = [];
    if (channelId) filters.push(`channelId eq ${channelId}`);
    const filter = filters.join(' and ');

    return this._get(config, PATH.ORDERS, 'orders:list', 'List orders', {
      params: { page: 1, pageSize, fields, ...(filter ? { filter } : {}) },
    });
  }

  async getCommerceProducts(
    config,
    { catalogId, pageSize = 200, fields = 'productId' } = {},
  ) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    const excludedProducts = excludeLists?.excludedProducts || [];

    const filters = [];
    if (catalogId) filters.push(`catalogId eq ${catalogId}`);

    if (excludedProducts.length > 0) {
      excludedProducts.forEach((exclusion) => {
        if (exclusion.entityId) {
          filters.push(`id ne ${exclusion.entityId}`);
        }
        if (exclusion.erc) {
          filters.push(`externalReferenceCode ne '${exclusion.erc}'`);
        }
        if (exclusion.name) {
          filters.push(`name ne '${exclusion.name}'`);
        }
      });
    }

    const filter = filters.join(' and ');

    return this._get(config, PATH.PRODUCTS, 'products:list', 'List products', {
      params: { page: 1, pageSize, fields, ...(filter ? { filter } : {}) },
    });
  }

  async getCommerceAccounts(
    config,
    { channelId, pageSize = 200, fields = 'id' } = {},
  ) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    const excludedAccounts = excludeLists?.excludedAccounts || [];

    const filters = [];

    if (channelId) {
      const orderAccountIds = await this._collectPagedIds(config, {
        op: 'orders:list',
        friendly: 'List account IDs from orders for channel',
        listUrl: PATH.ORDERS,
        pageSize,
        filter: `channelId eq ${channelId}`,
        fields: 'accountId',
        idKey: 'accountId',
      });

      const uniqueIds = [...new Set(orderAccountIds)].filter(Boolean);

      if (!uniqueIds.length) {
        return {
          items: [],
          page: 1,
          pageSize: 0,
          lastPage: 1,
          totalCount: 0,
        };
      }

      filters.push(`id in (${uniqueIds.join(',')})`);
    }

    if (excludedAccounts.length > 0) {
      excludedAccounts.forEach((exclusion) => {
        if (exclusion.entityId) {
          filters.push(`id ne ${exclusion.entityId}`);
        }
        if (exclusion.erc) {
          filters.push(`externalReferenceCode ne '${exclusion.erc}'`);
        }
        if (exclusion.name) {
          filters.push(`name ne '${exclusion.name}'`);
        }
      });
    }

    const filter = filters.join(' and ');

    return this._get(config, PATH.ACCOUNTS, 'accounts:list', 'List accounts', {
      params: { page: 1, pageSize, fields, ...(filter ? { filter } : {}) },
    });
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

  async getAccounts(config) {
    const { config: configService } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    const excludedAccounts = excludeLists?.excludedAccounts || [];

    const params = new URLSearchParams();
    const filters = [];

    if (excludedAccounts.length > 0) {
      excludedAccounts.forEach((exclusion) => {
        if (exclusion.entityId) {
          filters.push(`id ne ${exclusion.entityId}`);
        }
        if (exclusion.erc) {
          filters.push(`externalReferenceCode ne '${exclusion.erc}'`);
        }
        if (exclusion.name) {
          filters.push(`name ne '${exclusion.name}'`);
        }
      });
    }

    if (filters.length > 0) {
      params.append('filter', filters.join(' and '));
    }

    const url = `${PATH.ACCOUNTS}?${params.toString()}`;
    const data = await this._get(config, url, 'get-accounts');
    return this._asItems(data);
  }

  async getAccountCount(config) {
    const data = await this._get(config, PATH.ACCOUNTS, 'get-accounts');
    return this._asCount(data);
  }

  async getImportTask(config, batchId) {
    if (config.demoMode) {
      const { logger } = this.ctx;
      logger.warn(
        '********************************************************************************',
      );
      logger.warn(
        'LiferayRestService.getImportTask is using a mock implementation for demo mode.',
      );
      logger.warn(
        '********************************************************************************',
      );

      return Promise.resolve({
        data: {
          className: 'com.liferay.headless.admin.user.dto.v1_0.Account',
          contentType: 'JSON',
          endTime: new Date().toISOString(),
          errorMessage:
            'java.lang.IllegalArgumentException: Unrecognized field "domains" (class com.liferay.headless.admin.user.dto.v1_0.AccountContactInformation), not marked as ignorable',
          executeStatus: 'FAILED',
          externalReferenceCode: '504d9fc4-d4fa-4960-c350-df7014cff5f4',
          failedItems: [
            {
              item: 'Unable to read item at index 1',
              itemIndex: 1,
              message:
                'java.lang.IllegalArgumentException: Unrecognized field "domains" (class com.liferay.headless.admin.user.dto.v1_0.AccountContactInformation), not marked as ignorable',
            },
          ],
          id: batchId,
          importStrategy: 'ON_ERROR_FAIL',
          operation: 'CREATE',
          processedItemsCount: 0,
          startTime: new Date().toISOString(),
          totalItemsCount: 5,
        },
      });
    }

    return await this._get(
      config,
      PATH.IMPORT_TASK(batchId),
      'import-task',
      'Failed to get import task',
    );
  }

  async getImportTaskSubmittedContent(config, batchId) {
    const urlResponse = await this._get(
      config,
      PATH.IMPORT_TASK_SUBMITTED_CONTENT(batchId),
      'import-task-submitted-content',
      'Failed to get import task submitted content',
      { headers: { Accept: '*/*' } },
    );

    logger.info('Received urlResponse from getImportTaskSubmittedContent', {
      batchId,
      urlResponse: JSON.stringify(urlResponse, null, 2),
    });

    if (urlResponse && urlResponse.url) {
      const tempFilePath = path.join(tmpdir(), `${uuidv4()}.zip`);

      try {
        await this._downloadFile(config, urlResponse.url, tempFilePath);

        const zip = new StreamZip.async({ file: tempFilePath });
        const entries = await zip.entries();
        const jsonEntry = Object.values(entries).find((entry) =>
          entry.name.endsWith('.json'),
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
      { headers: { Accept: 'application/octet-stream' } },
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
    },
  ) {
    const { logger, cache, config: configService } = this.ctx;

    const erc =
      externalReferenceCode ??
      createERC(ERC_PREFIX[`${entityName.toUpperCase()}_BATCH`]);

    const processedItems = (items || []).map((item) => {
      const extERC = sanitizedERC(
        item.externalReferenceCode || item[itemERCKey] || uuidv4(),
      );
      return { ...item, externalReferenceCode: extERC };
    });

    const itemERCs = processedItems.map((i) => i.externalReferenceCode);

    this._cacheItemERCs(erc, null, itemERCs, sessionId);

    const batchPayload = {
      createStrategy: 'INSERT',
      items: processedItems,
      externalReferenceCode: erc,
    };

    const callbackUrl = this._buildCallbackURL(
      this._getBaseCallbackUrl(config),
      {
        batchERC: erc,
        sessionId: sessionId,
        op: 'create',
      },
    );

    const url = path(callbackUrl);

    logger.info(`Sending batch ${entityName} creation request`, {
      operation: op,
      count: processedItems.length,
      callbackUrl: url,
      externalReferenceCode: erc,
    });

    const data = await this._post(config, url, batchPayload, op, friendly);

    this._cacheItemERCs(erc, data?.id, itemERCs, sessionId);

    if (cache && data?.id) {
      cache.set(
        `batch:${data.id}:submission`,
        {
          op: op,
          erc: erc,
          itemERCs,
          count: processedItems.length,
          createdAt: new Date().toISOString(),
        },
        getBatchCacheTTLms(configService),
      );
    }

    logger?.trace?.('cache:itemERCs:stored', {
      scopeERC: erc,
      sessionId: sessionId || null,
      batchId: data?.id || null,
      count: itemERCs.length,
    });

    logger.info(`Batch ${entityName} creation initiated`, {
      operation: op,
      batchId: data.id || 'unknown',
      status: data.status || 'submitted',
      externalReferenceCode: erc,
    });

    return {
      batchId: data.id || `batch-${Date.now()}`,
      status: data.status || 'submitted',
      count: processedItems.length,
      externalReferenceCode: erc,
      batchRefs: [{ taskId: data.id, count: processedItems.length, erc }],
    };
  }

  async _deleteBatchNative(
    config,
    {
      entityName,
      ids,
      externalReferenceCode,
      dryRun,
      sessionId,
      path,
      op,
      friendly,
    },
  ) {
    const { logger } = this.ctx;

    const batchERC =
      externalReferenceCode ??
      createERC(ERC_PREFIX[`${entityName.toUpperCase()}_BATCH`]);

    const taggedCallback = this._buildCallbackURL(
      this._getBaseCallbackUrl(config),
      {
        entity: entityName,
        op: 'delete',
        batchERC,
        sessionId,
      },
    );

    const batchUrl = path(taggedCallback);

    logger.info(`Submitting batch delete for ${entityName}`, {
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
    });
    res.batchRefs = (res.batchRefs || []).map((r) => ({ ...r, erc: batchERC }));
    return res;
  }

  async _deleteBatchSimulated(
    config,
    { entityName, ids, dryRun, basePath, op, friendly, concurrency, retryOn },
  ) {
    const { logger } = this.ctx;

    logger.info(`Submitting simulated batch delete for ${entityName}`, {
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

  async deleteByFilter(
    config,
    { entityName, filter, search, searchPrefixes, nativeBatch, ...rest },
  ) {
    const { logger } = this.ctx;

    const idSet = new Set();

    const collect = async (args) => {
      const ids = await this._collectPagedIds(config, {
        listUrl: rest.listUrl,
        pageSize: rest.pageSize,
        filter: args.filter,
        search: args.search,
        fields: 'id',
        op: `${entityName}:list`,
        friendly: `List ${entityName}`,
      });
      ids.forEach((id) => idSet.add(id));
    };

    if (Array.isArray(searchPrefixes) && searchPrefixes.length) {
      for (const s of searchPrefixes) {
        await collect({ search: s });
      }
    } else if (search) {
      await collect({ search });
    } else {
      await collect({ filter });
    }

    const ids = Array.from(idSet);

    if (nativeBatch) {
      return await this._deleteBatchNative(config, {
        entityName,
        ids,
        ...rest,
      });
    } else {
      return await this._deleteBatchSimulated(config, {
        entityName,
        ids,
        ...rest,
      });
    }
  }

  async deleteAll(config, { entityName, ...rest }) {
    return await this.deleteByFilter(config, {
      entityName,
      filter: undefined,
      ...rest,
    });
  }

  async createWarehousesBatch(config, warehousesData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'warehouse',
      items: warehousesData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'name.en_US',
      op: 'create-warehouses-batch',
      friendly: 'Failed to create warehouses batch',
      path: PATH.WAREHOUSES_BATCH,
      sessionId: opts.sessionId,
    });

    return {
      ...results,
      warehouseCount: results.count,
    };
  }

  async deleteWarehouse(config, warehouseId) {
    return await this._delete(
      config,
      `${PATH.WAREHOUSES}/${warehouseId}`,
      null,
      'delete-warehouse',
      'Failed to delete warehouse',
    );
  }

  async getWarehouses(config) {
    const data = await this._get(config, PATH.WAREHOUSES, 'get-warehouses');
    return this._asItems(data);
  }

  async getWarehousesPage(config, { pageSize = 200, fields = 'id' } = {}) {
    return this._get(
      config,
      PATH.WAREHOUSES,
      'get-warehouses-page',
      'List warehouses page',
      {
        params: { page: 1, pageSize, fields },
      },
    );
  }

  async updateProductInventory(config, warehouseId, sku, inventoryData) {
    return await this._post(
      config,
      PATH.WAREHOUSE_INVENTORIES(warehouseId),
      { ...inventoryData, sku },
      'update-product-inventory',
      'Failed to update product inventory',
    );
  }

  async getCurrencies(config) {
    const data = await this._get(config, PATH.CURRENCIES, 'get-currencies');
    const items = this._asItems(data);
    return items.map((currency) => ({
      code: currency.code,
      name: currency.name?.[config.languageId],
    }));
  }

  async getSiteLanguages(config, siteGroupId) {
    const data = await this._get(
      config,
      PATH.SITE_LANGUAGES(siteGroupId),
      'get-site-languages',
    );
    return this._asItems(data);
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
      null,
      'handle',
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
    });

    return {
      ...results,
      productCount: results.count,
    };
  }

  async createAccount(config, accountData) {
    const { logger } = this.ctx;
    const data = await this._post(
      config,
      PATH.ACCOUNTS,
      accountData,
      'create-account',
      null,
      'handle',
    );

    return data;
  }

  async patchAccount(config, accountId, accountData) {
    return await this._patch(
      config,
      PATH.ACCOUNT(accountId),
      accountData,
      'patch-account',
      'Failed to patch account',
    );
  }

  async getAccountByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.ACCOUNT_BY_ERC(externalReferenceCode),
        'get-account-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get account by ERC: ${error.message}`);
    }
  }

  async getCountries(config) {
    const { cache, logger } = this.ctx;
    const correlationId = config.correlationId;
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
      { params: { pageSize: 1000, active: true } },
    );

    countries = this._asItems(data);

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
    const correlationId = config.correlationId;
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
      { params: { pageSize: 1000, active: true } },
    );
    regions = this._asItems(data);

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
      'Failed to create account address',
    );
  }

  async createAccountAddressBatch(config, accountId, addressesData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'address',
      items: addressesData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'id',
      op: 'create-account-addresses-batch',
      friendly: 'Failed to create account addresses batch',
      path: (callback) => PATH.ACCOUNT_ADDRESSES_BATCH(accountId, callback),
      sessionId: opts.sessionId,
    });

    return {
      ...results,
      addressCount: results.count,
    };
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
          ttl,
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
      itemERCKey: 'orderNumber',
      op: 'create-orders-batch',
      friendly: 'Failed to create orders batch',
      path: PATH.ORDERS_BATCH,
      sessionId: opts.sessionId,
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
      'Failed to create order',
    );
  }

  async createPriceList(config, priceListData) {
    return await this._post(
      config,
      PATH.PRICE_LISTS,
      priceListData,
      'create-price-list',
      'Failed to create price list',
    );
  }

  async getPriceLists(
    config,
    {
      search,
      pageSize = 200,
      fields = 'id,name,externalReferenceCode',
      filter,
    } = {},
  ) {
    const { config: configService, logger } = this.ctx;
    const excludeLists = await configService.getExcludeLists(config);
    const excludedPriceLists = excludeLists?.excludedPriceLists || [];

    logger.info('Excluded price lists', { excludedPriceLists });

    const params = new URLSearchParams();
    const filters = [];

    if (filter) {
      filters.push(filter);
    }

    if (search) {
      filters.push(`name like '%${search}%'`);
    }

    if (filters.length > 0) {
      params.append('filter', filters.join(' and '));
    }

    params.append('pageSize', pageSize);
    params.append('fields', fields);

    const url = `${PATH.PRICE_LISTS}?${params.toString()}`;

    const allPriceLists = await this._get(
      config,
      url,
      'pricelists:list',
      'List price lists',
    );

    let allPriceListsItems = this._asItems(allPriceLists);

    if (excludedPriceLists.length > 0) {
      allPriceListsItems = allPriceListsItems.filter((priceList) => {
        return !excludedPriceLists.some((exclusion) => {
          if (exclusion.entityId && priceList.id === exclusion.entityId) {
            return true;
          }
          if (
            exclusion.erc &&
            priceList.externalReferenceCode === exclusion.erc
          ) {
            return true;
          }
          if (exclusion.name && priceList.name === exclusion.name) {
            return true;
          }
          return false;
        });
      });
    }

    return {
      ...allPriceLists,
      items: allPriceListsItems,
      totalCount: allPriceListsItems.length,
    };
  }

  async deletePriceListsBatch(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'priceList',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRICE_LISTS_BATCH,
      listUrl: PATH.PRICE_LISTS,
      op: 'pricelists:batch-delete',
      friendly: 'Delete price lists (batch)',
    });
  }

  async createPriceEntry(config, priceListId, priceEntryData) {
    return await this._post(
      config,
      PATH.PRICE_ENTRIES(priceListId),
      priceEntryData,
      'create-price-entry',
      'Failed to create price entry',
    );
  }

  async createSkuPriceEntry(config, priceListId, skuId, priceEntryData) {
    return await this._post(
      config,
      PATH.PRICE_ENTRIES(priceListId),
      { ...priceEntryData, skuId },
      'create-sku-price-entry',
      'Failed to create SKU price entry',
    );
  }

  async createProductSku(config, productId, skuData) {
    return await this._post(
      config,
      PATH.PRODUCT_SKUS(productId),
      skuData,
      'create-sku',
      'Failed to create SKU',
    );
  }

  async addProductOptions(config, productId, productOptions) {
    return await this._post(
      config,
      PATH.PRODUCT_OPTIONS(productId),
      productOptions,
      'add-product-options',
      'Failed to add product options',
    );
  }

  async createOption(config, optionData) {
    const { logger } = this.ctx;
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
      'Failed to create option',
    );

    logger.debug(`✓ Option created successfully:`, data);
    return data;
  }

  async getOptions(
    config,
    { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {},
  ) {
    const { logger } = this.ctx;

    const params = { page: 1, pageSize, fields, ...(search ? { search } : {}) };

    logger.info('getOptions called with params', { params });

    return this._get(config, PATH.OPTIONS, 'options:list', 'List options', {
      params,
    });
  }

  async getOptionCategories(
    config,
    { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {},
  ) {
    return this._get(
      config,
      PATH.OPTION_CATEGORIES,
      'optionCategories:list',
      'List option categories',
      {
        params: { page: 1, pageSize, fields, ...(search ? { search } : {}) },
      },
    );
  }

  async createOptionWithReuse(config, optionData) {
    try {
      return await this.createOption(config, optionData);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict');
      if (!isConflict) throw e;

      let existing = null;
      const erc = optionData?.externalReferenceCode;
      const key = optionData?.key;

      if (erc) {
        try {
          existing = await this.getOptionByERC(config, erc);
        } catch {}
      }
      if (!existing && key) {
        try {
          existing = await this.getOptionByKey(config, key);
        } catch {}
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
        } catch {}
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
      'Failed to create option value',
    );
  }

  async getOptionByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_BY_ERC(externalReferenceCode),
        'get-option-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option by ERC: ${error.message}`);
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
            search: key,
            fields: 'id,key,externalReferenceCode',
          },
        },
      );
      const items = Array.isArray(res?.items) ? res.items : [];
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(`Failed to get option by key: ${error.message}`);
    }
  }

  async getOptionValueByERC(config, optionId, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_VALUE_BY_ERC(optionId, externalReferenceCode),
        'get-option-value-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option value by ERC: ${error.message}`);
    }
  }

  async getOptionValueByKey(config, optionId, key) {
    const listUrl = `${PATH.OPTIONS}/${encodeURIComponent(
      optionId,
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
      },
    );
    const items = Array.isArray(res?.items) ? res.items : [];
    return items.find((it) => it.key === key) || null;
  }

  async updateOptionValueById(config, optionId, valueId, payload) {
    const url = `${PATH.OPTIONS}/${encodeURIComponent(
      optionId,
    )}/productOptionValues/${encodeURIComponent(valueId)}`;
    return this._put(
      config,
      url,
      payload,
      'update-option-value-by-id',
      'Failed to update option value by ID',
    );
  }

  async updateOptionValueByERC(
    config,
    optionId,
    externalReferenceCode,
    payload,
  ) {
    const url = PATH.OPTION_VALUE_BY_ERC(optionId, externalReferenceCode);
    return this._put(
      config,
      url,
      payload,
      'update-option-value-by-erc',
      'Failed to update option value by ERC',
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

      if (erc && typeof this.getOptionValueByERC === 'function') {
        try {
          existing = await this.getOptionValueByERC(config, optionId, erc);
        } catch {}
      }
      if (!existing && key && typeof this.getOptionValueByKey === 'function') {
        try {
          existing = await this.getOptionValueByKey(config, optionId, key);
        } catch {}
      }
      if (!existing) throw e;

      if (erc && existing.externalReferenceCode !== erc) {
        if (typeof this.updateOptionValueById === 'function') {
          try {
            await this.updateOptionValueById(config, optionId, existing.id, {
              externalReferenceCode: erc,
            });
          } catch {}
        } else if (typeof this.updateOptionValueByERC === 'function') {
          try {
            await this.updateOptionValueByERC(
              config,
              optionId,
              existing.externalReferenceCode,
              { externalReferenceCode: erc },
            );
          } catch {}
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
      'Failed to create option category',
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
            search: key,
            fields: 'id,key,externalReferenceCode,title,description,priority',
          },
        },
      );
      const items = Array.isArray(res?.items) ? res.items : [];
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(`Failed to get option category by key: ${error.message}`);
    }
  }

  async _listOptionCategories(
    config,
    { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {},
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
        },
      },
    );
  }

  async updateOptionCategoryById(config, id, payload) {
    const url = `${PATH.OPTION_CATEGORIES}/${encodeURIComponent(id)}`;
    return this._put(
      config,
      url,
      payload,
      'update-option-category-by-id',
      'Failed to update option category by ID',
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
        `Conflict creating option category, attempting to fetch by key: ${payload.key}`,
      );

      const key = payload?.key;
      if (!key) {
        throw new Error(
          'Conflict on createOptionCategory, but no key was provided to find existing.',
        );
      }

      const existing = await this.getOptionCategoryByKey(config, key);

      if (!existing) {
        throw new Error(
          `Conflict creating option category '${key}', but could not retrieve the existing one.`,
        );
      }

      const erc = payload?.externalReferenceCode;
      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateOptionCategoryById(config, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch (updateError) {
          logger.warn(
            `Failed to update ERC for existing option category '${key}'`,
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
        'get-option-category-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option category by ERC: ${error.message}`);
    }
  }

  _normalizeSpecificationPayload(specData = {}) {
    const payload = { ...specData };

    if (
      payload &&
      typeof payload.optionCategory === 'object' &&
      payload.optionCategory !== null
    ) {
      const { id, key, externalReferenceCode, title } = payload.optionCategory;

      if (id || key || externalReferenceCode || title) {
        const newOptionCategory = {};
        if (id) newOptionCategory.id = id;
        if (key) newOptionCategory.key = key;
        if (externalReferenceCode)
          newOptionCategory.externalReferenceCode = externalReferenceCode;
        if (title) newOptionCategory.title = title;
        payload.optionCategory = newOptionCategory;
      } else {
        delete payload.optionCategory;
      }

      delete payload.optionCategoryExternalReferenceCode;
      delete payload.optionCategoryId;
      return payload;
    }

    const erc = payload.optionCategoryExternalReferenceCode;
    const id = payload.optionCategoryId;
    if (erc || id) {
      payload.optionCategory = id ? { id } : { externalReferenceCode: erc };
      delete payload.optionCategoryExternalReferenceCode;
      delete payload.optionCategoryId;
    }

    return payload;
  }

  async createSpecification(config, specificationData) {
    const normalized = this._normalizeSpecificationPayload(specificationData);
    return await this._post(
      config,
      PATH.SPECIFICATIONS,
      normalized,
      'create-specification',
      'Failed to create specification',
    );
  }

  async createSpecificationWithReuse(config, specificationData) {
    try {
      return await this.createSpecification(config, specificationData);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict');
      if (!isConflict) throw e;

      let existing = null;
      const erc = specificationData?.externalReferenceCode;
      const key = specificationData?.key;

      if (erc) {
        try {
          existing = await this.getSpecificationByERC(config, erc);
        } catch {}
      }
      if (!existing && key) {
        try {
          existing = await this.getSpecificationByKey(config, key);
        } catch {}
      }
      if (!existing) throw e;

      if (
        erc &&
        existing.externalReferenceCode !== erc &&
        typeof this.updateSpecificationById === 'function'
      ) {
        try {
          await this.updateSpecificationById(config, existing.id, {
            externalReferenceCode: erc,
          });
        } catch {}
      }
      const desired = this._normalizeSpecificationPayload(specificationData);
      const desiredId = desired?.optionCategory?.id;
      const desiredErc = desired?.optionCategory?.externalReferenceCode;
      const currentId =
        existing?.optionCategory?.id || existing?.optionCategoryId;
      const currentErc =
        existing?.optionCategory?.externalReferenceCode ||
        existing?.optionCategoryExternalReferenceCode;

      if (typeof this.updateSpecificationByERC === 'function') {
        try {
          if (desiredId && desiredId !== currentId) {
            await this.updateSpecificationByERC(
              config,
              erc || existing.externalReferenceCode,
              {
                optionCategory: {
                  id: desiredId,
                  title: desired.optionCategory.title,
                },
              },
            );
            existing.optionCategory = {
              ...(existing.optionCategory || {}),
              id: desiredId,
            };
          } else if (!desiredId && desiredErc && desiredErc !== currentErc) {
            await this.updateSpecificationByERC(
              config,
              erc || existing.externalReferenceCode,
              {
                optionCategory: {
                  externalReferenceCode: desiredErc,
                  title: desired.optionCategory.title,
                },
              },
            );
            existing.optionCategory = {
              ...(existing.optionCategory || {}),
              externalReferenceCode: desiredErc,
            };
          }
        } catch {}
      }
      return existing;
    }
  }

  async getSpecificationByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.SPECIFICATION_BY_ERC(externalReferenceCode),
        'get-specification-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get specification by ERC: ${error.message}`);
    }
  }

  async updateSpecificationById(config, id, payload) {
    const url = `${PATH.SPECIFICATIONS}/${encodeURIComponent(id)}`;
    const normalized = this._normalizeSpecificationPayload(payload);
    return this._put(
      config,
      url,
      normalized,
      'update-specification-by-id',
      'Failed to update specification by ID',
    );
  }

  async updateSpecificationByERC(config, externalReferenceCode, payload) {
    const url = PATH.SPECIFICATION_BY_ERC(externalReferenceCode);
    const normalized = this._normalizeSpecificationPayload(payload);
    return this._put(
      config,
      url,
      normalized,
      'update-specification-by-erc',
      'Failed to update specification by ERC',
    );
  }

  async getSpecifications(
    config,
    { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {},
  ) {
    return this._get(
      config,
      PATH.SPECIFICATIONS,
      'specifications:list',
      'List specifications',
      { params: { page: 1, pageSize, fields, ...(search ? { search } : {}) } },
    );
  }

  async getSpecificationsByProductIds(config, productIds) {
    const allSpecifications = [];
    for (const productId of productIds) {
      try {
        const specifications = await this._get(
          config,
          PATH.PRODUCT_SPECIFICATIONS(productId),
          'get-product-specifications',
          `Failed to get specifications for product ${productId}`,
        );
        allSpecifications.push(...this._asItems(specifications));
      } catch (error) {
        if (error.response?.status !== 404) {
          throw error;
        }
      }
    }
    return allSpecifications;
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
            search: key,
            fields:
              'id,key,externalReferenceCode,optionCategory,optionCategoryExternalReferenceCode',
          },
        },
      );
      const items = Array.isArray(res?.items) ? res.items : [];
      return items.find((it) => it.key === key) || null;
    } catch (error) {
      throw new Error(`Failed to get specification by key: ${error.message}`);
    }
  }

  async getConfig(config, configKey) {
    const { logger } = this.ctx;
    try {
      const filter = `configKey eq '${configKey}' and configStatus eq 'Active'`;

      const url = PATH.CUSTOM_OBJECT_QUERY(PATH.CUSTOM_OBJECTS.AICA_CONFIGS, {
        fields: 'configValue',
        filter,
      });

      logger.debug('Getting configuration from Liferay', {
        operation: 'get-config',
        configKey,
        url,
        baseURL: config.liferayUrl,
      });

      const data = await this._get(
        config,
        url,
        'get-config',
        'Failed to get configuration entry',
      );
      return data;
    } catch (error) {
      const errorReference = createERC(ERC_PREFIX.ERROR);
      logger.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to get configuration entry', {
        operation: 'get-config',
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        configKey,
        errorReference,
      });

      throw new Error(
        `Failed to get configuration entry: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`,
      );
    }
  }

  async ensureDocumentsFolderByERC(
    config,
    siteGroupId,
    externalReferenceCode,
    nameOverride,
  ) {
    try {
      const folder = await this.getDocumentsFolderByERC(
        config,
        siteGroupId,
        externalReferenceCode,
      );
      return folder;
    } catch (err) {
      if (err?.response?.status !== 404) throw err;

      const name =
        nameOverride ??
        `AI Commerce Accelerator - ${
          new Date().toISOString().split('T')[0]
        } - ${externalReferenceCode.slice(-6)}`;

      const created = await this._post(
        config,
        PATH.DOCUMENT_FOLDERS(siteGroupId),
        {
          name,
          externalReferenceCode,
          description: 'Uploads from AI Commerce Accelerator',
        },
        'create-documents-folder',
        'Failed to create documents folder',
      );

      return created;
    }
  }

  async getDocumentsFolderByERC(config, siteId, externalReferenceCode) {
    return this._get(
      config,
      PATH.DOCUMENT_FOLDER_BY_ERC(siteId, externalReferenceCode),
      'get-documents-folder-by-erc',
    );
  }

  async createSiteDocumentsFolder(config, siteId, opts = {}) {
    if (!config || !siteId) return;

    let { folderName, folderExternalReferenceCode: folderERC } = opts;

    if (!folderName || !folderERC) {
      const date = new Date();
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const short = uuidv4().slice(0, 6);

      folderName = `AI Commerce Accelerator - ${yyyy}-${mm}-${dd} - ${short}`;
      folderERC = `AICA_${yyyy}${mm}${dd}_${Date.now()}_${short}`;
    }

    const payload = {
      name: folderName,
      externalReferenceCode: folderERC,
      description: 'Uploads from AI Commerce Accelerator',
      parentDocumentFolderId: opts.parentFolderId ?? 0,
      viewableBy: opts.viewableBy || 'Owner',
    };

    const folder = await this._post(
      config,
      PATH.DOCUMENT_FOLDERS(siteId),
      payload,
      'create-site-documents-folder',
      'Failed to create site documents folder',
    );

    return { folder, folderName, folderERC };
  }

  async _postMultipart(config, url, form, op, friendly) {
    const { logger } = this.ctx;
    const client = await this._client(config);
    try {
      const { data } = await client.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Accept: 'application/json',
        },
        transformRequest: [(d) => d],
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return data;
    } catch (err) {
      const status = err?.response?.status;
      const statusText = err?.response?.statusText;
      const resHeaders = err?.response?.headers || {};
      const body = err?.response?.data;
      const existingRef =
        (body && body.errorReference) ||
        resHeaders['x-liferay-error-reference'] ||
        err?.errorReference;
      const errorReference = existingRef || createERC(ERC_PREFIX.ERROR);

      logger?.error?.('Multipart request failed', {
        operation: op || 'post-multipart',
        url,
        status,
        statusText,
        data: body,
        timestamp: new Date().toISOString(),
        errorReference,
      });

      const msg =
        friendly ||
        (body && (body.title || body.detail)) ||
        err.message ||
        'Multipart request failed';

      const e = new Error(msg);
      e.name = 'LiferayRequestError';
      e.status = status;
      e.statusText = statusText;
      e.errorReference = errorReference;
      e.problem =
        body && typeof body === 'object'
          ? {
              status: body.status,
              title: body.title,
              type: body.type,
              detail: body.detail,
              errorReference:
                body.errorReference || resHeaders['x-liferay-error-reference'],
            }
          : null;
      e.response = { status, statusText, headers: resHeaders, data: body };
      e.request = { method: 'POST', url, hasData: true };
      throw e;
    }
  }

  async uploadSiteDocumentMultipart(config, file, opts = {}) {
    const form = new FormData();

    const filename = opts.filename || file?.filename || 'upload.bin';
    const mime = opts.mime || file?.mime || 'application/octet-stream';

    const documentJson = {
      title: opts.title || filename || 'Uploaded Document',
      description:
        opts.description || `Product document - ${filename} [${mime}]`,
      documentFolderExternalReferenceCode:
        opts.documentFolderExternalReferenceCode ?? null,
      documentFolderId: opts.documentFolderId ?? null,
      externalReferenceCode: (
        opts.externalReferenceCode || `DOC_${Date.now()}`
      ).replace(/\s+/g, '_'),
      fileName: filename,
      viewableBy: opts.viewableBy || 'Owner',
    };

    form.append('document', JSON.stringify(documentJson), {
      contentType: 'application/json; charset=utf-8',
    });

    if (Buffer.isBuffer(file)) {
      form.append('file', file, { filename, contentType: mime });
    } else if (file?.buffer && Buffer.isBuffer(file.buffer)) {
      form.append('file', file.buffer, { filename, contentType: mime });
    } else if (file?.path) {
      form.append('file', fs.createReadStream(file.path), {
        filename,
        contentType: mime,
      });
    } else {
      throw new Error(
        'uploadSiteDocumentMultipart: provide a Buffer, a Multer file with .buffer, or an object with .path',
      );
    }

    const url = PATH.SITE_DOCUMENTS(config.siteGroupId);
    return this._postMultipart(
      config,
      url,
      form,
      'upload-site-document-multipart',
      'Failed to upload site document',
    );
  }

  _extractDataUrlBase64(input) {
    if (typeof input !== 'string') return { base64: null, contentType: null };
    if (!input.startsWith('data:')) return { base64: input, contentType: null };

    const match = input.match(/^data:([^;]+);base64,(.*)$/);
    if (match) return { contentType: match[1] || null, base64: match[2] || '' };

    const parts = input.split(',');
    return { contentType: null, base64: parts[1] || '' };
  }

  async _postProductMediaByBase64(
    config,
    productERC,
    { base64, contentType, title, priority, type },
  ) {
    const url =
      type === 'image'
        ? PATH.PRODUCT_IMAGES_BY_BASE64(productERC)
        : PATH.PRODUCT_ATTACHMENTS_BY_BASE64(productERC);
    const payload = {
      attachment: base64,
      title: title || {
        en_US: `${
          type === 'image' ? 'Product Image' : 'Product Documentation'
        } - ${productERC}`,
      },
      contentType:
        contentType || (type === 'image' ? 'image/jpeg' : 'application/pdf'),
      priority: priority ?? 1.0,
    };
    return this._post(
      config,
      url,
      payload,
      `add-product-${type}-by-base64`,
      `Failed to add product ${type}`,
    );
  }

  async _postProductMediaByUrl(config, productERC, { src, title, type }) {
    const url =
      type === 'image'
        ? PATH.PRODUCT_IMAGES_BY_URL(productERC)
        : PATH.PRODUCT_ATTACHMENTS_BY_URL(productERC);
    const payload = {
      externalReferenceCode: `${
        type === 'image' ? 'IMG' : 'ATT'
      }_${Date.now()}`,
      title: title || {
        en_US: `${type === 'image' ? 'Image' : 'Attachment'} for ${productERC}`,
      },
      src,
    };
    return this._post(
      config,
      url,
      payload,
      `add-product-${type}-by-url`,
      `Failed to add product ${type}`,
    );
  }

  async addProductImageByBase64(config, productERC, imageData, priority = 1.0) {
    if (!config || !productERC || !imageData) return;
    const { base64, contentType } = this._extractDataUrlBase64(imageData);
    return this._postProductMediaByBase64(config, productERC, {
      base64,
      contentType: contentType || 'image/jpeg',
      priority,
      type: 'image',
    });
  }

  async addProductAttachmentByBase64(
    config,
    productERC,
    attachmentMetaData,
    priority = 1.0,
  ) {
    if (!config || !productERC || !attachmentMetaData?.attachment) return;

    const { base64 } = this._extractDataUrlBase64(
      attachmentMetaData.attachment,
    );

    try {
      const pdfBuffer = Buffer.from(base64 || '', 'base64');
      const pdfHeader = pdfBuffer.slice(0, 4).toString();
      if (pdfHeader !== '%PDF') {
        logger.warn(
          `Warning: PDF attachment for ${productERC} does not have valid PDF header, got: ${pdfHeader}`,
        );
      }
    } catch (validationError) {
      logger.error(
        `PDF validation failed for ${productERC}:`,
        validationError.message,
      );
    }

    return this._postProductMediaByBase64(config, productERC, {
      base64,
      contentType: attachmentMetaData.contentType || 'application/pdf',
      title: attachmentMetaData.title,
      priority,
      type: 'attachment',
    });
  }

  async addProductImageByUrl(config, productERC, imageUrlData) {
    return this._postProductMediaByUrl(config, productERC, {
      src: imageUrlData.src,
      title: imageUrlData.title,
      type: 'image',
    });
  }

  async addProductAttachmentByUrl(config, productERC, attachmentUrlData) {
    return this._postProductMediaByUrl(config, productERC, {
      src: attachmentUrlData.src,
      title: attachmentUrlData.title,
      type: 'attachment',
    });
  }

  async addProductAttachment(config, productId, attachmentData) {
    return await this._post(
      config,
      PATH.PRODUCT_ATTACHMENTS(productId),
      {
        title: attachmentData.title,
        src: attachmentData.src,
        attachment: attachmentData.attachment,
        priority: attachmentData.priority ?? 0,
      },
      'add-product-attachment',
      'Failed to add product attachment',
    );
  }

  async addProductImage(config, productId, imageData) {
    return await this._post(
      config,
      PATH.PRODUCT_IMAGES(productId),
      {
        title: imageData.title,
        src: imageData.src,
        attachment: imageData.attachment,
        priority: 0,
      },
      'add-product-image',
      'Failed to add product image',
    );
  }

  async attachSiteDocumentToProductByUrl(config, productERC, doc) {
    const isImage = /^(png|jpg|jpeg|webp|gif)$/i.test(doc.fileExtension || '');
    const title = {
      en_US:
        doc.title ||
        (isImage ? `Image for ${productERC}` : `Attachment for ${productERC}`),
    };
    const payload = { title, src: doc.contentUrl };
    return isImage
      ? this.addProductImageByUrl(config, productERC, payload)
      : this.addProductAttachmentByUrl(config, productERC, payload);
  }

  async attachDocumentToProduct(config, productERC, doc) {
    const isImage = /^(png|jpg|jpeg|webp|gif)$/i.test(doc.fileExtension || '');
    const payload = {
      externalReferenceCode: `${isImage ? 'IMG' : 'ATT'}_${Date.now()}`,
      title: {
        en_US:
          doc.title ||
          (isImage
            ? `Image for ${productERC}`
            : `Attachment for ${productERC}`),
      },
      src: doc.contentUrl,
    };
    return isImage
      ? this.addProductImageByUrl(config, productERC, payload)
      : this.addProductAttachmentByUrl(config, productERC, payload);
  }

  async getDocumentFolderPermissions(config, folderId) {
    return this._getPermissions(config, ASSET_TYPE.DOCUMENT_FOLDER, folderId);
  }

  async putDocumentFolderPermissions(config, folderId, items) {
    return this._putPermissions(
      config,
      ASSET_TYPE.DOCUMENT_FOLDER,
      folderId,
      items,
    );
  }

  async getDocumentPermissions(config, documentId) {
    return this._getPermissions(config, ASSET_TYPE.DOCUMENT, documentId);
  }

  async putDocumentPermissions(config, documentId, items) {
    return this._putPermissions(config, ASSET_TYPE.DOCUMENT, documentId, items);
  }

  async patchPermissionsByAsset(config, opts) {
    const {
      assetType,
      id,
      viewableBy,
      overrides,
      includeRoles,
      strategy = 'union',
      remove,
    } = opts || {};

    if (!assetType)
      throw new Error('patchPermissionsByAsset: assetType is required.');
    if (id == null) throw new Error('patchPermissionsByAsset: id is required.');
    if (!viewableBy)
      throw new Error('patchPermissionsByAsset: viewableBy is required.');

    const currentItems = await this._getPermissions(config, assetType, id);

    const built = buildPermissionsItems({
      assetType,
      viewableBy,
      overrides,
      includeRoles,
    });

    const merged = this._mergePermissionsItems(currentItems, built, {
      strategy,
      remove,
    });
    return this._putPermissions(config, assetType, id, merged);
  }

  async patchDocumentFolderPermissions(config, folderId, builderOpts) {
    return this.patchPermissionsByAsset(config, {
      assetType: ASSET_TYPE.DOCUMENT_FOLDER,
      id: folderId,
      ...builderOpts,
    });
  }

  async patchDocumentPermissions(config, documentId, builderOpts) {
    return this.patchPermissionsByAsset(config, {
      assetType: ASSET_TYPE.DOCUMENT,
      id: documentId,
      ...builderOpts,
    });
  }

  async mutateDocumentFolderPermissions(config, folderId, builderOrMutator) {
    const current = await this.getDocumentFolderPermissions(config, folderId);
    const currentItems = current.items || current;

    if (typeof builderOrMutator === 'function') {
      const nextItems = await builderOrMutator(currentItems, {
        helpers: {
          ACTION_IDS,
          ROLE,
          VIEWABLE_BY,
          buildPermissionsItems,
          ASSET_TYPE,
        },
      });
      const merged = this._mergePermissionsItems(currentItems, nextItems, {
        strategy: 'union',
      });
      return this.putDocumentFolderPermissions(config, folderId, merged);
    }

    return this.patchDocumentFolderPermissions(
      config,
      folderId,
      builderOrMutator,
    );
  }

  async mutateDocumentPermissions(config, documentId, builderOrMutator) {
    const current = await this.getDocumentPermissions(config, documentId);
    const currentItems = current.items || current;

    if (typeof builderOrMutator === 'function') {
      const nextItems = await builderOrMutator(currentItems, {
        helpers: {
          ACTION_IDS,
          ROLE,
          VIEWABLE_BY,
          buildPermissionsItems,
          ASSET_TYPE,
        },
      });
      const merged = this._mergePermissionsItems(currentItems, nextItems, {
        strategy: 'union',
      });
      return this.putDocumentPermissions(config, documentId, merged);
    }

    return this.patchDocumentPermissions(config, documentId, builderOrMutator);
  }

  async deleteCommerceOrders(
    config,
    {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      channelId,
    } = {},
  ) {
    const filters = [];
    if (filter) filters.push(filter);
    if (channelId) filters.push(`channelId eq ${channelId}`);
    const finalFilter = filters.join(' and ');

    return this.deleteByFilter(config, {
      entityName: 'order',
      filter: finalFilter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.ORDERS_BATCH,
      listUrl: PATH.ORDERS,
      op: 'orders:batch-delete',
      friendly: 'Delete orders (batch)',
    });
  }

  async getChannel(config, channelId) {
    const data = await this._get(
      config,
      PATH.CHANNEL(channelId),
      'get-channel',
    );
    return data;
  }

  async updatePriceListCatalog(config, priceListId, catalogId) {
    return await this._patch(
      config,
      PATH.PRICE_LIST(priceListId),
      { catalogId: catalogId },
      'update-price-list-catalog',
      'Failed to update price list catalog',
    );
  }

  async deleteCommerceProducts(
    config,
    {
      pageSize = 200,
      productFilter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
      channelId,
    } = {},
  ) {
    let { catalogId } = config || {};

    if (channelId) {
      const channel = await this.getChannel(config, channelId);
      if (channel && channel.id) {
        catalogId = channel.catalogId;
      }
    }

    if (catalogId === undefined || catalogId === null) {
      throw new Error('deleteCommerceProducts: config.catalogId is required');
    }

    const catalogClause =
      typeof catalogId === 'number'
        ? `catalogId eq ${catalogId}`
        : `catalogId eq '${String(catalogId).replace(/'/g, "''")}'`;
    const filter = this._combineODataFilters(catalogClause, productFilter);

    return this.deleteByFilter(config, {
      entityName: 'product',
      filter,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.PRODUCTS_BATCH,
      listUrl: PATH.PRODUCTS,
      op: 'products:batch-delete',
      friendly: 'Delete products (batch)',
    });
  }

  async deleteAllCommerceProducts(config, options = {}) {
    return this.deleteCommerceProducts(config, options);
  }

  async deleteCommerceAccounts(config, opts = {}) {
    const {
      pageSize = 200,
      filter,
      callbackBatchERC,
      dryRun = false,
      sessionId,
    } = opts || {};

    const accounts = await this.getCommerceAccounts(config, {
      ...opts,
      fields: 'id',
    });

    let accountIds = this._asItems(accounts).map((a) => a.id);

    const primaryAccountId = await this.getPrimaryAccountId(config);
    if (primaryAccountId != null) {
      accountIds = accountIds.filter(
        (id) => String(id) !== String(primaryAccountId),
      );
    }

    return this._deleteBatchNative(config, {
      entityName: 'account',
      ids: accountIds,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      path: PATH.ACCOUNTS_BATCH,
      op: 'accounts:batch-delete',
      friendly: 'Delete accounts (batch)',
    });
  }

  async deleteAllCommerceAccounts(config, options = {}) {
    return this.deleteCommerceAccounts(config, options);
  }
  _combineODataFilters(a, b) {
    if (!a) return b || '';
    if (!b) return a || '';
    return `(${a}) and (${b})`;
  }

  async _collectPagedIds(
    config,
    {
      listUrl,
      pageSize,
      filter,
      search,
      sort,
      itemsKey = 'items',
      idKey = 'id',
      idSelector,
      useTotalCount = true,
      maxPages = 10000,
      delayBetweenMs = 0,
      fields,
      op,
      friendly,
    },
  ) {
    const { logger } = this.ctx;
    const ids = new Set();

    try {
      const askedSort = this._sanitizeSort(sort, idKey);
      const baseParams = {
        page: 1,
        pageSize,
        ...(filter ? { filter } : {}),
        ...(search ? { search } : {}),
        ...(askedSort ? { sort: askedSort } : {}),
        ...(fields ? { fields } : {}),
      };

      const first = await this._get(config, listUrl, op, friendly, {
        params: baseParams,
      });

      logger.debug('pager:collect-paged-ids', {
        listUrl,
        params: baseParams,
        firstResponse: first,
      });

      const serverPage = typeof first?.page === 'number' ? first.page : 1;
      const serverPageSize =
        typeof first?.pageSize === 'number' && first.pageSize > 0
          ? first.pageSize
          : pageSize;
      const totalCount =
        useTotalCount && typeof first?.totalCount === 'number'
          ? first.totalCount
          : null;
      const lastPage =
        typeof first?.lastPage === 'number' ? first.lastPage : null;

      const firstItems = (first && first[itemsKey]) || [];
      for (const it of firstItems) {
        const id =
          typeof idSelector === 'function' ? idSelector(it) : it?.[idKey];
        if (id != null) ids.add(id);
      }
      let fetched = firstItems.length;

      if (DEBUG) {
        const sample = firstItems
          .slice(0, 5)
          .map((it) => (idSelector ? idSelector(it) : it?.[idKey]))
          .filter((v) => v != null);
        logger.debug('pager:first', {
          askedPage: 1,
          askedPageSize: pageSize,
          usedSort: askedSort || '(none)',
          serverPage,
          serverPageSize,
          serverLast: lastPage,
          serverTotal: totalCount,
          itemsOnThisPage: firstItems.length,
          uniqueIdsSoFar: ids.size,
          sample,
        });
      }

      if (
        (totalCount != null && fetched >= totalCount) ||
        firstItems.length === 0 ||
        (lastPage != null && lastPage <= 1)
      ) {
        return Array.from(ids);
      }

      let nextPage = serverPage + 1;
      let stickyRetry = 1;

      for (let safety = 0; safety < maxPages; safety++) {
        const params = {
          page: nextPage,
          pageSize: serverPageSize,
          ...(filter ? { filter } : {}),
          ...(search ? { search } : {}),
          ...(askedSort ? { sort: askedSort } : {}),
          ...(fields ? { fields } : {}),
        };

        let data = await this._get(config, listUrl, op, friendly, { params });
        let curPage = typeof data?.page === 'number' ? data.page : nextPage;

        if (nextPage > 1 && curPage === 1 && stickyRetry > 0) {
          stickyRetry--;
          data = await this._get(config, listUrl, op, friendly, {
            params: { ...params, _t: Date.now() },
          });
          curPage = typeof data?.page === 'number' ? data.page : nextPage;
        }

        const items = (data && data[itemsKey]) || [];
        const before = ids.size;
        for (const it of items) {
          const id =
            typeof idSelector === 'function' ? idSelector(it) : it?.[idKey];
          if (id != null) ids.add(id);
        }
        fetched += items.length;

        if (DEBUG) {
          logger.debug('pager:page', {
            listUrl,
            askedPage: nextPage,
            usedPageSize: serverPageSize,
            usedSort: askedSort || '(none)',
            serverPage: curPage,
            serverLast:
              typeof data?.lastPage === 'number' ? data.lastPage : null,
            serverTotal:
              typeof data?.totalCount === 'number'
                ? data.totalCount
                : totalCount,
            itemsOnThisPage: items.length,
            newIdsOnThisPage: ids.size - before,
            uniqueIdsSoFar: ids.size,
          });
        }

        const dataTotal =
          typeof data?.totalCount === 'number' ? data.totalCount : totalCount;
        if (useTotalCount && dataTotal != null && ids.size >= dataTotal) break;

        const dataLast =
          typeof data?.lastPage === 'number' ? data.lastPage : lastPage;
        if (dataLast != null && curPage >= dataLast) break;

        if (items.length === 0) break;

        nextPage = (curPage || nextPage) + 1;
        if (delayBetweenMs > 0) await delay(delayBetweenMs);
      }
    } catch (error) {
      console.error('_collectPagedIds', error);
      throw error;
    }

    return Array.from(ids);
  }

  _sanitizeSort(sort, idKey, { disallow = [] } = {}) {
    if (!sort) return null;
    const raw = String(sort).trim();
    if (!raw) return null;

    const pk = String(idKey || 'id').toLowerCase();
    const blocked = new Set([
      pk,
      ...disallow.map((f) => String(f).toLowerCase()),
    ]);

    const tokens = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((token) => {
        const field = token.split(':')[0].trim().toLowerCase();
        return !blocked.has(field);
      });

    return tokens.length ? tokens.join(',') : null;
  }

  _pageMeta(data) {
    return {
      page: typeof data?.page === 'number' ? data.page : null,
      pageSize: typeof data?.pageSize === 'number' ? data.pageSize : null,
      lastPage: typeof data?.lastPage === 'number' ? data.lastPage : null,
      totalCount: typeof data?.totalCount === 'number' ? data.totalCount : null,
    };
  }

  async _deleteByBatch(
    config,
    { batchUrl, ids, batchSize, dryRun = false, idProp = 'id', op, friendly },
  ) {
    const { logger } = this.ctx;
    const summary = {
      total: ids.length,
      batches: Math.ceil(ids.length / Math.max(1, batchSize)),
      submitted: 0,
      failures: [],
      dryRun,
      batchRefs: [],
    };
    if (!ids.length || dryRun) return summary;

    const toBatchObjects = (chunk) =>
      chunk.map((v) => {
        if (v == null) return { [idProp]: v };
        if (typeof v !== 'object') return { [idProp]: v };
        if (Object.prototype.hasOwnProperty.call(v, idProp)) return v;
        const candidate =
          v.id ??
          v.productId ??
          v.orderId ??
          v.accountId ??
          v[keyFromOnlyProp(v)];
        return { [idProp]: candidate };
      });

    function keyFromOnlyProp(o) {
      const keys = Object.keys(o || {});
      return keys.length === 1 ? keys[0] : undefined;
    }

    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      const body = toBatchObjects(chunk);

      logger.debug('Submitting batch for deletion', {
        op,
        friendly,
        batchSize: chunk.length,
      });

      try {
        const res = await this._delete(
          config,
          batchUrl,
          body,
          op,
          friendly,
          true,
        );

        const location =
          res?.headers?.location || res?.headers?.Location || undefined;
        const taskERC =
          res?.data?.externalReferenceCode || res?.data?.erc || null;
        const taskId =
          res?.data?.id ||
          res?.data?.batchEngineImportTaskId ||
          `batch-${Date.now()}`;

        summary.batchRefs.push({
          index: summary.submitted,
          location: location || null,
          taskERC,
          taskId,
          count: chunk.length,
          batchSize,
          status: res.status || 'submitted',
        });

        summary.submitted += 1;
      } catch (err) {
        const errInfo = {
          batchIndex: summary.submitted,
          status: err?.status ?? err?.response?.status,
          error: err?.response?.data ?? String(err?.message ?? err),
          ids: chunk,
        };
        logger.warn('Unable to record batch delete', errInfo);
        summary.failures.push(errInfo);
      }
    }

    return summary;
  }

  async _deleteByIds(
    config,
    {
      baseDeletePath,
      ids,
      concurrency = 6,
      retryOn = [],
      dryRun = false,
      op,
      friendly,
    },
  ) {
    const summary = {
      total: ids.length,
      deleted: 0,
      notFound: 0,
      failures: [],
      dryRun,
      get succeeded() {
        return this.deleted + this.notFound;
      },
    };
    if (!ids.length || dryRun) return summary;

    const retryLimit = 2;
    const backoffMs = 500;

    let idx = 0;

    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= ids.length) return;
        const id = ids[i];

        let attempts = 0;

        while (true) {
          try {
            await this._delete(
              config,
              `${baseDeletePath}/${encodeURIComponent(id)}`,
              undefined,
              op,
              friendly,
            );
            summary.deleted++;
            break;
          } catch (err) {
            const status = err?.response?.status;
            const payload = err?.response?.data;
            const retriable = retryOn.includes(status) && attempts < retryLimit;
            if (!retriable) {
              if (status === 404) {
                summary.notFound++;
              } else {
                summary.failures.push({
                  id,
                  status,
                  error: payload ?? String(err?.message ?? err),
                });
              }
              break;
            }
            attempts++;
            await delay(backoffMs * attempts);
          }
        }
      }
    };

    const n = Math.min(concurrency, Math.max(1, ids.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return summary;
  }

  async _drainCollection(
    config,
    {
      listUrl,
      pageSize = 50,
      filter,
      maxChecks = 10,
      delayMs = 500,
      itemsKey = 'items',
      op = 'drain:check',
      friendly = 'Check drain',
    },
  ) {
    let attempt = 0;
    while (attempt < maxChecks) {
      const data = await this._get(config, listUrl, op, friendly, {
        params: { page: 1, pageSize, ...(filter ? { filter } : {}) },
      });
      const items = (data && data[itemsKey]) || [];
      if (items.length === 0) return true;
      attempt += 1;
      await delay(delayMs);
    }
    return false;
  }

  _cacheItemERCs(batchERC, batchId, itemERCs, sessionId) {
    const { cache, config: configService } = this.ctx || {};
    if (!cache || !Array.isArray(itemERCs)) return;
    cache.set(
      `erc:${batchERC}:itemERCs`,
      itemERCs,
      getBatchCacheTTLms(configService),
    );
    if (batchId)
      cache.set(
        `batch:${batchId}:itemERCs`,
        itemERCs,
        getBatchCacheTTLms(configService),
      );
    if (sessionId)
      cache.set(
        `session:${sessionId}:itemERCsByBatch:${batchERC}`,
        itemERCs,
        getBatchCacheTTLms(configService),
      );
  }

  _stringifySafe(obj, max = 20_000) {
    try {
      const seen = new WeakSet();
      const s = JSON.stringify(
        obj,
        (k, v) => {
          if (typeof v === 'object' && v !== null) {
            if (seen.has(v)) return '[Circular]';
            seen.add(v);
          }
          if (typeof v === 'string' && v.length > 2000)
            return v.slice(0, 2000) + '…';
          return v;
        },
        2,
      );
      return s.length > max ? s.slice(0, max) + '…' : s;
    } catch {
      return String(obj);
    }
  }

  async getImportTask(config, batchId) {
    return await this._get(
      config,
      `/o/headless-batch-engine/v1.0/import-task/${batchId}`,
      'import-task',
      'Import Liferay task',
      {},
      true,
    );
  }

  async createOptionsBatch(config, optionsData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'option',
      items: optionsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'key',
      op: 'create-options-batch',
      friendly: 'Failed to create options batch',
      path: PATH.OPTIONS_BATCH,
      sessionId: opts.sessionId,
    });

    return {
      ...results,
      optionCount: results.count,
    };
  }

  async deleteOptionsBatch(
    config,
    {
      pageSize = 200,
      search,
      callbackBatchERC,
      dryRun = false,
      sessionId,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'option',
      search,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.OPTIONS_BATCH,
      listUrl: PATH.OPTIONS,
      op: 'options:batch-delete',
      friendly: 'Delete options (batch)',
    });
  }

  async createSpecificationsBatch(config, specificationsData, opts = {}) {
    const results = await this._postBatch(config, {
      entityName: 'specification',
      items: specificationsData,
      externalReferenceCode: opts.externalReferenceCode,
      itemERCKey: 'key',
      op: 'create-specifications-batch',
      friendly: 'Failed to create specifications batch',
      path: PATH.SPECIFICATIONS_BATCH,
      sessionId: opts.sessionId,
    });

    return {
      ...results,
      specificationCount: results.count,
    };
  }

  async deleteSpecificationsBatch(
    config,
    {
      pageSize = 200,
      filter,
      search,
      searchPrefixes,
      all = false,
      callbackBatchERC,
      dryRun = false,
      sessionId,
    } = {},
  ) {
    return this.deleteByFilter(config, {
      entityName: 'specification',
      filter: all ? undefined : filter,
      search,
      searchPrefixes,
      pageSize,
      externalReferenceCode: callbackBatchERC,
      dryRun,
      sessionId,
      nativeBatch: true,
      path: PATH.SPECIFICATIONS_BATCH,
      listUrl: PATH.SPECIFICATIONS,
      op: 'specifications:batch-delete',
      friendly: 'Delete specifications (batch)',
    });
  }

  async createOptionCategoriesBatch(config, categories, opts = {}) {
    try {
      const results = await this._postBatch(config, {
        entityName: 'optionCategory',
        items: categories,
        externalReferenceCode: opts.externalReferenceCode,
        itemERCKey: 'key',
        op: 'create-option-categories-batch',
        friendly: 'Failed to create option categories batch',
        path: PATH.OPTION_CATEGORIES_BATCH,
        sessionId: opts.sessionId,
      });

      return {
        ...results,
        optionCategoryCount: results.count,
      };
    } catch (e) {
      if (e?.status === 404) {
        logger.warn(
          'Option Categories /batch not found. Falling back to per-item create.',
        );
        const results = [];
        for (const item of items) {
          const res = await this.createOptionCategory(config, item);
          results.push(res);
        }
        return {
          batchId: null,
          status: 'completed',
          optionCategoryCount: results.length,
          externalReferenceCode: batchERC,
          items: results,
          batchRefs: [],
        };
      }
      throw e;
    }
  }

  async getPostalAddressByERC(config, erc) {
    return await this._get(
      config,
      PATH.POSTAL_ADDRESS_BY_ERC(erc),
      'get-postal-address-by-erc',
      'Failed to get postal address',
    );
  }

  async setBillingAndShippingAddresses(
    config,
    accountId,
    defaultShippingAddressId,
    defaultBillingAddressId,
  ) {
    return await this._patch(
      config,
      PATH.ACCOUNT(accountId),
      {
        defaultBillingAddressId,
        defaultShippingAddressId,
      },
      'set-billing-and-shipping-addresses',
      'Failed to set billing and shipping addresses',
    );
  }

  async deleteOptionCategoriesBatch(
    config,
    {
      pageSize = 200,
      filter,
      search,
      searchPrefixes,
      dryRun = false,
      sessionId,
    } = {},
  ) {
    try {
      return await this.deleteByFilter(config, {
        entityName: 'optionCategory',
        filter,
        search,
        searchPrefixes,
        pageSize,
        dryRun,
        sessionId,
        nativeBatch: true,
        path: PATH.OPTION_CATEGORIES_BATCH,
        listUrl: PATH.OPTION_CATEGORIES,
        op: 'optionCategories:batch-delete',
        friendly: 'Delete option categories (batch)',
      });
    } catch (e) {
      if (e?.status === 404) {
        this.ctx.logger.warn(
          'Option Categories /batch not found. Falling back to per-id delete.',
        );
        return this.deleteByFilter(config, {
          entityName: 'optionCategory',
          filter,
          search,
          searchPrefixes,
          pageSize,
          dryRun,
          nativeBatch: false,
          basePath: PATH.OPTION_CATEGORIES,
          listUrl: PATH.OPTION_CATEGORIES,
          op: 'optionCategories:ids-delete',
          friendly: 'Delete option categories (by id)',
          concurrency: 6,
          retryOn: [409, 429, 503],
        });
      }
      throw e;
    }
  }
}

module.exports = LiferayRestService;
