import React from 'react';
import { useEffect } from 'react';
import ClayIcon from '@clayui/icon';

import ProgressItem from './ProgressItem.jsx';

function ProgressMonitor({ generationConfig, progress, onErrorsClick }) {
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

  useEffect(() => {
    const handleWsEvent = (event) => {
      if (event.detail) {
        console.log('[WS] Incoming Event:', event.detail);
      }
    };

    window.addEventListener('liferay-ai-ws-event', handleWsEvent);
    console.log('Progress updated:', progress);

    return () => {
      window.removeEventListener('liferay-ai-ws-event', handleWsEvent);
    };
  }, [progress]);

  return (
    <div className="progress-sections">
      <div className="progress-section">
        <h6 className="section-title">
          <ClayIcon symbol="table" />
          Core Data Generation
        </h6>

        <div className="progress-grid core-data">
          <ProgressItem
            title="Products"
            iconSymbol="box-container"
            iconClassName="products-icon"
            completed={progress.products.completed}
            total={progress.products.total}
            errors={progress.products.errors}
            onErrorsClick={() => onErrorsClick(0)}
          />

          <ProgressItem
            title="Accounts"
            iconSymbol="users"
            iconClassName="accounts-icon"
            completed={progress.accounts.completed}
            total={progress.accounts.total}
            errors={progress.accounts.errors}
            onErrorsClick={() => onErrorsClick(1)}
          />

          <ProgressItem
            title="Orders"
            iconSymbol="shopping-cart"
            iconClassName="orders-icon"
            completed={progress.orders.completed}
            total={progress.orders.total}
            errors={progress.orders.errors}
            onErrorsClick={() => onErrorsClick(2)}
          />
        </div>
      </div>

      <div className="progress-section">
        <h6 className="section-title">
          <ClayIcon symbol="document" />
          Product Enrichment
        </h6>

        <div className="progress-grid content-generation">
          <ProgressItem
            title="Images"
            iconSymbol="picture"
            iconClassName="images-icon"
            completed={progress.images?.completed || 0}
            total={progress.images?.total || 0}
            errors={progress.images?.errors || []}
          >
            {(progress.images?.total || 0) === 0 &&
              (generationConfig?.imageRatio || 0) === 0 && (
                <small className="disabled-text">
                  <ClayIcon symbol="block" />
                  Image generation disabled
                </small>
              )}
            {(progress.images?.expected > 0 ||
              progress.images?.completed < progress.images?.total) && (
              <small className="info-text">
                <ClayIcon symbol="info-circle" />
                Expected {progress.images.expected} products with{' '}
                {getImageContentType().toLowerCase()}
              </small>
            )}
          </ProgressItem>

          <ProgressItem
            title="PDFs"
            iconSymbol="document"
            iconClassName="pdfs-icon"
            completed={progress.pdfs.completed}
            total={progress.pdfs.total}
            errors={progress.pdfs.errors}
          >
            {progress.pdfs.total === 0 &&
              (generationConfig?.pdfRatio || 0) === 0 && (
                <small className="disabled-text">
                  <ClayIcon symbol="block" />
                  PDF generation disabled
                </small>
              )}
            {(progress.pdfs?.expected > 0 ||
              progress.pdfs?.completed < progress.pdfs?.total) && (
              <small className="info-text">
                <ClayIcon symbol="info-circle" />
                Expected {progress.pdfs.expected} products with{' '}
                {getPdfContentType().toLowerCase()}
              </small>
            )}
          </ProgressItem>
          <ProgressItem
            title="Warehouses"
            iconSymbol="warehouse"
            iconClassName="warehouses-icon"
            completed={progress.warehouses.completed}
            total={progress.warehouses.total}
            errors={progress.warehouses.errors}
          />
        </div>
      </div>
    </div>
  );
}

export default ProgressMonitor;
