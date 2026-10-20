import { useRef, type ReactNode } from 'react';
import Modal from '../Modal';
import './index.less';

/**
 * 通用确认弹窗（简洁风格，与网站整体一致）。
 *
 * 用法：通过 open 控制显示；onConfirm/onCancel 处理确认/取消；
 * danger 用于危险操作（确认按钮为红色）；loading 用于提交中的禁用/文案。
 * 打开时自动聚焦「取消」按钮，避免误触回车确认；Esc 关闭。
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 弹窗正文，可为 ReactNode（如带提醒样式的富文本） */
  content?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮为红色 */
  danger?: boolean;
  /** 确认中：禁用按钮并显示处理中文案 */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  content,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      title={title}
      size="small"
      dismissible={!loading}
      initialFocusRef={cancelRef}
      onClose={onCancel}
      footer={
        <div className="confirmActions">
          <button
            ref={cancelRef}
            type="button"
            className="btn cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? '处理中...' : confirmText}
          </button>
        </div>
      }
    >
      {content && <div className="confirmContent">{content}</div>}
    </Modal>
  );
}

export default ConfirmDialog;
