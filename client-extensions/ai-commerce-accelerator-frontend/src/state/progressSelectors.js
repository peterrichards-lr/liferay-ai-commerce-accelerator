export const getProgressPercentage = (completed = 0, total = 0) => {
  if (total > 0) return (completed / total) * 100;
  return 0;
};

/** The 8 UI milestones that match the Workflow Status display. */
const MILESTONES = [
  { id: 'products', keys: ['products'] },
  { id: 'accounts', keys: ['accounts'] },
  { id: 'orders', keys: ['orders'] },
  { id: 'warehouses', keys: ['warehouses'] },
  { id: 'addresses', keys: ['addresses'] },
  { id: 'images', keys: ['images'] },
  { id: 'pdfs', keys: ['pdfs'] },
  { id: 'pricing', keys: ['priceLists', 'promotions'] },
];

/**
 * A step still outstanding is proof the run has not finished, whatever
 * anything else claims.
 *
 * The step total is not discovered as the run goes: every flow declares it
 * when the session starts, from the length of the step list it is about to
 * execute. So `completedSteps < totalSteps` is trustworthy from the first
 * event onwards, and it is the one signal that contradicted a delete run
 * reporting COMPLETED at 6 steps of 15 (#786).
 */
export const hasOutstandingSteps = (progress) =>
  (progress?.totalSteps || 0) > 0 &&
  (progress?.completedSteps || 0) < progress.totalSteps;

/**
 * A milestone with nothing in play and nothing done is vacuously done.
 *
 * A step that had no work still broadcasts a completion, so a delete run with
 * no images, PDFs, addresses, SKUs or prices to remove marked five of the
 * eight milestones done before doing anything. Counting those made the gauge
 * read 100% for a run two thirds of the way through (#786). Showing "Done, 0
 * Deleted" on such a bar is honest enough; letting it carry the aggregate is
 * not, so the aggregate is taken over the milestones that had work.
 */
const hadWork = (progress, milestone) =>
  milestone.keys.some(
    (key) =>
      (progress[key]?.total || 0) > 0 || (progress[key]?.completed || 0) > 0
  );

export const getTotalProgress = (progress) => {
  if (!progress) return { total: 100, completed: 0, percentage: 0 };

  const stepsOutstanding = hasOutstandingSteps(progress);

  // The workflow being finished settles every bar at once - but only once the
  // steps agree it is finished. The delete flow declared itself complete the
  // moment the request was accepted, and this shortcut turned that into
  // "COMPLETED, 100% Total Removal" over a run still deleting (#786).
  if (progress.workflowStatus === 'completed' && !stepsOutstanding) {
    return {
      total: 100,
      completed: 100,
      percentage: 100,
      entityCount: MILESTONES.length,
      doneCount: MILESTONES.length,
    };
  }

  const inPlay = MILESTONES.filter((milestone) => hadWork(progress, milestone));
  const doneCount = inPlay.filter((milestone) =>
    milestone.keys.every((key) => progress[key]?.isDone)
  ).length;

  const milestonePercentage =
    inPlay.length > 0 ? (doneCount / inPlay.length) * 100 : 0;

  // Two independent measures of the same run, so the lesser of them governs:
  // neither an aggregate of entity bars nor a count of steps may declare a
  // run finished while the other still has work outstanding.
  const stepPercentage = progress.totalSteps
    ? ((progress.completedSteps || 0) / progress.totalSteps) * 100
    : 100;

  const percentage = Math.min(100, milestonePercentage, stepPercentage);

  return {
    total: 100,
    completed: Math.round(percentage),
    percentage,
    entityCount: inPlay.length,
    doneCount,
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
