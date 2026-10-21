import { Link } from 'react-router-dom';
import { useProject } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import Icon, { type IconName } from '@/components/Icon';
import '../Projects/index.less';
import './index.less';

export default function ProjectOverviewPage() {
  const { project, projectPath } = useProject(),
    { state, error } = useWorkspace();
  if (!project || !state) return <div className="workspaceLoading">{error || '正在打开工程…'}</div>;
  const stats: { label: string; value: number; note: string; icon: IconName; path: string }[] = [
    {
      label: '需求资料',
      value: state.documents.length,
      note: `${state.documents.filter((item) => item.analyzed).length} 份已完成分析`,
      icon: 'document',
      path: 'documents',
    },
    {
      label: '工程对话',
      value: state.testSessions.length,
      note: '保留每一轮需求讨论',
      icon: 'chat',
      path: 'chat',
    },
    {
      label: '验收任务',
      value: state.testTasks.length,
      note: `${state.testTasks.filter((item) => item.hasReport).length} 份测试文档已生成`,
      icon: 'check',
      path: 'tasks',
    },
    {
      label: '待关注任务',
      value: state.testTasks.filter((item) =>
        ['failed', 'partial', 'cancelled'].includes(item.lastRunStatus || ''),
      ).length,
      note: '最近执行有失败、未完成或取消',
      icon: 'overview',
      path: 'tasks',
    },
  ];
  return (
    <div className="projectOverview projectsPage">
      <header className="projectPageHeading">
        <div>
          <div className="projectEyebrow">工程概览</div>
          <h1>{project.name}</h1>
          <p>{project.description || '所有需求、讨论和测试结果，在这里形成完整的工程记录。'}</p>
        </div>
        <Link className="workButton primary" to={projectPath('documents')}>
          <Icon name="plus" size={16} />
          导入需求
        </Link>
      </header>
      <div className="projectStats">
        {stats.map((item) => (
          <Link to={projectPath(item.path)} key={item.label}>
            <div>
              <span>{item.label}</span>
              <Icon name={item.icon} size={18} />
            </div>
            <strong>{item.value}</strong>
            <p>{item.note}</p>
          </Link>
        ))}
      </div>
      <div className="overviewSectionHeading">
        <h2>继续你的工程</h2>
        <span>从理解需求，到确认结果</span>
      </div>
      <div className="projectSteps">
        {(
          [
            [
              'documents',
              'document',
              '01',
              '需求分析',
              '导入文档或 HTML 原型，拆分功能实现步骤与验收标准。',
              '管理需求资料',
            ],
            [
              'chat',
              'chat',
              '02',
              '对话管理',
              '结合需求持续讨论，将明确的结论保留为测试依据。',
              '进入工程对话',
            ],
            [
              'tasks',
              'check',
              '03',
              '测试验收',
              '生成详细测试文档，执行网页测试，核对实际结果。',
              '查看验收任务',
            ],
          ] as const
        ).map(([path, icon, no, title, desc, action]) => (
          <Link to={projectPath(path)} key={path}>
            <div className="stepTop">
              <span className="stepIcon">
                <Icon name={icon} size={22} />
              </span>
              <span>{no}</span>
            </div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <div className="stepAction">
              {action}
              <Icon name="arrow" size={16} />
            </div>
          </Link>
        ))}
      </div>
      <div className="overviewRecent">
        <section>
          <div className="overviewSectionHeading">
            <h2>最近的需求资料</h2>
            <Link to={projectPath('documents')}>查看全部 →</Link>
          </div>
          {state.documents.slice(0, 4).map((doc) => (
            <Link
              className="recentItem"
              to={`${projectPath('documents')}?document=${doc.id}`}
              key={doc.id}
            >
              <Icon name="document" size={17} />
              <div>
                <strong>{doc.name}</strong>
                <span>
                  {doc.kind.toUpperCase()} · {doc.analyzed ? '分析已完成' : '待分析'}
                </span>
              </div>
              <span className={`smallStatus ${doc.analyzed ? 'done' : ''}`}>
                {doc.analyzed ? '已分析' : '待分析'}
              </span>
            </Link>
          ))}
          {!state.documents.length && (
            <p className="overviewEmpty">从一份需求文档开始。导入后可预览原文并拆分功能。</p>
          )}
        </section>
        <section>
          <div className="overviewSectionHeading">
            <h2>最近的讨论</h2>
            <Link to={projectPath('chat')}>查看全部 →</Link>
          </div>
          {state.testSessions.slice(0, 4).map((chat) => (
            <Link
              className="recentItem"
              to={`${projectPath('chat')}?session=${chat.id}`}
              key={chat.id}
            >
              <Icon name="chat" size={17} />
              <div>
                <strong>{chat.title}</strong>
                <span>
                  {chat.featureId || '完整需求'} · {chat.taskId ? '已关联验收任务' : '讨论中'}
                </span>
              </div>
              <Icon name="arrow" size={15} />
            </Link>
          ))}
          {!state.testSessions.length && (
            <p className="overviewEmpty">分析需求后，围绕功能和验收条件开始讨论。</p>
          )}
        </section>
      </div>
      <div className="projectFootnote">
        <span>工程资料与上下文独立保存在本机。</span>
        <Link to={projectPath('files')}>管理文件与缓存 →</Link>
      </div>
    </div>
  );
}
