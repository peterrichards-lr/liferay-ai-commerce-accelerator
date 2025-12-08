import React from 'react';
import ClayTable from '@clayui/table';

function BatchErrors({ batchErrors }) {
  if (!batchErrors || batchErrors.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <h4>Batch Errors</h4>
      {batchErrors.map((error, index) => (
        <div key={index} className="mb-3">
          <h5>Batch ID: {error.batchId}</h5>
          <p><strong>Error Message:</strong> {error.importTask.errorMessage}</p>
          <h6>Failed Items Report:</h6>
          <ClayTable>
            <ClayTable.Head>
              <ClayTable.Row>
                <ClayTable.Cell headingCell>Item Index</ClayTable.Cell>
                <ClayTable.Cell headingCell>Error Message</ClayTable.Cell>
              </ClayTable.Row>
            </ClayTable.Head>
            <ClayTable.Body>
              {error.errorReport.map((item, i) => (
                <ClayTable.Row key={i}>
                  <ClayTable.Cell>{item.itemIndex}</ClayTable.Cell>
                  <ClayTable.Cell>{item.errorMessage}</ClayTable.Cell>
                </ClayTable.Row>
              ))}
            </ClayTable.Body>
          </ClayTable>
        </div>
      ))}
    </div>
  );
}

export default BatchErrors;
