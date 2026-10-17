'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

let openCount = 0;
let originalOverflow = '';

// Native dialogs provide focus containment, focus restoration and a top layer
// above transformed drag/drop cards. A nested editor stays above its timeline.
export default function Modal({ title, onClose, busy = false, children }) {
  const ref = useRef(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    const dialog = ref.current;
    if (openCount++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialog.showModal();
    return () => {
      dialog.close();
      if (--openCount === 0) document.body.style.overflow = originalOverflow;
    };
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <dialog ref={ref} aria-labelledby={titleId}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-lg border-0 bg-white p-0 shadow-xl backdrop:bg-black/50"
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}>
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close dialog"
          className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-50">✕</button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>, document.body,
  );
}
