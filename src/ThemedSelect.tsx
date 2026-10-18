import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

export type SelectOption = { value: string; label: string };

export default function ThemedSelect({ id, label, value, options, onChange, disabled = false }: {
  id?: string; label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; disabled?: boolean;
}) {
  const generated = useId(); const controlId = id ?? generated;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null); const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    return () => trigger.current?.focus({ preventScroll: true });
  }, [open]);
  return <>
    <button ref={trigger} id={controlId} type="button" className="themed-select-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <span>{options.find(option => option.value === value)?.label ?? 'Choose an option'}</span><ChevronDown size={17}/>
    </button>
    {open ? createPortal(<div className="choice-backdrop" onClick={event => { event.stopPropagation(); setOpen(false); }}>
      <div className="choice-panel" ref={panel} role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        const controls = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const current = controls.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) {
          event.preventDefault(); const direction = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
          controls[(current + direction + controls.length) % controls.length]?.focus({ preventScroll: true });
        }
      }}>
        <header><h3>{label}</h3><button type="button" className="icon-button" aria-label="Close options" onClick={() => setOpen(false)}><X size={19}/></button></header>
        <div className="choice-options" role="listbox" aria-label={label}>{options.map(option => <button type="button" key={option.value} role="option" aria-selected={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span>{value === option.value ? <Check size={18}/> : null}</button>)}</div>
      </div>
    </div>, document.body) : null}
  </>;
}
