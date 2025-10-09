function normalizeEntityType(t) {
  if (!t) return 'unknown';
  const s = String(t).toLowerCase().trim();
  if (s.startsWith('product')) return 'products';
  if (s.startsWith('order')) return 'orders';
  if (s.startsWith('account')) return 'accounts';
  if (s.startsWith('image')) return 'images';
  if (s.startsWith('pdf')) return 'pdfs';
  return s;
}

const clampToTotal = (total, n) =>
  Math.max(0, Math.min(Number.isFinite(total) ? total : n, n));

export { clampToTotal, normalizeEntityType };
