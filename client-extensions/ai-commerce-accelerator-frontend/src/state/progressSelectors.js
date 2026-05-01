export const getProgressPercentage = (completed = 0, total = 0) => {
  if (total > 0) return (completed / total) * 100;
  return 0;
};

export const getTotalProgress = (progress) => {
  if (!progress) return { total: 0, completed: 0 };
  const entities = [
    'products',
    'accounts',
    'orders',
    'images',
    'pdfs',
    'warehouses',
  ];
  const totals = entities.map((e) => progress[e]?.total || 0);
  const completeds = entities.map((e) => progress[e]?.completed || 0);

  const totalSum = totals.reduce((a, b) => a + b, 0);
  const completedSum = completeds.reduce((a, b) => a + b, 0);

  return {
    total: totalSum,
    completed: completedSum,
  };
};

export const computeProductTotal = (generationConfig) =>
  Number.parseInt(generationConfig?.productCount, 10) || 0;

export const computeAccountTotal = (generationConfig) =>
  Number.parseInt(generationConfig?.accountCount, 10) || 0;

export const computeOrderTotal = (generationConfig) =>
  Number.parseInt(generationConfig?.orderCount, 10) || 0;

export const computeWarehouseTotal = (generationConfig) => {
  if (!generationConfig?.createWarehouses) return 0;
  const totalWarehouses = Number.parseInt(generationConfig?.warehouseCount, 10);
  return Number.isNaN(totalWarehouses) ? 0 : totalWarehouses;
};

export const computeTotalsFromConfig = (generationConfig) => ({
  products: computeProductTotal(generationConfig),
  accounts: computeAccountTotal(generationConfig),
  orders: computeOrderTotal(generationConfig),
  images: expectedImageTotal(generationConfig),
  pdfs: expectedPdfTotal(generationConfig),
  warehouses: computeWarehouseTotal(generationConfig),
});

export const expectedImageTotal = (generationConfig) => {
  if (generationConfig.imageMode === 'none') return 0;
  const ratio = Number(generationConfig?.imageRatio) || 0;
  return Math.round((generationConfig.productCount * ratio) / 100);
};

export const expectedPdfTotal = (generationConfig) => {
  if (generationConfig.pdfMode === 'none') return 0;
  const ratio = Number(generationConfig?.pdfRatio) || 0;
  return Math.round((generationConfig.productCount * ratio) / 100);
};
