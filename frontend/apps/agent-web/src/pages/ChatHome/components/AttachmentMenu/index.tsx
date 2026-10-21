import { useProject } from '@/hooks/useProject';
import { useEffect, useRef, useState } from 'react';
import BrowserDataModal, { describeBrowserImport } from '@/components/BrowserDataModal';
import { useBrowserWorkspace } from '@/components/BrowserWorkspace';
import type { BrowserImportKind } from '@project/shared-api';
import './index.less';

export default function AttachmentMenu({
  onNotice,
  onDocuments,
}: {
  onNotice: (message: string) => void;
  onDocuments: () => Promise<void>;
}) {
  const { api } = useProject();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState(false);
  const browser = useBrowserWorkspace();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const importAttachment = async (kind: BrowserImportKind | 'documents') => {
    setOpen(false);
    setBusy(true);
    onNotice(kind === 'passwords' ? '正在本机导入密码，文件不会发送给模型…' : '正在导入附件…');
    try {
      if (kind === 'documents') {
        const result = await api!.importFiles();
        onNotice(
          result.imported.length || result.errors.length
            ? `文档导入完成：成功 ${result.imported.length} 份${result.errors.length ? `，失败 ${result.errors.length} 份：${result.errors.map((item) => item.message).join('；')}` : ''}。可在需求分析中查看和分析。`
            : '已取消导入。',
        );
        await onDocuments();
      } else {
        const result = await window.desktop!.importBrowserData(kind);
        onNotice(result ? describeBrowserImport(result) : '已取消导入。');
      }
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : '附件导入失败，请重试。');
    } finally {
      setBusy(false);
      trigger.current?.focus();
    }
  };
  return (
    <div className="chatAttachment" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="attachmentTrigger"
        aria-label="添加附件"
        title="添加附件"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m21 11-8.6 8.6a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
        </svg>
      </button>
      {open && (
        <div className="attachmentOptions" aria-label="选择附件类型">
          <button type="button" onClick={() => void importAttachment('documents')}>
            <span>需求文档</span>
            <small>PDF、Word、HTML 等常用格式</small>
          </button>
          <button type="button" onClick={() => void importAttachment('bookmarks')}>
            <span>浏览器书签</span>
            <small>导入书签 HTML，保留文件夹</small>
          </button>
          <button type="button" onClick={() => void importAttachment('passwords')}>
            <span>浏览器密码</span>
            <small>导入密码 CSV · 仅在本机加密保存</small>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setLibrary(true);
            }}
          >
            <span>查看书签与密码</span>
            <small>打开网站，管理已导入的资料</small>
          </button>
        </div>
      )}
      <BrowserDataModal
        open={library}
        onClose={() => setLibrary(false)}
        onOpenUrl={(url) => browser.open({ url })}
      />
    </div>
  );
}
