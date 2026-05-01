import React from 'react';
import Card from '@clayui/card';
import ClayButton from '@clayui/button';
import ClayIcon from '@clayui/icon';

function BatchErrors({ batchErrors, clearBatchErrors, entityFilter }) {
  if (!Array.isArray(batchErrors) || batchErrors.length === 0) {
    return (
      <div className="empty-errors-state mt-4 text-center py-5">
        <ClayIcon
          symbol="check-circle"
          className="text-success mb-3"
          style={{ fontSize: '3rem' }}
        />
        <h5>No errors detected!</h5>
        <p className="text-muted">All batches processed successfully.</p>
      </div>
    );
  }

  const filteredErrors = entityFilter
    ? batchErrors.filter((err) => err.entityType === entityFilter)
    : batchErrors;

  if (filteredErrors.length === 0 && entityFilter) {
    return (
      <div className="mt-4">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h5>Errors for {entityFilter}</h5>
          <ClayButton
            onClick={() => clearBatchErrors(entityFilter)}
            displayType="secondary"
            small
          >
            Back to All
          </ClayButton>
        </div>
        <p className="text-muted">
          No errors found for this specific category.
        </p>
      </div>
    );
  }

  return (
    <div className="batch-errors-container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>{entityFilter ? `Errors: ${entityFilter}` : 'All Batch Errors'}</h4>
        <div className="btn-group">
          <ClayButton onClick={clearBatchErrors} displayType="secondary" small>
            Clear All
          </ClayButton>
        </div>
      </div>

      {filteredErrors.map((error, index) => (
        <Card
          key={error?.batchId ? `${error.batchId}-${index}` : index}
          className="batch-error-card mb-4"
        >
          <div className="card-header d-flex justify-content-between align-items-center">
            <h5 className="mb-0">
              <ClayIcon symbol="box-container" className="me-2" />
              Batch: {error?.batchId || 'Unknown'}
            </h5>
            <span className="label label-warning">
              {error?.entityType || 'unknown'}
            </span>
          </div>
          <Card.Body>
            {error?.importTask?.errorMessage && (
              <div className="alert alert-danger py-2 px-3 mb-3">
                <strong>Liferay Error:</strong> {error.importTask.errorMessage}
              </div>
            )}

            <div className="failed-items-section">
              <h6 className="mb-2 d-flex align-items-center">
                <ClayIcon symbol="warning-full" className="text-danger me-2" />
                Failed Items Details
              </h6>

              {Array.isArray(error?.errorReport) &&
              error.errorReport.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-autofit table-list table-nowrap table-sm">
                    <thead>
                      <tr>
                        <th className="table-cell-expand">Index</th>
                        <th className="table-cell-expand">
                          External Reference Code
                        </th>
                        <th className="table-cell-expand">Error Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {error.errorReport.map((item, itemIndex) => (
                        <tr key={item?.itemIndex ?? itemIndex}>
                          <td className="table-cell-expand">
                            {item?.itemIndex}
                          </td>
                          <td className="table-cell-expand">
                            <code>
                              {item?.externalReferenceCode ||
                                (item?.item &&
                                  (() => {
                                    try {
                                      return JSON.parse(item.item)
                                        ?.externalReferenceCode;
                                    } catch {
                                      return 'n/a';
                                    }
                                  })()) ||
                                'n/a'}
                            </code>
                          </td>
                          <td className="table-cell-expand text-danger">
                            {item?.message || 'Unknown processing error'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mb-0 text-muted italic">
                  No individual item reports available for this batch. Check
                  microservice logs for details.
                </p>
              )}
            </div>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}

export default BatchErrors;
