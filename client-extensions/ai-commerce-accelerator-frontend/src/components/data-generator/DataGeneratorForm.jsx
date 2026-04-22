import React, { useEffect, useState } from 'react';
import ClayIcon from '@clayui/icon';
import FieldError from '../ui/FieldError';
import CheckboxField from '../ui/CheckboxField';
import CheckboxGroup from '../ui/CheckboxGroup';
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
  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    if (isGenerating) setPanelOpen(false);
  }, [isGenerating]);
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

  const costEstimate = () => {
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
  };

  const estimatedCost = costEstimate();

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
                max="50"
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
                max="200"
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

        <div className="form-group">
          <CheckboxField
            id="dataGeneration_demoMode"
            checked={generationConfig.demoMode}
            onChange={(checked) =>
              setGenerationConfig((prev) => ({ ...prev, demoMode: checked }))
            }
            disabled={lockFields || forceDemoMode}
            label={
              <>
                <ClayIcon symbol="warning-full" className="demo-mode-icon" />
                <strong>Demo Mode</strong> - Generate mock data without AI costs
                (for testing)
              </>
            }
          />
          {forceDemoMode && (
            <div className="text-info my-2">
              <i className="fas fa-info-circle me-1"></i>
              OpenAI API key not found. Demo mode is enforced, and AI generation
              options are disabled.
            </div>
          )}
          <small className="help-text">
            Perfect for testing the interface and progress tracking without
            consuming API credits
          </small>
        </div>

        <div
          className={
            generationConfig.productCount > 0 ||
            generationConfig.accountCount > 0
              ? 'product-config-section'
              : 'product-config-section hidden'
          }
        >
          <div className="divider"></div>

          <div className="form-group">
            <h5
              className={`section-title ${
                generationConfig.productCount === 0 &&
                generationConfig.accountCount === 0
                  ? 'muted'
                  : ''
              }`}
            >
              <ClayIcon symbol="cog" />
              Generation Context Options
            </h5>
            <small className="section-subtitle">
              The following options influence how data is generated
            </small>
          </div>

          <div className="form-group">
            {availableCategories.length === 0 ? (
              <small className="text-secondary">Loading categories...</small>
            ) : (
              <CategoriesSelector
                availableCategories={availableCategories}
                selectedCategories={generationConfig.categories}
                onToggleCategory={handleCategoryChange}
                disabled={lockFields || availableCategories.length === 0}
                invalid={
                  hasErr(validationErrors, 'categories')
                    ? validationErrors.categories
                    : null
                }
                showNote={
                  generationConfig.productCount > 0 &&
                  generationConfig.accountCount > 0
                }
              />
            )}
          </div>

          <div className="config-row">
            <div className="config-col-narrow">
              <ProductToggleSet
                productCount={generationConfig.productCount}
                values={{
                  generatePriceLists: generationConfig.generatePriceLists,
                  generateBulkPricing: generationConfig.generateBulkPricing,
                  generateTierPricing: generationConfig.generateTierPricing,
                  generateSpecifications:
                    generationConfig.generateSpecifications,
                  generateSkuVariants: generationConfig.generateSkuVariants,
                }}
                onChange={handleConfigChange}
                disabled={lockFields}
              />
            </div>
            <div className="config-col-wide">
              {generationConfig.demoMode ? (
                <div>
                  <h6
                    className={`config-section-title ${
                      generationConfig.productCount === 0 ? 'muted' : ''
                    }`}
                  >
                    <ClayIcon
                      symbol="warning-full"
                      className="demo-mode-icon"
                    />
                    Demo Mode Media Options
                    <small className="config-subtitle">
                      (Uses existing assets, no AI costs)
                    </small>
                  </h6>

                  <div className="content-options-grid">
                    <div className="content-option">
                      <h6 className="content-option-title">
                        <ClayIcon symbol="picture" />
                        Product Images
                      </h6>

                      <div className="radio-group">
                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_noImages"
                            checked={generationConfig.imageMode === 'none'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'none')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_noImages"
                          >
                            No images
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_useDefaultImage"
                            checked={
                              generationConfig.imageMode === 'placeholder'
                            }
                            onChange={() =>
                              handleConfigChange('imageMode', 'placeholder')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useDefaultImage"
                          >
                            Use placeholder image
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_usePicsumImage"
                            checked={generationConfig.imageMode === 'picsum'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'picsum')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_usePicsumImage"
                          >
                            Use Picsum images (Dynamic)
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_useCustomImage"
                            checked={generationConfig.imageMode === 'custom'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'custom')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useCustomImage"
                          >
                            Upload custom image
                          </label>
                        </div>
                      </div>

                      {generationConfig.imageMode === 'custom' && (
                        <div className="file-upload-section">
                          <input
                            type="file"
                            className={`file-input ${
                              hasErr(validationErrors, 'customImageFile')
                                ? 'invalid'
                                : ''
                            }`}
                            accept="image/*"
                            onChange={(e) =>
                              handleConfigChange(
                                'customImageFile',
                                e.target.files[0]
                              )
                            }
                            disabled={lockFields}
                          />
                          {hasErr(validationErrors, 'customImageFile') && (
                            <FieldError
                              errors={validationErrors.customImageFile}
                            />
                          )}
                          <small className="help-text">
                            This image will be used for all products
                          </small>
                        </div>
                      )}

                      {generationConfig.imageMode !== 'none' && (
                        <div className="ratio-input-section">
                          <label htmlFor="dataGeneration_imageRatio">
                            Apply Images To
                          </label>
                          <div className="input-with-unit">
                            <input
                              id="dataGeneration_imageRatio"
                              type="number"
                              className={`form-input ${
                                hasErr(validationErrors, 'imageRatio')
                                  ? 'invalid'
                                  : ''
                              }`}
                              min="0"
                              max="100"
                              value={generationConfig.imageRatio}
                              onChange={(e) =>
                                handleConfigChange(
                                  'imageRatio',
                                  parseInt(e.target.value)
                                )
                              }
                              disabled={lockFields}
                            />
                            <span className="input-unit">%</span>
                          </div>
                          {hasErr(validationErrors, 'imageRatio') && (
                            <FieldError errors={validationErrors.imageRatio} />
                          )}
                          <small className="help-text">
                            Randomly assigns an image to this percentage of
                            products
                          </small>
                        </div>
                      )}
                    </div>

                    <div className="content-option">
                      <h6 className="content-option-title">
                        <ClayIcon symbol="document" />
                        Product PDFs
                      </h6>

                      <div className="radio-group">
                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_noPDFs"
                            checked={generationConfig.pdfMode === 'none'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'none')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_noPDFs"
                          >
                            No PDFs
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_useDefaultPDF"
                            checked={generationConfig.pdfMode === 'placeholder'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'placeholder')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useDefaultPDF"
                          >
                            Use placeholder PDF
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_useCustomPDF"
                            checked={generationConfig.pdfMode === 'custom'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'custom')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useCustomPDF"
                          >
                            Upload custom PDF
                          </label>
                        </div>
                      </div>

                      {generationConfig.pdfMode === 'custom' && (
                        <div className="file-upload-section">
                          <input
                            type="file"
                            className={`file-input ${
                              hasErr(validationErrors, 'customPDFFile')
                                ? 'invalid'
                                : ''
                            }`}
                            accept=".pdf"
                            onChange={(e) =>
                              handleConfigChange(
                                'customPDFFile',
                                e.target.files[0]
                              )
                            }
                            disabled={lockFields}
                          />
                          {hasErr(validationErrors, 'customPDFFile') && (
                            <FieldError
                              errors={validationErrors.customPDFFile}
                            />
                          )}
                          <small className="help-text">
                            This PDF will be used for all products
                          </small>
                        </div>
                      )}

                      {generationConfig.pdfMode !== 'none' && (
                        <div className="ratio-input-section">
                          <label htmlFor="dataGeneration_pdfRatio">
                            Apply PDFs To
                          </label>
                          <div className="input-with-unit">
                            <input
                              id="dataGeneration_pdfRatio"
                              type="number"
                              className={`form-input ${
                                hasErr(validationErrors, 'pdfRatio')
                                  ? 'invalid'
                                  : ''
                              }`}
                              min="0"
                              max="100"
                              value={generationConfig.pdfRatio}
                              onChange={(e) =>
                                handleConfigChange(
                                  'pdfRatio',
                                  parseInt(e.target.value)
                                )
                              }
                              disabled={lockFields}
                            />
                            <span className="input-unit">%</span>
                          </div>
                          {hasErr(validationErrors, 'pdfRatio') && (
                            <FieldError errors={validationErrors.pdfRatio} />
                          )}
                          <small className="help-text">
                            Randomly assigns a PDFs to this percentage of
                            products
                          </small>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <h6
                    className={`config-section-title ${
                      generationConfig.productCount === 0 ? 'muted' : ''
                    }`}
                  >
                    <ClayIcon symbol="magic" className="ai-icon" />
                    AI-Powered Content Generation
                    <small className="config-subtitle">
                      (Additional API costs apply)
                    </small>
                  </h6>

                  <div className="content-options-grid">
                    <div className="content-option">
                      <h6 className="content-option-title">
                        <ClayIcon symbol="picture" />
                        Product Images
                      </h6>

                      <div className="radio-group">
                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_noImages_live"
                            checked={generationConfig.imageMode === 'none'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'none')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_noImages_live"
                          >
                            No images
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_generateImages"
                            checked={generationConfig.imageMode === 'ai'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'ai')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_generateImages"
                          >
                            <ClayIcon symbol="magic" className="ai-icon" />
                            Generate with AI
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_picsumImages_live"
                            checked={generationConfig.imageMode === 'picsum'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'picsum')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_picsumImages_live"
                          >
                            Use Picsum images (Dynamic)
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_placeholderImages_live"
                            checked={
                              generationConfig.imageMode === 'placeholder'
                            }
                            onChange={() =>
                              handleConfigChange('imageMode', 'placeholder')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_placeholderImages_live"
                          >
                            Use placeholder image
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="imageSource"
                            id="dataGeneration_useCustomImage_live"
                            checked={generationConfig.imageMode === 'custom'}
                            onChange={() =>
                              handleConfigChange('imageMode', 'custom')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useCustomImage_live"
                          >
                            Upload custom image
                          </label>
                        </div>
                      </div>

                      {generationConfig.imageMode === 'custom' && (
                        <div className="file-upload-section">
                          <input
                            type="file"
                            className={`file-input ${
                              hasErr(validationErrors, 'customImageFile')
                                ? 'invalid'
                                : ''
                            }`}
                            accept="image/*"
                            onChange={(e) =>
                              handleConfigChange(
                                'customImageFile',
                                e.target.files[0]
                              )
                            }
                            disabled={lockFields}
                          />
                          {hasErr(validationErrors, 'customImageFile') && (
                            <FieldError
                              errors={validationErrors.customImageFile}
                            />
                          )}
                          <small className="help-text">
                            This image will be used for all products
                          </small>
                        </div>
                      )}

                      {generationConfig.imageMode === 'generate' && (
                        <div className="ai-options-panel">
                          <small className="warning-text">
                            High-quality AI image generation can be expensive
                          </small>

                          <div className="ai-options-grid">
                            <div className="ai-option">
                              <label htmlFor="dataGeneration_imageWidth">
                                Width (px)
                              </label>
                              <select
                                id="dataGeneration_imageWidth"
                                className="form-select"
                                value={generationConfig.imageWidth}
                                onChange={(e) =>
                                  handleConfigChange(
                                    'imageWidth',
                                    parseInt(e.target.value)
                                  )
                                }
                                disabled={lockFields}
                              >
                                <option value="512">512px</option>
                                <option value="768">768px</option>
                                <option value="1024">1024px</option>
                                <option value="1536">1536px</option>
                              </select>
                            </div>
                            <div className="ai-option">
                              <label htmlFor="dataGeneration_imageHeight">
                                Height (px)
                              </label>
                              <select
                                id="dataGeneration_imageHeight"
                                className="form-select"
                                value={generationConfig.imageHeight}
                                onChange={(e) =>
                                  handleConfigChange(
                                    'imageHeight',
                                    parseInt(e.target.value)
                                  )
                                }
                                disabled={lockFields}
                              >
                                <option value="512">512px</option>
                                <option value="768">768px</option>
                                <option value="1024">1024px</option>
                                <option value="1536">1536px</option>
                              </select>
                            </div>
                            <div className="ai-option">
                              <label htmlFor="dataGeneration_imageQuality">
                                Quality Level
                              </label>
                              <select
                                id="dataGeneration_imageQuality"
                                className="form-select"
                                value={generationConfig.imageQuality}
                                onChange={(e) =>
                                  handleConfigChange(
                                    'imageQuality',
                                    e.target.value
                                  )
                                }
                                disabled={lockFields}
                              >
                                <option value="standard">
                                  Standard (Lower cost)
                                </option>
                                <option value="high">High (Higher cost)</option>
                              </select>
                            </div>
                            <div className="ai-option">
                              <label htmlFor="dataGeneration_imageStyle">
                                Image Style
                              </label>
                              <select
                                id="dataGeneration_imageStyle"
                                className="form-select"
                                value={generationConfig.imageStyle}
                                onChange={(e) =>
                                  handleConfigChange(
                                    'imageStyle',
                                    e.target.value
                                  )
                                }
                                disabled={lockFields}
                              >
                                <option value="photographic">
                                  Photographic
                                </option>
                                <option value="product_studio">
                                  Product Studio
                                </option>
                                <option value="minimalist">Minimalist</option>
                                <option value="lifestyle">Lifestyle</option>
                                <option value="technical">
                                  Technical/Diagram
                                </option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {generationConfig.imageMode !== 'none' && (
                        <div className="ratio-input-section">
                          <label htmlFor="dataGeneration_imageRatio_live">
                            Apply Image To
                          </label>
                          <div className="input-with-unit">
                            <input
                              id="dataGeneration_imageRatio_live"
                              type="number"
                              className={`form-input ${
                                hasErr(validationErrors, 'imageRatio')
                                  ? 'invalid'
                                  : ''
                              }`}
                              min="0"
                              max="100"
                              value={generationConfig.imageRatio}
                              onChange={(e) =>
                                handleConfigChange(
                                  'imageRatio',
                                  parseInt(e.target.value)
                                )
                              }
                              disabled={lockFields}
                            />
                            <span className="input-unit">%</span>
                          </div>
                          {hasErr(validationErrors, 'imageRatio') && (
                            <FieldError errors={validationErrors.imageRatio} />
                          )}
                          <small className="help-text">
                            {generationConfig.imageMode === 'ai'
                              ? 'Generate images for this percentage of products'
                              : 'Assign images to this percentage of products'}
                          </small>
                        </div>
                      )}
                    </div>

                    <div className="content-option">
                      <h6 className="content-option-title">
                        <ClayIcon symbol="document" />
                        Product PDFs
                      </h6>

                      <div className="radio-group">
                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_noPDFs_live"
                            checked={generationConfig.pdfMode === 'none'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'none')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_noPDFs_live"
                          >
                            No PDFs
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_generatePDFs"
                            checked={generationConfig.pdfMode === 'ai'}
                            onChange={() => handleConfigChange('pdfMode', 'ai')}
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_generatePDFs"
                          >
                            <ClayIcon symbol="magic" className="ai-icon" />
                            Generate with AI
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_placeholderPDFs_live"
                            checked={generationConfig.pdfMode === 'placeholder'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'placeholder')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_placeholderPDFs_live"
                          >
                            Use placeholder PDF
                          </label>
                        </div>

                        <div className="radio-wrapper">
                          <input
                            className="radio-input"
                            type="radio"
                            name="pdfSource"
                            id="dataGeneration_useCustomPDF_live"
                            checked={generationConfig.pdfMode === 'custom'}
                            onChange={() =>
                              handleConfigChange('pdfMode', 'custom')
                            }
                            disabled={
                              lockFields || generationConfig.productCount === 0
                            }
                          />
                          <label
                            className={`radio-label ${
                              generationConfig.productCount === 0 ? 'muted' : ''
                            }`}
                            htmlFor="dataGeneration_useCustomPDF_live"
                          >
                            Upload custom PDF
                          </label>
                        </div>
                      </div>

                      {generationConfig.pdfMode === 'custom' && (
                        <div className="file-upload-section">
                          <input
                            type="file"
                            className={`file-input ${
                              hasErr(validationErrors, 'customPDFFile')
                                ? 'invalid'
                                : ''
                            }`}
                            accept=".pdf"
                            onChange={(e) =>
                              handleConfigChange(
                                'customPDFFile',
                                e.target.files[0]
                              )
                            }
                            disabled={lockFields}
                          />
                          {hasErr(validationErrors, 'customPDFFile') && (
                            <FieldError
                              errors={validationErrors.customPDFFile}
                            />
                          )}
                          <small className="help-text">
                            This PDF will be used for all products
                          </small>
                        </div>
                      )}

                      {generationConfig.pdfMode !== 'none' && (
                        <div className="ratio-input-section">
                          <label htmlFor="dataGeneration_pdfRatio_live">
                            Apply PDF To
                          </label>
                          <div className="input-with-unit">
                            <input
                              id="dataGeneration_pdfRatio_live"
                              type="number"
                              className={`form-input ${
                                hasErr(validationErrors, 'pdfRatio')
                                  ? 'invalid'
                                  : ''
                              }`}
                              min="0"
                              max="100"
                              value={generationConfig.pdfRatio}
                              onChange={(e) =>
                                handleConfigChange(
                                  'pdfRatio',
                                  parseInt(e.target.value)
                                )
                              }
                              disabled={lockFields}
                            />
                            <span className="input-unit">%</span>
                          </div>
                          {hasErr(validationErrors, 'pdfRatio') && (
                            <FieldError errors={validationErrors.pdfRatio} />
                          )}
                          <small className="help-text">
                            {generationConfig.pdfMode === 'ai'
                              ? 'Generate PDFs for this percentage of products'
                              : 'Assign PDFs to this percentage of products'}
                          </small>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
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
                  disabled={lockFields || generationConfig.productCount === 0}
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
      </form>
    </CollapsiblePanel>
  );
}

export default DataGeneratorForm;
