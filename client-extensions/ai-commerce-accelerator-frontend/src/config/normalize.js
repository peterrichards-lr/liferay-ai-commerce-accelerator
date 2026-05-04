export const normalizeConfig = (config) => {
  const filtered = Object.entries(config).reduce((acc, [key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      acc[key] = value;
    }
    return acc;
  }, {});

  const normalized = { ...filtered };

  if (normalized.batchSize) normalized.batchSize = Number(normalized.batchSize);
  if (normalized.catalogId) normalized.catalogId = Number(normalized.catalogId);
  if (normalized.channelId) normalized.channelId = Number(normalized.channelId);

  return normalized;
};

export const normalizeGenerationConfig = (config) => {
  const normalized = { ...config };

  const numFields = [
    'productCount',
    'accountCount',
    'orderCount',
    'inventoryMin',
    'inventoryMax',
    'inventoryAssignmentRatio',
    'backorderAssignmentRatio',
    'imageWidth',
    'imageHeight',
    'imageRatio',
    'pdfRatio',
    'warehouseCount',
  ];

  numFields.forEach((field) => {
    if (normalized[field] !== undefined) {
      normalized[field] = Number(normalized[field]);
    }
  });

  return normalized;
};
