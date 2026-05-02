import React from 'react';
import ClayIcon from '@clayui/icon';
import ClayBadge from '@clayui/badge';
import ClayProgressBar from '@clayui/progress-bar';

function MiniProgressItem({ title, completed, total, errors, onErrorsClick }) {
    const hasErrors = errors && errors.length > 0;
    const isDone = total > 0 && completed >= total && !hasErrors;
    const inProgress = completed > 0 && completed < total && !hasErrors;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="d-flex justify-content-between align-items-center py-2 border-bottom">
            <div>
                <span className="font-weight-semi-bold d-block" style={{fontSize: '0.875rem'}}>{title}</span>
                <span className="text-secondary" style={{fontSize: '0.75rem'}}>
                    {completed} / {total}
                </span>
            </div>
            <div className="d-flex align-items-center">
                {hasErrors ? (
                    <button className="btn btn-unstyled text-danger p-0" onClick={onErrorsClick} title="View Errors">
                        <ClayBadge displayType="danger" label={`${errors.length} Err`} />
                    </button>
                ) : isDone ? (
                    <ClayBadge displayType="success" label="Done" />
                ) : inProgress ? (
                     <span className="text-primary font-weight-semi-bold" style={{fontSize: '0.875rem'}}>{percentage}%</span>
                ) : (
                    <span className="text-secondary" style={{fontSize: '0.875rem'}}>Pending</span>
                )}
            </div>
        </div>
    );
}

function ProgressMonitor({ generationConfig, progress, onErrorsClick }) {
  if (!progress) return null;

  return (
    <div className="progress-monitor-compact mt-2">
        <h6 className="text-uppercase text-secondary mb-2" style={{fontSize: '0.75rem', letterSpacing: '0.05em'}}>Entities</h6>
        <MiniProgressItem
            title="Products"
            completed={progress.products.completed}
            total={progress.products.total}
            errors={progress.products.errors}
            onErrorsClick={() => onErrorsClick(0, 'products')}
        />
        <MiniProgressItem
            title="Accounts"
            completed={progress.accounts.completed}
            total={progress.accounts.total}
            errors={progress.accounts.errors}
            onErrorsClick={() => onErrorsClick(1, 'accounts')}
        />
        <MiniProgressItem
            title="Orders"
            completed={progress.orders.completed}
            total={progress.orders.total}
            errors={progress.orders.errors}
            onErrorsClick={() => onErrorsClick(2, 'orders')}
        />

        <h6 className="text-uppercase text-secondary mt-3 mb-2" style={{fontSize: '0.75rem', letterSpacing: '0.05em'}}>Assets & Structure</h6>
        <MiniProgressItem
            title="Images"
            completed={progress.images?.completed || 0}
            total={progress.images?.total || 0}
            errors={progress.images?.errors || []}
            onErrorsClick={() => onErrorsClick(3, 'images')}
        />
        <MiniProgressItem
            title="PDFs"
            completed={progress.pdfs.completed}
            total={progress.pdfs.total}
            errors={progress.pdfs.errors}
            onErrorsClick={() => onErrorsClick(4, 'pdfs')}
        />
        <MiniProgressItem
            title="Warehouses"
            completed={progress.warehouses.completed}
            total={progress.warehouses.total}
            errors={progress.warehouses.errors}
            onErrorsClick={() => onErrorsClick(5, 'warehouses')}
        />
        <MiniProgressItem
            title="Prices & Promos"
            completed={(progress.priceLists?.completed || 0) + (progress.promotions?.completed || 0)}
            total={(progress.priceLists?.total || 0) + (progress.promotions?.total || 0)}
            errors={[...(progress.priceLists?.errors || []), ...(progress.promotions?.errors || [])]}
            onErrorsClick={() => onErrorsClick(8, 'pricing')}
        />
    </div>
  );
}

export default ProgressMonitor;
