import { useMemo } from 'react';
import { useMatch } from 'react-router-dom';
import type { ProjectBridge } from '@project/shared-api';
import { useWorkspace } from './useWorkspace';

export function useProjectId() {
  return useMatch('/projects/:projectId/*')?.params.projectId || '';
}

export function useProject() {
  const projectId = useProjectId();
  const { projects } = useWorkspace();
  const api = useMemo(() => {
    const bridge = window.desktop?.project;
    if (!bridge || !projectId) return undefined;
    // Only the fixed project methods exposed by preload are bound here.
    return Object.fromEntries(
      Object.entries(bridge).map(([name, method]) => [
        name,
        (...args: unknown[]) => (method as (...input: unknown[]) => unknown)(projectId, ...args),
      ]),
    ) as unknown as ProjectBridge;
  }, [projectId]);
  return {
    projectId,
    project: projects.find((item) => item.id === projectId),
    api,
    projectPath: (section = 'overview') => `/projects/${encodeURIComponent(projectId)}/${section}`,
  };
}
