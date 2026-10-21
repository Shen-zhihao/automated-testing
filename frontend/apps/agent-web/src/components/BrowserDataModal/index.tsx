import { useEffect, useState } from 'react';
import type {
  BrowserImportKind,
  BrowserImportResult,
  BrowserSavedData,
  BrowserTabInfo,
} from '@project/shared-api';
import Modal from '@/components/Modal';
import './index.less';

export function describeBrowserImport(result: BrowserImportResult) {
  return `${result.kind === 'bookmarks' ? '书签' : '密码'}导入完成：新增 ${result.imported} 条，重复 ${result.duplicates} 条，无效 ${result.skipped} 条。${result.kind === 'passwords' ? '密码已在本机加密保存。' : ''}`;
}

export default function BrowserDataModal({
  open,
  initialKind = 'bookmarks',
  current,
  disabled = false,
  onClose,
  onOpenUrl,
}: {
  open: boolean;
  initialKind?: BrowserImportKind;
  current?: BrowserTabInfo;
  disabled?: boolean;
  onClose: () => void;
  onOpenUrl: (url: string) => Promise<void>;
}) {
  const [data, setData] = useState<BrowserSavedData>({ bookmarks: [], passwords: [] });
  const [kind, setKind] = useState<BrowserImportKind>(initialKind);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [removeId, setRemoveId] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setKind(initialKind);
    setSearch('');
    setError('');
    setNotice('');
    setRemoveId('');
    void window.desktop
      ?.getBrowserData()
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError('读取浏览器资料失败，请重试。');
      });
    return () => {
      active = false;
    };
  }, [open, initialKind]);
  let origin = '';
  try {
    origin = new URL(current?.url || '').origin;
  } catch {
    /* blank tab */
  }
  const operate = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setData(await window.desktop!.getBrowserData());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  const importData = () =>
    void operate(async () => {
      const result = await window.desktop!.importBrowserData(kind);
      if (result) setNotice(describeBrowserImport(result));
    });
  const query = search.toLowerCase();
  const bookmarks = data.bookmarks.filter((entry) =>
    `${entry.title} ${entry.url} ${entry.folder}`.toLowerCase().includes(query),
  );
  const passwords = data.passwords
    .filter((entry) => `${entry.origin} ${entry.usernameLabel}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.origin === origin) - Number(a.origin === origin));
  const remove = (id: string) =>
    removeId === id
      ? void operate(async () => {
          await window.desktop!.removeBrowserData(kind, id);
          setRemoveId('');
          setNotice('已从本机浏览器移除。');
        })
      : setRemoveId(id);
  return (
    <Modal
      open={open}
      title="书签与密码"
      description="在客户端内使用你已有的浏览器资料。"
      size="large"
      dismissible={!busy}
      onClose={onClose}
    >
      <div className="browserDataManager">
        <div className="browserDataTabs" role="tablist" aria-label="浏览器资料">
          <button
            role="tab"
            aria-selected={kind === 'bookmarks'}
            onClick={() => {
              setKind('bookmarks');
              setRemoveId('');
              setSearch('');
            }}
            disabled={busy}
          >
            书签 <span>{data.bookmarks.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={kind === 'passwords'}
            onClick={() => {
              setKind('passwords');
              setRemoveId('');
              setSearch('');
            }}
            disabled={busy}
          >
            密码 <span>{data.passwords.length}</span>
          </button>
        </div>
        <div className="browserDataActions">
          <input
            aria-label={kind === 'bookmarks' ? '搜索书签' : '搜索密码网站'}
            placeholder={kind === 'bookmarks' ? '搜索标题、网址或文件夹' : '搜索网站或账号'}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="primary" disabled={busy} onClick={importData}>
            {busy ? '处理中…' : kind === 'bookmarks' ? '导入书签 HTML' : '导入密码 CSV'}
          </button>
        </div>
        {notice && (
          <p className="browserDataNotice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="browserDataError" role="alert">
            {error}
          </p>
        )}
        {kind === 'passwords' && (
          <p className="browserDataHint">
            密码默认隐藏。打开对应网站后，可点击「填入登录页」，再由你确认登录。
            {origin && origin !== 'null' ? ` 当前网站：${origin}` : ''}
          </p>
        )}
        <div className="browserDataList">
          {kind === 'bookmarks'
            ? bookmarks.map((entry) => (
                <div className="browserDataRow" key={entry.id}>
                  <span className="browserDataSymbol" aria-hidden="true">
                    ☆
                  </span>
                  <div className="browserDataText">
                    <strong>{entry.title}</strong>
                    <small>{entry.url}</small>
                    {entry.folder && <small>{entry.folder}</small>}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      onClose();
                      void onOpenUrl(entry.url);
                    }}
                  >
                    打开
                  </button>
                  <button
                    className="remove"
                    disabled={busy}
                    aria-label={`${removeId === entry.id ? '确认移除' : '移除'}书签 ${entry.title}`}
                    onClick={() => remove(entry.id)}
                  >
                    {removeId === entry.id ? '确认移除' : '移除'}
                  </button>
                </div>
              ))
            : passwords.map((entry) => (
                <div className="browserDataRow" key={entry.id}>
                  <span className="browserDataSymbol" aria-hidden="true">
                    ⚿
                  </span>
                  <div className="browserDataText">
                    <strong>
                      {entry.origin}
                      {entry.origin === origin && <em>当前网站</em>}
                    </strong>
                    <small>
                      {entry.usernameLabel} <span className="passwordMask">********</span>
                    </small>
                  </div>
                  {current && entry.origin === origin && (
                    <button
                      disabled={busy || disabled}
                      onClick={() =>
                        void operate(async () => {
                          await window.desktop!.fillBrowserPassword(current.id, entry.id);
                          setNotice('已填入登录页。关闭此窗口后，在网页中确认并登录。');
                        })
                      }
                    >
                      填入登录页
                    </button>
                  )}
                  <button
                    className="remove"
                    disabled={busy}
                    aria-label={`${removeId === entry.id ? '确认移除' : '移除'}密码 ${entry.origin} ${entry.usernameLabel}`}
                    onClick={() => remove(entry.id)}
                  >
                    {removeId === entry.id ? '确认移除' : '移除'}
                  </button>
                </div>
              ))}
          {!(kind === 'bookmarks' ? bookmarks.length : passwords.length) && (
            <div className="browserDataEmpty">
              {search
                ? '没有匹配的记录'
                : kind === 'bookmarks'
                  ? '导入书签后，可以直接在这里打开网站。'
                  : '导入密码后，在对应网站选择账号即可填入。'}
            </div>
          )}
        </div>
        <details className="browserImportHelp">
          <summary>支持的格式与导入说明</summary>
          <p>
            书签：浏览器导出的 HTML，保留标题和文件夹。密码：Chrome、Edge、Firefox、Safari 导出的
            CSV（网址、用户名、密码）。每个文件最多 10 MB / 10,000 条。
          </p>
          <p>
            重复书签按网址与文件夹跳过；同网站、同账号的密码保留已有值。需要更新时，先移除该条再重新导入。无效网址和记录会跳过并显示数量。
          </p>
          <p>
            密码文件只在本机处理，不进入对话或模型。CSV
            原文件包含明文密码，导入后请妥善保管或自行删除。此功能不导入通行密钥、验证码种子、Cookie
            或浏览历史。
          </p>
        </details>
      </div>
    </Modal>
  );
}
