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
    // OAuthService is now instantiated where needed with parameters
    this.baseUrl = liferayConfig.liferayUrl;
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
        merged = new Set([...cur, ...next]); // union
      }

      for (const r of remove[role] || []) merged.delete(r);
      out.set(role, merged);
    }

    return this._denormalizePermissionMap(out);
  }

  _resolvePermissionsOps(assetType) {
    switch (assetType) {
      case ASSET_TYPE.DOCUMENT_FOLDER:
        return {
          get: async (config, id) => {
            const client = await this.createAxiosInstance(config);
            const { data } = await client.get(
              PATH.DOCUMENT_FOLDER_PERMISSIONS(id)
            );
            return Array.isArray(data)
              ? data
              : Array.isArray(data?.items)
              ? data.items
              : [];
          },
          put: async (config, id, items) => {
            const client = await this.createAxiosInstance(config);
            const { data } = await client.put(
              PATH.DOCUMENT_FOLDER_PERMISSIONS(id),
              items
            );
            return data;
          },
        };
      case ASSET_TYPE.DOCUMENT:
        return {
          get: async (config, id) => {
            const client = await this.createAxiosInstance(config);
            const { data } = await client.get(PATH.DOCUMENT_PERMISSIONS(id));
            return Array.isArray(data)
              ? data
              : Array.isArray(data?.items)
              ? data.items
              : [];
          },
          put: async (config, id, items) => {
            const client = await this.createAxiosInstance(config);
            const { data } = await client.put(
              PATH.DOCUMENT_PERMISSIONS(id),
              items
            );
            return data;
          },
        };
      default:
        throw new Error(`Unsupported assetType: ${assetType}`);
    }
  }

  async getDocumentFolderPermissions(config, folderId) {
    const client = await this.createAxiosInstance(config);
    const { data } = await client.get(
      PATH.DOCUMENT_FOLDER_PERMISSIONS(folderId)
    );
    return Array.isArray(data) ? data : data.items || [];
  }

  async putDocumentFolderPermissions(config, folderId, items) {
    const client = await this.createAxiosInstance(config);

    // Guard + normalize
    if (!Array.isArray(items)) {
      throw new TypeError(
        'putDocumentFolderPermissions: items must be an array'
      );
    }
    const payload = items.map((it) => ({
      roleName: it?.roleName,
      // ensure plain array of strings
      actionIds: Array.isArray(it?.actionIds) ? it.actionIds.slice() : [],
    }));

    const { data } = await client.put(
      PATH.DOCUMENT_FOLDER_PERMISSIONS(folderId),
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        // Bypass any global transform that might url-encode arrays
        transformRequest: [
          (data, headers) => {
            headers['Content-Type'] = 'application/json';
            return JSON.stringify(data);
          },
        ],
      }
    );
    return data;
  }

  async getDocumentPermissions(config, documentId) {
    const client = await this.createAxiosInstance(config);
    const { data } = await client.get(PATH.DOCUMENT_PERMISSIONS(documentId));
    return Array.isArray(data) ? data : data.items || [];
  }

  async putDocumentPermissions(config, documentId, items) {
    const client = await this.createAxiosInstance(config);

    if (!Array.isArray(items)) {
      throw new TypeError('putDocumentPermissions: items must be an array');
    }
    const payload = items.map((it) => ({
      roleName: it?.roleName,
      actionIds: Array.isArray(it?.actionIds) ? it.actionIds.slice() : [],
    }));

    const { data } = await client.put(
      PATH.DOCUMENT_PERMISSIONS(documentId),
      payload,
      {
        headers: { 'Content-Type': 'application/json' },
        transformRequest: [
          (data, headers) => {
            headers['Content-Type'] = 'application/json';
            return JSON.stringify(data);
          },
        ],
      }
    );
    return data;
  }

  async createAxiosInstance(config) {
    const oauthService = new OAuthService(
      config.liferayUrl,
      config.clientId,
      config.clientSecret
    );
    const accessToken = await oauthService.getAccessToken(
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
      } catch (urlError) {
        throw new Error(`Invalid URL format: ${config.liferayUrl}`);
      }

      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      oauthService.validateOAuthConfig(config);

      const client = await this.createAxiosInstance(config);

      const response = await client.get(
        '/o/headless-admin-user/v1.0/my-user-account'
      );

      return {
        status: 'connected',
        message: 'Successfully connected to Liferay Commerce using OAuth 2',
      };
    } catch (error) {
      console.error(
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
        error.response?.status === 401 ||
        error.response?.status === 403 ||
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        error.status === 401 ||
        error.status === 403 ||
        error.message.includes('OAuth authentication failed')
      ) {
        structuredError.error =
          'Authentication failed. Please verify your OAuth Client ID and Client Secret are correct.';
        structuredError.errorType = 'auth_error';
        structuredError.field = 'clientSecret';

        // Use the OAuth service error reference if available
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

      // Generate a unique error reference code only if not already provided by OAuth service
      const errorReference =
        structuredError.errorReference ||
        `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`); // Log to microservice console
      structuredError.errorReference = errorReference; // Add to structured error for potential internal use

      // For UI, only pass back the error reference and a user-friendly message
      const uiErrorResponse = {
        success: false,
        error: structuredError.error,
        errorType: structuredError.errorType,
        field: structuredError.field,
        status: structuredError.status,
        errorReference: errorReference, // Include the reference code in the UI response
      };

      const errorResponse = new Error(structuredError.error);
      errorResponse.response = {
        data: uiErrorResponse, // Use the UI-focused response
        status: structuredError.status || 500,
      };

      throw errorResponse;
    }
  }

  async getCatalogs(config) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        '/o/headless-commerce-admin-catalog/v1.0/catalogs'
      );
      return response.data.items || [];
    } catch (error) {
      console.error('Failed to fetch catalogs:', error);
      throw new Error(`Failed to fetch catalogs: ${error.message}`);
    }
  }

  async getChannels(config) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        '/o/headless-commerce-admin-channel/v1.0/channels'
      );
      return response.data.items || [];
    } catch (error) {
      console.error('Failed to fetch channels:', error);
      throw new Error(`Failed to fetch channels: ${error.message}`);
    }
  }

  async createProduct(config, productData) {
    try {
      const client = await this.createAxiosInstance(config);

      if (!productData.catalogId && config.catalogId) {
        productData.catalogId = parseInt(config.catalogId);
      }

      console.log('Creating product with payload:', {
        sku: productData.sku,
        name: productData.name?.en_US || 'N/A',
        catalogId: productData.catalogId,
        productType: productData.productType,
        payloadKeys: Object.keys(productData),
      });

      const response = await client.post(
        '/o/headless-commerce-admin-catalog/v1.0/products',
        productData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('Product creation failed:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        requestPayload: {
          sku: productData.sku,
          name: productData.name?.en_US || 'N/A',
          catalogId: productData.catalogId,
          invalidProperties: Object.keys(productData).filter(
            (key) =>
              ![
                'catalogId',
                'name',
                'description',
                'shortDescription',
                'sku',
                'productType',
                'active',
                'externalReferenceCode',
                'metaDescription',
                'metaTitle',
              ].includes(key)
          ),
        },
        timestamp: new Date().toISOString(),
        errorReference: errorReference,
      });

      throw ErrorHandler.handleLiferayError(
        error,
        'create-product',
        productData,
        errorReference
      );
    }
  }

  async createProductsBatch(config, productsData, callbackUrl) {
    try {
      const client = await this.createAxiosInstance(config);

      const batchPayload = {
        createStrategy: 'INSERT',
        items: productsData,
      };

      let url = '/o/headless-commerce-admin-catalog/v1.0/products/batch';
      if (callbackUrl && callbackUrl !== 'null') {
        url += `?callbackURL=${encodeURIComponent(callbackUrl)}`;
      }

      logger.info('Sending batch product creation request', {
        operation: 'create-products-batch',
        productCount: productsData.length,
        callbackUrl: callbackUrl || 'none',
        url: url,
      });

      const response = await client.post(url, batchPayload);

      logger.info('Batch product creation initiated', {
        operation: 'create-products-batch',
        batchId: response.data.id || 'unknown',
        status: response.data.status || 'submitted',
      });

      return {
        batchId: response.data.id || `batch-${Date.now()}`,
        status: response.data.status || 'submitted',
        productCount: productsData.length,
      };
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to create products batch', {
        operation: 'create-products-batch',
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        errorReference: errorReference,
      });
      throw new Error(
        `Failed to create products batch: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`
      );
    }
  }

  async addProductImageByBase64(config, productERC, imageData, priority = 1.0) {
    try {
      if (!config) return;
      if (!productERC) return;
      if (!imageData) return;

      const client = await this.createAxiosInstance(config);

      // Extract base64 data from data URL format
      let base64Data = imageData;
      let contentType = 'image/jpeg'; // default fallback

      if (imageData.startsWith('data:')) {
        const match = imageData.match(/^data:([^;]+);base64,(.*)$/);
        if (match) {
          contentType = match[1] || contentType;
          base64Data = match[2];
        } else {
          // fallback if somehow split fails
          base64Data = imageData.split(',')[1];
        }
      }

      const payload = {
        attachment: base64Data,
        title: {
          en_US: `Product Image - ${productERC}`,
        },
        contentType,
        priority,
      };

      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/${productERC}/images/by-base64`,
        payload
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to add product image by base64:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to add product image: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async addProductAttachmentByBase64(
    config,
    productERC,
    attachmentMetaData,
    priority = 1.0
  ) {
    try {
      if (!config) return;
      if (!productERC) return;
      if (!attachmentMetaData) return;

      const client = await this.createAxiosInstance(config);

      const attachmentData = attachmentMetaData?.attachment;
      if (!attachmentData) return;

      // Extract base64 data from data URL format and validate PDF
      let base64Data = attachmentData;
      if (attachmentData.startsWith('data:')) {
        base64Data = attachmentData.split(',')[1];
      }

      // Validate that the base64 decodes to a valid PDF
      try {
        const pdfBuffer = Buffer.from(base64Data, 'base64');
        const pdfHeader = pdfBuffer.slice(0, 4).toString();
        if (pdfHeader !== '%PDF') {
          console.warn(
            `Warning: PDF attachment for ${productERC} does not have valid PDF header, got: ${pdfHeader}`
          );
        }
      } catch (validationError) {
        console.error(
          `PDF validation failed for ${productERC}:`,
          validationError.message
        );
      }

      const payload = {
        attachment: base64Data,
        title: attachmentMetaData.title || {
          en_US: `Product Documentation - ${productERC}`,
        },
        contentType: attachmentMetaData.contentType || 'application/pdf',
        priority,
      };

      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/${productERC}/attachments/by-base64`,
        payload
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to add product attachment by base64:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to add product attachment: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async addProductImageByUrl(config, productERC, imageUrlData) {
    try {
      const client = await this.createAxiosInstance(config);

      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/${productERC}/images/by-url`,
        imageUrlData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('imageUrlData', imageUrlData);
      console.error(
        'Failed to add product image by URL:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to add product image: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async addProductAttachmentByUrl(config, productERC, attachmentUrlData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/by-externalReferenceCode/${productERC}/attachments/by-url`,
        attachmentUrlData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to add product attachment by URL:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to add product attachment: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createAccountsBatch(config, accountsData, callbackUrl) {
    try {
      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      const token = await oauthService.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );

      const batchPayload = {
        createStrategy: 'INSERT',
        items: accountsData,
      };

      const finalCallbackUrl = callbackUrl;

      logger.info('Sending batch account creation request', {
        operation: 'create-accounts-batch',
        accountCount: accountsData.length,
        callbackUrl: finalCallbackUrl,
      });

      const response = await axios.post(
        `${
          config.liferayUrl
        }/o/headless-admin-user/v1.0/accounts/batch?callbackURL=${encodeURIComponent(
          finalCallbackUrl
        )}`,
        batchPayload,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Batch account creation initiated', {
        operation: 'create-accounts-batch',
        batchId: response.data.id || 'unknown',
        status: response.data.status || 'submitted',
      });

      return {
        batchId: response.data.id || `batch-${Date.now()}`,
        status: response.data.status || 'submitted',
        accountCount: accountsData.length,
      };
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to create accounts batch', {
        operation: 'create-accounts-batch',
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        errorReference: errorReference,
      });
      throw new Error(
        `Failed to create accounts batch: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`
      );
    }
  }

  async createAccount(config, accountData) {
    try {
      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      const token = await oauthService.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );

      const response = await axios.post(
        `${config.liferayUrl}/o/headless-admin-user/v1.0/accounts`,
        accountData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Account created successfully', {
        operation: 'create-account',
        accountId: response.data.id,
        accountName: response.data.name,
      });

      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to create account', {
        operation: 'create-account',
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        errorReference: errorReference,
      });
      throw ErrorHandler.handleLiferayError(
        error,
        'create-account',
        accountData,
        errorReference
      );
    }
  }

  async createOrder(config, orderData) {
    try {
      const client = await this.createAxiosInstance(config);

      if (!orderData.channelId) {
        throw new Error('channelId is required for order creation');
      }
      if (!orderData.currencyCode) {
        throw new Error('currencyCode is required for order creation');
      }

      orderData.channelId = parseInt(orderData.channelId);
      orderData.currencyCode = orderData.currencyCode;

      console.log('Creating order with payload:', {
        channelId: orderData.channelId,
        currencyCode: orderData.currencyCode,
        accountId: orderData.accountId,
        payloadKeys: Object.keys(orderData),
      });

      const response = await client.post(
        '/o/headless-commerce-admin-order/v1.0/orders',
        orderData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('Order creation failed:', {
        error: error.response?.data || error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        requestPayload: {
          channelId: orderData.channelId,
          currencyCode: orderData.currencyCode,
          accountId: orderData.accountId,
          invalidProperties: Object.keys(orderData).filter(
            (key) =>
              ![
                'channelId',
                'currencyCode',
                'accountId',
                'orderTypeExternalReferenceCode',
                'orderDate',
                'externalReferenceCode',
                'orderStatus',
              ].includes(key)
          ),
        },
        timestamp: new Date().toISOString(),
        errorReference: errorReference,
      });

      throw new Error(
        `Failed to create order: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`
      );
    }
  }

  async getProducts(config) {
    try {
      const client = await this.createAxiosInstance(config);
      let url = '/o/headless-commerce-admin-catalog/v1.0/products';

      if (config.catalogId) {
        url += `?filter=catalogId eq ${config.catalogId}`;
      }

      const response = await client.get(url);
      return response.data.items || [];
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('Failed to fetch products:', error);
      throw new Error(`Failed to fetch products: ${error.message}`);
    }
  }

  async getAccounts(config) {
    try {
      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      const token = await oauthService.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );

      const response = await axios.get(
        `${config.liferayUrl}/o/headless-admin-user/v1.0/accounts`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data.items || [];
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to fetch accounts', {
        operation: 'get-accounts',
        error: error.message,
        status: error.response?.status,
        errorReference: errorReference,
      });
      throw error;
    }
  }

  async createPriceList(config, priceListData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        '/o/headless-commerce-admin-pricing/v1.0/price-lists',
        priceListData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to create price list:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create price list: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createPriceEntry(config, priceListId, priceEntryData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        `/o/headless-commerce-admin-pricing/v1.0/price-lists/${priceListId}/price-entries`,
        priceEntryData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to create price entry:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create price entry: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async addProductSpecification(config, productId, specData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/${productId}/product-specifications`,
        specData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to add product specification:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to add specification: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async addProductAttachment(config, productId, attachmentData) {
    try {
      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      const accessToken = await oauthService.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );

      const response = await axios.post(
        `${config.liferayUrl}/o/headless-commerce-admin-catalog/v1.0/products/${productId}/attachments`,
        attachmentData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.errorWithStack(error, {
        operation: 'add-product-attachment',
        productId,
        attachmentData,
        errorDetails: error.response?.data,
      });
      throw error;
    }
  }

  async addProductImage(config, productId, imageData) {
    try {
      const oauthService = new OAuthService(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );
      const accessToken = await oauthService.getAccessToken(
        config.liferayUrl,
        config.clientId,
        config.clientSecret
      );

      // Use the product images endpoint instead of attachments
      const response = await axios.post(
        `${config.liferayUrl}/o/headless-commerce-admin-catalog/v1.0/products/${productId}/images`,
        {
          title: imageData.title,
          src: imageData.src,
          attachment: imageData.attachment,
          priority: 0,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.errorWithStack(error, {
        operation: 'add-product-image',
        productId,
        imageData,
        errorDetails: error.response?.data,
      });
      throw error;
    }
  }

  async getCurrencies(config) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        '/o/headless-commerce-admin-catalog/v1.0/currencies'
      );
      return (
        response.data?.items.map((currency) => ({
          code: currency.code,
          name: currency.name[config.languageId],
        })) || []
      );
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('Failed to fetch currencies:', error);
      throw new Error(`Failed to fetch currencies: ${error.message}`);
    }
  }

  async getSiteLanguages(config, siteGroupId) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        `/o/headless-delivery/v1.0/sites/${siteGroupId}/languages`
      );
      return response.data.items || [];
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error('Failed to fetch site languages:', error);
      throw new Error(`Failed to fetch site languages: ${error.message}`);
    }
  }

  async createProductSku(config, productId, skuData) {
    try {
      const client = await this.createAxiosInstance(config);

      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/${productId}/skus`,
        skuData
      );

      logger.info('SKU created successfully', {
        correlationId: uuidv4(),
        operation: 'create-sku',
        productId: productId,
        sku: response.data.sku,
        skuId: response.data.id,
      });

      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to create SKU', {
        correlationId: uuidv4(),
        operation: 'create-sku',
        error: {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        },
        productId: productId,
        skuData: skuData,
        timestamp: new Date().toISOString(),
        errorReference: errorReference,
      });

      throw new Error(
        `Failed to create SKU: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`
      );
    }
  }

  async addProductOptions(config, productId, productOptions) {
    try {
      const client = await this.createAxiosInstance(config);

      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/products/${productId}/productOptions`,
        productOptions
      );

      logger.info('Product options added successfully', {
        correlationId: uuidv4(),
        operation: 'add-product-options',
        productId: productId,
        optionsCount: productOptions.length,
      });

      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to add product options', {
        correlationId: uuidv4(),
        operation: 'add-product-options',
        error: {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data,
        },
        productId: productId,
        productOptions: productOptions,
        timestamp: new Date().toISOString(),
        errorReference: errorReference,
      });

      throw new Error(
        `Failed to add product options: ${
          error.response?.data?.title ||
          error.response?.data?.detail ||
          error.message
        }`
      );
    }
  }

  async createSkuPriceEntry(config, priceListId, skuId, priceEntryData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        `/o/headless-commerce-admin-pricing/v1.0/price-lists/${priceListId}/price-entries`,
        { ...priceEntryData, skuId }
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      console.error(
        'Failed to create SKU price entry:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create SKU price entry: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createOption(config, optionData) {
    try {
      console.log(`LiferayService.createOption called with:`, {
        optionKey: optionData.key,
        optionName: optionData.name?.en_US,
        fieldType: optionData.fieldType,
        liferayUrl: config.liferayUrl,
      });
      const client = await this.createAxiosInstance(config);
      console.log(
        `Making POST request to: ${config.liferayUrl}/o/headless-commerce-admin-catalog/v1.0/options`
      );
      const response = await client.post(
        '/o/headless-commerce-admin-catalog/v1.0/options',
        optionData
      );
      console.log(`✓ Option created successfully:`, response.data);
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 500) {
        console.error(
          'Internal Server Error - Create Option Request Details:',
          {
            url: '/o/headless-commerce-admin-catalog/v1.0/options',
            method: 'POST',
            requestBody: optionData,
            config: {
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
            },
            response: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: error.response.data,
            },
            timestamp: new Date().toISOString(),
            errorReference: errorReference,
          }
        );
      }

      console.error(
        'Failed to create option:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create option: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createOptionValue(config, optionId, optionValueData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        `/o/headless-commerce-admin-catalog/v1.0/options/${optionId}/optionValues`,
        optionValueData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 500) {
        console.error(
          'Internal Server Error - Create Option Value Request Details:',
          {
            url: `/o/headless-commerce-admin-catalog/v1.0/options/${optionId}/optionValues`,
            method: 'POST',
            optionId: optionId,
            requestBody: optionValueData,
            config: {
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
            },
            response: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: error.response.data,
            },
            timestamp: new Date().toISOString(),
            errorReference: errorReference,
          }
        );
      }

      console.error(
        'Failed to create option value:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create option value: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async getOptionByERC(config, externalReferenceCode) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        `/o/headless-commerce-admin-catalog/v1.0/options/by-external-reference-code/${externalReferenceCode}`
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 404) {
        return null;
      }
      console.error(
        'Failed to get option by ERC:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to get option by ERC: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async getOptionValueByERC(config, optionId, externalReferenceCode) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        `/o/headless-commerce-admin-catalog/v1.0/options/${optionId}/optionValues/by-external-reference-code/${externalReferenceCode}`
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 404) {
        return null;
      }
      console.error(
        'Failed to get option value by ERC:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to get option value by ERC: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createOptionCategory(config, optionCategoryData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        '/o/headless-commerce-admin-catalog/v1.0/optionCategories',
        optionCategoryData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 500) {
        console.error(
          'Internal Server Error - Create Option Category Request Details:',
          {
            url: '/o/headless-commerce-admin-catalog/v1.0/optionCategories',
            method: 'POST',
            requestBody: optionCategoryData,
            config: {
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
            },
            response: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: error.response.data,
            },
            timestamp: new Date().toISOString(),
            errorReference: errorReference,
          }
        );
      }

      console.error(
        'Failed to create option category:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create option category: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async getOptionCategoryByERC(config, externalReferenceCode) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        `/o/headless-commerce-admin-catalog/v1.0/optionCategories/by-external-reference-code/${externalReferenceCode}`
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 404) {
        return null;
      }
      console.error(
        'Failed to get option category by ERC:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to get option category by ERC: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async createSpecification(config, specificationData) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.post(
        '/o/headless-commerce-admin-catalog/v1.0/specifications',
        specificationData
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 500) {
        console.error(
          'Internal Server Error - Create Specification Request Details:',
          {
            url: '/o/headless-commerce-admin-catalog/v1.0/specifications',
            method: 'POST',
            requestBody: specificationData,
            config: {
              liferayUrl: config.liferayUrl,
              localeCode: config.localeCode,
            },
            response: {
              status: error.response.status,
              statusText: error.response.statusText,
              data: error.response.data,
            },
            timestamp: new Date().toISOString(),
            errorReference: errorReference,
          }
        );
      }

      console.error(
        'Failed to create specification:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to create specification: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async getSpecificationByERC(config, externalReferenceCode) {
    try {
      const client = await this.createAxiosInstance(config);
      const response = await client.get(
        `/o/headless-commerce-admin-catalog/v1.0/specifications/by-external-reference-code/${externalReferenceCode}`
      );
      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      if (error.response?.status === 404) {
        return null;
      }
      console.error(
        'Failed to get specification by ERC:',
        error.response?.data || error.message
      );
      throw new Error(
        `Failed to get specification by ERC: ${
          error.response?.data?.title || error.message
        }`
      );
    }
  }

  async getConfig(config, configKey) {
    try {
      const client = await this.createAxiosInstance(config);
      const filter = encodeURIComponent(
        `configKey eq '${configKey}' and configStatus eq 'Active'`
      );

      const url = `/o/c/aicommerceacceleratorconfigurations/?fields=configValue&filter=${filter}`;

      logger.info('Getting configuration from Liferay', {
        operation: 'get-config',
        configKey: configKey,
        url: url,
        baseURL: config.liferayUrl,
      });

      const response = await client.get(url);

      return response.data;
    } catch (error) {
      const errorReference = `LIFR-${Date.now()}-${uuidv4().slice(0, 8)}`;
      console.error(`Error Reference: ${errorReference}`);
      logger.error('Failed to get configuration entry', {
        operation: 'get-config',
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        configKey: configKey,
        errorReference: errorReference,
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
    const client = await this.createAxiosInstance(config);
    try {
      const folder = await getDocumentsFolderByERC.call(
        this,
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
      const { data } = await client.post(
        `/o/headless-delivery/v1.0/sites/${siteGroupId}/documents-folders`,
        {
          name,
          externalReferenceCode,
          description: 'Uploads from AI Commerce Accelerator',
        }
      );
      return data;
    }
  }

  async getDocumentsFolderByERC(config, siteId, externalReferenceCode) {
    const client = await this.createAxiosInstance(config);
    const { data } = await client.get(
      `/o/headless-delivery/v1.0/sites/${siteId}/documents-folders/by-externalReferenceCode/${encodeURIComponent(
        externalReferenceCode
      )}`
    );
    return data; // folder
  }

  async createSiteDocumentsFolder(config, siteId, opts = {}) {
    if (!config || !siteId) return;

    const client = await this.createAxiosInstance(config);

    let folderName = opts.folderName;
    let folderERC = opts.folderExternalReferenceCode;

    if (!folderName || !folderERC) {
      // friendly name + short hash
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

    // POST /v1.0/sites/{siteId}/documents-folders
    const { data: folder } = await client.post(
      `/o/headless-delivery/v1.0/sites/${siteId}/document-folders`,
      payload
    );

    return { folder, folderName, folderERC };
  }

  async uploadSiteDocumentMultipart(config, file, opts = {}) {
    const client = await this.createAxiosInstance(config);

    // Pick correct FormData implementation (browser vs Node)
    const FormDataCtor =
      typeof FormData !== 'undefined'
        ? FormData
        : (await import('form-data')).default;

    const form = new FormDataCtor();

    // Resolve filename/mime
    const filename = opts.filename || file?.filename || 'upload.bin';
    const mime = opts.mime || file?.mime || 'application/octet-stream';

    // ----- JSON 'document' part (as STRING, no filename) -----
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

    // IMPORTANT: no filename here; send as a plain field with JSON content type
    form.append('document', JSON.stringify(documentJson), {
      contentType: 'application/json; charset=utf-8',
    });

    // ----- binary 'file' part -----
    if (Buffer.isBuffer(file)) {
      form.append('file', file, { filename, contentType: mime });
    } else if (file?.buffer && Buffer.isBuffer(file.buffer)) {
      form.append('file', file.buffer, { filename, contentType: mime });
    } else if (file?.path) {
      const fs = require('fs');
      form.append('file', fs.createReadStream(file.path), {
        filename,
        contentType: mime,
      });
    } else {
      throw new Error(
        'uploadSiteDocumentMultipart: provide a Buffer, a Multer file with .buffer, or an object with .path'
      );
    }

    const url = `/o/headless-delivery/v1.0/sites/${config.siteGroupId}/documents`;

    const { data } = await client.post(url, form, {
      headers: {
        ...form.getHeaders(), // sets proper multipart boundary
        Accept: 'application/json',
      },
      // Avoid any global transform that might stringify the FormData as querystring
      transformRequest: [(data, headers) => data],
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return data;
  }

  async attachSiteDocumentToProductByUrl(config, productERC, doc) {
    const isImage = /^(png|jpg|jpeg|webp|gif)$/i.test(doc.fileExtension || '');
    const title = {
      en_US:
        doc.title ||
        (isImage ? `Image for ${productERC}` : `Attachment for ${productERC}`),
    };
    const payload = {
      externalReferenceCode: `${isImage ? 'IMG' : 'ATT'}_${Date.now()}`,
      title,
      src: doc.contentUrl,
    };

    if (isImage) {
      return this.addProductImageByUrl(config, productERC, payload);
    }
    return this.addProductAttachmentByUrl(config, productERC, payload);
  }

  async attachDocumentToProduct(config, productERC, doc) {
    const isImage = /^(png|jpg|jpeg|webp|gif)$/i.test(doc.fileExtension || '');

    if (isImage) {
      return this.addProductImageByUrl(config, productERC, {
        externalReferenceCode: `IMG_${Date.now()}`,
        title: { en_US: doc.title || `Image for ${productERC}` },
        src: doc.contentUrl,
      });
    }

    return this.addProductAttachmentByUrl(config, productERC, {
      externalReferenceCode: `ATT_${Date.now()}`,
      title: { en_US: doc.title || `Attachment for ${productERC}` },
      src: doc.contentUrl,
    });
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

    // Resolve ops
    const ops = this._resolvePermissionsOps(assetType);

    // GET current (normalized to array via the getters above)
    const currentItems = await ops.get(config, id);

    // Build proposed
    const built = buildPermissionsItems({
      assetType,
      viewableBy,
      overrides,
      includeRoles,
    });

    // Merge → returns array
    const merged = this._mergePermissionsItems(currentItems, built, {
      strategy,
      remove,
    });

    // PUT raw array
    return ops.put(config, id, merged);
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
    const currentItems = current.items || [];

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

    // else treat as builder options object
    return this.patchDocumentFolderPermissions(
      config,
      folderId,
      builderOrMutator
    );
  }

  async mutateDocumentPermissions(config, documentId, builderOrMutator) {
    const current = await this.getDocumentPermissions(config, documentId);
    const currentItems = current.items || [];

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
