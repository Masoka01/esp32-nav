'use client';

interface Props {
  visible: boolean;
  navigating: boolean;
  awakeNote: string;
  awakeWarn: boolean;
  onStart: () => void;
  onStop: () => void;
}

export function NavControls({ visible, navigating, awakeNote, awakeWarn, onStart, onStop }: Props) {
  if (!visible) return null;

  return (
    <div className="nav-controls">
      {!navigating && (
        <button className="nav-btn btn-start" onClick={onStart}>
          Mulai Navigasi
        </button>
      )}
      {navigating && (
        <button className="nav-btn btn-stop" onClick={onStop}>
          Berhenti
        </button>
      )}
      {awakeNote && (
        <div className={`awake-note${awakeWarn ? ' warn' : ''}`}>
          {awakeNote}
        </div>
      )}
    </div>
  );
}
