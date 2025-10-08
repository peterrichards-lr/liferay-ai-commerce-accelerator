/* eslint-disable no-console */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const { OAuthService } = require('./oauthService.cjs');
const liferayConfig = require('../config/liferayConfig.cjs');
const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const { ErrorHandler } = require('../utils/errorHandler.cjs');

const { PATH } = require('../utils/liferayPaths.cjs');
const {
  ACTION_IDS,
  ROLE,
  ASSET_TYPE,
  VIEWABLE_BY,
  buildPermissionsItems,
} = require('../utils/liferayPermissions.cjs');

class LiferayService {
  constructor() {
    this.axiosInstance = null;
    this.oauthService = new OAuthService();
    this.baseUrl = liferayConfig.liferayUrl;
  }

  _errRef() {
    return `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
  }

  _asItems(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  async _client(config) {
    return this.createAxiosInstance(config);
  }

  async _request(
    config,
    { method, url, data, headers, op, onError, friendly }
  ) {
    const client = await this._client(config);
    try {
      const res = await client.request({ method, url, data, headers });
      return res.data;
    } catch (error) {
      const errorReference = this._errRef();
      console.error(`Error Reference: ${errorReference}`);

      const baseLog = {
        operation: op || method?.toLowerCase() || 'request',
        url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        timestamp: new Date().toISOString(),
        errorReference,
      };

      if (logger?.error) logger.error(`Request failed: ${op || url}`, baseLog);
      else console.error('Request failed:', baseLog);

      if (onError === 'handle') {
        throw ErrorHandler.handleLiferayError(
          error,
          op || 'request',
          data,
          errorReference
        );
      }

      const msg =
        friendly ||
        error.response?.data?.title ||
        error.response?.data?.detail ||
        error.message;

      const wrapped = new Error(msg);
      wrapped.response = {
        status: error.response?.status,
        data: error.response?.data,
        errorReference,
      };
      throw wrapped;
    }
  }

  async _get(config, url, op, friendly) {
    return this._request(config, { method: 'GET', url, op, friendly });
  }

  async _post(config, url, data, op, friendly, onError = 'throw') {
    return this._request(config, {
      method: 'POST',
      url,
      data,
      op,
      friendly,
      onError,
    });
  }

  async _put(config, url, data, op, friendly) {
    return this._request(config, { method: 'PUT', url, data, op, friendly });
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
      `put-permissions:${assetType}`
    );
  }

  async createAxiosInstance(config) {
    const accessToken =
      config.clientId === null
        ? await this.oauthService.getAccessTokenFromRoute()
        : await this.oauthService.getAccessToken(
            config.liferayUrl,
            config.clientId,
            config.clientSecret
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
    try {
      try {
        new URL(config.liferayUrl);
      } catch {
        throw new Error(`Invalid URL format: ${config.liferayUrl}`);
      }

      if (!this.oauthService.isLiferayRouteAvailable)
        this.oauthService.validateOAuthConfig(config);

      await this._get(config, PATH.ME, 'test-connection');

      return {
        status: 'connected',
        message: 'Successfully connected to Liferay Commerce using OAuth 2',
      };
    } catch (error) {
      logger.error(
        'OAuth connection test failed:',
        error.response?.data || error.message
      );

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

      const errorReference = structuredError.errorReference || this._errRef();
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

  async getCatalogs(config) {
    const data = await this._get(config, PATH.CATALOGS, 'get-catalogs');
    return this._asItems(data);
  }

  async getChannels(config) {
    const data = await this._get(config, PATH.CHANNELS, 'get-channels');
    return this._asItems(data);
  }

  async getProducts(config) {
    let url =
      PATH.PRODUCTS +
      (config.catalogId ? `?filter=catalogId eq ${config.catalogId}` : '');
    const data = await this._get(config, url, 'get-products');
    return this._asItems(data);
  }

  async getAccounts(config) {
    const data = await this._get(config, PATH.ACCOUNTS, 'get-accounts');
    return this._asItems(data);
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
      'get-site-languages'
    );
    return this._asItems(data);
  }

  async createProduct(config, productData) {
    if (!productData.catalogId && config.catalogId) {
      productData.catalogId = parseInt(config.catalogId, 10);
    }

    logger.debug('Creating product with payload:', {
      sku: productData.sku,
      name: productData.name?.en_US || 'N/A',
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
      'handle'
    );
    return data;
  }

  async createProductsBatch(config, productsData, callbackUrl) {
    const batchPayload = { createStrategy: 'INSERT', items: productsData };

    const url = PATH.PRODUCTS_BATCH(callbackUrl);

    logger.info('Sending batch product creation request', {
      operation: 'create-products-batch',
      productCount: productsData.length,
      callbackUrl: callbackUrl || 'none',
      url,
    });

    const data = await this._post(
      config,
      url,
      batchPayload,
      'create-products-batch',
      'Failed to create products batch'
    );
    logger.info('Batch product creation initiated', {
      operation: 'create-products-batch',
      batchId: data.id || 'unknown',
      status: data.status || 'submitted',
    });

    return {
      batchId: data.id || `batch-${Date.now()}`,
      status: data.status || 'submitted',
      productCount: productsData.length,
    };
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

    logger.info('Account created successfully', {
      operation: 'create-account',
      accountId: data.id,
      accountName: data.name,
    });

    return data;
  }

  async createAccountsBatch(config, accountsData, callbackUrl) {
    const batchPayload = { createStrategy: 'INSERT', items: accountsData };
    const url = PATH.ACCOUNTS_BATCH(callbackUrl);

    logger.info('Sending batch account creation request', {
      operation: 'create-accounts-batch',
      accountCount: accountsData.length,
      callbackUrl,
    });

    const data = await this._post(
      config,
      url,
      batchPayload,
      'create-accounts-batch',
      'Failed to create accounts batch'
    );

    logger.info('Batch account creation initiated', {
      operation: 'create-accounts-batch',
      batchId: data.id || 'unknown',
      status: data.status || 'submitted',
    });

    return {
      batchId: data.id || `batch-${Date.now()}`,
      status: data.status || 'submitted',
      accountCount: accountsData.length,
    };
  }

  async createOrder(config, orderData) {
    if (!orderData.channelId)
      throw new Error('channelId is required for order creation');
    if (!orderData.currencyCode)
      throw new Error('currencyCode is required for order creation');

    orderData.channelId = parseInt(orderData.channelId, 10);

    logger.debug('Creating order with payload:', {
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

  async addProductOptions(config, productId, productOptions) {
    return await this._post(
      config,
      PATH.PRODUCT_OPTIONS(productId),
      productOptions,
      'add-product-options',
      'Failed to add product options'
    );
  }

  async createOption(config, optionData) {
    logger.debug(`LiferayService.createOption called with:`, {
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
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option by ERC: ${error.message}`);
    }
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
      throw new Error(`Failed to get option value by ERC: ${error.message}`);
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

  async getOptionCategoryByERC(config, externalReferenceCode) {
    try {
      return await this._get(
        config,
        PATH.OPTION_CATEGORY_BY_ERC(externalReferenceCode),
        'get-option-category-by-erc'
      );
    } catch (error) {
      if (error.response?.status === 404) return null;
      throw new Error(`Failed to get option category by ERC: ${error.message}`);
    }
  }

  async createSpecification(config, specificationData) {
    return await this._post(
      config,
      PATH.SPECIFICATIONS,
      specificationData,
      'create-specification',
      'Failed to create specification'
    );
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

  async getConfig(config, configKey) {
    try {
      const filter = `configKey eq '${configKey}' and configStatus eq 'Active'`;

      const url = PATH.CUSTOM_OBJECT_QUERY(PATH.CUSTOM_OBJECTS.AICA_CONFIGS, {
        fields: 'configValue',
        filter,
      });

      logger.info('Getting configuration from Liferay', {
        operation: 'get-config',
        configKey,
        url,
        baseURL: config.liferayUrl,
      });

      const data = await this._get(
        config,
        url,
        'get-config',
        'Failed to get configuration entry'
      );
      return data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
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
        }`
      );
    }
  }

  async ensureDocumentsFolderByERC(
    config,
    siteGroupId,
    externalReferenceCode,
    nameOverride
  ) {
    try {
      const folder = await this.getDocumentsFolderByERC(
        config,
        siteGroupId,
        externalReferenceCode
      );
      return folder;
    } catch (err) {
      if (err?.response?.status !== 404) throw err;

      const name =
        nameOverride ??
        `AI Commerce Accelerator - ${
          new Date().toISOString().split('T')[0]
        } - ${externalReferenceCode.slice(-6)}`;

      this._post(
        config,
        PATH.DOCUMENT_FOLDERS(siteGroupId),
        {
          name,
          externalReferenceCode,
          description: 'Uploads from AI Commerce Accelerator',
        },
        'create-documents-folder',
        'Failed to create documents folder'
      );
    }
  }

  async getDocumentsFolderByERC(config, siteId, externalReferenceCode) {
    return this._get(
      config,
      PATH.DOCUMENT_FOLDER_BY_ERC(siteId, externalReferenceCode),
      'get-documents-folder-by-erc'
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
      'Failed to create site documents folder'
    );

    return { folder, folderName, folderERC };
  }

  async _postMultipart(config, url, form, op, friendly) {
    const client = await this._client(config);
    try {
      const { data } = await client.post(url, form, {
        headers: {
          ...form.getHeaders(),
          Accept: 'application/json',
        },
        // keep FormData unmodified
        transformRequest: [(d) => d],
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return data;
    } catch (error) {
      const errorReference = this._errRef();
      logger.error(`Error Reference: ${errorReference}`);
      const baseLog = {
        operation: op || 'post-multipart',
        url,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        timestamp: new Date().toISOString(),
        errorReference,
      };
      if (logger?.error) logger.error('Multipart request failed', baseLog);
      const msg =
        friendly ||
        error.response?.data?.title ||
        error.response?.data?.detail ||
        error.message;

      const wrapped = new Error(msg);
      wrapped.response = {
        status: error.response?.status,
        data: error.response?.data,
        errorReference,
      };
      throw wrapped;
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
        'uploadSiteDocumentMultipart: provide a Buffer, a Multer file with .buffer, or an object with .path'
      );
    }

    const url = PATH.SITE_DOCUMENTS(config.siteGroupId);
    return this._postMultipart(
      config,
      url,
      form,
      'upload-site-document-multipart',
      'Failed to upload site document'
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
    { base64, contentType, title, priority, type }
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
      `Failed to add product ${type}`
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
      `Failed to add product ${type}`
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
    priority = 1.0
  ) {
    if (!config || !productERC || !attachmentMetaData?.attachment) return;

    const { base64 } = this._extractDataUrlBase64(
      attachmentMetaData.attachment
    );

    try {
      const pdfBuffer = Buffer.from(base64 || '', 'base64');
      const pdfHeader = pdfBuffer.slice(0, 4).toString();
      if (pdfHeader !== '%PDF') {
        logger.warn(
          `Warning: PDF attachment for ${productERC} does not have valid PDF header, got: ${pdfHeader}`
        );
      }
    } catch (validationError) {
      logger.error(
        `PDF validation failed for ${productERC}:`,
        validationError.message
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
    return this._postProductMediaByUrl(config, productERC, {
      src: imageUrlData.src,
      title: imageUrlData.title,
      type: 'image',
    });
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
      'Failed to add product image'
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
      items
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
      builderOrMutator
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
}

module.exports = new LiferayService();
