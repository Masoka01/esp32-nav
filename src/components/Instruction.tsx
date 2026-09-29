'use client';

interface Props {
  icon?: string;
  text?: string;
  dist?: string;
  totalDist?: string;
  totalDur?: string;
  showInfo?: boolean;
}

export function Instruction({ icon, text, dist, totalDist, totalDur, showInfo }: Props) {
  const hasTurnInstruction = !!(icon || text || dist);
  const hasRouteInfo = showInfo && (totalDist || totalDur);

  // Nothing to show at all
  if (!hasTurnInstruction && !hasRouteInfo) {
    return null;
  }

  // Only route info (no active turn) → compact chip
  if (!hasTurnInstruction && hasRouteInfo) {
    return (
      <div className="route-info-chip" role="status" aria-live="polite">
        {totalDist && <span>{totalDist}</span>}
        {totalDur && <span>{totalDur}</span>}
      </div>
    );
  }

  // Active turn instruction → floating card
  return (
    <div className="instruction-float" role="region" aria-label="Petunjuk belokan">
      <div className="instruction-card">
        <div className="instr-icon" aria-hidden="true">{icon}</div>
        <div className="instr-text">{text}</div>
        {dist && <div className="instr-dist">{dist}</div>}
      </div>
      {hasRouteInfo && (
        <div className="route-info" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          {totalDist && <span>{totalDist}</span>}
          {totalDur && <span>{totalDur}</span>}
        </div>
      )}
    </div>
  );
}
