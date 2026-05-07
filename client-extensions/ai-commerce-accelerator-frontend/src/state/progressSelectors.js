export const getProgressPercentage = (completed = 0, total = 0) => {
  if (total > 0) return (completed / total) * 100;
  return 0;
};

export const getTotalProgress = (progress) => {
  if (!progress) return { total: 100, completed: 0, percentage: 0 };

  // If the whole workflow is marked as completed, overall progress is 100%
  if (progress.workflowStatus === 'completed') {
    return {
      total: 100,
      completed: 100,
      percentage: 100,
      entityCount: 8,
      doneCount: 8,
    };
  }

  // Define the 8 UI Milestones that match the Workflow Status display
  const milestones = [
    { id: 'products', keys: ['products'] },
    { id: 'accounts', keys: ['accounts'] },
    { id: 'orders', keys: ['orders'] },
    { id: 'warehouses', keys: ['warehouses'] },
    { id: 'addresses', keys: ['addresses'] },
    { id: 'images', keys: ['images'] },
    { id: 'pdfs', keys: ['pdfs'] },
    { id: 'pricing', keys: ['priceLists', 'promotions'] },
  ];

  let doneMilestones = 0;

  milestones.forEach((milestone) => {
    // A milestone is 'done' if all its associated state keys are marked as isDone
    const isMilestoneDone = milestone.keys.every(
      (key) => progress[key]?.isDone
    );

    if (isMilestoneDone) {
      doneMilestones += 1;
    }
  });

  // Calculate percentage based on 8 milestones (12.5% each)
  const totalMilestones = milestones.length;
  const percentage = (doneMilestones / totalMilestones) * 100;

  return {
    total: 100,
    completed: Math.round(percentage),
    percentage: Math.min(100, percentage),
    entityCount: totalMilestones,
    doneCount: doneMilestones,
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
