export const getProgressPercentage = (completed = 0, total = 0) => {
  if (total > 0) return (completed / total) * 100;
  if (completed > 0) return 100;
  return 0;
};

export const clampCompleted = (completed = 0, total = 0) =>
  Math.min(Math.max(completed, 0), Math.max(total, 0));

export const getTotalProgress = (progress) => {
  if (!progress) return { total: 0, completed: 0 };
  const totals = [
    progress.products?.total || 0,
    progress.accounts?.total || 0,
    progress.orders?.total || 0,
    progress.images?.total || 0,
    progress.pdfs?.total || 0,
    progress.warehouses?.total || 0,
  ];
  const completeds = [
    progress.products?.completed || 0,
    progress.accounts?.completed || 0,
    progress.orders?.completed || 0,
    progress.images?.completed || 0,
    progress.pdfs?.completed || 0,
    progress.warehouses?.completed || 0,
  ];
  return {
    total: totals.reduce((a, b) => a + b, 0),
    completed: completeds.reduce((a, b) => a + b, 0),
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
