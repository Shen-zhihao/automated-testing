import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TaskKind } from '@project/shared-api';
import Modal from '@/components/Modal';
import { usePrototype } from '@/hooks/usePrototype';
import { taskKindLabels } from '@/utils/tasks';
import TaskForm from './components/TaskForm';
import './index.less';

export default function TaskListPage() {
  const { tasks } = usePrototype();
  const navigate = useNavigate();
  const [kind, setKind] = useState<TaskKind | ''>('');
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);
  const filtered = tasks.filter(
    (task) =>
      (!kind || task.kind === kind) &&
      `${task.name} ${task.target}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  );

  return (
    <div className="taskListPage">
      <div className="pageHeader">
        <h1 className="pageTitle">测试任务</h1>
        <button className="primaryBtn" onClick={() => setCreating(true)}>
          + 新建任务
        </button>
      </div>
      <p className="pageDescription">先记录测试目标与类型。当前仅创建本地草稿，不会发起测试。</p>
      <div className="filterBar">
        <select
          className="filterSelect"
          aria-label="任务类型筛选"
          value={kind}
          onChange={(event) => setKind(event.target.value as TaskKind | '')}
        >
          <option value="">全部类型</option>
          {Object.entries(taskKindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          className="searchInput"
          aria-label="搜索任务"
          placeholder="搜索任务名称或测试目标"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>
      <div className="tableCard">
        <table className="dataTable">
          <thead>
            <tr>
              <th>任务名称</th>
              <th>类型</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.id}>
                <td>
                  <Link className="nameCell" to={`/tasks/${task.id}`}>
                    {task.name}
                  </Link>
                </td>
                <td>{taskKindLabels[task.kind]}</td>
                <td>
                  <span className="statusTag statusPending">草稿 · 未执行</span>
                </td>
                <td>{new Date(task.createdAt).toLocaleString('zh-CN')}</td>
                <td>
                  <Link className="linkBtn" to={`/tasks/${task.id}`}>
                    详情
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="emptyRow">
                  {tasks.length ? '没有匹配的任务' : '暂无任务，创建第一个测试草稿。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal
        open={creating}
        title="新建测试任务"
        description="草稿仅在当前页面保留，刷新后清空。"
        onClose={() => setCreating(false)}
      >
        <TaskForm
          onCreated={(id) => {
            setCreating(false);
            navigate(`/tasks/${id}`);
          }}
        />
      </Modal>
    </div>
  );
}
