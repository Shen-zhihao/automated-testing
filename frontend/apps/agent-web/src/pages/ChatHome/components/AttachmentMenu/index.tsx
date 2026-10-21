import { useProject } from '@/hooks/useProject';
import { useEffect, useRef, useState } from 'react';
import BrowserDataModal, { describeBrowserImport } from '@/components/BrowserDataModal';
import { useBrowserWorkspace } from '@/components/BrowserWorkspace';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import type { BrowserImportKind, DocumentSummary } from '@project/shared-api';
import './index.less';

export default function AttachmentMenu({
  onNotice,
  onDocuments,
  documents,
  selected,
  onSelect,
  disabled,
}: {
  onNotice: (message: string) => void;
  onDocuments: () => Promise<void>;
  documents: DocumentSummary[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  disabled: boolean;
}) {
  const { api } = useProject();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState(false);
  const [picker, setPicker] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState('');
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
        const ids = [...new Set([...selected, ...result.imported])];
        if (ids.length <= 5) onSelect(ids);
        else {
          setDraft(selected);
          setPicker(true);
        }
        onNotice(
          result.imported.length || result.errors.length
            ? `文档导入完成：成功 ${result.imported.length} 份${result.errors.length ? `，失败 ${result.errors.length} 份：${result.errors.map((item) => item.message).join('；')}` : ''}。${ids.length <= 5 ? '已选中导入的文档，发送消息时引用。' : '每轮最多引用 5 份，请选择本轮需要的文档。'}`
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
        disabled={busy || disabled}
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
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDraft(selected);
              setQuery('');
              setPicker(true);
            }}
          >
            <span>引用工程文档</span>
            <small>选择已导入的资料，可多选</small>
          </button>
          <button type="button" onClick={() => void importAttachment('documents')}>
            <span>导入并引用文档</span>
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
      <Modal
        open={picker}
        title="引用工程文档"
        description="选择本轮需要的资料，发送消息时引用；每轮最多 5 份。"
        onClose={() => setPicker(false)}
        footer={
          <>
            <button className="workButton" onClick={() => setPicker(false)}>
              取消
            </button>
            <button
              className="workButton primary"
              onClick={() => {
                onSelect(draft);
                setPicker(false);
              }}
            >
              {draft.length ? `引用所选文档（${draft.length}）` : '不引用文档'}
            </button>
          </>
        }
      >
        <div className="chatDocumentPicker">
          <input
            aria-label="搜索引用文档"
            placeholder="搜索工程文档…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="referenceDocumentList">
            {documents
              .filter((doc) => doc.name.toLowerCase().includes(query.trim().toLowerCase()))
              .map((doc) => (
                <label key={doc.id}>
                  <input
                    type="checkbox"
                    checked={draft.includes(doc.id)}
                    disabled={!draft.includes(doc.id) && draft.length >= 5}
                    onChange={(event) =>
                      setDraft((ids) =>
                        event.target.checked ? [...ids, doc.id] : ids.filter((id) => id !== doc.id),
                      )
                    }
                  />
                  <Icon name="document" size={18} />
                  <span>
                    <strong>{doc.name}</strong>
                    <small>{doc.analyzed ? '原文与分析结果' : '已提取原文'}</small>
                  </span>
                </label>
              ))}
            {!documents.length && <p>还没有工程文档，可从附件菜单导入并引用。</p>}
            {documents.length > 0 &&
              !documents.some((doc) =>
                doc.name.toLowerCase().includes(query.trim().toLowerCase()),
              ) && <p>没有找到匹配的文档。</p>}
          </div>
        </div>
      </Modal>
      <BrowserDataModal
        open={library}
        onClose={() => setLibrary(false)}
        onOpenUrl={(url) => browser.open({ url })}
      />
    </div>
  );
}
