import React, { useCallback, useMemo, useState } from 'react';
import ClayIcon from '@clayui/icon';
import { ClayInput } from '@clayui/form';
import ClayButton from '@clayui/button';
import ClayLabel from '@clayui/label';

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
        <span className="d-flex align-items-center">
          <ClayIcon symbol="magic" className="mr-2" />
          Data Generation Strategy
        </span>
      }
      headerActions={
        <>
          <ClayButton
            displayType="unstyled"
            className="text-secondary p-0 mr-3"
            onClick={() => {
              onResetSettings();
              setExpandSignal((n) => n + 1);
            }}
            disabled={isGenerating}
            title="Reset generator settings to defaults"
          >
            <ClayIcon symbol="redo" className="mr-1" />
            Reset Settings
          </ClayButton>
        </>
      }
      startOpen={!isGenerating}
      autoCollapseWhen={isGenerating}
      expandSignal={expandSignal}
      collapsedIndicator="⏵"
      expandedIndicator="⏷"
    >
      <form name="dataGeneration" onSubmit={handleSubmit}>
        
        <div className="form-group mb-4">
          <label htmlFor="dataGeneration_brandName" className="font-weight-semi-bold">
            Brand / Context <span className="text-secondary font-weight-normal" style={{fontSize: '0.8em'}}>(Used by LLM for thematic generation)</span>
          </label>
          <textarea
            id="dataGeneration_brandName"
            className="form-control"
            rows="2"
            placeholder="e.g., A premium outdoor gear brand focusing on sustainability..."
            value={generationConfig.brandName || ''}
            onChange={(e) => handleConfigChange('brandName', e.target.value)}
            disabled={lockFields}
          ></textarea>
        </div>

        <h3 className="sheet-title mt-5 mb-3" style={{fontSize: '1rem'}}>Data Volumes</h3>
        <div className="row mb-4">
          <div className="col-md-4">
            <div className={`form-group ${hasErr(validationErrors, 'productCount') ? 'has-error' : ''}`}>
              <label htmlFor="dataGeneration_productCount">Products</label>
              <ClayInput.Group>
                <ClayInput.GroupItem>
                  <ClayInput
                    id="dataGeneration_productCount"
                    type="number"
                    min="0"
                    max="100"
                    value={generationConfig.productCount}
                    onChange={(e) => handleConfigChange('productCount', parseInt(e.target.value))}
                    disabled={lockFields}
                  />
                </ClayInput.GroupItem>
                <ClayInput.GroupItem shrink>
                  <ClayInput.GroupText>items</ClayInput.GroupText>
                </ClayInput.GroupItem>
              </ClayInput.Group>
              {hasErr(validationErrors, 'productCount') && <FieldError errors={validationErrors.productCount} />}
            </div>
          </div>
          
          <div className="col-md-4">
            <div className={`form-group ${hasErr(validationErrors, 'accountCount') ? 'has-error' : ''}`}>
              <label htmlFor="dataGeneration_accountCount">B2B Accounts</label>
              <ClayInput.Group>
                <ClayInput.GroupItem>
                  <ClayInput
                    id="dataGeneration_accountCount"
                    type="number"
                    min="0"
                    max="100"
                    value={generationConfig.accountCount}
                    onChange={(e) => handleConfigChange('accountCount', parseInt(e.target.value))}
                    disabled={lockFields}
                  />
                </ClayInput.GroupItem>
                <ClayInput.GroupItem shrink>
                  <ClayInput.GroupText>accounts</ClayInput.GroupText>
                </ClayInput.GroupItem>
              </ClayInput.Group>
              {hasErr(validationErrors, 'accountCount') && <FieldError errors={validationErrors.accountCount} />}
            </div>
          </div>

          <div className="col-md-4">
            <div className={`form-group ${hasErr(validationErrors, 'orderCount') ? 'has-error' : ''}`}>
              <label htmlFor="dataGeneration_orderCount">Historical Orders</label>
              <ClayInput.Group>
                <ClayInput.GroupItem>
                  <ClayInput
                    id="dataGeneration_orderCount"
                    type="number"
                    min="0"
                    max="500"
                    value={generationConfig.orderCount}
                    onChange={(e) => handleConfigChange('orderCount', parseInt(e.target.value))}
                    disabled={lockFields}
                  />
                </ClayInput.GroupItem>
                <ClayInput.GroupItem shrink>
                  <ClayInput.GroupText>orders</ClayInput.GroupText>
                </ClayInput.GroupItem>
              </ClayInput.Group>
              {hasErr(validationErrors, 'orderCount') && <FieldError errors={validationErrors.orderCount} />}
            </div>
          </div>
        </div>

        <div className="form-group mb-4">
          <label className="font-weight-semi-bold">Target Categories</label>
          <CategoriesSelector
            availableCategories={availableCategories}
            selectedCategories={generationConfig.categories}
            onToggleCategory={handleCategoryChange}
            disabled={lockFields}
            error={hasErr(validationErrors, 'categories')}
          />
          {hasErr(validationErrors, 'categories') && <FieldError errors={validationErrors.categories} />}
        </div>


        <div className="row mt-5">
          <div className="col-lg-6 pr-lg-4 border-right-lg">
             <h3 className="sheet-title mb-3" style={{fontSize: '1rem'}}>Architecture Features</h3>
             <ProductToggleSet
                values={{
                  generateSpecifications: generationConfig.generateSpecifications,
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

              <div className="mt-4">
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
          </div>

          <div className="col-lg-6 pl-lg-4">
             <h3 className={`sheet-title mb-3 ${generationConfig.productCount === 0 ? 'text-muted' : ''}`} style={{fontSize: '1rem'}}>
               Inventory Strategy
             </h3>
             <WarehousesToggle
                productCount={generationConfig.productCount}
                values={{
                  createWarehouses: generationConfig.createWarehouses,
                  reuseExistingWarehouses: generationConfig.reuseExistingWarehouses,
                  warehouseCount: generationConfig.warehouseCount,
                }}
                onChange={handleConfigChange}
                disabled={lockFields || generationConfig.productCount === 0}
              />

              {generationConfig.createWarehouses && (
                <div className="mt-3">
                  <InventoryControls
                    productCount={generationConfig.productCount}
                    inventoryMin={generationConfig.inventoryMin}
                    inventoryMax={generationConfig.inventoryMax}
                    inventoryAssignmentRatio={generationConfig.inventoryAssignmentRatio}
                    enableBackorders={generationConfig.enableBackorders}
                    backorderAssignmentRatio={generationConfig.backorderAssignmentRatio}
                    onChange={handleConfigChange}
                    disabled={lockFields || generationConfig.productCount === 0}
                    validationErrors={validationErrors}
                  />
                </div>
              )}
          </div>
        </div>

        {!generationConfig.demoMode && (
          <div className="mt-4 p-3 bg-light rounded d-flex justify-content-between align-items-center">
              <span className="font-weight-semi-bold">
                <ClayIcon symbol="coin" className="mr-2 text-warning" />
                Estimated Generation Cost
              </span>
              <div className="text-right">
                <span className="h4 mb-0 d-block">${estimatedCost.total.toFixed(2)}</span>
                {estimatedCost.breakdown.length > 0 && (
                  <small className="text-muted d-block" style={{fontSize: '0.75rem'}}>
                    {estimatedCost.breakdown.join(' | ')}
                  </small>
                )}
              </div>
          </div>
        )}

        <div className="mt-4">
          <span title={disabled && !isGenerating ? disabledReason : undefined} style={{ display: 'block' }}>
            <ClayButton
              type="submit"
              displayType={generationConfig.demoMode ? "secondary" : "primary"}
              block
              disabled={isSubmitDisabled}
            >
              {isGenerating ? (
                <>
                  <span className="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true" />
                  {generationConfig.demoMode ? 'Generating Demo Data...' : 'Generating Data...'}
                </>
              ) : disabled ? (
                <>
                  <ClayIcon symbol="warning-full" className="mr-2" />
                  {disabledReason || 'Not ready to generate yet'}
                </>
              ) : (
                <>
                  <ClayIcon symbol={generationConfig.demoMode ? 'flask' : 'play'} className="mr-2" />
                  {generationConfig.demoMode ? 'Start Demo Generation' : 'Start Generation'}
                </>
              )}
            </ClayButton>
          </span>
        </div>
      </form>
    </CollapsiblePanel>
  );
}

export default DataGeneratorForm;
