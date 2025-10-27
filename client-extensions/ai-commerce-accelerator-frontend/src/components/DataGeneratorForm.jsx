import React from 'react';
import FieldError from './FieldError';

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
  disabledReason,
  isGenerating,
  forceDemoMode,
  openAiKeyAvailable,
  validationErrors,
}) {
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

    if (generationConfig.imageMode === 'generate' && generationConfig.productCount > 0) {
      const imageCount = Math.ceil(
        generationConfig.productCount * (generationConfig.imageRatio / 100)
      );
      const imageCost = imageCount * 0.04;
      breakdown.push(
        `AI images: $${imageCost.toFixed(2)} (${imageCount} images)`
      );
      total += imageCost;
    }

    if (generationConfig.pdfMode === 'generate' && generationConfig.productCount > 0) {
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

  const availableCategories = [
    'Electronics',
    'Clothing',
    'Home & Garden',
    'Sports',
    'Books',
    'Automotive',
    'Health & Beauty',
    'Toys & Games',
    'Food & Beverage',
    'Office Supplies',
  ];

  // Only lock fields when globally disabled AND there are no validation errors
  const shouldDisableFields =
    disabled && Object.keys(validationErrors || {}).length === 0;
  const lockFields = shouldDisableFields;

  return (
    <div className="form-card">
      <div className="form-header">
        <h5>
          <i className="icon icon-magic"></i>
          Data Generation
        </h5>
        <div className="form-header-actions">
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
            onClick={onResetSettings}
            disabled={isGenerating}
            title="Reset generator settings to defaults"
          >
            <span className="icon icon-restore"></span>
            Reset Settings
          </button>
        </div>
      </div>
      <div className="form-body">
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
            <div className="checkbox-wrapper">
              <input
                className="checkbox-input"
                type="checkbox"
                id="dataGeneration_demoMode"
                checked={generationConfig.demoMode}
                onChange={(e) =>
                  setGenerationConfig((prev) => ({
                    ...prev,
                    demoMode: e.target.checked,
                  }))
                }
                disabled={lockFields || forceDemoMode}
              />
              <label
                className="checkbox-label"
                htmlFor="dataGeneration_demoMode"
              >
                <i className="icon icon-warning demo-mode-icon"></i>
                <strong>Demo Mode</strong> - Generate mock data without AI costs
                (for testing)
              </label>
            </div>

            {forceDemoMode && (
              <div className="text-info my-2">
                <i className="fas fa-info-circle me-1"></i>
                OpenAI API key not found. Demo mode is enforced, and AI
                generation options are disabled.
              </div>
            )}
            <small className="help-text">
              Perfect for testing the interface and progress tracking without
              consuming API credits
            </small>
          </div>

          <div className="divider"></div>

          <div className="form-group">
            <h5
              className={`section-title ${
                generationConfig.productCount === 0 ? 'muted' : ''
              }`}
            >
              <i className="icon icon-settings"></i>
              Product Configuration Options
            </h5>
            <small className="section-subtitle">
              The following options are only applicable when generating products
            </small>
          </div>

          <div className="form-group">
            <div className="categories-section">
              <span className="categories-title">Categories</span>
              {generationConfig.productCount === 0 &&
                generationConfig.accountCount === 0 && (
                  <small className="categories-note">
                    (Categories are used for both product and account
                    generation)
                  </small>
                )}
              <div className="categories-grid">
                {availableCategories.map((category) => (
                  <div key={category} className="category-item">
                    <div className="checkbox-wrapper">
                      <input
                        className={`checkbox-input ${
                          hasErr(validationErrors, 'categories')
                            ? 'invalid'
                            : ''
                        }`}
                        type="checkbox"
                        id={`dataGeneration_category-${category}`}
                        checked={generationConfig.categories.includes(category)}
                        onChange={(e) =>
                          handleCategoryChange(category, e.target.checked)
                        }
                        disabled={
                          lockFields ||
                          (generationConfig.productCount === 0 &&
                            generationConfig.accountCount === 0)
                        }
                      />
                      <label
                        className={`checkbox-label ${
                          generationConfig.productCount === 0 ? 'muted' : ''
                        } ${
                          hasErr(validationErrors, 'categories') ? 'error' : ''
                        }`}
                        htmlFor={`dataGeneration_category-${category}`}
                      >
                        {category}
                      </label>
                    </div>
                  </div>
                ))}
                {hasErr(validationErrors, 'categories') && (
                  <FieldError errors={validationErrors.categories} />
                )}
              </div>
            </div>
          </div>

          <div
            className={
              generationConfig.productCount > 0
                ? 'product-config-section'
                : 'product-config-section hidden'
            }
          >
            <div className="config-row">
              <div className="config-col-narrow">
                <h6
                  className={`config-section-title ${
                    generationConfig.productCount === 0 ? 'muted' : ''
                  }`}
                >
                  <i className="icon icon-list"></i>
                  Pricing & Data Options
                </h6>
                <div className="config-options">
                  <div className="checkbox-wrapper">
                    <input
                      className="checkbox-input"
                      type="checkbox"
                      id="dataGeneration_generatePriceLists"
                      checked={generationConfig.generatePriceLists}
                      onChange={(e) =>
                        handleConfigChange(
                          'generatePriceLists',
                          e.target.checked
                        )
                      }
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                    />
                    <label
                      className={`checkbox-label ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                      htmlFor="dataGeneration_generatePriceLists"
                    >
                      Generate Price Lists
                    </label>
                  </div>
                  <div className="checkbox-wrapper">
                    <input
                      className="checkbox-input"
                      type="checkbox"
                      id="dataGeneration_generateBulkPricing"
                      checked={generationConfig.generateBulkPricing}
                      onChange={(e) =>
                        handleConfigChange(
                          'generateBulkPricing',
                          e.target.checked
                        )
                      }
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                    />
                    <label
                      className={`checkbox-label ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                      htmlFor="dataGeneration_generateBulkPricing"
                    >
                      Generate Bulk Pricing
                    </label>
                  </div>
                  <div className="checkbox-wrapper">
                    <input
                      className="checkbox-input"
                      type="checkbox"
                      id="dataGeneration_generateTierPricing"
                      checked={generationConfig.generateTierPricing}
                      onChange={(e) =>
                        handleConfigChange(
                          'generateTierPricing',
                          e.target.checked
                        )
                      }
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                    />
                    <label
                      className={`checkbox-label ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                      htmlFor="dataGeneration_generateTierPricing"
                    >
                      Generate Tier Pricing
                    </label>
                  </div>
                  <div className="checkbox-wrapper">
                    <input
                      className="checkbox-input"
                      type="checkbox"
                      id="dataGeneration_generateSpecifications"
                      checked={generationConfig.generateSpecifications}
                      onChange={(e) =>
                        handleConfigChange(
                          'generateSpecifications',
                          e.target.checked
                        )
                      }
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                    />
                    <label
                      className={`checkbox-label ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                      htmlFor="dataGeneration_generateSpecifications"
                    >
                      Generate Specifications
                    </label>
                  </div>
                  <div className="checkbox-wrapper">
                    <input
                      className="checkbox-input"
                      type="checkbox"
                      id="dataGeneration_generateSkuVariants"
                      checked={generationConfig.generateSkuVariants}
                      onChange={(e) =>
                        handleConfigChange(
                          'generateSkuVariants',
                          e.target.checked
                        )
                      }
                      disabled={
                        lockFields || generationConfig.productCount === 0
                      }
                    />
                    <label
                      className={`checkbox-label ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                      htmlFor="dataGeneration_generateSkuVariants"
                    >
                      Generate SKU Variants (Size, Color, etc.)
                    </label>
                  </div>
                </div>
              </div>

              <div className="config-col-wide">
                {generationConfig.demoMode ? (
                  <div>
                    <h6
                      className={`config-section-title ${
                        generationConfig.productCount === 0 ? 'muted' : ''
                      }`}
                    >
                      <i className="icon icon-warning demo-mode-icon"></i>
                      Demo Mode Media Options
                      <small className="config-subtitle">
                        (Uses existing assets, no AI costs)
                      </small>
                    </h6>

                    <div className="content-options-grid">
                      <div className="content-option">
                        <h6 className="content-option-title">
                          <i className="icon icon-image"></i>
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              checked={generationConfig.imageMode === 'default'}
                              onChange={() =>
                                handleConfigChange('imageMode', 'default')
                              }
                              disabled={
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
                              }`}
                              htmlFor="dataGeneration_useDefaultImage"
                            >
                              Use default placeholder image
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              Image Assignment Ratio
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
                              <FieldError
                                errors={validationErrors.imageRatio}
                              />
                            )}
                            <small className="help-text">
                              Assign images to this percentage of products
                            </small>
                          </div>
                        )}
                      </div>

                      <div className="content-option">
                        <h6 className="content-option-title">
                          <i className="icon icon-pdf"></i>
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              checked={generationConfig.pdfMode === 'default'}
                              onChange={() =>
                                handleConfigChange('pdfMode', 'default')
                              }
                              disabled={
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
                              }`}
                              htmlFor="dataGeneration_useDefaultPDF"
                            >
                              Use default placeholder PDF
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              PDF Assignment Ratio
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
                              Assign PDFs to this percentage of products
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
                      <i className="icon icon-magic ai-icon"></i>
                      AI-Powered Content Generation
                      <small className="config-subtitle">
                        (Additional API costs apply)
                      </small>
                    </h6>

                    <div className="content-options-grid">
                      <div className="content-option">
                        <h6 className="content-option-title">
                          <i className="icon icon-image"></i>
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              checked={
                                generationConfig.imageMode === 'generate'
                              }
                              onChange={() =>
                                handleConfigChange('imageMode', 'generate')
                              }
                              disabled={
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
                              }`}
                              htmlFor="dataGeneration_generateImages"
                            >
                              <i className="icon icon-magic ai-icon"></i>
                              Generate with AI
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                                  <option value="high">
                                    High (Higher cost)
                                  </option>
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
                              Image Assignment Ratio
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
                              <FieldError
                                errors={validationErrors.imageRatio}
                              />
                            )}
                            <small className="help-text">
                              {generationConfig.imageMode === 'generate'
                                ? 'Generate images for this percentage of products'
                                : 'Assign custom image to this percentage of products'}
                            </small>
                          </div>
                        )}
                      </div>

                      <div className="content-option">
                        <h6 className="content-option-title">
                          <i className="icon icon-pdf"></i>
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              checked={generationConfig.pdfMode === 'generate'}
                              onChange={() =>
                                handleConfigChange('pdfMode', 'generate')
                              }
                              disabled={
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
                              }`}
                              htmlFor="dataGeneration_generatePDFs"
                            >
                              <i className="icon icon-magic ai-icon"></i>
                              Generate with AI
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
                                lockFields ||
                                generationConfig.productCount === 0
                              }
                            />
                            <label
                              className={`radio-label ${
                                generationConfig.productCount === 0
                                  ? 'muted'
                                  : ''
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
                              PDF Assignment Ratio
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
                              {generationConfig.pdfMode === 'generate'
                                ? 'Generate PDFs for this percentage of products'
                                : 'Assign custom PDF to this percentage of products'}
                            </small>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="divider"></div>

          {!generationConfig.demoMode && (
            <div className="cost-estimation">
              <div className="cost-card">
                <h5 className="cost-title">
                  <i className="icon icon-dollar"></i>
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
                disabled={disabled}
                aria-disabled={disabled ? 'true' : 'false'}
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
                    <i className="icon icon-warning error-icon"></i>
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
      </div>
    </div>
  );
}

export default DataGeneratorForm;
