import React from 'react';
import Card from '@clayui/card';
import ClayButton from '@clayui/button';

function BatchErrors({ batchErrors, clearBatchErrors }) {
  if (!Array.isArray(batchErrors) || batchErrors.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>Batch Errors</h4>
        <ClayButton onClick={clearBatchErrors} displayType="secondary" small>
          Clear
        </ClayButton>
      </div>

      {batchErrors.map((error, index) => (
        <Card
          key={error?.batchId ? `${error.batchId}-${index}` : index}
          className="mb-3"
        >
          <h5 className="card-header mb-3">{error?.batchId}</h5>
          <Card.Body>
            {error?.importTask?.errorMessage ? (
              <p>
                <strong>Error Message:</strong> {error.importTask.errorMessage}
              </p>
            ) : null}

            <h6 className="mb-2">Failed Items Report</h6>

            {Array.isArray(error?.errorReport) &&
            error.errorReport.length > 0 ? (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th scope="col">Item Index</th>
                    <th scope="col">Item Id</th>
                    <th scope="col">Error Message</th>
                  </tr>
                </thead>
                <tbody>
                  {error.errorReport.map((item, itemIndex) => (
                    <tr key={item?.itemIndex ?? itemIndex}>
                      <td>{item?.itemIndex}</td>
                      <td>
                        {item?.item &&
                          (() => {
                            try {
                              return JSON.parse(item.item)?.id;
                            } catch {
                              return item.item;
                            }
                          })()}
                      </td>
                      <td>{item?.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mb-0 text-secondary">
                No item-level report was provided for this batch.
              </p>
            )}
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}

export default BatchErrors;
