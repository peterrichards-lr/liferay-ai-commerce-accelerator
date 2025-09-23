function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(s);
}
function toNumber(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function parseMaybeJSON(v) {
  if (v == null) return undefined;
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
function bufferToDataUrl(buffer, mime, fallback = 'application/octet-stream') {
  const m = mime || fallback;
  const b64 = buffer.toString('base64');
  return `data:${m};base64,${b64}`;
}

module.exports = { toBoolean, toNumber, parseMaybeJSON, bufferToDataUrl };