export function toFormData(obj, files = {}) {
  const fd = new FormData();

  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null) {
      fd.append(key, '');
      return;
    }
    if (value instanceof File || value instanceof Blob) {
      return;
    }
    const isObject = typeof value === 'object';
    fd.append(key, isObject ? JSON.stringify(value) : String(value));
  });

  Object.entries(files).forEach(([field, file]) => {
    if (!file) return;
    fd.append(field, file, file.name || field);
  });

  return fd;
}
