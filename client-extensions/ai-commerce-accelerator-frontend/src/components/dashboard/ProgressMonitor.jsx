import React from 'react';
import ClayIcon from '@clayui/icon';

import { getProgressPercentage } from '../../state/progressSelectors';

function ProgressMonitor({ generationConfig, progress }) {
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
          <ClayIcon symbol="table" className="me-2" />
          Core Data Generation
        </h6>

        <div className="progress-grid core-data">
          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <ClayIcon symbol="box-container" className="products-icon me-2" />
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
                <ClayIcon symbol="warning-full" className="me-2" />
                {progress.products.errors.length} errors
              </small>
            )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <ClayIcon symbol="users" className="accounts-icon me-2" />
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
                <ClayIcon symbol="warning-full" className="me-2" />
                {progress.accounts.errors.length} errors
              </small>
            )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <ClayIcon symbol="shopping-cart" className="orders-icon me-2" />
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
                <ClayIcon symbol="warning-full" className="me-2" />
                {progress.orders.errors.length} errors
              </small>
            )}
          </div>
        </div>
      </div>

      <div className="progress-section">
        <h6 className="section-title">
          <ClayIcon symbol="document" className="me-2" />
          Content Generation
        </h6>

        <div className="progress-grid content-generation">
          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <ClayIcon symbol="picture" className="images-icon me-2" />
                Images
              </h6>
              <span className="progress-count">
                {progress.images?.completed || 0} /{' '}
                {progress.images?.total}
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
                <ClayIcon symbol="warning-full" className="me-2" />
                {progress.images.errors.length} errors
              </small>
            )}
            {(progress.images?.total || 0) === 0 &&
              (generationConfig?.imageRatio || 0) === 0 && (
                <small className="disabled-text">
                  <ClayIcon symbol="block" className="me-2" />
                  Image generation disabled
                </small>
              )}
            {((progress.images?.expected > 0) ||
              progress.images?.completed < progress.images?.total) && (
              <small className="info-text">
                <ClayIcon symbol="info-circle" className="me-2" />
                Expected {progress.images.expected} products with{' '}
                {getImageContentType().toLowerCase()}
              </small>
            )}
          </div>

          <div className="progress-item">
            <div className="progress-item-header">
              <h6 className="progress-item-title">
                <ClayIcon symbol="document" className="pdfs-icon me-2" />
                PDFs
              </h6>
              <span className="progress-count">
                {progress.pdfs.completed} /{' '}
                {progress.pdfs.total}
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
                <ClayIcon symbol="warning-full" className="me-2" />
                {progress.pdfs.errors.length} errors
              </small>
            )}
            {progress.pdfs.total === 0 &&
              (generationConfig?.pdfRatio || 0) === 0 && (
                <small className="disabled-text">
                  <ClayIcon symbol="block" className="me-2" />
                  PDF generation disabled
                </small>
              )}
            {((progress.pdfs?.expected > 0) ||
              progress.pdfs?.completed < progress.pdfs?.total) && (
              <small className="info-text">
                <ClayIcon symbol="info-circle" className="me-2" />
                Expected {progress.pdfs.expected} products with{' '}
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
