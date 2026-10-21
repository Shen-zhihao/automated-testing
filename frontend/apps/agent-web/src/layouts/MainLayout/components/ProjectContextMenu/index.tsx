import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectSummary } from '@project/shared-api';
import Icon from '@/components/Icon';
import './index.less';

export interface ProjectMenuAnchor {
  projectId: string;
  x: number;
  y: number;
  trigger: HTMLElement;
}
export default function ProjectContextMenu({
  project,
  anchor,
  onClose,
  onDelete,
}: {
  project: ProjectSummary;
  anchor: ProjectMenuAnchor;
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
    action.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        close.current();
      } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        action.current?.focus();
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
  }, [anchor]);
  return createPortal(
    <div
      ref={menu}
      className="projectContextMenu"
      role="menu"
      aria-label={`工程「${project.name}」操作`}
      style={{ left: anchor.x, top: anchor.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="projectContextTitle" role="presentation">
        {project.name}
      </div>
      <button ref={action} type="button" role="menuitem" onClick={onDelete}>
        <Icon name="trash" size={16} />
        删除工程
      </button>
    </div>,
    document.body,
  );
}
