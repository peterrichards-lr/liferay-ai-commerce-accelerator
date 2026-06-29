import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ClayIcon from '@clayui/icon';
import ClayForm, { ClayInput, ClayToggle } from '@clayui/form';
import ClayButton from '@clayui/button';

import FieldError from '../ui/FieldError';
import CollapsiblePanel from '../ui/CollapsiblePanel';
import CategoriesSelector from './CategoriesSelector';
import ProductToggleSet from './ProductToggleSet';
import WarehousesToggle from './WarehousesToggle';
import InventoryControls from './InventoryControls';
import VisualAssetControls from './VisualAssetControls';
import OrderDistributionControl from './OrderDistributionControl';

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
  onCancel,
  disabled,
  isSubmitDisabled,
  disabledReason,
  isGenerating,
  aiKeyAvailable,
  validationErrors,
  scrollTargetRef,
  availableCategories,
  liferayConnected,
  generationLimits,
}) {
  const [expandSignal, setExpandSignal] = useState(0);

  const defaultSessionName = useMemo(() => {
    return new Date()
      .toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
      .replace(/\//g, '-')
      .replace(', ', '_');
  }, []);

  const maxProducts = generationLimits?.maxProducts || 100;
  const maxAccounts = generationLimits?.maxAccounts || 50;
  const maxOrders = generationLimits?.maxOrders || 200;

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

    // Ensure we have a session name
    const finalConfig = {
      ...generationConfig,
      sessionName: generationConfig.sessionName || defaultSessionName,
    };

    const node = scrollTargetRef?.current;
    if (node?.scrollIntoView)
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo?.({ top: 0, behavior: 'smooth' });
    onGenerate(finalConfig);
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

  useEffect(() => {
    if (!aiKeyAvailable && !generationConfig.demoMode) {
      handleConfigChange('demoMode', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiKeyAvailable, generationConfig.demoMode]);

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
      <form name="dataGeneration" onSubmit={handleSubmit} className="mt-4">
        <div className="row mb-4">
          <div className="col-12">
            <ClayForm.Group className="mb-0">
              <label
                htmlFor="dataGeneration_sessionName"
                className="form-label font-weight-semi-bold"
              >
                Session Name{' '}
                <small className="text-secondary">(Optional)</small>
              </label>
              <ClayInput
                id="dataGeneration_sessionName"
                placeholder={defaultSessionName}
                value={generationConfig.sessionName || ''}
                onChange={(e) =>
                  handleConfigChange('sessionName', e.target.value)
                }
                disabled={lockFields}
              />
            </ClayForm.Group>
          </div>
        </div>

        <div className="d-flex justify-content-end my-4 align-items-center">
          <span
            className={`mr-2 font-weight-semi-bold ${
              generationConfig.demoMode ? 'text-primary' : 'text-secondary'
            }`}
          >
            Demo (Mock Data)
          </span>
          <div
            title={
              !aiKeyAvailable
                ? 'AI API Key not configured. Using Demo Mode.'
                : undefined
            }
          >
            <ClayToggle
              id="dataGeneration_demoMode"
              toggled={!generationConfig.demoMode && aiKeyAvailable}
              onToggle={(val) => {
                handleConfigChange('demoMode', !val);
                if (val) {
                  handleConfigChange('seedPack', '');
                }
              }}
              disabled={lockFields || !aiKeyAvailable}
              aria-label="Toggle Data Generation Mode"
            />
          </div>
          <span
            className={`ml-2 font-weight-semi-bold ${
              !generationConfig.demoMode && aiKeyAvailable
                ? 'text-primary'
                : 'text-secondary'
            }`}
          >
            Live (AI Driven)
          </span>
        </div>

        {generationConfig.demoMode && (
          <div className="form-group mb-4">
            <label
              htmlFor="dataGeneration_seedPack"
              className="font-weight-semi-bold"
            >
              Demo Dataset Template
            </label>
            <select
              id="dataGeneration_seedPack"
              className="form-control"
              value={generationConfig.seedPack || ''}
              onChange={(e) => handleConfigChange('seedPack', e.target.value)}
              disabled={lockFields}
            >
              <option value="">Dynamic Random Generation</option>
              <option value="industrial-power-tools">
                Industrial Power Tools (Pre-packaged Seed Pack)
              </option>
              <option value="outdoor-adventure-gear">
                Outdoor Adventure Gear (Pre-packaged Seed Pack)
              </option>
            </select>
            <p className="text-secondary mt-1" style={{ fontSize: '0.85em' }}>
              {generationConfig.seedPack === 'industrial-power-tools' &&
                'Includes: 3 products, 2 accounts, 2 orders, 1 warehouse, plus pricing and variants.'}
              {generationConfig.seedPack === 'outdoor-adventure-gear' &&
                'Includes: 3 products, 2 accounts, 2 orders, 1 warehouse, plus pricing and variants.'}
              {!generationConfig.seedPack &&
                'Generates randomized mock data on-the-fly locally based on selected counts below.'}
            </p>
          </div>
        )}

        {generationConfig.seedPack ? (
          <div className="card my-5 border-primary bg-light">
            <div className="card-body">
              <h5 className="card-title text-primary font-weight-bold">
                <ClayIcon symbol="info-circle-o" className="mr-2" />
                Seed Pack Active:{' '}
                {generationConfig.seedPack === 'industrial-power-tools'
                  ? 'Industrial Power Tools'
                  : 'Outdoor Adventure Gear'}
              </h5>
              <p className="card-text text-secondary mt-3">
                This seed pack contains a pre-compiled, production-ready dataset
                optimized for instant seeding on DXP:
              </p>
              <ul className="list-group list-group-flush bg-transparent">
                <li className="list-group-item bg-transparent pl-0 border-0">
                  <strong>📦 3 Products:</strong>{' '}
                  {generationConfig.seedPack === 'industrial-power-tools'
                    ? 'Rotary Hammer Drill, Belt Sander, and Li-Ion Battery Pack'
                    : 'Waterproof Camping Tent, Cold-Weather Sleeping Bag, and Trekking Poles'}
                  .
                </li>
                <li className="list-group-item bg-transparent pl-0 border-0">
                  <strong>🏢 2 B2B Accounts:</strong>{' '}
                  {generationConfig.seedPack === 'industrial-power-tools'
                    ? 'Apex Manufacturing and Midwest Construction Group'
                    : 'Cascade Climbing School and Rainier Tours & Expeditions'}
                  .
                </li>
                <li className="list-group-item bg-transparent pl-0 border-0">
                  <strong>📂 1 Warehouse:</strong>{' '}
                  {generationConfig.seedPack === 'industrial-power-tools'
                    ? 'Industrial Midwest Hub (Chicago, IL)'
                    : 'Outdoor Northwest Depot (Seattle, WA)'}
                  .
                </li>
                <li className="list-group-item bg-transparent pl-0 border-0">
                  <strong>🛒 2 Orders:</strong> Simulating real historical B2B
                  purchases with pricing and variants.
                </li>
              </ul>
              <div
                className="alert alert-info mt-4 mb-0 py-2 font-weight-semi-bold"
                style={{ fontSize: '0.9em' }}
              >
                💡 Seeding runs fully locally. No OpenAI API calls, zero credit
                costs, and zero network dependency.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="form-group mb-4">
              <label
                htmlFor="dataGeneration_brandName"
                className="font-weight-semi-bold"
              >
                Brand / Context{' '}
                <span
                  className="text-secondary font-weight-normal"
                  style={{ fontSize: '0.8em' }}
                >
                  (Used by LLM for thematic generation)
                </span>
              </label>
              <textarea
                id="dataGeneration_brandName"
                className="form-control"
                rows="2"
                placeholder="e.g., A premium outdoor gear brand focusing on sustainability..."
                value={generationConfig.brandName || ''}
                onChange={(e) =>
                  handleConfigChange('brandName', e.target.value)
                }
                disabled={lockFields}
              ></textarea>
            </div>

            <h3 className="sheet-title mt-5 mb-3" style={{ fontSize: '1rem' }}>
              Data Volumes
            </h3>
            <div className="row mb-4">
              <div className="col-md-4">
                <div
                  className={`form-group ${hasErr(validationErrors, 'productCount') ? 'has-error' : ''}`}
                >
                  <label htmlFor="dataGeneration_productCount">Products</label>
                  <ClayInput.Group>
                    <ClayInput.GroupItem>
                      <ClayInput
                        id="dataGeneration_productCount"
                        type="number"
                        min="0"
                        max={maxProducts}
                        value={generationConfig.productCount}
                        onChange={(e) =>
                          handleConfigChange(
                            'productCount',
                            parseInt(e.target.value)
                          )
                        }
                        disabled={lockFields}
                      />
                    </ClayInput.GroupItem>
                    <ClayInput.GroupItem shrink>
                      <ClayInput.GroupText>items</ClayInput.GroupText>
                    </ClayInput.GroupItem>
                  </ClayInput.Group>
                  {hasErr(validationErrors, 'productCount') && (
                    <FieldError errors={validationErrors.productCount} />
                  )}
                </div>
              </div>

              <div className="col-md-4">
                <div
                  className={`form-group ${hasErr(validationErrors, 'accountCount') ? 'has-error' : ''}`}
                >
                  <label htmlFor="dataGeneration_accountCount">
                    B2B Accounts
                  </label>
                  <ClayInput.Group>
                    <ClayInput.GroupItem>
                      <ClayInput
                        id="dataGeneration_accountCount"
                        type="number"
                        min="0"
                        max={maxAccounts}
                        value={generationConfig.accountCount}
                        onChange={(e) =>
                          handleConfigChange(
                            'accountCount',
                            parseInt(e.target.value)
                          )
                        }
                        disabled={lockFields}
                      />
                    </ClayInput.GroupItem>
                    <ClayInput.GroupItem shrink>
                      <ClayInput.GroupText>accounts</ClayInput.GroupText>
                    </ClayInput.GroupItem>
                  </ClayInput.Group>
                  {hasErr(validationErrors, 'accountCount') && (
                    <FieldError errors={validationErrors.accountCount} />
                  )}
                </div>
              </div>

              <div className="col-md-4">
                <div
                  className={`form-group ${hasErr(validationErrors, 'orderCount') ? 'has-error' : ''}`}
                >
                  <label htmlFor="dataGeneration_orderCount">Orders</label>
                  <ClayInput.Group>
                    <ClayInput.GroupItem>
                      <ClayInput
                        id="dataGeneration_orderCount"
                        type="number"
                        min="0"
                        max={maxOrders}
                        value={generationConfig.orderCount}
                        onChange={(e) =>
                          handleConfigChange(
                            'orderCount',
                            parseInt(e.target.value)
                          )
                        }
                        disabled={lockFields}
                      />
                    </ClayInput.GroupItem>
                    <ClayInput.GroupItem shrink>
                      <ClayInput.GroupText>orders</ClayInput.GroupText>
                    </ClayInput.GroupItem>
                  </ClayInput.Group>
                  {hasErr(validationErrors, 'orderCount') && (
                    <FieldError errors={validationErrors.orderCount} />
                  )}
                </div>
              </div>
            </div>

            {generationConfig.orderCount > 0 && (
              <OrderDistributionControl
                totalOrders={generationConfig.orderCount}
                distribution={
                  generationConfig.orderDistribution || {
                    open: 0,
                    processing: 0,
                    shipped: 0,
                    completed: 0,
                  }
                }
                onChange={(dist) =>
                  handleConfigChange('orderDistribution', dist)
                }
                disabled={lockFields}
              />
            )}

            <fieldset className="form-group mb-4 mt-5">
              <legend
                className="font-weight-semi-bold"
                style={{ fontSize: '1rem' }}
              >
                Target Categories
              </legend>
              <CategoriesSelector
                availableCategories={availableCategories}
                selectedCategories={generationConfig.categories}
                onToggleCategory={handleCategoryChange}
                disabled={lockFields}
                connected={liferayConnected}
                error={hasErr(validationErrors, 'categories')}
              />
              {hasErr(validationErrors, 'categories') && (
                <FieldError errors={validationErrors.categories} />
              )}
            </fieldset>

            <div className="row mt-5 gx-5">
              <div className="col-lg-6 pr-lg-5 border-right-lg">
                <h3 className="sheet-title mb-4" style={{ fontSize: '1rem' }}>
                  Architecture Features
                </h3>
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

              <div className="col-lg-6 pl-lg-5">
                <h3
                  className={`sheet-title mb-4 ${generationConfig.productCount === 0 ? 'text-muted' : ''}`}
                  style={{ fontSize: '1rem' }}
                >
                  Inventory Strategy
                </h3>
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
                  <div className="mt-3">
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
                  <span className="h4 mb-0 d-block">
                    ${estimatedCost.total.toFixed(2)}
                  </span>
                  {estimatedCost.breakdown.length > 0 && (
                    <small
                      className="text-muted d-block"
                      style={{ fontSize: '0.75rem' }}
                    >
                      {estimatedCost.breakdown.join(' | ')}
                    </small>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="mt-4">
          {isGenerating ? (
            <div className="d-flex" style={{ gap: '1rem' }}>
              <ClayButton
                displayType="secondary"
                block
                onClick={onCancel}
                title="Request workflow cancellation"
              >
                <ClayIcon symbol="times-circle" className="mr-2" />
                Cancel Generation
              </ClayButton>
              <ClayButton
                displayType="primary"
                block
                disabled
                className="flex-grow-1"
              >
                <span
                  className="spinner-border spinner-border-sm mr-2"
                  role="status"
                  aria-hidden="true"
                />
                {generationConfig.demoMode ? 'Generating...' : 'Generating...'}
              </ClayButton>
            </div>
          ) : (
            <span
              title={disabled && !isGenerating ? disabledReason : undefined}
              style={{ display: 'block' }}
            >
              <ClayButton
                type="submit"
                displayType={
                  generationConfig.demoMode ? 'secondary' : 'primary'
                }
                block
                disabled={isSubmitDisabled}
              >
                <ClayIcon
                  symbol={generationConfig.demoMode ? 'flask' : 'play'}
                  className="mr-2"
                />
                {generationConfig.demoMode
                  ? 'Start Demo Generation'
                  : 'Start Generation'}
              </ClayButton>
            </span>
          )}
        </div>
      </form>
    </CollapsiblePanel>
  );
}

export default DataGeneratorForm;
