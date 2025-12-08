import React from 'react';
import ClayCard from '@clayui/card';
import ClayList from '@clayui/list';

function BatchErrors({ batchErrors }) {
  if (!batchErrors || batchErrors.length === 0) {
    return null;
  }

  return (
    <div className="mt-4">
      <h4>Batch Errors</h4>
      <ClayList>
        {batchErrors.map((error, index) => (
          <ClayList.Item key={index}>
            <ClayCard>
              <ClayCard.Body>
                <p><strong>Batch ID:</strong> {error.batchId}</p>
                <p><strong>Error Message:</strong> {error.importTask.errorMessage}</p>
                <h5>Failed Items:</h5>
                <ClayList>
                  {error.importTask.failedItems.map((item, i) => (
                    <ClayList.Item key={i}>
                      <p><strong>Item Index:</strong> {item.itemIndex}</p>
                      <p><strong>Message:</strong> {item.message}</p>
                    </ClayList.Item>
                  ))}
                </ClayList>
              </ClayCard.Body>
            </ClayCard>
          </ClayList.Item>
        ))}
      </ClayList>
    </div>
  );
}

export default BatchErrors;
