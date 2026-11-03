'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line, e.g. "2 residents". */
  hint?: string;
}
export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

/**
 * Custom dropdown (WAI-ARIA "select-only combobox"). Looks like the rest of the
 * site, works with a keyboard (arrows, Home/End, Enter/Space, Esc, type to jump)
 * and screen readers, and submits with forms through a hidden input.
 */
export function Select({
  id,
  name,
  label,
  options,
  groups,
  value: controlled,
  defaultValue = '',
  placeholder = 'Choose…',
  onChange,
  required,
  className = '',
}: {
  id?: string;
  /** Form field name (a hidden input carries the value). */
  name?: string;
  /** Visible label text; rendered by the caller with htmlFor={id}, or here when given. */
  label?: string;
  options?: SelectOption[];
  groups?: SelectGroup[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  const auto = useId();
  const baseId = id ?? `sel-${auto.replace(/:/g, '')}`;
  const listId = `${baseId}-list`;
  const labelId = `${baseId}-label`;
  const all = useMemo(
    () => (groups ? groups.flatMap((g) => g.options) : (options ?? [])),
    [groups, options],
  );
  const [inner, setInner] = useState(defaultValue);
  const value = controlled ?? inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const selected = all.find((o) => o.value === value) ?? null;

  function choose(i: number) {
    const o = all[i];
    if (!o) return;
    if (controlled === undefined) setInner(o.value);
    onChange?.(o.value);
    setOpen(false);
    button.current?.focus();
  }

  function openAt(i?: number) {
    const cur = all.findIndex((o) => o.value === value);
    setActive(i ?? (cur >= 0 ? cur : 0));
    setOpen(true);
  }

  // Close on outside press.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // When it opens near the bottom of the screen, bring the whole list into view.
  useEffect(() => {
    if (!open) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [open]);

  // Keep the active option in view, scrolling only the list (not the page).
  useEffect(() => {
    const l = list.current;
    if (!open || !l) return;
    const o = l.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!o) return;
    const top = o.getBoundingClientRect().top - l.getBoundingClientRect().top + l.scrollTop;
    if (top < l.scrollTop) l.scrollTop = top;
    else if (top + o.offsetHeight > l.scrollTop + l.clientHeight)
      l.scrollTop = top + o.offsetHeight - l.clientHeight;
  }, [open, active]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>) {
    const last = all.length - 1;
    /** Opens on the current choice, or moves the highlight when already open. */
    const move = (i?: number) => {
      e.preventDefault();
      if (!open) openAt(i);
      else if (i !== undefined) setActive(Math.max(0, Math.min(last, i)));
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(open ? active + 1 : undefined);
      case 'ArrowUp':
        return move(open ? active - 1 : undefined);
      case 'Home':
        return move(0);
      case 'End':
        return move(last);
      case 'PageDown':
        return move(active + 8);
      case 'PageUp':
        return move(active - 8);
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) choose(active);
        else openAt();
        return;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation(); // don't also close a surrounding dialog
          setOpen(false);
        }
        return;
      case 'Tab':
        if (open) choose(active);
        return;
      default:
        // Type to jump: "2" → Room 2, "s" → Something else.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const t = typed.current;
          t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
          t.at = now;
          const from = Math.max(0, open ? active : all.findIndex((o) => o.value === value));
          // A single key cycles forward from the next option; a word searches from here.
          const start = t.text.length > 1 ? from : from + 1;
          const order = all.map((_, k) => (start + k) % all.length);
          const hit = order.find((k) => {
            const l = (all[k]?.label ?? '').toLowerCase();
            return l.startsWith(t.text) || l.replace(/^room\s+/, '').startsWith(t.text);
          });
          const o = hit === undefined ? undefined : all[hit];
          if (o && hit !== undefined) {
            if (open) setActive(hit);
            else {
              if (controlled === undefined) setInner(o.value);
              onChange?.(o.value);
            }
          }
        }
    }
  }

  let index = -1;
  const renderOption = (o: SelectOption) => {
    index += 1;
    const i = index;
    return (
      <li
        key={o.value}
        id={`${baseId}-opt-${i}`}
        role="option"
        data-index={i}
        aria-selected={o.value === value}
        className="sel__option"
        data-active={i === active}
        onPointerMove={() => setActive(i)}
        onClick={(e) => {
          // Inside a <label>, a click would also "activate" the button and reopen the list.
          e.preventDefault();
          choose(i);
        }}
      >
        <span className="sel__text">
          <span>{o.label}</span>
          {o.hint ? <span className="sel__hint">{o.hint}</span> : null}
        </span>
        <svg className="sel__tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12.5 10 17.5 19 7" />
        </svg>
      </li>
    );
  };

  return (
    <div ref={root} className={`sel ${className}`} data-open={open}>
      {label ? (
        <span id={labelId} className="sel__label">
          {label}
        </span>
      ) : null}
      <button
        ref={button}
        id={baseId}
        type="button"
        role="combobox"
        className="sel__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={label ? `${labelId} ${baseId}` : undefined}
        aria-required={required || undefined}
        aria-activedescendant={open ? `${baseId}-opt-${active}` : undefined}
        data-empty={!selected}
        onClick={() => (open ? setOpen(false) : openAt())}
        onKeyDown={onKey}
      >
        <span className="sel__value">{selected ? selected.label : placeholder}</span>
        <svg className="sel__chev" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
        </svg>
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <ul
        ref={list}
        id={listId}
        role="listbox"
        className="sel__list"
        aria-labelledby={label ? labelId : baseId}
        hidden={!open}
        tabIndex={-1}
        onClick={(e) => e.preventDefault()}
      >
        {groups
          ? groups.map((g) => (
              <li key={g.label} role="presentation" className="sel__group">
                <span className="sel__group-label" role="presentation">
                  {g.label}
                </span>
                <ul role="group" aria-label={g.label}>
                  {g.options.map(renderOption)}
                </ul>
              </li>
            ))
          : all.map(renderOption)}
      </ul>
    </div>
  );
}
