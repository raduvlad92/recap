import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { opener?.focus(); };
  }, []);
  useEffect(() => { headingRef.current?.focus(); }, [title]);
  return <dialog className={`modal ${wide ? 'modal-wide' : ''}`} ref={ref} onCancel={onClose} onClick={(event) => {
    if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }
  }} aria-labelledby="modal-heading">
    <header className="modal-heading"><h2 id="modal-heading" ref={headingRef} tabIndex={-1}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={20} /></button></header>
    <div className="modal-body">{children}</div>
  </dialog>;
}
