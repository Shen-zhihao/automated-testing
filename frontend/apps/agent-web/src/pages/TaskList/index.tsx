import { useProject } from '@/hooks/useProject';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/hooks/useWorkspace';
import Modal from '@/components/Modal';
import DesktopRequired from '@/components/DesktopRequired';
import TaskForm from './components/TaskForm';
import '../../styles/testing.less';

export default function TaskListPage() {
  const { projectPath } = useProject();
  const { state, error } = useWorkspace();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  if (!window.desktop) return <DesktopRequired />;
  if (!state) return <div className="testingPage">{error || '正在读取测试任务…'}</div>;
  const stage = (task: (typeof state.testTasks)[number]) =>
    state.testJobs[`task:${task.id}`]?.status === 'running'
      ? 'running'
      : !task.hasReport || task.reportStale
        ? 'design'
        : ['failed', 'partial', 'cancelled'].includes(task.lastRunStatus || '')
          ? 'attention'
          : task.lastRunStatus === 'passed'
            ? 'passed'
            : 'ready';
  const filters = [
    { id: 'all', name: '全部任务' },
    { id: 'design', name: '测试设计' },
    { id: 'ready', name: '待执行' },
    { id: 'running', name: '进行中' },
    { id: 'attention', name: '待关注' },
    { id: 'passed', name: '本次计划通过' },
  ];
  const tasks = state.testTasks.filter(
    (task) =>
      (filter === 'all' || stage(task) === filter) &&
      `${task.name} ${task.documentName} ${task.scope}`
        .toLowerCase()
        .includes(keyword.trim().toLowerCase()),
  );
  return (
    <div className="testingPage">
      <header className="testHeading">
        <div>
          <h1>测试验收</h1>
          <p>保存讨论结论，结合需求生成测试文档，并记录网页自动化执行结果。</p>
        </div>
        <div className="testActions">
          <button className="testButton primary" onClick={() => setCreating(true)}>
            ＋ 新建测试任务
          </button>
        </div>
      </header>
      <div className="taskFilters">
        {filters.map((item) => (
          <button
            key={item.id}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.name}
            <span>
              {
                state.testTasks.filter((task) => item.id === 'all' || stage(task) === item.id)
                  .length
              }
            </span>
          </button>
        ))}
      </div>
      <div className="testingForm">
        <label className="fullWidth">
          搜索任务
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索任务名称、需求文档或测试范围"
          />
        </label>
      </div>
      <div className="testList" style={{ marginTop: 20 }}>
        {tasks.map((task) => (
          <article className="testTaskRow" key={task.id}>
            <div>
              <h2>
                <Link to={`${projectPath('tasks')}/${task.id}`}>{task.name}</Link>
              </h2>
              <p>
                {task.documentName} · {task.scope}
              </p>
              <span className="testTag">{task.noteCount} 条讨论结论</span>
              <span className="testTag">
                {task.reportStale
                  ? '结论已更新，文档待重新生成'
                  : task.hasReport
                    ? '已有详细测试文档'
                    : '待生成测试文档'}
              </span>
              <span className="testTag">
                {filters.find((item) => item.id === stage(task))?.name}
              </span>
              <span className="testTag">{task.caseCount} 条用例</span>
            </div>
            <Link className="testButton" to={`${projectPath('tasks')}/${task.id}`}>
              进入任务 →
            </Link>
          </article>
        ))}
        {!tasks.length && (
          <div className="testCard">
            <h2>{keyword ? '没有匹配的任务' : '从需求与讨论建立测试任务'}</h2>
            <p>可以在需求分析中直接创建任务，也可以在对话回复下点击“保留到测试任务”。</p>
            <div className="testActions" style={{ marginTop: 15 }}>
              <Link className="testButton" to={projectPath('documents')}>
                需求分析
              </Link>
              <Link className="testButton" to={projectPath('chat')}>
                对话管理
              </Link>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={creating}
        title="新建测试任务"
        description="关联已分析的需求，任务与结果保存在本机。"
        onClose={() => setCreating(false)}
      >
        <TaskForm
          onCreated={(id) => {
            setCreating(false);
            navigate(`${projectPath('tasks')}/${id}`);
          }}
        />
      </Modal>
    </div>
  );
}
