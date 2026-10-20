import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from '@/layouts/MainLayout';
import ChatHomePage from '@/pages/ChatHome';
import TaskListPage from '@/pages/TaskList';
import TaskDetailPage from '@/pages/TaskDetail';
import './App.less';

export default function App() {
  return (
    <div className="appRoot">
      <div className="appContent">
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<ChatHomePage />} />
            <Route path="tasks" element={<TaskListPage />} />
            <Route path="tasks/:taskId" element={<TaskDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </div>
    </div>
  );
}
