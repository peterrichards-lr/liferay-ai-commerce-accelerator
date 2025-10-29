const { Storage } = require('@google-cloud/storage');
const { randomUUID } = require('crypto');
const { ENV } = require('../utils/constants.cjs');
const { normalizeNumber } = require('../utils/misc.cjs');

function parseObjectPath(path) {
  if (!path.startsWith('/')) path = `/${path}`;
  const parts = path.split('/');
  if (parts.length < 3)
    throw new Error('Invalid path: must contain at least a bucket name');
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
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, make sure you're running on Replit`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

class ObjectStorageService {
  constructor({ configService, logger, ENV }) {
    this.configService = configService;
    this.logger = logger;
    this.applyConfig();
    this.sidecarEndpoint =
      ENV.OBJECT_STORAGE_SIDECAR_ENDPOINT || 'http://127.0.0.1:1106';
    this.signedUrlTtlSec = normalizeNumber(
      ENV.OBJECT_STORAGE_SIGNED_URL_TTL_SEC,
      {
        min: 60,
        defaultValue: 900,
      }
    );
    this.uploadPrefix = ENV.OBJECT_STORAGE_UPLOAD_PREFIX || 'uploads';
    this.client = new Storage({
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
      try {
        cfg = JSON.parse(cfg);
      } catch {
        return;
      }
    }
    if (typeof cfg !== 'object') return;
    const ttl = normalizeNumber(cfg.signedUrlTtlSec, {
      min: 60,
      defaultValue: this.signedUrlTtlSec,
    });
    this.signedUrlTtlSec = Math.max(this.signedUrlTtlSec, ttl);
    if (cfg.sidecarEndpoint && typeof cfg.sidecarEndpoint === 'string') {
      this.sidecarEndpoint = cfg.sidecarEndpoint;
    }
    if (cfg.uploadPrefix && typeof cfg.uploadPrefix === 'string') {
      this.uploadPrefix = cfg.uploadPrefix.replace(/^\/+|\/+$/g, '');
    }
    this.client = new Storage({
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
    this.ctx?.logger?.debug?.('ObjectStorageService config applied', {
      operation: 'object-storage-config-apply',
      sidecarEndpoint: this.sidecarEndpoint,
      signedUrlTtlSec: this.signedUrlTtlSec,
      uploadPrefix: this.uploadPrefix,
    });
  }

  getPublicObjectSearchPaths() {
    const pathsStr = ENV.PUBLIC_OBJECT_SEARCH_PATHS;
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir() {
    const dir = ENV.PRIVATE_OBJECT_DIR;
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async getObjectEntityUploadURL() {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const prefix = this.uploadPrefix ? `/${this.uploadPrefix}` : '/uploads';
    const fullPath = `${privateObjectDir}${prefix}/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    return signObjectURL({
      sidecarEndpoint: this.sidecarEndpoint,
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: this.signedUrlTtlSec,
    });
  }

  normalizeObjectEntityPath(rawPath) {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) return rawPath;
    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;
    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) objectEntityDir = `${objectEntityDir}/`;
    if (!rawObjectPath.startsWith(objectEntityDir)) return rawObjectPath;
    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }
}

module.exports = {
  ObjectStorageService,
  ObjectStorageService,
  ObjectNotFoundError,
};
