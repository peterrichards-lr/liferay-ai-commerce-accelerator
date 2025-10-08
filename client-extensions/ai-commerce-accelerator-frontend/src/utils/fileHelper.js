const exportJsonFile = (data, filename, root = document) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const link = root.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  root.removeChild(link);
  URL.revokeObjectURL(url);
};

const importJsonFile = (filename) => {
  if (!filename) return;
};

const buildFilename = (prefix) => {
  return `${prefix}-${new Date().toISOString().split('T')[0]}.json`;
};

export { exportJsonFile, importJsonFile, buildFilename };
