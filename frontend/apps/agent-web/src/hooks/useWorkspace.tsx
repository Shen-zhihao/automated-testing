import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceSnapshot, ProjectSummary } from '@project/shared-api';
import { useMatch } from 'react-router-dom';

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
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!window.desktop) return;
    const current = ++revision.current;
    try {
      const snapshot = await window.desktop.snapshot(projectId);
      if (current === revision.current) {
        setState(snapshot);
        setError('');
      }
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : '无法读取本机工作区');
    }
  }, [projectId]);
  useEffect(() => {
    setError('');
    void refresh();
    const unsubscribe = window.desktop?.onChanged(() => void refresh());
    return () => {
      revision.current++;
      unsubscribe?.();
    };
  }, [refresh]);
  return (
    <WorkspaceContext.Provider
      value={{
        state: !projectId || state?.activeProjectId === projectId ? state : null,
        projects: state?.projects || [],
        error,
        refresh,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
