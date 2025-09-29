import React from 'react';

import {
  getProgressPercentage,
  expectedImageTotal,
  expectedPdfTotal,
} from '../../state/progressSelectors';

function ProgressMonitor({ generationConfig, progress }) {
  const getExpectedImageCount = () => expectedImageTotal(generationConfig);
  const getExpectedPdfCount = () => expectedPdfTotal(generationConfig);

  const getProgressBarClass = (percentage) => {
    if (percentage === 100) return 'complete';
    if (percentage > 0) return 'active';
    return 'pending';
  };

  const getImageContentType = () => {
    if (generationConfig?.useCustomImage) return 'Custom image file';
    if (generationConfig?.demoMode) return 'Default placeholder images';
    return 'AI-generated images';
  };

  const getPdfContentType = () => {
    if (generationConfig?.useCustomPDF) return 'Custom PDF file';
    if (generationConfig?.demoMode) return 'Default placeholder PDFs';
    return 'AI-generated PDFs';
  };

  return (
    <div className="progress-sections">
      <div className="progress-section">
        <h6 className="section-title">
          <i className="icon icon-database"></i>
          Core Data Generation
        </h6>

        <div className="progress-grid core-data">
          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <i className="icon icon-box products-icon"></i>
                Products
              </h6>
              <span className="progress-count">
                {progress.products.completed} / {progress.products.total}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${getProgressBarClass(
                  getProgressPercentage(
                    progress.products.completed,
                    progress.products.total
                  )
                )}`}
                style={{
                  width: `${getProgressPercentage(
                    progress.products.completed,
                    progress.products.total
                  )}%`,
                }}
              ></div>
            </div>
            {progress.products.errors.length > 0 && (
              <small className="error-text">
                <i className="icon icon-warning"></i>
                {progress.products.errors.length} errors
              </small>
            )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <i className="icon icon-users accounts-icon"></i>
                Accounts
              </h6>
              <span className="progress-count">
                {progress.accounts.completed} / {progress.accounts.total}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${getProgressBarClass(
                  getProgressPercentage(
                    progress.accounts.completed,
                    progress.accounts.total
                  )
                )}`}
                style={{
                  width: `${getProgressPercentage(
                    progress.accounts.completed,
                    progress.accounts.total
                  )}%`,
                }}
              ></div>
            </div>
            {progress.accounts.errors.length > 0 && (
              <small className="error-text">
                <i className="icon icon-warning"></i>
                {progress.accounts.errors.length} errors
              </small>
            )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <i className="icon icon-cart orders-icon"></i>
                Orders
              </h6>
              <span className="progress-count">
                {progress.orders.completed} / {progress.orders.total}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${getProgressBarClass(
                  getProgressPercentage(
                    progress.orders.completed,
                    progress.orders.total
                  )
                )}`}
                style={{
                  width: `${getProgressPercentage(
                    progress.orders.completed,
                    progress.orders.total
                  )}%`,
                }}
              ></div>
            </div>
            {progress.orders.errors.length > 0 && (
              <small className="error-text">
                <i className="icon icon-warning"></i>
                {progress.orders.errors.length} errors
              </small>
            )}
          </div>
        </div>
      </div>

      <div className="progress-section">
        <h6 className="section-title">
          <i className="icon icon-file"></i>
          Content Generation
        </h6>

        <div className="progress-grid content-generation">
          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <i className="icon icon-image images-icon"></i>
                Images
              </h6>
              <span className="progress-count">
                {progress.images?.completed || 0} /{' '}
                {progress.images?.total || getExpectedImageCount()}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${getProgressBarClass(
                  getProgressPercentage(
                    progress.images?.completed || 0,
                    progress.images?.total || 0
                  )
                )}`}
                style={{
                  width: `${getProgressPercentage(
                    progress.images?.completed || 0,
                    progress.images?.total || 0
                  )}%`,
                }}
              ></div>
            </div>
            {progress.images?.errors?.length > 0 && (
              <small className="error-text">
                <i className="icon icon-warning"></i>
                {progress.images.errors.length} errors
              </small>
            )}
            {(progress.images?.total || 0) === 0 &&
              (generationConfig?.imageRatio || 0) === 0 && (
                <small className="disabled-text">
                  <i className="icon icon-ban"></i>
                  Image generation disabled
                </small>
              )}
            {(getExpectedImageCount() > 0 &&
              (progress.images?.total === 0) ||
                progress.images?.completed < progress.images?.total) && (
                <small className="info-text">
                  <i className="icon icon-info"></i>
                  Expected {getExpectedImageCount()} products with{' '}
                  {getImageContentType().toLowerCase()}
                </small>
              )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <i className="icon icon-pdf pdfs-icon"></i>
                PDFs
              </h6>
              <span className="progress-count">
                {progress.pdfs.completed} /{' '}
                {progress.pdfs.total || getExpectedPdfCount()}
              </span>
            </div>
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${getProgressBarClass(
                  getProgressPercentage(
                    progress.pdfs.completed,
                    progress.pdfs.total
                  )
                )}`}
                style={{
                  width: `${getProgressPercentage(
                    progress.pdfs.completed,
                    progress.pdfs.total
                  )}%`,
                }}
              ></div>
            </div>
            {progress.pdfs.errors.length > 0 && (
              <small className="error-text">
                <i className="icon icon-warning"></i>
                {progress.pdfs.errors.length} errors
              </small>
            )}
            {progress.pdfs.total === 0 &&
              (generationConfig?.pdfRatio || 0) === 0 && (
                <small className="disabled-text">
                  <i className="icon icon-ban"></i>
                  PDF generation disabled
                </small>
              )}
            {((getExpectedPdfCount() > 0 && progress.pdfs?.total === 0) ||
              progress.pdfs?.completed < progress.pdfs?.total) && (
              <small className="info-text">
                <i className="icon icon-info"></i>
                Expected {getExpectedPdfCount()} products with{' '}
                {getPdfContentType().toLowerCase()}
              </small>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProgressMonitor;
