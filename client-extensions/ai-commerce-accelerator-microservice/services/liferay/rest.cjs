const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const StreamZip = require('node-stream-zip');
const liferayConfig = require('../../config/liferayConfig.cjs');
const { logger } = require('../../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');

const { PATH, CUSTOM_OBJECTS } = require('../../utils/liferayPaths.cjs');
const {
  ACTION_IDS,
  ROLE,
  ASSET_TYPE,
  VIEWABLE_BY,
  buildPermissionsItems,
} = require('../../utils/liferayPermissions.cjs');
const { DEBUG, ERC_PREFIX, OP_MAP } = require('../../utils/constants.cjs');
const { delay, createERC } = require('../../utils/misc.cjs');
const { sanitizedERC } = require('../../utils/normalize.cjs');
const { parse } = require('csv-parse/sync');
const { getBatchCacheTTLms } = require('../../utils/ttl.cjs');
const { COMMERCE_CONSTRAINTS } = require('../../utils/commerceConstants.cjs');
const { asItems, asCount } = require('../../utils/liferayUtils.cjs');

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
      
      const batchERC = meta.batchExternalReferenceCode || meta.batchERC;
      if (batchERC) {
        u.searchParams.set('batchExternalReferenceCode', String(batchERC));
      }

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

      const logData = {
        operation: op,
        status: res.status,
      };

      if (res.data) {
        if (Array.isArray(res.data.items)) {
          logData.itemCount = res.data.items.length;
          logData.totalCount = res.data.totalCount;
        } else if (typeof res.data === 'object') {
          logData.dataKeys = Object.keys(res.data);
        }
      }

      logger.debug('Liferay API Response', logData);

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

  async _collectPagedIds(config, { listUrl, pageSize, filter, search, fields, op, friendly, idKey = 'id' }) {
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
      const ids = items.map((it) => it[idKey]).filter((id) => id !== undefined && id !== null);
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
      `get-permissions:${assetType}`,
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
      PATH.CUSTOM_OBJECT_QUERY(CUSTOM_OBJECTS.AICA_CONFIGS, { filter: `externalReferenceCode eq '${configKey}'` }),
      `get-config:${configKey}`,
    );
  }

  async getCatalogs(config) {
    const data = await this._get(config, PATH.CATALOGS, 'get-catalogs');
    return asItems(data);
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
      idField = 'id',
    },
  ) {
    const { logger } = this.ctx;

    const prefixKey = `${entityName.toUpperCase()}_BATCH`;
    const batchERC =
      externalReferenceCode ??
      createERC(ERC_PREFIX[prefixKey] || ERC_PREFIX.BATCH);

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
      idField,
    });
    res.batchRefs = (res.batchRefs || []).map((r) => ({ ...r, erc: batchERC }));
    return res;
  }

  async _deleteByBatch(
    config,
    { batchUrl, ids, batchSize = 100, dryRun = false, op, friendly, idField = 'id' }
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
        batchRefs.push({ taskId: `dry-run-${uuidv4()}`, count: chunk.length });
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
    { baseDeletePath, ids, concurrency = 5, retryOn = [404], dryRun = false, op, friendly }
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

  async _collectPagedItems(config, { listUrl, pageSize, filter, search, fields, op, friendly }) {
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
      'Failed to delete warehouse',
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
    const items = asItems(data);
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
    return asItems(data);
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
      itemERCKey: 'externalReferenceCode',
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

  async deleteProductOption(config, productId, productOptionId) {
    return await this._delete(
      config,
      PATH.PRODUCT_OPTION(productOptionId),
      null,
      'delete-product-option',
      'Failed to delete product option',
    );
  }

  async getCommerceProductOptions(config, productId) {
    const data = await this._get(
      config,
      PATH.PRODUCT_OPTIONS(productId),
      'get-product-options',
    );
    return asItems(data);
  }

  async deleteProductSpecification(config, productId, productSpecificationId) {
    return await this._delete(
      config,
      PATH.PRODUCT_SPECIFICATION(productSpecificationId),
      null,
      'delete-product-specification',
      'Failed to delete product specification',
    );
  }

  async getCommerceProductSpecifications(config, productId) {
    const data = await this._get(
      config,
      PATH.PRODUCT_SPECIFICATIONS(productId),
      'get-product-specifications',
    );
    return asItems(data);
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
      'Failed to create specification',
    );

    logger.debug(`✓ Specification created successfully:`, data);
    return data;
  }

  async getSpecificationByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.SPECIFICATION_BY_ERC(externalReferenceCode),
        'get-specification-by-erc'
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get specification by ERC: ${error.message}`);
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
      throw new Error(`Failed to get specification by key: ${error.message}`);
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
    try {
      return await this.createSpecification(config, payload);
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      const isConflict =
        e?.status === 409 ||
        e?.problem?.status === 'CONFLICT' ||
        msg.includes('409') ||
        msg.includes('conflict');

      if (!isConflict) throw e;

      logger.trace(
        `Conflict creating specification, attempting to fetch by key: ${payload.key}`
      );

      const key = payload?.key;
      if (!key) {
        throw new Error(
          'Conflict on createSpecification, but no key was provided to find existing.'
        );
      }

      const existing = await this.getSpecificationByKey(config, key);

      if (!existing) {
        throw new Error(
          `Conflict creating specification '${key}', but could not retrieve the existing one.`
        );
      }

      const erc = payload?.externalReferenceCode;
      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateSpecificationById(config, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch (updateError) {
          logger.warn(
            `Failed to update ERC for existing specification '${key}'`
          );
        }
      }
      return existing;
    }
  }

  async createOption(config, optionData) {
    const { logger } = this.ctx;

    // Last-line-of-defense validation for Commerce constraints
    if (
      optionData.skuContributor &&
      !COMMERCE_CONSTRAINTS.SKU_CONTRIBUTOR_FIELD_TYPES.includes(
        optionData.fieldType,
      )
    ) {
      logger.warn(
        `REST: fieldType '${optionData.fieldType}' is incompatible with skuContributor. Disabling skuContributor.`,
        { optionKey: optionData.key },
      );
      optionData.skuContributor = false;
    }

    if (
      optionData.priceContributor &&
      !COMMERCE_CONSTRAINTS.PRICE_CONTRIBUTOR_FIELD_TYPES.includes(
        optionData.fieldType,
      )
    ) {
      logger.warn(
        `REST: fieldType '${optionData.fieldType}' is incompatible with priceContributor. Disabling priceContributor.`,
        { optionKey: optionData.key },
      );
      optionData.priceContributor = false;
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
      'Failed to create option',
    );

    logger.debug(`✓ Option created successfully:`, data);
    return data;
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
    const url = PATH.OPTION_VALUE(valueId);
    return this._patch(
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
    return this._patch(
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

      if (erc) {
        try {
          existing = await this.getOptionValueByERC(config, optionId, erc);
        } catch {}
      }
      if (!existing && key) {
        try {
          existing = await this.getOptionValueByKey(config, optionId, key);
        } catch {}
      }
      if (!existing) throw e;

      if (erc && existing.externalReferenceCode !== erc) {
        try {
          await this.updateOptionValueById(config, optionId, existing.id, {
            externalReferenceCode: erc,
          });
          existing.externalReferenceCode = erc;
        } catch {}
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
            filter: `key eq '${key}'`,
            fields: 'id,key,externalReferenceCode,title,description,priority',
          },
        },
      );
      const items = asItems(res);
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
    const url = PATH.OPTION_CATEGORY(id);
    return this._patch(
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

  async getOptionCategories(config, { search, pageSize = 200, fields = 'id,key,externalReferenceCode' } = {}) {
    return this._listOptionCategories(config, { search, pageSize, fields });
  }

  async getPostalAddressByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.POSTAL_ADDRESS_BY_ERC(externalReferenceCode),
        'get-postal-address-by-erc',
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get postal address by ERC: ${error.message}`);
    }
  }

  async addProductImage(config, productId, image) {
    return await this._post(
      config,
      PATH.PRODUCT_IMAGES_BY_URL(productId),
      image,
      'add-product-image',
      'Failed to add product image',
    );
  }

  async addProductDocumentAttachment(config, productId, attachment) {
    return await this._post(
      config,
      PATH.PRODUCT_ATTACHMENTS_BY_URL(productId),
      attachment,
      'add-product-document-attachment',
      'Failed to add product document attachment',
    );
  }

  async setBillingAndShippingAddresses(config, accountId, shippingAddressId, billingAddressId) {
    const payload = {};
    if(shippingAddressId) payload.defaultShippingAddressId = shippingAddressId
    if(billingAddressId) payload.defaultBillingAddressId = billingAddressId

    return await this._patch(
      config,
      PATH.ACCOUNT(accountId),
      payload,
      'set-billing-and-shipping-addresses',
      'Failed to set billing and shipping addresses',
    );
  }
}

module.exports = LiferayRestService;
