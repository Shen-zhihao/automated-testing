import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, Outlet } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import { WorkspaceProvider, useWorkspace } from '@/hooks/useWorkspace';
import './App.less';
import { useProject } from '@/hooks/useProject';
const ProjectsPage = lazy(() => import('@/pages/Projects'));
const OverviewPage = lazy(() => import('@/pages/ProjectOverview'));
const FilesPage = lazy(() => import('@/pages/ProjectFiles'));
const TerminalPage = lazy(() => import('@/pages/Terminal'));
function ProjectBoundary() {
  const { state, error } = useWorkspace(),
    { project } = useProject();
  if (!window.desktop) return <Outlet />;
  if (error)
    return (
      <div className="workAlert error">
        {error} <a href="#/projects">返回工程列表</a>
      </div>
    );
  if (!state) return <div className="workspaceLoading">正在打开工程…</div>;
  return project ? <Outlet /> : <Navigate to="/projects" replace />;
}

const DocumentsPage = lazy(() => import('@/pages/Documents'));
const ChatHomePage = lazy(() => import('@/pages/ChatHome'));
const TaskListPage = lazy(() => import('@/pages/TaskList'));
const TaskDetailPage = lazy(() => import('@/pages/TaskDetail'));
const SettingsPage = lazy(() => import('@/pages/Settings'));

export default function App() {
  return (
    <WorkspaceProvider>
      <div className="appRoot">
        <div className="appContent">
          <Suspense
            fallback={
              <div role="status" style={{ padding: 24 }}>
                正在打开工作区…
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<MainLayout />}>
                <Route index element={<Navigate to="/projects" replace />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="projects/:projectId" element={<ProjectBoundary />}>
                  <Route index element={<Navigate to="overview" replace />} />
                  <Route path="overview" element={<OverviewPage />} />
                  <Route path="documents" element={<DocumentsPage />} />
                  <Route path="chat" element={<ChatHomePage />} />
                  <Route path="tasks" element={<TaskListPage />} />
                  <Route path="tasks/:taskId" element={<TaskDetailPage />} />
                  <Route path="files" element={<FilesPage />} />
                  <Route path="terminal" element={<TerminalPage />} />
                </Route>
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </Suspense>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
