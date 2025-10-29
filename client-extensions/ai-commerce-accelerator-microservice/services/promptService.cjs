const fs = require('fs/promises');
const path = require('path');

class PromptService {
  constructor(ctx) {
    this.ctx = ctx;
    this.baseDir =
      this.ctx?.ENV?.PROMPTS_DIR ||
      this.ctx?.configService?.getAIConfigCached?.()?.promptsDir ||
      path.resolve(process.cwd(), 'prompts');

    this.cacheTTL =
      Number(this.ctx?.ENV?.PROMPT_CACHE_TTL) > 0
        ? Number(this.ctx.ENV.PROMPT_CACHE_TTL)
        : 10 * 60 * 1000;
  }

  async loadRaw(name) {
    const { cache } = this.ctx;
    const key = `prompt:${name}:raw`;
    const cached = cache.get(key);
    if (cached) return cached;

    const filePath = path.join(this.baseDir, `${name}.md`);
    const buf = await fs.readFile(filePath);
    const txt = buf.toString('utf8');
    cache.set(key, txt, this.cacheTTL);
    return txt;
  }

  renderFromString(tpl, vars = {}) {
    const get = (p) =>
      p
        .split('.')
        .reduce((a, k) => (a && a[k] !== undefined ? a[k] : ''), vars);

    return tpl
      .replace(/\{\{=json:([\w.[\]]+)\}\}/g, (_, p) => {
        try {
          return JSON.stringify(get(p));
        } catch {
          return 'null';
        }
      })
      .replace(/\{\{([\w.[\]]+)\}\}/g, (_, p) => String(get(p)));
  }

  async render(name, vars = {}) {
    const raw = await this.loadRaw(name);
    return this.renderFromString(raw, vars);
  }
}

module.exports = { PromptService };
