const fs = require('fs/promises');
const path = require('path');
const { ENV } = require('../utils/constants.cjs');

class PromptService {
  constructor(ctx) {
    this.ctx = ctx;
    const envDir = ENV.PROMPTS_DIR;
    const cfgDir = this.ctx?.configService?.getAIConfigCached?.()?.promptsDir;
    this.baseDir = path.resolve(process.cwd(), envDir || cfgDir || 'prompts');
    this.cacheTTL =
      Number(ENV.PROMPT_CACHE_TTL) > 0
        ? Number(ENV.PROMPT_CACHE_TTL)
        : 10 * 60 * 1000;
    this.disableCache =
      String(ENV.PROMPT_CACHE_DISABLED || '').toLowerCase() === 'true';
    this.cache = this.ctx?.cache || new Map();
  }

  _safeName(name) {
    const n = String(name || '').trim();
    const clean = path
      .basename(n)
      .replace(/\.\.+/g, '')
      .replace(/[^\w.-]/g, '_');
    if (!clean) throw new Error('Invalid prompt name');
    return clean;
  }

  async _getFileMeta(filePath) {
    try {
      const st = await fs.stat(filePath);
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch (e) {
      if (e && e.code === 'ENOENT')
        throw new Error(`Prompt not found: ${path.basename(filePath, '.md')}`);
      throw e;
    }
  }

  _getCache(key) {
    if (!this.cache || typeof this.cache.get !== 'function') return null;
    const rec = this.cache.get(key);
    if (!rec) return null;
    if (rec.expiresAt && rec.expiresAt <= Date.now()) {
      try {
        this.cache.delete?.(key);
      } catch {}
      return null;
    }
    return rec;
  }

  _setCache(key, value, ttlMs) {
    if (!this.cache || typeof this.cache.set !== 'function') return;
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null;
    try {
      this.cache.set(key, { ...value, expiresAt }, ttlMs);
    } catch {
      try {
        this.cache.set(key, { ...value, expiresAt });
      } catch {}
    }
  }

  async loadRaw(name, requestConfig) {
    const safe = this._safeName(name);

    if (requestConfig) {
      const remotePrompt = await this.ctx?.configService?.getAIPrompt?.(
        requestConfig,
        safe
      );

      if (typeof remotePrompt === 'string' && remotePrompt.trim()) {
        return remotePrompt;
      }
    }

    const filePath = path.join(this.baseDir, `${safe}.md`);
    const { mtimeMs } = await this._getFileMeta(filePath);
    const key = `prompt:${safe}:raw`;
    if (!this.disableCache) {
      const cached = this._getCache(key);
      if (cached && cached.mtimeMs === mtimeMs && cached.txt) return cached.txt;
    }
    const buf = await fs.readFile(filePath);
    const txt = buf.toString('utf8');
    if (!this.disableCache)
      this._setCache(key, { txt, mtimeMs }, this.cacheTTL);
    return txt;
  }

  renderFromString(tpl, vars = {}) {
    const get = (p) =>
      p
        .split('.')
        .reduce((a, k) => (a && a[k] !== undefined ? a[k] : ''), vars);

    return String(tpl || '')
      .replace(/\{\{=json:([\w.[\]]+)\}\}/g, (_, p) => {
        try {
          return JSON.stringify(get(p));
        } catch {
          return 'null';
        }
      })
      .replace(/\{\{([\w.[\]]+)\}\}/g, (_, p) => String(get(p)));
  }

  async render(name, vars = {}, requestConfig) {
    const raw = await this.loadRaw(name, requestConfig);
    return this.renderFromString(raw, vars);
  }
}

module.exports = { PromptService };
