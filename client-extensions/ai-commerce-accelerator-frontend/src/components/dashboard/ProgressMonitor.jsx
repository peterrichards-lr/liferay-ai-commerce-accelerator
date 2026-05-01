import React from 'react';
import ClayIcon from '@clayui/icon';

import ProgressItem from './ProgressItem.jsx';

function ProgressMonitor({ generationConfig, progress, onErrorsClick }) {
  return (
    <div className="progress-monitor-container">
      <div className="progress-monitor-grid">
        <div className="row">
          {/* Core Commerce Data */}
          <div className="col-md-4">
            <div className="progress-group-card h-100">
              <div className="group-header">
                <ClayIcon symbol="table" className="group-icon" />
                <h6 className="group-title">Core Commerce</h6>
              </div>
              <div className="group-body flex-column">
                <ProgressItem
                  title="Products"
                  iconSymbol="box-container"
                  iconClassName="products-icon"
                  completed={progress.products.completed}
                  total={progress.products.total}
                  errors={progress.products.errors}
                  onErrorsClick={() => onErrorsClick(0, 'products')}
                />
                <ProgressItem
                  title="Accounts"
                  iconSymbol="users"
                  iconClassName="accounts-icon"
                  completed={progress.accounts.completed}
                  total={progress.accounts.total}
                  errors={progress.accounts.errors}
                  onErrorsClick={() => onErrorsClick(1, 'accounts')}
                />
                <ProgressItem
                  title="Orders"
                  iconSymbol="shopping-cart"
                  iconClassName="orders-icon"
                  completed={progress.orders.completed}
                  total={progress.orders.total}
                  errors={progress.orders.errors}
                  onErrorsClick={() => onErrorsClick(2, 'orders')}
                />
              </div>
            </div>
          </div>

          {/* Enrichment & Assets */}
          <div className="col-md-4">
            <div className="progress-group-card h-100">
              <div className="group-header">
                <ClayIcon symbol="document" className="group-icon" />
                <h6 className="group-title">Enrichment & Assets</h6>
              </div>
              <div className="group-body flex-column">
                <ProgressItem
                  title="Images"
                  iconSymbol="picture"
                  iconClassName="images-icon"
                  completed={progress.images?.completed || 0}
                  total={progress.images?.total || 0}
                  errors={progress.images?.errors || []}
                  onErrorsClick={() => onErrorsClick(3, 'images')}
                />
                <ProgressItem
                  title="PDFs"
                  iconSymbol="document"
                  iconClassName="pdfs-icon"
                  completed={progress.pdfs.completed}
                  total={progress.pdfs.total}
                  errors={progress.pdfs.errors}
                  onErrorsClick={() => onErrorsClick(4, 'pdfs')}
                />
                <ProgressItem
                  title="Warehouses"
                  iconSymbol="warehouse"
                  iconClassName="warehouses-icon"
                  completed={progress.warehouses.completed}
                  total={progress.warehouses.total}
                  errors={progress.warehouses.errors}
                  onErrorsClick={() => onErrorsClick(5, 'warehouses')}
                />
              </div>
            </div>
          </div>

          {/* Architecture */}
          <div className="col-md-4">
            <div className="progress-group-card h-100">
              <div className="group-header">
                <ClayIcon symbol="list" className="group-icon" />
                <h6 className="group-title">Architecture</h6>
              </div>
              <div className="group-body flex-column">
                <ProgressItem
                  title="Specs"
                  iconSymbol="list"
                  iconClassName="specifications-icon"
                  completed={progress.specifications?.completed || 0}
                  total={progress.specifications?.total || 0}
                  errors={progress.specifications?.errors || []}
                  onErrorsClick={() => onErrorsClick(6, 'specifications')}
                />
                <ProgressItem
                  title="Options"
                  iconSymbol="check-circle-full"
                  iconClassName="options-icon"
                  completed={progress.options?.completed || 0}
                  total={progress.options?.total || 0}
                  errors={progress.options?.errors || []}
                  onErrorsClick={() => onErrorsClick(7, 'options')}
                />
                <div className="d-flex gap-2">
                  <ProgressItem
                    title="Prices"
                    iconSymbol="info-circle"
                    iconClassName="price-lists-icon"
                    completed={progress.priceLists?.completed || 0}
                    total={progress.priceLists?.total || 0}
                    errors={progress.priceLists?.errors || []}
                    onErrorsClick={() => onErrorsClick(8, 'priceLists')}
                  />
                  <ProgressItem
                    title="Promos"
                    iconSymbol="calendar"
                    iconClassName="promotions-icon"
                    completed={progress.promotions?.completed || 0}
                    total={progress.promotions?.total || 0}
                    errors={progress.promotions?.errors || []}
                    onErrorsClick={() => onErrorsClick(9, 'promotions')}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProgressMonitor;
