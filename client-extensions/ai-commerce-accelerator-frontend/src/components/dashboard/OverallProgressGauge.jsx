import React from 'react';

function OverallProgressGauge({ percentage }) {
  const radius = 60;
  const stroke = 12;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="overall-gauge-container">
      <svg height={radius * 2} width={radius * 2} className="overall-gauge">
        <circle
          stroke="#e9ecef"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          stroke={percentage === 100 ? '#28a745' : '#0b5fff'}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={circumference + ' ' + circumference}
          style={{
            strokeDashoffset,
            transition: 'stroke-dashoffset 0.5s ease-in-out',
          }}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
      </svg>
      <div className="gauge-text">
        <span className="gauge-value">{Math.round(percentage)}%</span>
        <span className="gauge-label">Total Progress</span>
      </div>
    </div>
  );
}

export default OverallProgressGauge;
