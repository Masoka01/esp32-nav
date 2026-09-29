'use client';
import { useEffect, useState, useCallback, useRef } from 'react';

let showToastGlobal: ((msg: string) => void) | null = null;

export function toast(msg = '') {
  showToastGlobal?.(msg);
}

export function Toast() {
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2500);
  }, []);

  useEffect(() => {
    showToastGlobal = show;
    return () => { showToastGlobal = null; };
  }, [show]);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '8px 16px',
        fontSize: 13,
        color: 'var(--text)',
        zIndex: 9999,
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.2s',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}
