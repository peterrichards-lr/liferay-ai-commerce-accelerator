import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClayInput } from '@clayui/form';

const STATUS_CONFIG = [
  {
    color: 'var(--brand-color-1, var(--secondary, #00d1ff))',
    key: 'open',
    label: 'Open',
  },
  {
    color: 'var(--brand-color-2, var(--primary, #7a00ff))',
    key: 'processing',
    label: 'Processing',
  },
  {
    color: 'var(--brand-color-3, var(--info, #00ff94))',
    key: 'shipped',
    label: 'Shipped',
  },
  {
    color: 'var(--brand-color-4, var(--success, #ffbb00))',
    key: 'completed',
    label: 'Fulfilled',
  },
];

export default function OrderDistributionControl({
  totalOrders,
  distribution, // These are now percentages (0-100)
  onChange,
  disabled,
}) {
  const containerRef = useRef(null);
  const [draggingIdx, setDraggingIdx] = useState(null);

  // The dividers are at cumulative percentage points: p1, p1+p2, p1+p2+p3
  const dividers = useMemo(
    () => [
      distribution.open,
      distribution.open + distribution.processing,
      distribution.open + distribution.processing + distribution.shipped,
    ],
    [distribution]
  );

  const handleMouseDown = (idx, e) => {
    if (disabled) return;
    e.preventDefault();
    setDraggingIdx(idx);
  };

  useEffect(() => {
    if (draggingIdx === null) return;

    const onMouseMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let newPct = Math.max(0, Math.min(100, (x / rect.width) * 100));

      // Constraints: dividers cannot cross each other
      const minPct = draggingIdx === 0 ? 0 : dividers[draggingIdx - 1];
      const maxPct = draggingIdx === 2 ? 100 : dividers[draggingIdx + 1];

      newPct = Math.max(minPct, Math.min(maxPct, newPct));

      const newDividers = [...dividers];
      newDividers[draggingIdx] = newPct;

      // Convert back to percentages for each segment
      const newDist = {
        open: Math.round(newDividers[0]),
        processing: Math.round(newDividers[1] - newDividers[0]),
        shipped: Math.round(newDividers[2] - newDividers[1]),
      };
      newDist.completed =
        100 - newDist.open - newDist.processing - newDist.shipped;

      onChange(newDist);
    };

    const onMouseUp = () => setDraggingIdx(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingIdx, dividers, onChange]);

  const handleInputChange = (key, valStr) => {
    let val = parseInt(valStr, 10) || 0;
    if (val > 100) val = 100;

    const newDist = { ...distribution, [key]: val };
    const newTotal = Object.values(newDist).reduce((a, b) => a + b, 0);

    if (newTotal > 100) {
      // Auto-balance: subtract from other fields (completed -> shipped -> processing -> open)
      let excess = newTotal - 100;
      const keysToSteal = ['completed', 'shipped', 'processing', 'open'].filter(
        (k) => k !== key
      );
      for (const k of keysToSteal) {
        if (newDist[k] >= excess) {
          newDist[k] -= excess;
          break;
        } else {
          excess -= newDist[k];
          newDist[k] = 0;
        }
      }
    } else if (newTotal < 100) {
      // Auto-balance: add to the last bucket (completed or open)
      const target = key === 'completed' ? 'open' : 'completed';
      newDist[target] += 100 - newTotal;
    }

    onChange(newDist);
  };

  const getCount = (pct) => Math.round((pct / 100) * totalOrders);

  return (
    <div className="order-distribution mt-4">
      <div className="d-flex justify-content-between align-items-end mb-2">
        <label className="form-label font-weight-semi-bold mb-0">
          Order Lifecycle Distribution (%)
        </label>
        <span className="text-secondary small font-italic">
          Target: {totalOrders} total orders
        </span>
      </div>

      {/* Interactive Segmented Bar */}
      <div
        ref={containerRef}
        className="progress mb-4 position-relative"
        style={{
          height: '1.25rem',
          borderRadius: '1rem',
          overflow: 'hidden',
          backgroundColor: '#f1f3f4',
          border: '1px solid #e9ecef',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {STATUS_CONFIG.map(({ key, color }, i) => {
          const values = [
            distribution.open,
            distribution.processing,
            distribution.shipped,
            distribution.completed,
          ];
          const pct = values[i];

          // Find the first and last indices with non-zero values to apply rounding
          const firstVisibleIdx = values.findIndex((v) => v > 0);
          const lastVisibleIdx = values.map((v) => v > 0).lastIndexOf(true);

          return (
            <div
              key={key}
              className="d-flex align-items-center justify-content-center progress-bar"
              role="progressbar"
              style={{
                backgroundColor: color,
                borderBottomLeftRadius: i === firstVisibleIdx ? '1rem' : '0',
                borderBottomRightRadius: i === lastVisibleIdx ? '1rem' : '0',
                borderTopLeftRadius: i === firstVisibleIdx ? '1rem' : '0',
                borderTopRightRadius: i === lastVisibleIdx ? '1rem' : '0',
                marginRight: i === lastVisibleIdx ? '0' : '2px',
                transition: draggingIdx !== null ? 'none' : 'width 0.2s',
                width: `${pct}%`,
              }}
            >
              {pct > 12 && (
                <span
                  className="font-weight-bold"
                  style={{
                    fontSize: '0.65rem',
                    color: 'white',
                  }}
                >
                  {Math.round(pct)}%
                </span>
              )}
            </div>
          );
        })}

        {/* Draggable Dividers */}
        {!disabled &&
          dividers.map((pos, i) => (
            <div
              key={i}
              onMouseDown={(e) => handleMouseDown(i, e)}
              className="position-absolute h-100"
              style={{
                left: `${pos}%`,
                width: '14px',
                marginLeft: '-7px',
                zIndex: 10,
                cursor: 'col-resize',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '4px',
                  height: '90%',
                  backgroundColor: '#fff',
                  borderRadius: '2px',
                  boxShadow: '0 0 5px rgba(0,0,0,0.6)',
                }}
              />
            </div>
          ))}
      </div>

      {/* Legend and Manual Inputs */}
      <div className="row">
        {STATUS_CONFIG.map(({ key, label, color }) => {
          const count = getCount(distribution[key] || 0);
          return (
            <div key={key} className="col-6 col-md-3 mb-2">
              <div className="d-flex align-items-center mb-1">
                <span
                  className="d-inline-block mr-2 rounded-circle"
                  style={{
                    backgroundColor: color,
                    height: '10px',
                    width: '10px',
                  }}
                ></span>
                <span
                  className="small font-weight-semi-bold text-truncate"
                  title={`${label}: ${count} items`}
                >
                  {label}{' '}
                  <span className="text-secondary font-weight-normal">
                    ({count})
                  </span>
                </span>
              </div>
              <ClayInput.Group>
                <ClayInput
                  type="number"
                  min="0"
                  max="100"
                  value={distribution[key] || 0}
                  onChange={(e) => handleInputChange(key, e.target.value)}
                  disabled={disabled || totalOrders === 0}
                />
                <ClayInput.GroupItem shrink>
                  <ClayInput.GroupText
                    style={{ padding: '0 8px', fontSize: '0.875rem' }}
                  >
                    %
                  </ClayInput.GroupText>
                </ClayInput.GroupItem>
              </ClayInput.Group>
            </div>
          );
        })}
      </div>
      <small className="form-text text-muted mt-1">
        Adjust percentages to distribute {totalOrders} orders. Total must equal
        100%.
      </small>
    </div>
  );
}
