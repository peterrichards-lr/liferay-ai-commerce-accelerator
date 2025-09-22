import React, { useState } from 'react';

function DataGeneratorForm({
  generationConfig,
  setGenerationConfig,
  disabled,
  onGenerate,
  connectionEstablished,
  openAiKeyAvailable,
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

  const getValidationIssues = () => {
    const issues = [];
    if (generationConfig.productCount < 0)
      issues.push('Product count cannot be negative.');
    if (generationConfig.accountCount < 0)
      issues.push('Account count cannot be negative.');
    if (generationConfig.orderCount < 0)
      issues.push('Order count cannot be negative.');
    if (generationConfig.productCount > 100)
      issues.push('Product count cannot exceed 100.');
    if (generationConfig.accountCount > 50)
      issues.push('Account count cannot exceed 50.');
    if (generationConfig.orderCount > 200)
      issues.push('Order count cannot exceed 200.');
    if (generationConfig.imageRatio < 0 || generationConfig.imageRatio > 100)
      issues.push('Image assignment ratio must be between 0 and 100.');
    if (generationConfig.pdfRatio < 0 || generationConfig.pdfRatio > 100)
      issues.push('PDF assignment ratio must be between 0 and 100.');

    if (generationConfig.useCustomImage && !generationConfig.customImageFile) {
      issues.push('Please upload a custom image.');
    }
    if (generationConfig.useCustomPDF && !generationConfig.customPDFFile) {
      issues.push('Please upload a custom PDF.');
    }

    if (
      generationConfig.productCount > 0 &&
      generationConfig.categories.length === 0
    ) {
      issues.push('Please select at least one category for products.');
    }

    return issues;
  };

  const costEstimate = () => {
    if (generationConfig.demoMode) return { total: 0, breakdown: [] };

    const breakdown = [];
    let total = 0;

    // Base data generation cost
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

    // AI image generation cost
    if (generationConfig.generateImages && generationConfig.productCount > 0) {
      const imageCount = Math.ceil(
        generationConfig.productCount * (generationConfig.imageRatio / 100)
      );
      const imageCost = imageCount * 0.04;
      breakdown.push(
        `AI images: $${imageCost.toFixed(2)} (${imageCount} images)`
      );
      total += imageCost;
    }

    // AI PDF generation cost
    if (generationConfig.generatePDFs && generationConfig.productCount > 0) {
      const pdfCount = Math.ceil(
        generationConfig.productCount * (generationConfig.pdfRatio / 100)
      );
      const pdfCost = pdfCount * 0.01;
      breakdown.push(`AI PDFs: $${pdfCost.toFixed(2)} (${pdfCount} PDFs)`);
      total += pdfCost;
    }

    return { total, breakdown };
  };

  const validationIssues = getValidationIssues();
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

  return (
    <div className="form-card">
      <div className="form-header">
        <h5>
          <i className="icon icon-magic"></i>
          Data Generation
        </h5>

        {typeof openAiKeyAvailable === 'boolean' && (
          <span
            className={`label ${
              openAiKeyAvailable ? 'label-success' : 'label-warning'
            }`}
          >
            {openAiKeyAvailable ? 'OpenAI key detected' : 'OpenAI key not set'}
          </span>
        )}
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
                    validationIssues.includes(
                      'Product count cannot be negative.'
                    ) ||
                    validationIssues.includes(
                      'Product count cannot exceed 100.'
                    )
                      ? 'invalid'
                      : ''
                  }`}
                  min="0"
                  max="100"
                  value={generationConfig.productCount}
                  onChange={(e) =>
                    handleConfigChange('productCount', parseInt(e.target.value))
                  }
                  disabled={disabled}
                />
                {validationIssues.includes(
                  'Product count cannot be negative.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Product count cannot be negative.')
                    )}
                  </div>
                )}
                {validationIssues.includes(
                  'Product count cannot exceed 100.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Product count cannot exceed 100.')
                    )}
                  </div>
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
                    validationIssues.includes(
                      'Account count cannot be negative.'
                    ) ||
                    validationIssues.includes('Account count cannot exceed 50.')
                      ? 'invalid'
                      : ''
                  }`}
                  min="0"
                  max="50"
                  value={generationConfig.accountCount}
                  onChange={(e) =>
                    handleConfigChange('accountCount', parseInt(e.target.value))
                  }
                  disabled={disabled}
                />
                {validationIssues.includes(
                  'Account count cannot be negative.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Account count cannot be negative.')
                    )}
                  </div>
                )}
                {validationIssues.includes(
                  'Account count cannot exceed 50.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Account count cannot exceed 50.')
                    )}
                  </div>
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
                    validationIssues.includes('Order count cannot be negative.')
                      ? 'invalid'
                      : ''
                  }`}
                  min="0"
                  max="200"
                  value={generationConfig.orderCount}
                  onChange={(e) =>
                    handleConfigChange('orderCount', parseInt(e.target.value))
                  }
                  disabled={disabled}
                />
                {validationIssues.includes(
                  'Order count cannot be negative.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Order count cannot be negative.')
                    )}
                  </div>
                )}
                {validationIssues.includes(
                  'Order count cannot exceed 200.'
                ) && (
                  <div className="error-message">
                    {validationIssues.find((issue) =>
                      issue.startsWith('Order count cannot exceed 200.')
                    )}
                  </div>
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
                  handleConfigChange('demoMode', e.target.checked)
                }
                disabled={
                  disabled || (!openAiKeyAvailable && connectionEstablished)
                }
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
            {connectionEstablished && !openAiKeyAvailable && (
              <div className="text-info mt-2">
                <i className="fas fa-info-circle me-1"></i>
                OpenAI API key not found. Only demo mode is available.
              </div>
            )}
            <small className="help-text">
              Perfect for testing the interface and progress tracking without
              consuming API credits
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
                          validationIssues.includes(
                            'Please select at least one category for products.'
                          ) && generationConfig.productCount > 0
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
                          disabled ||
                          (generationConfig.productCount === 0 &&
                            generationConfig.accountCount === 0)
                        }
                      />
                      <label
                        className={`checkbox-label ${
                          generationConfig.productCount === 0 ? 'muted' : ''
                        } ${
                          validationIssues.includes(
                            'Please select at least one category for products.'
                          ) && generationConfig.productCount > 0
                            ? 'error'
                            : ''
                        }`}
                        htmlFor={`dataGeneration_category-${category}`}
                      >
                        {category}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {validationIssues.includes(
                'Please select at least one category for products.'
              ) &&
                generationConfig.productCount > 0 && (
                  <div className="error-message">
                    Please select at least one category for products.
                  </div>
                )}
            </div>
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
                      disabled={disabled || generationConfig.productCount === 0}
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
                      disabled={disabled || generationConfig.productCount === 0}
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
                      disabled={disabled || generationConfig.productCount === 0}
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
                      disabled={disabled || generationConfig.productCount === 0}
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
                      disabled={disabled || generationConfig.productCount === 0}
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
                      Demo Mode Content Options
                      <small className="config-subtitle">
                        (Uses default assets, no AI costs)
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
                              checked={generationConfig.imageRatio === 0}
                              onChange={() =>
                                handleConfigChange('imageRatio', 0)
                              }
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              checked={
                                !generationConfig.useCustomImage &&
                                generationConfig.imageRatio > 0
                              }
                              onChange={() => {
                                handleConfigChange('useCustomImage', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              checked={
                                generationConfig.useCustomImage &&
                                generationConfig.imageRatio > 0
                              }
                              onChange={() => {
                                handleConfigChange('useCustomImage', true);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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

                        {generationConfig.useCustomImage && (
                          <div className="file-upload-section">
                            <input
                              type="file"
                              className={`file-input ${
                                validationIssues.includes(
                                  'Please upload a custom image.'
                                )
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
                              disabled={disabled}
                            />
                            {validationIssues.includes(
                              'Please upload a custom image.'
                            ) && (
                              <div className="error-message">
                                Please upload a custom image.
                              </div>
                            )}
                            <small className="help-text">
                              This image will be used for all products
                            </small>
                          </div>
                        )}

                        {(generationConfig.useCustomImage ||
                          generationConfig.imageRatio > 0) && (
                          <div className="ratio-input-section">
                            <label htmlFor="dataGeneration_imageRatio">
                              Image Assignment Ratio
                            </label>
                            <div className="input-with-unit">
                              <input
                                id="dataGeneration_imageRatio"
                                type="number"
                                className={`form-input ${
                                  validationIssues.includes(
                                    'Image assignment ratio must be between 0 and 100.'
                                  )
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
                                disabled={disabled}
                              />
                              <span className="input-unit">%</span>
                            </div>
                            {validationIssues.includes(
                              'Image assignment ratio must be between 0 and 100.'
                            ) && (
                              <div className="error-message">
                                Image assignment ratio must be between 0 and
                                100.
                              </div>
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
                              checked={generationConfig.pdfRatio === 0}
                              onChange={() => handleConfigChange('pdfRatio', 0)}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              checked={
                                !generationConfig.useCustomPDF &&
                                generationConfig.pdfRatio > 0
                              }
                              onChange={() => {
                                handleConfigChange('useCustomPDF', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              checked={
                                generationConfig.useCustomPDF &&
                                generationConfig.pdfRatio > 0
                              }
                              onChange={() => {
                                handleConfigChange('useCustomPDF', true);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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

                        {generationConfig.useCustomPDF && (
                          <div className="file-upload-section">
                            <input
                              type="file"
                              className={`file-input ${
                                validationIssues.includes(
                                  'Please upload a custom PDF.'
                                )
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
                              disabled={disabled}
                            />
                            {validationIssues.includes(
                              'Please upload a custom PDF.'
                            ) && (
                              <div className="error-message">
                                Please upload a custom PDF.
                              </div>
                            )}
                            <small className="help-text">
                              This PDF will be used for all products
                            </small>
                          </div>
                        )}

                        {(generationConfig.useCustomPDF ||
                          generationConfig.pdfRatio > 0) && (
                          <div className="ratio-input-section">
                            <label htmlFor="dataGeneration_pdfRatio">
                              PDF Assignment Ratio
                            </label>
                            <div className="input-with-unit">
                              <input
                                id="dataGeneration_pdfRatio"
                                type="number"
                                className={`form-input ${
                                  validationIssues.includes(
                                    'PDF assignment ratio must be between 0 and 100.'
                                  )
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
                                disabled={disabled}
                              />
                              <span className="input-unit">%</span>
                            </div>
                            {validationIssues.includes(
                              'PDF assignment ratio must be between 0 and 100.'
                            ) && (
                              <div className="error-message">
                                PDF assignment ratio must be between 0 and 100.
                              </div>
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
                              id="dataGeneration_noImages"
                              checked={
                                !generationConfig.generateImages &&
                                !generationConfig.useCustomImage
                              }
                              onChange={() => {
                                handleConfigChange('generateImages', false);
                                handleConfigChange('useCustomImage', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              id="dataGeneration_generateImages"
                              checked={generationConfig.generateImages}
                              onChange={() => {
                                handleConfigChange('generateImages', true);
                                handleConfigChange('useCustomImage', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              id="dataGeneration_useCustomImage"
                              checked={generationConfig.useCustomImage}
                              onChange={() => {
                                handleConfigChange('generateImages', false);
                                handleConfigChange('useCustomImage', true);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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

                        {generationConfig.useCustomImage && (
                          <div className="file-upload-section">
                            <input
                              type="file"
                              className={`file-input ${
                                validationIssues.includes(
                                  'Please upload a custom image.'
                                )
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
                              disabled={disabled}
                            />
                            {validationIssues.includes(
                              'Please upload a custom image.'
                            ) && (
                              <div className="error-message">
                                Please upload a custom image.
                              </div>
                            )}
                            <small className="help-text">
                              This image will be used for all products
                            </small>
                          </div>
                        )}

                        {generationConfig.generateImages && (
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
                                  disabled={disabled}
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
                                  disabled={disabled}
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
                                  disabled={disabled}
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
                                  disabled={disabled}
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

                        {(generationConfig.generateImages ||
                          generationConfig.useCustomImage) && (
                          <div className="ratio-input-section">
                            <label htmlFor="dataGeneration_imageRatio">
                              Image Assignment Ratio
                            </label>
                            <div className="input-with-unit">
                              <input
                                id="dataGeneration_imageRatio"
                                type="number"
                                className={`form-input ${
                                  validationIssues.includes(
                                    'Image assignment ratio must be between 0 and 100.'
                                  )
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
                                disabled={disabled}
                              />
                              <span className="input-unit">%</span>
                            </div>
                            {validationIssues.includes(
                              'Image assignment ratio must be between 0 and 100.'
                            ) && (
                              <div className="error-message">
                                Image assignment ratio must be between 0 and
                                100.
                              </div>
                            )}
                            <small className="help-text">
                              {generationConfig.generateImages
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
                              id="dataGeneration_noPDFs"
                              checked={
                                !generationConfig.generatePDFs &&
                                !generationConfig.useCustomPDF
                              }
                              onChange={() => {
                                handleConfigChange('generatePDFs', false);
                                handleConfigChange('useCustomPDF', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              id="dataGeneration_generatePDFs"
                              checked={generationConfig.generatePDFs}
                              onChange={() => {
                                handleConfigChange('generatePDFs', true);
                                handleConfigChange('useCustomPDF', false);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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
                              id="dataGeneration_useCustomPDF"
                              checked={generationConfig.useCustomPDF}
                              onChange={() => {
                                handleConfigChange('generatePDFs', false);
                                handleConfigChange('useCustomPDF', true);
                              }}
                              disabled={
                                disabled || generationConfig.productCount === 0
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

                        {generationConfig.useCustomPDF && (
                          <div className="file-upload-section">
                            <input
                              type="file"
                              className={`file-input ${
                                validationIssues.includes(
                                  'Please upload a custom PDF.'
                                )
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
                              disabled={disabled}
                            />
                            {validationIssues.includes(
                              'Please upload a custom PDF.'
                            ) && (
                              <div className="error-message">
                                Please upload a custom PDF.
                              </div>
                            )}
                            <small className="help-text">
                              This PDF will be used for all products
                            </small>
                          </div>
                        )}

                        {generationConfig.generatePDFs && (
                          <div className="ai-options-panel">
                            <small className="warning-text">
                              AI-generated specs, warranties, and manuals
                            </small>
                          </div>
                        )}

                        {(generationConfig.generatePDFs ||
                          generationConfig.useCustomPDF) && (
                          <div className="ratio-input-section">
                            <label htmlFor="dataGeneration_pdfRatio">
                              PDF Assignment Ratio
                            </label>
                            <div className="input-with-unit">
                              <input
                                id="dataGeneration_pdfRatio"
                                type="number"
                                className={`form-input ${
                                  validationIssues.includes(
                                    'PDF assignment ratio must be between 0 and 100.'
                                  )
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
                                disabled={disabled}
                              />
                              <span className="input-unit">%</span>
                            </div>
                            {validationIssues.includes(
                              'PDF assignment ratio must be between 0 and 100.'
                            ) && (
                              <div className="error-message">
                                PDF assignment ratio must be between 0 and 100.
                              </div>
                            )}
                            <small className="help-text">
                              {generationConfig.generatePDFs
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

          <div className="submit-section">
            <button
              type="submit"
              className={`submit-button ${
                generationConfig.demoMode ? 'demo-mode' : 'generate-mode'
              }`}
              disabled={
                disabled ||
                !connectionEstablished ||
                validationIssues.length > 0
              }
            >
              {disabled ? (
                <>
                  <span className="spinner"></span>
                  {generationConfig.demoMode
                    ? 'Generating Demo Data...'
                    : 'Generating Data...'}
                </>
              ) : !connectionEstablished ? (
                <>
                  <i className="icon icon-plug"></i>
                  Test Connection First
                </>
              ) : validationIssues.length > 0 ? (
                <>
                  <i className="icon icon-warning error-icon"></i>
                  Fix Issues to Generate
                </>
              ) : (
                <>
                  <i
                    className={`icon ${
                      generationConfig.demoMode ? 'icon-flask' : 'icon-play'
                    }`}
                  ></i>
                  {generationConfig.demoMode
                    ? 'Start Demo Generation'
                    : 'Start Generation'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default DataGeneratorForm;
