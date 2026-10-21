import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import './index.less';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  'aria-label': string;
  'aria-describedby'?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** 全局单选下拉：焦点留在触发器，弹层可用于滚动容器和模态窗口。 */
export default function Select({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = '请选择',
  className = '',
  ...attributes
}: SelectProps) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [position, setPosition] = useState<CSSProperties>({});
  const selected = options.find((option) => option.value === value);
  const enabled = options.filter((option) => !option.disabled);
  const expanded = open && !disabled && enabled.length > 0;
  const activeIndex = options.findIndex((option) => option.value === active);

  const show = () => {
    if (disabled || !enabled.length) return;
    setActive(enabled.find((option) => option.value === value)?.value ?? enabled[0].value);
    search.current = { text: '', time: 0 };
    setOpen(true);
  };
  const choose = (option: SelectOption) => {
    if (disabled || trigger.current?.matches(':disabled') || option.disabled) return;
    setOpen(false);
    onChange(option.value);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (disabled || !enabled.length) setOpen(false);
    if (!enabled.some((option) => option.value === active)) setActive(enabled[0]?.value ?? '');
  }, [disabled, options, active]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      if (!trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - margin - gap;
      const above = rect.top - margin - gap;
      const upwards = below < 240 && above > below;
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - margin * 2);
      setPosition({
        width,
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        maxHeight: Math.max(0, Math.min(320, upwards ? above : below)),
        ...(upwards ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    const observer = new ResizeObserver(place);
    if (trigger.current) observer.observe(trigger.current);
    place();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [expanded]);

  useLayoutEffect(() => {
    if (expanded)
      document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [expanded, activeIndex, listId, position.maxHeight]);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!enabled.length) return;
      if (!expanded) show();
      if (event.key === 'Home') setActive(enabled[0].value);
      else if (event.key === 'End') setActive(enabled[enabled.length - 1].value);
      else if (expanded) {
        const index = enabled.findIndex((option) => option.value === active);
        const next = Math.max(
          0,
          Math.min(enabled.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
        );
        setActive(enabled[next].value);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options.find((item) => item.value === active);
      if (expanded && option) choose(option);
      else show();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text =
        (now - search.current.time < 700 ? search.current.text : '') +
        event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      const match = enabled.find((option) => option.label.toLocaleLowerCase().startsWith(text));
      if (match) {
        event.preventDefault();
        if (!expanded) show();
        setActive(match.value);
      }
    }
  };

  return (
    <>
      <button
        {...attributes}
        ref={trigger}
        type="button"
        className={`appSelect ${className}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={
          expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
        }
        disabled={disabled || !enabled.length}
        onClick={() => (expanded ? setOpen(false) : show())}
        onKeyDown={keyDown}
        onBlur={() => setOpen(false)}
        title={selected?.label}
      >
        <span className={selected ? 'appSelectValue' : 'appSelectValue placeholder'}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          className="appSelectChevron"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m4 6 4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded &&
        createPortal(
          <div
            ref={popup}
            id={listId}
            role="listbox"
            aria-label={attributes['aria-label']}
            className="appSelectPopup"
            style={position}
            onMouseDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={option.value === active}
                className="appSelectOption"
                onMouseEnter={() => !option.disabled && setActive(option.value)}
                onClick={() => choose(option)}
                title={option.label}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
                    <path
                      d="m3 8 3 3 7-7"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>,
          trigger.current?.closest('[role="dialog"]') ?? document.body,
        )}
    </>
  );
}
