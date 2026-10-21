import { useEffect, useRef, useState } from 'react';
import type { BrowserTabInfo } from '@project/shared-api';
import BrowserDataModal from '@/components/BrowserDataModal';
import './index.less';

export default function BuiltinBrowser({
  info,
  disabled = false,
  onOpenUrl,
}: {
  info: BrowserTabInfo;
  disabled?: boolean;
  onOpenUrl: (url: string) => Promise<void>;
}) {
  const [address, setAddress] = useState(info.url === 'about:blank' ? '' : info.url);
  const [error, setError] = useState('');
  const [library, setLibrary] = useState<'bookmarks' | 'passwords' | null>(null);
  const focused = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pageVisible = Boolean(info.url && info.url !== 'about:blank' && !info.error);
  useEffect(() => {
    if (!focused.current) setAddress(info.url === 'about:blank' ? '' : info.url);
  }, [info.url]);
  useEffect(() => {
    const api = window.desktop;
    if (!host.current || !api) return;
    let frame = 0,
      disposed = false;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !host.current) return;
        const rect = host.current.getBoundingClientRect();
        const top = Math.max(0, rect.top),
          bottom = Math.min(rect.bottom, window.innerHeight);
        const overlay = Boolean(document.querySelector('[role="dialog"], [role="menu"]'));
        void api
          .attachBrowser(
            info.id,
            !pageVisible || overlay || bottom <= top
              ? null
              : { x: rect.left, y: top, width: rect.width, height: bottom - top },
          )
          .catch(() => {});
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(host.current);
    // Dialogs and menus are body portals; keep native webpages behind these overlays.
    const mutations = new MutationObserver(update);
    mutations.observe(document.body, { childList: true });
    window.addEventListener('resize', update);
    update();
    const focusAddress = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', focusAddress);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('keydown', focusAddress);
      void api.attachBrowser(info.id, null).catch(() => {});
    };
  }, [info.id, pageVisible]);
  const operate = async (operation: () => Promise<void>) => {
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '浏览器操作失败。');
    }
  };
  return (
    <div className="builtinBrowser">
      <form
        className="browserToolbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) void operate(() => window.desktop!.loadBrowserUrl(info.id, address));
          input.current?.blur();
        }}
      >
        <button
          type="button"
          className="browserNavButton"
          aria-label="后退"
          title="后退"
          disabled={!info.canGoBack || disabled}
          onClick={() => void operate(() => window.desktop!.navigateBrowser(info.id, 'back'))}
        >
          ←
        </button>
        <button
          type="button"
          className="browserNavButton"
          aria-label="前进"
          title="前进"
          disabled={!info.canGoForward || disabled}
          onClick={() => void operate(() => window.desktop!.navigateBrowser(info.id, 'forward'))}
        >
          →
        </button>
        <button
          type="button"
          className="browserNavButton"
          aria-label={info.loading ? '停止加载' : '刷新'}
          title={info.loading ? '停止加载' : '刷新'}
          disabled={disabled}
          onClick={() =>
            void operate(() =>
              window.desktop!.navigateBrowser(info.id, info.loading ? 'stop' : 'reload'),
            )
          }
        >
          {info.loading ? '×' : '↻'}
        </button>
        <input
          className="browserAddress"
          ref={input}
          aria-label="网址"
          placeholder="输入网址"
          value={address}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setAddress(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
          }}
        />
        <button
          type="submit"
          className="browserNavButton go"
          aria-label="访问网址"
          disabled={disabled || !address.trim()}
        >
          前往
        </button>
        {disabled && <span className="browserRunning">任务执行中</span>}
        <button
          type="button"
          className="browserNavButton"
          aria-label="书签与导入"
          title="书签与导入"
          onClick={() => setLibrary('bookmarks')}
        >
          ☆
        </button>
        <button
          type="button"
          className="browserNavButton go"
          aria-label="已保存的密码"
          title="已保存的密码"
          onClick={() => setLibrary('passwords')}
        >
          密码
        </button>
      </form>
      {error && (
        <div className="browserError" role="alert">
          {error}
        </div>
      )}
      <div className="browserViewport" ref={host}>
        {!pageVisible && (
          <div className="browserEmpty">
            <span className="browserEmptyIcon" aria-hidden="true">
              ◎
            </span>
            <h2>{info.error ? '暂时无法打开网页' : '输入网址，开始浏览'}</h2>
            <p>{info.error || '直接在网页中登录，登录状态会保留在此客户端。'}</p>
          </div>
        )}
      </div>
      <BrowserDataModal
        open={Boolean(library)}
        initialKind={library || 'bookmarks'}
        current={info}
        disabled={disabled}
        onClose={() => setLibrary(null)}
        onOpenUrl={onOpenUrl}
      />
    </div>
  );
}
