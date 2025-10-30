const { Storage } = require('@google-cloud/storage');
const { randomUUID } = require('crypto');
const { ENV } = require('../utils/constants.cjs');
const {
  normalizeNumber,
  tryParseJSON,
  createERC,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

function withErrorRef(err, operation) {
  if (err && err.errorReference) return err;
  const wrapped = err instanceof Error ? err : new Error(String(err || 'Error'));
  wrapped.errorReference = createERC(ERC_PREFIX.ERROR);
  wrapped.operation = operation;
  return wrapped;
}

function parseObjectPath(path) {
  if (!path || typeof path !== 'string') {
    throw withErrorRef(
      new Error('Invalid path: must be a non-empty string'),
      'parse-object-path'
    );
  }

  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  const parts = path.split('/');

  if (parts.length < 3) {
    throw withErrorRef(
      new Error('Invalid path: must contain at least a bucket name'),
      'parse-object-path'
    );
  }

  const bucketName = parts[1];
  const objectName = parts.slice(2).join('/');

  return { bucketName, objectName };
}

async function signObjectURL({
  sidecarEndpoint,
  bucketName,
  objectName,
  method,
  ttlSec,
}) {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };

  const response = await fetch(
    `${sidecarEndpoint}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }
  );

  if (!response.ok) {
    const err = new Error(
      `Failed to sign object URL, status=${response.status}`
    );
    throw withErrorRef(err, 'sign-object-url');
  }

  const body = await response.json();
  const signedURL = body && body.signed_url ? body.signed_url : null;

  if (!signedURL) {
    const err = new Error('No signed_url returned from signer service');
    throw withErrorRef(err, 'sign-object-url');
  }

  return signedURL;
}

class ObjectNotFoundError extends Error {
  constructor(message = 'Object not found') {
    super(message);
    this.name = 'ObjectNotFoundError';
    this.errorReference = createERC(ERC_PREFIX.ERROR);
  }
}

class ObjectStorageService {
  constructor({ configService, logger }) {
    this.configService = configService;
    this.logger = logger;

    this.sidecarEndpoint =
      ENV.OBJECT_STORAGE_SIDECAR_ENDPOINT || 'http://';

    this.signedUrlTtlSec = normalizeNumber(
      ENV.OBJECT_STORAGE_SIGNED_URL_TTL_SEC,
      {
        min: 60,
        defaultValue: 900,
      }
    );

    this.uploadPrefix = (ENV.OBJECT_STORAGE_UPLOAD_PREFIX || 'uploads')
      .replace(/^\/+|\/+$/g, '')
      .trim();

    this.client = this.buildClient();

    const cachedCfg =
      this.configService?.getObjectStorageConfigCached?.() || {};
    this.applyConfig(cachedCfg);
  }

  buildClient() {
    return new Storage({
      credentials: {
        audience: 'replit',
        subject_token_type: 'access_token',
        token_url: `${this.sidecarEndpoint}/token`,
        type: 'external_account',
        credential_source: {
          url: `${this.sidecarEndpoint}/credential`,
          format: { type: 'json', subject_token_field_name: 'access_token' },
        },
        universe_domain: 'googleapis.com',
      },
      projectId: '',
    });
  }

  applyConfig(input) {
    if (!input) return;

    let cfg = input;
    if (typeof cfg === 'string') {
      cfg = tryParseJSON(cfg, null);
    }
    if (!cfg || typeof cfg !== 'object') return;

    if (cfg.signedUrlTtlSec !== undefined) {
      const ttl = normalizeNumber(cfg.signedUrlTtlSec, {
        min: 60,
        defaultValue: this.signedUrlTtlSec,
      });
      this.signedUrlTtlSec = Math.max(this.signedUrlTtlSec, ttl);
    }

    if (cfg.sidecarEndpoint && typeof cfg.sidecarEndpoint === 'string') {
      this.sidecarEndpoint = cfg.sidecarEndpoint;
    }

    if (cfg.uploadPrefix && typeof cfg.uploadPrefix === 'string') {
      this.uploadPrefix = cfg.uploadPrefix.replace(/^\/+|\/+$/g, '').trim();
    }

    this.client = this.buildClient();

    this.logger?.debug?.('ObjectStorageService config applied', {
      operation: 'object-storage-config-apply',
      sidecarEndpoint: this.sidecarEndpoint,
      signedUrlTtlSec: this.signedUrlTtlSec,
      uploadPrefix: this.uploadPrefix,
    });
  }

  getPublicObjectSearchPaths() {
    const pathsStr = ENV.PUBLIC_OBJECT_SEARCH_PATHS;
    if (!pathsStr || typeof pathsStr !== 'string') {
      const err = new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
      throw withErrorRef(err, 'get-public-object-search-paths');
    }

    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );

    if (paths.length === 0) {
      const err = new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS is empty. Provide at least one '/bucket/path' entry."
      );
      throw withErrorRef(err, 'get-public-object-search-paths');
    }

    return paths;
  }

  getPrivateObjectDir() {
    const dir = ENV.PRIVATE_OBJECT_DIR;
    if (!dir || typeof dir !== 'string' || !dir.trim()) {
      const err = new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' and set PRIVATE_OBJECT_DIR env var."
      );
      throw withErrorRef(err, 'get-private-object-dir');
    }
    return dir.trim();
  }

  async getObjectEntityUploadURL() {
    try {
      const privateObjectDir = this.getPrivateObjectDir();
      const objectId = randomUUID();

      const prefix = this.uploadPrefix
        ? `/${this.uploadPrefix}`
        : '/uploads';
      const fullPath = `${privateObjectDir}${prefix}/${objectId}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);

      const signedURL = await signObjectURL({
        sidecarEndpoint: this.sidecarEndpoint,
        bucketName,
        objectName,
        method: 'PUT',
        ttlSec: this.signedUrlTtlSec,
      });

      this.logger?.trace?.('Generated upload URL for object entity', {
        operation: 'get-object-entity-upload-url',
        bucketName,
        objectName,
        ttlSec: this.signedUrlTtlSec,
      });

      return {
        success: true,
        uploadUrl: signedURL,
        objectPath: fullPath,
        expiresInSeconds: this.signedUrlTtlSec,
      };
    } catch (err) {
      const error = withErrorRef(err, 'get-object-entity-upload-url');

      this.logger?.error?.('Failed to get object entity upload URL', {
        operation: 'get-object-entity-upload-url',
        errorReference: error.errorReference,
        message: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  normalizeObjectEntityPath(rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return rawPath;

    if (!rawPath.startsWith('https://')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }
}

module.exports = {
  ObjectStorageService,
  ObjectNotFoundError,
};