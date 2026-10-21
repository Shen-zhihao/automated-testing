import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './index.less';

type ModalSize = 'small' | 'medium' | 'large';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/** 通用模态弹窗：统一处理 Portal、焦点、Esc、遮罩关闭和页面滚动锁定。 */
function Modal({
  open,
  title,
  description,
  children,
  footer,
  size = 'medium',
  dismissible = true,
  initialFocusRef,
  onClose,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const modalCardRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      const focusTarget =
        initialFocusRef?.current ?? closeButtonRef.current ?? modalCardRef.current;
      focusTarget?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('.modalCard');
      if (dialogs[dialogs.length - 1] !== modalCardRef.current) return;
      if (event.key === 'Escape' && dismissible) {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !modalCardRef.current) {
        return;
      }

      const focusableElements = Array.from(
        modalCardRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) {
        event.preventDefault();
        modalCardRef.current.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElementRef.current?.focus();
    };
  }, [dismissible, initialFocusRef, open]);

  if (!open) {
    return null;
  }

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissible && event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div className="modalOverlay" onMouseDown={handleBackdropMouseDown}>
      <section
        ref={modalCardRef}
        className={`modalCard modalCard-${size}`}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="modalHeader">
          <div className="modalHeading">
            <h2 id={titleId} className="modalTitle">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="modalDescription">
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            className="modalCloseButton"
            type="button"
            disabled={!dismissible}
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m6 6 12 12" />
              <path d="m18 6-12 12" />
            </svg>
          </button>
        </header>
        <div className="modalBody">{children}</div>
        {footer && <footer className="modalFooter">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}

export default Modal;
