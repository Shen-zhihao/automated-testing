import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BrowserTabInfo } from '@project/shared-api';
import BuiltinBrowser from '@/components/BuiltinBrowser';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useProjectId } from '@/hooks/useProject';
import './index.less';

type BrowserWorkspace = {
  tabs: BrowserTabInfo[];
  activeId: string | null;
  error: string;
  open: (options: { taskId?: string; url?: string }) => Promise<void>;
  select: (id: string | null) => void;
  hide: (id: string) => Promise<void>;
  clearError: () => void;
};
const Context = createContext<BrowserWorkspace | null>(null);
export function useBrowserWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('浏览器工作区尚未就绪。');
  return context;
}
export function BrowserWorkspaceProvider({ children }: { children: ReactNode }) {
  const projectId = useProjectId();
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const active = useRef<string | null>(null);
  const previous = useRef<BrowserTabInfo[]>([]);
  const request = useRef(0);
  const select = useCallback((id: string | null) => {
    active.current = id;
    setActiveId(id);
  }, []);
  const refresh = useCallback(async () => {
    if (!window.desktop) return;
    const revision = ++request.current;
    const next = (await window.desktop.getBrowserTabs()).filter(
      (tab) => tab.projectId === (projectId || null),
    );
    if (revision !== request.current) return;
    const popup = next.find(
      (tab) =>
        tab.parentId === active.current && !previous.current.some((old) => old.id === tab.id),
    );
    if (popup) select(popup.id);
    else if (active.current && !next.some((tab) => tab.id === active.current)) {
      const parentId = previous.current.find((tab) => tab.id === active.current)?.parentId;
      select(next.some((tab) => tab.id === parentId) ? parentId! : null);
    }
    if (JSON.stringify(previous.current) !== JSON.stringify(next)) {
      previous.current = next;
      setTabs(next);
    }
  }, [select, projectId]);
  useEffect(() => {
    select(null);
    setError('');
    previous.current = [];
    setTabs([]);
  }, [projectId, select]);
  useEffect(() => {
    const load = () => void refresh().catch(() => {});
    load();
    const unsubscribe = window.desktop?.onBrowserChanged(load);
    return () => {
      ++request.current;
      unsubscribe?.();
    };
  }, [refresh]);
  const open = async ({ taskId, url }: { taskId?: string; url?: string }) => {
    if (!window.desktop) {
      setError('请在桌面客户端中打开网页。');
      return;
    }
    setError('');
    try {
      const id = await window.desktop.openTestBrowser(taskId || 'standalone', {
        url,
        projectId: projectId || undefined,
      });
      if (currentProject.current !== projectId) return;
      await refresh();
      if (currentProject.current === projectId) select(id);
    } catch (cause) {
      if (currentProject.current === projectId)
        setError(cause instanceof Error ? cause.message : '网页打开失败。');
    }
  };
  const hide = async (id: string) => {
    try {
      await window.desktop?.hideBrowserTab(id);
      if (active.current === id) select(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法关闭标签。');
    }
  };
  return (
    <Context.Provider
      value={{
        tabs: tabs.filter((tab) => tab.projectId === projectId),
        activeId: tabs.some((tab) => tab.id === activeId && tab.projectId === projectId)
          ? activeId
          : null,
        error,
        open,
        select,
        hide,
        clearError: () => setError(''),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function BrowserTabs() {
  const browser = useBrowserWorkspace();
  if (!browser.tabs.length && !browser.error) return null;
  return (
    <>
      {browser.tabs.length > 0 && (
        <div className="workspaceTabs" role="tablist" aria-label="工作区与网页">
          <button
            className={`workspaceTab home ${!browser.activeId ? 'active' : ''}`}
            role="tab"
            aria-selected={!browser.activeId}
            onClick={() => browser.select(null)}
          >
            工作区
          </button>
          <div className="webTabList">
            {browser.tabs.map((tab) => (
              <div className={`webTab ${browser.activeId === tab.id ? 'active' : ''}`} key={tab.id}>
                <button
                  className="webTabSelect"
                  role="tab"
                  aria-selected={browser.activeId === tab.id}
                  title={tab.url}
                  onClick={() => browser.select(tab.id)}
                >
                  <span
                    aria-hidden="true"
                    className={tab.loading ? 'browserTabSpinner' : 'browserTabIcon'}
                  >
                    {tab.loading ? '' : '◎'}
                  </span>
                  <span>{tab.title || '新标签页'}</span>
                </button>
                <button
                  className="webTabClose"
                  aria-label={`关闭网页标签：${tab.title || '新标签页'}`}
                  title="关闭标签，任务继续执行"
                  onClick={() => void browser.hide(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            className="newWebTab"
            aria-label="新建网页标签"
            title="新建网页标签"
            onClick={() => void browser.open({})}
          >
            ＋
          </button>
        </div>
      )}
      {browser.error && (
        <div className="browserWorkspaceError" role="alert">
          {browser.error}
          <button onClick={browser.clearError} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
    </>
  );
}
export function BrowserPanel() {
  const { tabs, activeId, open } = useBrowserWorkspace();
  const { state } = useWorkspace();
  const tab = tabs.find((item) => item.id === activeId);
  if (!tab) return null;
  const running = state?.testJobs[`task:${tab.id}`]?.status === 'running';
  return (
    <section className="workspaceBrowserPanel" aria-label="当前网页">
      <BuiltinBrowser
        key={tab.id}
        info={tab}
        disabled={running}
        onOpenUrl={(url) => open({ url })}
      />
    </section>
  );
}
