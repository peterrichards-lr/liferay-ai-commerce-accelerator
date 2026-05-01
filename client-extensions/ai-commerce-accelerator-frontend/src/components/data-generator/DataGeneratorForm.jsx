import React, { useCallback, useMemo, useState } from 'react';
import ClayIcon from '@clayui/icon';
import FieldError from '../ui/FieldError';
import CollapsiblePanel from '../ui/CollapsiblePanel';
import CategoriesSelector from './CategoriesSelector';
import ProductToggleSet from './ProductToggleSet';
import WarehousesToggle from './WarehousesToggle';
import InventoryControls from './InventoryControls';

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
  openAiKeyAvailable,
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
          {typeof openAiKeyAvailable === 'boolean' && (
            <span
              className={`label ${
                openAiKeyAvailable ? 'label-success' : 'label-warning'
              }`}
            >
              {openAiKeyAvailable
                ? 'OpenAI key detected'
                : 'OpenAI key not set'}
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
        <div className="form-row">
          <div className="form-col">
            <div className="form-group">
              <label htmlFor="dataGeneration_productCount">
                Products to Generate
              </label>
              <input
                id="dataGeneration_productCount"
                type="number"
                className={`form-input ${
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
          </div>
          <div className="form-col">
            <div className="form-group">
              <label htmlFor="dataGeneration_accountCount">
                Accounts to Generate
              </label>
              <input
                id="dataGeneration_accountCount"
                type="number"
                className={`form-input ${
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
          </div>
          <div className="form-col">
            <div className="form-group">
              <label htmlFor="dataGeneration_orderCount">
                Orders to Generate
              </label>
              <input
                id="dataGeneration_orderCount"
                type="number"
                className={`form-input ${
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

        <div className="divider my-4"></div>

        <div className="config-row">
          <div className="config-col-wide" style={{ gridColumn: 'span 2' }}>
            <div className="generator-main-settings">
              <div className="config-section">
                <ProductToggleSet
                  values={{
                    imageMode: generationConfig.imageMode,
                    imageWidth: generationConfig.imageWidth,
                    imageHeight: generationConfig.imageHeight,
                    imageQuality: generationConfig.imageQuality,
                    imageStyle: generationConfig.imageStyle,
                    imageRatio: generationConfig.imageRatio,
                    pdfMode: generationConfig.pdfMode,
                    pdfRatio: generationConfig.pdfRatio,
                    generateSpecifications:
                      generationConfig.generateSpecifications,
                    generateSkuVariants: generationConfig.generateSkuVariants,
                    generatePriceLists: generationConfig.generatePriceLists,
                  }}
                  forceDemoMode={forceDemoMode}
                  openAiKeyAvailable={openAiKeyAvailable}
                  productCount={generationConfig.productCount}
                  onChange={handleConfigChange}
                  disabled={lockFields || generationConfig.productCount === 0}
                  errors={validationErrors}
                />
              </div>

              <div className="divider"></div>

              <div className="config-row">
                <div className="config-col-narrow">
                  <h6
                    className={`config-section-title ${
                      generationConfig.productCount === 0 ? 'muted' : ''
                    }`}
                  >
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
                </div>
                <div className="config-col-wide">
                  {generationConfig.createWarehouses && (
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
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                      errors={{
                        inventoryMin:
                          (validationErrors && validationErrors.inventoryMin) ||
                          null,
                        inventoryMax:
                          (validationErrors && validationErrors.inventoryMax) ||
                          null,
                        inventoryAssignmentRatio:
                          (validationErrors &&
                            validationErrors.inventoryAssignmentRatio) ||
                          null,
                        backorderAssignmentRatio:
                          (validationErrors &&
                            validationErrors.backorderAssignmentRatio) ||
                          null,
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="divider"></div>
            </div>

            {!generationConfig.demoMode && (
              <div className="cost-estimation">
                <div className="cost-card">
                  <h5 className="cost-title">
                    <ClayIcon symbol="coin" />
                    Cost Estimation
                  </h5>
                  <div className="cost-summary">
                    <h6>Estimated Cost:</h6>
                    <h5 className="cost-amount">
                      ${estimatedCost.total.toFixed(2)}
                    </h5>
                  </div>
                  {estimatedCost.breakdown.length > 0 && (
                    <ul className="cost-breakdown">
                      {estimatedCost.breakdown.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <div className="submit-section">
              <span
                title={disabled && !isGenerating ? disabledReason : undefined}
                style={{ display: 'inline-block' }}
              >
                <button
                  type="submit"
                  className={`submit-button w-100 btn my-2 py-2 ${
                    generationConfig.demoMode ? 'demo-mode' : 'generate-mode'
                  }`}
                  disabled={isSubmitDisabled}
                  aria-disabled={isSubmitDisabled ? 'true' : 'false'}
                >
                  {isGenerating ? (
                    <div className="processing-indicator">
                      <span className="pm-spinner" aria-hidden="true" />
                      {generationConfig.demoMode
                        ? 'Generating Demo Data...'
                        : 'Generating Data...'}
                    </div>
                  ) : disabled ? (
                    <>
                      <ClayIcon symbol="warning-full" className="error-icon" />
                      {disabledReason || 'Not ready to generate yet'}
                    </>
                  ) : (
                    <>
                      <i
                        className={`icon ${
                          generationConfig.demoMode ? 'icon-flask' : 'icon-play'
                        }`}
                      />
                      {generationConfig.demoMode
                        ? 'Start Demo Generation'
                        : 'Start Generation'}
                    </>
                  )}
                </button>
              </span>
            </div>
          </div>
        </div>
      </form>
    </CollapsiblePanel>
  );
}

export default DataGeneratorForm;
