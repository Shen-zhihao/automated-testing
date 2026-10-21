import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/Icon';
import './index.less';

export interface ContextMenuAnchor {
  x: number;
  y: number;
  trigger: HTMLElement;
}

export default function DeleteContextMenu({
  title,
  label,
  anchor,
  disabled = false,
  disabledReason,
  onClose,
  onDelete,
}: {
  title: string;
  label: string;
  anchor: ContextMenuAnchor;
  disabled?: boolean;
  disabledReason?: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null),
    action = useRef<HTMLButtonElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8))}px`;
    const focus = () => (disabled ? element : action.current)?.focus();
    focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        close.current();
      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        focus();
      }
    };
    const dismiss = () => close.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('blur', dismiss);
      if (anchor.trigger.isConnected) anchor.trigger.focus();
    };
  }, [anchor, disabled]);
  return createPortal(
    <div
      ref={menu}
      className="deleteContextMenu"
      role="menu"
      tabIndex={-1}
      aria-label={`${label}「${title}」操作`}
      style={{ left: anchor.x, top: anchor.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="deleteContextTitle" role="presentation">
        {title}
      </div>
      <button ref={action} type="button" role="menuitem" disabled={disabled} onClick={onDelete}>
        <Icon name="trash" size={16} />
        删除{label}
      </button>
      {disabledReason && <p className="deleteContextHint">{disabledReason}</p>}
    </div>,
    document.body,
  );
}
