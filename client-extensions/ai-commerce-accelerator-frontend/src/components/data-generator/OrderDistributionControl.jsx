import React, { useState, useEffect } from 'react';
import { ClayInput } from '@clayui/form';

const STATUS_CONFIG = [
  { key: 'open', label: 'Open (Baskets)', color: 'bg-secondary', statusId: 0 },
  { key: 'processing', label: 'Processing', color: 'bg-primary', statusId: 1 },
  { key: 'shipped', label: 'Shipped', color: 'bg-info', statusId: 2 },
  { key: 'completed', label: 'Fulfilled', color: 'bg-success', statusId: 10 },
];

export default function OrderDistributionControl({
  totalOrders,
  distribution,
  onChange,
  disabled,
}) {
  // Automatically adjust distribution if total orders change
  useEffect(() => {
    if (!totalOrders) return;

    let currentTotal = Object.values(distribution).reduce((a, b) => a + b, 0);

    // If the total has changed significantly, we need to rescale
    if (currentTotal !== totalOrders) {
      if (currentTotal === 0) {
        // Default split: evenly divided
        const quarter = Math.floor(totalOrders / 4);
        const remainder = totalOrders - quarter * 3;
        onChange({
          open: quarter,
          processing: quarter,
          shipped: quarter,
          completed: remainder,
        });
      } else {
        // Scale existing distribution
        const ratio = totalOrders / currentTotal;
        const newDist = {
          open: Math.floor(distribution.open * ratio),
          processing: Math.floor(distribution.processing * ratio),
          shipped: Math.floor(distribution.shipped * ratio),
        };
        newDist.completed =
          totalOrders - newDist.open - newDist.processing - newDist.shipped;
        onChange(newDist);
      }
    }
  }, [totalOrders]);

  const handleInput = (key, valueStr) => {
    let value = parseInt(valueStr, 10) || 0;

    // Ensure we don't exceed total orders
    if (value > totalOrders) value = totalOrders;

    const newDist = { ...distribution, [key]: value };
    let newTotal = Object.values(newDist).reduce((a, b) => a + b, 0);

    // Auto-balance: if we exceeded total, steal from other buckets (starting from the rightmost)
    if (newTotal > totalOrders) {
      let excess = newTotal - totalOrders;
      for (let i = STATUS_CONFIG.length - 1; i >= 0; i--) {
        const stealKey = STATUS_CONFIG[i].key;
        if (stealKey === key) continue; // Don't steal from the one we just edited

        if (newDist[stealKey] >= excess) {
          newDist[stealKey] -= excess;
          excess = 0;
          break;
        } else {
          excess -= newDist[stealKey];
          newDist[stealKey] = 0;
        }
      }
    }
    // Auto-balance: if we are under total, give to the last bucket (completed)
    else if (newTotal < totalOrders) {
      const shortage = totalOrders - newTotal;
      const lastKey = key === 'completed' ? 'open' : 'completed';
      newDist[lastKey] += shortage;
    }

    onChange(newDist);
  };

  const getPercent = (val) => (totalOrders > 0 ? (val / totalOrders) * 100 : 0);

  return (
    <div className="order-distribution mt-4">
      <label className="form-label font-weight-semi-bold">
        Order Status Distribution{' '}
        <span className="text-secondary font-weight-normal">
          ({totalOrders} total)
        </span>
      </label>

      {/* Visual Stacked Bar */}
      <div
        className="progress mb-3"
        style={{ height: '1.5rem', borderRadius: '0.5rem' }}
      >
        {STATUS_CONFIG.map(({ key, color }) => {
          const count = distribution[key] || 0;
          if (count === 0) return null;
          return (
            <div
              key={key}
              className={`progress-bar ${color}`}
              role="progressbar"
              style={{ width: `${getPercent(count)}%` }}
              aria-valuenow={count}
              aria-valuemin="0"
              aria-valuemax={totalOrders}
            >
              {getPercent(count) > 5 ? count : ''}
            </div>
          );
        })}
      </div>

      {/* Numerical Inputs and Legend */}
      <div className="row">
        {STATUS_CONFIG.map(({ key, label, color }) => (
          <div key={key} className="col-6 col-md-3 mb-2">
            <div className="d-flex align-items-center mb-1">
              <span
                className={`d-inline-block rounded-circle ${color} mr-2`}
                style={{ width: '10px', height: '10px' }}
              ></span>
              <span className="small font-weight-semi-bold">{label}</span>
            </div>
            <ClayInput
              type="number"
              min="0"
              max={totalOrders}
              value={distribution[key] || 0}
              onChange={(e) => handleInput(key, e.target.value)}
              disabled={disabled || totalOrders === 0}
              sizing="sm"
            />
          </div>
        ))}
      </div>
      <small className="form-text text-muted mt-2">
        Adjust the inputs to distribute the historical orders across different
        lifecycle states. They will automatically balance to equal {totalOrders}
        .
      </small>
    </div>
  );
}
