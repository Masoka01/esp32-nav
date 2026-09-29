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
    <div className="nav-controls-float" role="region" aria-label="Kontrol navigasi">
      {!navigating && (
        <button className="nav-btn-float btn-start-float" onClick={onStart} aria-label="Mulai navigasi">
          Mulai Navigasi
        </button>
      )}
      {navigating && (
        <button className="nav-btn-float btn-stop-float" onClick={onStop} aria-label="Berhenti navigasi">
          Berhenti
        </button>
      )}
      {awakeNote && (
        <div className={`awake-note-float${awakeWarn ? ' warn' : ''}`} role="status" aria-live="assertive">
          {awakeNote}
        </div>
      )}
    </div>
  );
}
