export const normalizeConfig = (config) => {
  const normalized = { ...config };

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
