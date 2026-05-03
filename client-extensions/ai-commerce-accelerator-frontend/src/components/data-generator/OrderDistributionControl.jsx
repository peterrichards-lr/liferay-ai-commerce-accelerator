import React, { useEffect, useRef, useState } from 'react';
import { ClayInput } from '@clayui/form';

const STATUS_CONFIG = [
  { key: 'open', label: 'Open', color: 'bg-secondary', statusId: 0 },
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
  const containerRef = useRef(null);
  const [draggingIdx, setDraggingIdx] = useState(null);

  // We convert absolute counts to percentages for the UI
  const getPercentages = () => {
    if (totalOrders === 0) return [25, 25, 25, 25];
    return [
      (distribution.open / totalOrders) * 100,
      (distribution.processing / totalOrders) * 100,
      (distribution.shipped / totalOrders) * 100,
      (distribution.completed / totalOrders) * 100,
    ];
  };

  const percentages = getPercentages();

  // The dividers are at cumulative percentage points: p1, p1+p2, p1+p2+p3
  const dividers = [
    percentages[0],
    percentages[0] + percentages[1],
    percentages[0] + percentages[1] + percentages[2],
  ];

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

      // Convert back to absolute counts
      const newPercentages = [
        newDividers[0],
        newDividers[1] - newDividers[0],
        newDividers[2] - newDividers[1],
        100 - newDividers[2],
      ];

      const newDist = {
        open: Math.round((newPercentages[0] / 100) * totalOrders),
        processing: Math.round((newPercentages[1] / 100) * totalOrders),
        shipped: Math.round((newPercentages[2] / 100) * totalOrders),
      };
      newDist.completed =
        totalOrders - newDist.open - newDist.processing - newDist.shipped;

      onChange(newDist);
    };

    const onMouseUp = () => setDraggingIdx(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingIdx, totalOrders, dividers, onChange]);

  const handleInputChange = (key, valStr) => {
    let val = parseInt(valStr, 10) || 0;
    if (val > totalOrders) val = totalOrders;

    const newDist = { ...distribution, [key]: val };
    const newTotal = Object.values(newDist).reduce((a, b) => a + b, 0);

    if (newTotal > totalOrders) {
      // Simple balancing: subtract from other fields
      let excess = newTotal - totalOrders;
      for (const k of ['completed', 'shipped', 'processing', 'open']) {
        if (k === key) continue;
        if (newDist[k] >= excess) {
          newDist[k] -= excess;
          excess = 0;
          break;
        } else {
          excess -= newDist[k];
          newDist[k] = 0;
        }
      }
    } else if (newTotal < totalOrders) {
      newDist.completed += totalOrders - newTotal;
    }

    onChange(newDist);
  };

  return (
    <div className="order-distribution mt-4">
      <div className="d-flex justify-content-between align-items-end mb-2">
        <label className="form-label font-weight-semi-bold mb-0">
          Order Lifecycle Distribution
        </label>
        <span className="text-secondary small font-italic">
          {totalOrders} total orders
        </span>
      </div>

      {/* Interactive Segmented Bar */}
      <div
        ref={containerRef}
        className="progress mb-4 position-relative"
        style={{
          height: '2.5rem',
          borderRadius: '0.5rem',
          overflow: 'visible',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {STATUS_CONFIG.map(({ key, color, label }, i) => {
          const pct = percentages[i];
          if (pct <= 0 && i > 0 && i < 3) return null; // Keep slots for dividers

          return (
            <div
              key={key}
              className={`progress-bar ${color} d-flex align-items-center justify-content-center`}
              role="progressbar"
              style={{
                width: `${pct}%`,
                transition: draggingIdx !== null ? 'none' : 'width 0.2s',
              }}
            >
              {pct > 10 && (
                <span
                  className="font-weight-bold"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
                >
                  {distribution[key]}
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
                width: '12px',
                marginLeft: '-6px',
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
                  height: '80%',
                  backgroundColor: 'white',
                  borderRadius: '2px',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                }}
              />
            </div>
          ))}
      </div>

      {/* Legend and Manual Inputs */}
      <div className="row">
        {STATUS_CONFIG.map(({ key, label, color }) => (
          <div key={key} className="col-6 col-md-3 mb-2">
            <div className="d-flex align-items-center mb-1">
              <span
                className={`d-inline-block rounded-circle ${color} mr-2`}
                style={{ width: '10px', height: '10px' }}
              ></span>
              <span className="small font-weight-semi-bold" title={label}>
                {label}
              </span>
            </div>
            <ClayInput.Group>
              <ClayInput
                type="number"
                min="0"
                max={totalOrders}
                value={distribution[key] || 0}
                onChange={(e) => handleInputChange(key, e.target.value)}
                disabled={disabled || totalOrders === 0}
                sizing="sm"
              />
              <ClayInput.GroupItem shrink>
                <ClayInput.GroupText
                  style={{ padding: '0 4px', fontSize: '0.7rem' }}
                >
                  {totalOrders > 0
                    ? Math.round((distribution[key] / totalOrders) * 100)
                    : 0}
                  %
                </ClayInput.GroupText>
              </ClayInput.GroupItem>
            </ClayInput.Group>
          </div>
        ))}
      </div>
    </div>
  );
}
