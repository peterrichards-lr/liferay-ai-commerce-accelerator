import React, { useCallback, useMemo, useState } from 'react';
import ClayIcon from '@clayui/icon';
import FieldError from '../ui/FieldError';
import CollapsiblePanel from '../ui/CollapsiblePanel';
import CategoriesSelector from './CategoriesSelector';
import ProductToggleSet from './ProductToggleSet';
import WarehousesToggle from './WarehousesToggle';
import InventoryControls from './InventoryControls';
import VisualAssetControls from './VisualAssetControls';

function hasErr(map, key, msgStartsWith) {
  const list = map?.[key] || [];
  return msgStartsWith
    ? list.some((m) => m.startsWith(msgStartsWith))
    : list.length > 0;
}

function DataGeneratorForm({
  generationConfig,
  setGenerationConfig,
  onGenerate,
  onResetSettings,
  disabled,
  isSubmitDisabled,
  disabledReason,
  isGenerating,
  forceDemoMode,
  aiKeyAvailable,
  validationErrors,
  scrollTargetRef,
  availableCategories,
  generationCompleted,
  onExport,
  onImport,
  liferayConnected,
}) {
  const [expandSignal, setExpandSignal] = useState(0);

  const handleConfigChange = (field, value) => {
    setGenerationConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleCategoryChange = (category, checked) => {
    setGenerationConfig((prev) => ({
      ...prev,
      categories: checked
        ? [...prev.categories, category]
        : prev.categories.filter((c) => c !== category),
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const node = scrollTargetRef?.current;
    if (node?.scrollIntoView)
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo?.({ top: 0, behavior: 'smooth' });
    onGenerate(generationConfig);
  };

  const costEstimate = useCallback(() => {
    if (generationConfig.demoMode) return { total: 0, breakdown: [] };

    const breakdown = [];
    let total = 0;

    const totalEntities =
      generationConfig.productCount +
      generationConfig.accountCount +
      generationConfig.orderCount;
    if (totalEntities > 0) {
      const baseCost = totalEntities * 0.002;
      breakdown.push(
        `Data generation: $${baseCost.toFixed(3)} (${totalEntities} items)`
      );
      total += baseCost;
    }

    if (
      generationConfig.imageMode === 'ai' &&
      generationConfig.productCount > 0
    ) {
      const imageCount = Math.ceil(
        generationConfig.productCount * (generationConfig.imageRatio / 100)
      );
      const imageCost = imageCount * 0.04;
      breakdown.push(
        `AI images: $${imageCost.toFixed(2)} (${imageCount} images)`
      );
      total += imageCost;
    }

    if (
      generationConfig.pdfMode === 'ai' &&
      generationConfig.productCount > 0
    ) {
      const pdfCount = Math.ceil(
        generationConfig.productCount * (generationConfig.pdfRatio / 100)
      );
      const pdfCost = pdfCount * 0.01;
      breakdown.push(`AI PDFs: $${pdfCost.toFixed(2)} (${pdfCount} PDFs)`);
      total += pdfCost;
    }

    return { total, breakdown };
  }, [generationConfig]);

  const estimatedCost = useMemo(() => costEstimate(), [costEstimate]);

  const lockFields = disabled;

  return (
    <CollapsiblePanel
      id="data-generator"
      title={
        <>
          <ClayIcon symbol="magic" className="me-2" />
          Data Generation
        </>
      }
      headerActions={
        <>
          {typeof aiKeyAvailable === 'boolean' && (
            <span
              className={`label ${
                aiKeyAvailable ? 'label-success' : 'label-warning'
              }`}
            >
              {aiKeyAvailable
                ? 'AI credentials detected'
                : 'AI credentials missing'}
            </span>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => {
              onResetSettings();
              setExpandSignal((n) => n + 1);
            }}
            disabled={isGenerating}
            title="Reset generator settings to defaults"
          >
            <ClayIcon symbol="redo" />
            Reset Settings
          </button>
          <div className="btn-group">
            <input
              type="file"
              id="dataImport"
              accept=".json"
              onChange={onImport}
              style={{ display: 'none' }}
              disabled={isGenerating || !liferayConnected}
            />
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => document.getElementById('dataImport').click()}
              disabled={isGenerating || !liferayConnected}
              title="Import generated data from a JSON file"
            >
              <ClayIcon symbol="upload" />
              Import Data
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onExport}
              disabled={isGenerating || !generationCompleted}
              title="Export generated data to a JSON file"
            >
              <ClayIcon symbol="download" />
              Export Data
            </button>
          </div>
        </>
      }
      startOpen={!isGenerating}
      autoCollapseWhen={isGenerating}
      expandSignal={expandSignal}
      collapsedIndicator="⏵"
      expandedIndicator="⏷"
    >
      <form name="dataGeneration" onSubmit={handleSubmit}>
        <div className="compact-config-grid">
          <div className="config-brand-row">
            <div className="form-group mb-0">
              <label
                htmlFor="dataGeneration_brandName"
                className="small font-weight-bold text-uppercase text-muted"
              >
                Brand / Context
              </label>
              <div className="input-group">
                <div className="input-group-item">
                  <input
                    id="dataGeneration_brandName"
                    type="text"
                    className="form-control form-control-sm"
                    placeholder="e.g. Sahid's Electronics, Global Hub..."
                    value={generationConfig.brandName || ''}
                    onChange={(e) =>
                      handleConfigChange('brandName', e.target.value)
                    }
                    disabled={lockFields}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="config-counts-row mt-3">
            <div className="count-item">
              <label htmlFor="dataGeneration_productCount">Products</label>
              <input
                id="dataGeneration_productCount"
                type="number"
                className={`form-control form-control-sm ${
                  hasErr(validationErrors, 'productCount') ? 'invalid' : ''
                }`}
                min="0"
                max="100"
                value={generationConfig.productCount}
                onChange={(e) =>
                  handleConfigChange('productCount', parseInt(e.target.value))
                }
                disabled={lockFields}
              />
              {hasErr(validationErrors, 'productCount') && (
                <FieldError errors={validationErrors.productCount} />
              )}
            </div>
            <div className="count-item">
              <label htmlFor="dataGeneration_accountCount">Accounts</label>
              <input
                id="dataGeneration_accountCount"
                type="number"
                className={`form-control form-control-sm ${
                  hasErr(validationErrors, 'accountCount') ? 'invalid' : ''
                }`}
                min="0"
                max="100"
                value={generationConfig.accountCount}
                onChange={(e) =>
                  handleConfigChange('accountCount', parseInt(e.target.value))
                }
                disabled={lockFields}
              />
              {hasErr(validationErrors, 'accountCount') && (
                <FieldError errors={validationErrors.accountCount} />
              )}
            </div>
            <div className="count-item">
              <label htmlFor="dataGeneration_orderCount">Orders</label>
              <input
                id="dataGeneration_orderCount"
                type="number"
                className={`form-control form-control-sm ${
                  hasErr(validationErrors, 'orderCount') ? 'invalid' : ''
                }`}
                min="0"
                max="500"
                value={generationConfig.orderCount}
                onChange={(e) =>
                  handleConfigChange('orderCount', parseInt(e.target.value))
                }
                disabled={lockFields}
              />
              {hasErr(validationErrors, 'orderCount') && (
                <FieldError errors={validationErrors.orderCount} />
              )}
            </div>
          </div>
        </div>

        <div className="config-section categories-top-section mt-4">
          <h6 className="config-section-title">Target Categories</h6>
          <CategoriesSelector
            availableCategories={availableCategories}
            selectedCategories={generationConfig.categories}
            onToggleCategory={handleCategoryChange}
            disabled={lockFields}
            error={hasErr(validationErrors, 'categories')}
          />
          {hasErr(validationErrors, 'categories') && (
            <FieldError errors={validationErrors.categories} />
          )}
        </div>

        <div className="divider my-3"></div>

        <div className="generator-main-settings">
          <div className="settings-grid">
            <div className="settings-column">
              <ProductToggleSet
                values={{
                  generateSpecifications:
                    generationConfig.generateSpecifications,
                  generateSkuVariants: generationConfig.generateSkuVariants,
                  generatePriceLists: generationConfig.generatePriceLists,
                  generateBulkPricing: generationConfig.generateBulkPricing,
                  generateTierPricing: generationConfig.generateTierPricing,
                }}
                productCount={generationConfig.productCount}
                onChange={handleConfigChange}
                disabled={lockFields || generationConfig.productCount === 0}
                errors={validationErrors}
              />

              <VisualAssetControls
                values={{
                  imageMode: generationConfig.imageMode,
                  imageRatio: generationConfig.imageRatio,
                  imageStyle: generationConfig.imageStyle,
                  pdfMode: generationConfig.pdfMode,
                  pdfRatio: generationConfig.pdfRatio,
                  pdfContentType: generationConfig.pdfContentType,
                }}
                onChange={handleConfigChange}
                disabled={lockFields || generationConfig.productCount === 0}
                aiKeyAvailable={aiKeyAvailable}
              />
            </div>

            <div className="settings-column border-left pl-4">
              <h6
                className={`config-section-title ${
                  generationConfig.productCount === 0 ? 'muted' : ''
                }`}
              >
                <ClayIcon symbol="box-container" className="mr-2" />
                Warehouses & Inventory
              </h6>

              <WarehousesToggle
                productCount={generationConfig.productCount}
                values={{
                  createWarehouses: generationConfig.createWarehouses,
                  reuseExistingWarehouses:
                    generationConfig.reuseExistingWarehouses,
                  warehouseCount: generationConfig.warehouseCount,
                }}
                onChange={handleConfigChange}
                disabled={lockFields || generationConfig.productCount === 0}
              />

              {generationConfig.createWarehouses && (
                <div className="mt-4">
                  <InventoryControls
                    productCount={generationConfig.productCount}
                    inventoryMin={generationConfig.inventoryMin}
                    inventoryMax={generationConfig.inventoryMax}
                    inventoryAssignmentRatio={
                      generationConfig.inventoryAssignmentRatio
                    }
                    enableBackorders={generationConfig.enableBackorders}
                    backorderAssignmentRatio={
                      generationConfig.backorderAssignmentRatio
                    }
                    onChange={handleConfigChange}
                    disabled={lockFields || generationConfig.productCount === 0}
                    validationErrors={validationErrors}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {!generationConfig.demoMode && (
          <div className="cost-estimation mt-4">
            <div className="cost-card p-3">
              <h6 className="cost-title mb-2">
                <ClayIcon symbol="coin" className="mr-2" />
                Estimated Generation Cost
              </h6>
              <div className="d-flex justify-content-between align-items-center">
                <h5 className="cost-amount mb-0">
                  ${estimatedCost.total.toFixed(2)}
                </h5>
                {estimatedCost.breakdown.length > 0 && (
                  <small className="text-muted">
                    {estimatedCost.breakdown.join(' | ')}
                  </small>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="submit-section mt-4">
          <span
            title={disabled && !isGenerating ? disabledReason : undefined}
            style={{ display: 'block' }}
          >
            <button
              type="submit"
              className={`submit-button btn btn-block btn-lg ${
                generationConfig.demoMode ? 'demo-mode' : 'generate-mode'
              }`}
              disabled={isSubmitDisabled}
              aria-disabled={isSubmitDisabled ? 'true' : 'false'}
            >
              {isGenerating ? (
                <div className="processing-indicator">
                  <span className="pm-spinner mr-2" aria-hidden="true" />
                  {generationConfig.demoMode
                    ? 'Generating Demo Data...'
                    : 'Generating Data...'}
                </div>
              ) : disabled ? (
                <>
                  <ClayIcon symbol="warning-full" className="mr-2" />
                  {disabledReason || 'Not ready to generate yet'}
                </>
              ) : (
                <>
                  <ClayIcon
                    symbol={generationConfig.demoMode ? 'flask' : 'play'}
                    className="mr-2"
                  />
                  {generationConfig.demoMode
                    ? 'Start Demo Generation'
                    : 'Start Generation'}
                </>
              )}
            </button>
          </span>
        </div>
      </form>
    </CollapsiblePanel>
  );
}

export default DataGeneratorForm;
