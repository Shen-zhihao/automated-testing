import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import ChatHomePage from '@/pages/ChatHome';
import TaskListPage from '@/pages/TaskList';
import TaskDetailPage from '@/pages/TaskDetail';
import DocumentsPage from '@/pages/Documents';
import SettingsPage from '@/pages/Settings';
import { WorkspaceProvider } from '@/hooks/useWorkspace';
import './App.less';

export default function App() {
  return (
    <WorkspaceProvider>
      <div className="appRoot">
        <div className="appContent">
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Navigate to="/documents" replace />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="chat" element={<ChatHomePage />} />
              <Route path="tasks" element={<TaskListPage />} />
              <Route path="tasks/:taskId" element={<TaskDetailPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
