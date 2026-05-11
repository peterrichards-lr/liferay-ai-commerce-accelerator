import React from 'react';
import ClayLabel from '@clayui/label';

function StatusBadge({ status }) {
  let displayType = 'secondary';
  if (status === 'COMPLETED') displayType = 'success';
  if (status === 'FAILED') displayType = 'danger';
  if (status === 'CANCELLED') displayType = 'warning';
  if (status === 'STARTED' || status === 'PROCESSING') displayType = 'info';

  return (
    <ClayLabel displayType={displayType} outline={true}>
      {status}
    </ClayLabel>
  );
}

export default StatusBadge;
