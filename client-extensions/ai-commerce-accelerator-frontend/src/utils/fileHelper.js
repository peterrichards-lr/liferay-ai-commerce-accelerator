const exportJsonFile = (data, filename, root = document) => {
  const doc = root.ownerDocument || root;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const link = doc.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;

  const container =
    root && typeof root.appendChild === 'function' && root.nodeType === 1
      ? root
      : doc.body || doc.documentElement || doc;
  container.appendChild(link);

  try {
    link.click();
  } finally {
    if (link.isConnected && link.parentNode) link.parentNode.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link), 0);
  }
};

const importJsonFile = (filename) => {
  if (!filename) return;
};

const buildFilename = (prefix) => {
  return `${prefix}-${new Date().toISOString().split('T')[0]}.json`;
};

export { exportJsonFile, importJsonFile, buildFilename };
