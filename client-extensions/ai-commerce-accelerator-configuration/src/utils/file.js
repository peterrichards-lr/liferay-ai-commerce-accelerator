export const BASE64_CHAR_LIMIT = 65000;
export const MAX_BYTES_FROM_CHAR_LIMIT = 3 * Math.floor(BASE64_CHAR_LIMIT / 4);

export const getBase64Payload = (raw) => {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = /^data:[^;]+;base64,(.+)$/i.exec(s);
  return (m ? m[1] : s).replace(/\s+/g, '');
};

export const parseMaybeDataUrl = (raw) => {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(raw?.trim() || '');
  if (m) return { mime: m[1], b64: m[2] };
  return null;
};

export const countBase64Chars = (raw) => {
  const parsed = parseMaybeDataUrl(raw);
  const b64 = parsed ? parsed.b64 : raw || '';
  return b64.replace(/\s+/g, '').length;
};

export const byteSizeFromBase64 = (b64) => {
  try {
    const len =
      (b64.length * 3) / 4 -
      (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.floor(len));
  } catch {
    return 0;
  }
};

export const toMB = (bytes) => {
  return (bytes / (1024 * 1024)).toFixed(2);
};

export const detectMimeFromBase64 = (b64) => {
  try {
    const head = atob(b64.slice(0, 64));
    const bytes = Array.from(head, (c) => c.charCodeAt(0));
    const startsWith = (...sig) => sig.every((v, i) => bytes[i] === v);
    if (startsWith(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
      return 'image/png';
    if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
      return 'image/webp';
  } catch {
    // Ignore parsing errors and return null
  }
  return null;
};

export const fileToDataURL = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
};

export const resizeBase64ToFitLimit = async (
  dataUrl,
  { targetCharLimit = BASE64_CHAR_LIMIT, preferType } = {}
) => {
  const payload = getBase64Payload(dataUrl);
  if (!payload) return dataUrl;

  if (payload.length <= targetCharLimit) return dataUrl;

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Failed to decode image'));
    i.src = dataUrl;
  });

  const isWebp = /^data:image\/webp/i.test(dataUrl);
  const targetType = isWebp ? 'image/webp' : preferType || 'image/jpeg';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  const currentLen = payload.length;
  let scale = Math.sqrt(targetCharLimit / currentLen);
  scale = Math.min(1, Math.max(0.05, scale));

  const drawScaled = (s) => {
    const w = Math.max(1, Math.floor(img.width * s));
    const h = Math.max(1, Math.floor(img.height * s));
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
  };

  let quality = 0.92;
  let result = dataUrl;
  for (let pass = 0; pass < 8; pass = 1) {
    drawScaled(scale);
    result = canvas.toDataURL(targetType, quality);
    const len = getBase64Payload(result).length;
    if (len <= targetCharLimit) return result;
    if (pass % 2 === 0) {
      scale *= 0.85;
      scale = Math.max(0.05, scale);
    } else {
      quality *= 0.85;
      quality = Math.max(0.2, quality);
    }
  }
  return result;
};
