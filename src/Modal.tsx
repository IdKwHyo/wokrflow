import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  return <dialog ref={ref} className="ag-dialog" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="ag-dialog-inner">
      <header className="ag-dialog-header"><span className="ag-eyebrow">AFTERGLOW / STUDIO</span><button className="ag-icon-button" aria-label="Close dialog" onClick={onClose}>×</button></header>
      <h2>{title}</h2>{children}
    </div>
  </dialog>;
}
