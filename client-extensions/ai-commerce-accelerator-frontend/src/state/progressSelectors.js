export const getProgressPercentage = (completed = 0, total = 0) =>
  total > 0 ? (completed / total) * 100 : 0;

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
  ];
  const completeds = [
    progress.products?.completed || 0,
    progress.accounts?.completed || 0,
    progress.orders?.completed || 0,
    progress.images?.completed || 0,
    progress.pdfs?.completed || 0,
  ];
  return {
    total: totals.reduce((a, b) => a + b, 0),
    completed: completeds.reduce((a, b) => a + b, 0),
  };
};

export const computeActualProductTotal = (generationConfig) => {
  const productCount = Number.parseInt(generationConfig?.productCount, 10) || 0;
  const categoryCount = Array.isArray(generationConfig?.categories)
    ? generationConfig.categories.length
    : 0;
  return productCount * categoryCount;
};

export const computeAccountTotal = (generationConfig) =>
  Number.parseInt(generationConfig?.accountCount, 10) || 0;

export const computeOrderTotal = (generationConfig) =>
  Number.parseInt(generationConfig?.orderCount, 10) || 0;

export const computeTotalsFromConfig = (generationConfig) => ({
  products:
    (Number.parseInt(generationConfig?.productCount, 10) || 0) *
    (Array.isArray(generationConfig?.categories)
      ? generationConfig.categories.length
      : 0),
  accounts: computeAccountTotal(generationConfig),
  orders: computeOrderTotal(generationConfig),
});

export const expectedImageTotal = (generationConfig) => {
  const totalProducts =
    generationConfig.imageMode !== 'none'
      ? computeActualProductTotal(generationConfig)
      : 0;
  const ratio = Number(generationConfig?.imageRatio) || 0;
  return Math.round((totalProducts * ratio) / 100);
};

export const expectedPdfTotal = (generationConfig) => {
  const totalProducts =
    generationConfig.pdfMode !== 'none'
      ? computeActualProductTotal(generationConfig)
      : 0;
  const ratio = Number(generationConfig?.pdfRatio) || 0;
  return Math.round((totalProducts * ratio) / 100);
};
