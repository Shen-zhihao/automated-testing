import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceSnapshot } from '@project/shared-api';

const WorkspaceContext = createContext<{
  state: WorkspaceSnapshot | null;
  error: string;
  refresh: () => Promise<void>;
}>({ state: null, error: '', refresh: async () => {} });

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    if (!window.desktop) return;
    const current = ++revision.current;
    try {
      const snapshot = await window.desktop.snapshot();
      if (current === revision.current) {
        setState(snapshot);
        setError('');
      }
    } catch (cause) {
      if (current === revision.current)
        setError(cause instanceof Error ? cause.message : '无法读取本机工作区');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = window.desktop?.onChanged(() => void refresh());
    return () => {
      revision.current++;
      unsubscribe?.();
    };
  }, [refresh]);
  return (
    <WorkspaceContext.Provider value={{ state, error, refresh }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export const useWorkspace = () => useContext(WorkspaceContext);
