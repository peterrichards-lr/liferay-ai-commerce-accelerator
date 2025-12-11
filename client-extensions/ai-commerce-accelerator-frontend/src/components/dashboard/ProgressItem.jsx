import React from 'react';
import ClayIcon from '@clayui/icon';

import { getProgressPercentage } from '../../state/progressSelectors';

function ProgressItem({
  title,
  iconSymbol,
  iconClassName,
  completed = 0,
  total = 0,
  errors = [],
  onErrorsClick,
  children,
}) {
  const percentage = getProgressPercentage(completed, total);

  const getProgressBarClass = (value) => {
    if (value === 100) return 'complete';
    if (value > 0) return 'active';
    return 'pending';
  };

  const progressBarClass = getProgressBarClass(percentage);
  const hasErrors = Array.isArray(errors) && errors.length > 0;

  return (
    <div className="progress-item">
      <div className="progress-item-header">
        <h6 className="progress-item-title">
          <ClayIcon symbol={iconSymbol} className={iconClassName} />
          {title}
        </h6>
        <span className="progress-count">
          {completed} / {total}
        </span>
      </div>
      <div className="progress-bar-container">
        <div
          className={`progress-bar ${progressBarClass}`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      {hasErrors && (
        <small
          className="error-text"
          onClick={onErrorsClick}
          role={onErrorsClick ? 'button' : undefined}
        >
          <ClayIcon symbol="warning-full" />
          {errors.length} errors
        </small>
      )}
      {children}
    </div>
  );
}

export default ProgressItem;