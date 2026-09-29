'use client';

interface Props {
  icon: string;
  text: string;
  dist?: string;
  totalDist?: string;
  totalDur?: string;
  showInfo?: boolean;
}

export function Instruction({ icon, text, dist, totalDist, totalDur, showInfo }: Props) {
  return (
    <div>
      <div className="instruction-card">
        <div className="instr-icon">{icon}</div>
        <div className="instr-text">{text}</div>
        {dist && <div className="instr-dist">{dist}</div>}
      </div>
      {showInfo && (totalDist || totalDur) && (
        <div className="route-info">
          {totalDist && <span>{totalDist}</span>}
          {totalDur && <span>{totalDur}</span>}
        </div>
      )}
    </div>
  );
}
