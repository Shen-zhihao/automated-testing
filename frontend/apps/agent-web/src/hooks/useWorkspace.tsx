import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceSnapshot, ProjectSummary } from '@project/shared-api';
import { useMatch } from 'react-router-dom';
import { createRefreshQueue, type RefreshQueue } from '@/utils/refresh-queue.mjs';

const WorkspaceContext = createContext<{
  state: WorkspaceSnapshot | null;
  projects: ProjectSummary[];
  error: string;
  refresh: () => Promise<void>;
}>({ state: null, projects: [], error: '', refresh: async () => {} });

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const projectId = useMatch('/projects/:projectId/*')?.params.projectId;
  const [state, setState] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState('');
  const queue = useRef<RefreshQueue | null>(null);
  const refresh = useCallback(() => queue.current?.request() ?? Promise.resolve(), []);
  useEffect(() => {
    setError('');
    const bridge = window.desktop;
    if (!bridge) return;
    const current = createRefreshQueue(
      () => bridge.snapshot(projectId ?? null),
      (snapshot) => {
        setState(snapshot);
        setError('');
      },
      (cause) => setError(cause instanceof Error ? cause.message : '无法读取本机工作区'),
    );
    queue.current = current;
    void current.request();
    const unsubscribe = bridge.onChanged(() => void current.request());
    return () => {
      current.dispose();
      if (queue.current === current) queue.current = null;
      unsubscribe();
    };
  }, [projectId]);
  const value = useMemo(
    () => ({
      state: !projectId || state?.activeProjectId === projectId ? state : null,
      projects: state?.projects || [],
      error,
      refresh,
    }),
    [state, projectId, error, refresh],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceContext);
