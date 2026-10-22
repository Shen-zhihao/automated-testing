import { lazy, Suspense, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWorkspace } from '@/hooks/useWorkspace';
import Icon from '@/components/Icon';
import DesktopRequired from '@/components/DesktopRequired';
import './index.less';
const ProjectDialog = lazy(() => import('@/components/ProjectDialog'));

export default function ProjectsPage() {
  const { state, error } = useWorkspace(),
    navigate = useNavigate();
  const [creating, setCreating] = useState(false),
    [keyword, setKeyword] = useState('');
  if (!window.desktop) return <DesktopRequired />;
  if (!state) return <div className="workspaceLoading">{error || '正在读取工程…'}</div>;
  const projects = state.projects.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  );
  return (
    <div className="projectsPage">
      <header className="projectPageHeading">
        <div>
          <div className="projectEyebrow">你的本地工作空间</div>
          <h1>每个工程，都有完整的上下文。</h1>
          <p>把需求、讨论和验收留在一起，从一个清晰的目标开始。</p>
        </div>
        <button className="workButton primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} />
          新建工程
        </button>
      </header>
      <div className="projectJourney" aria-label="工程工作流程">
        {[
          ['01', '需求分析', '读懂文档，拆分功能与验收标准'],
          ['02', '对话管理', '结合上下文，逐步澄清实现细节'],
          ['03', '测试验收', '沉淀测试用例，记录实际验证结果'],
        ].map(([number, title, desc]) => (
          <div key={number}>
            <span>{number}</span>
            <div>
              <strong>{title}</strong>
              <p>{desc}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="projectCollectionHeading">
        <h2>
          全部工程 <span>{state.projects.length}</span>
        </h2>
        <label className="projectSearch">
          <Icon name="search" size={16} />
          <input
            aria-label="搜索工程名称或说明"
            placeholder="搜索工程名称或说明"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
      </div>
      <div className="projectCards">
        {projects.map((project, index) => (
          <Link key={project.id} className="projectCard" to={`/projects/${project.id}/overview`}>
            <div className="projectCardTop">
              <span className={`projectCardIcon tone${index % 4}`}>
                <Icon name="projects" size={23} />
              </span>
              <span className="projectLocalTag">本地工程</span>
            </div>
            <h3>{project.name}</h3>
            <p>{project.description || '添加需求文档，开始这个工程的第一轮分析。'}</p>
            <div className="projectCardCounts">
              <span>
                <b>{project.documentCount}</b> 需求
              </span>
              <span>
                <b>{project.chatCount}</b> 对话
              </span>
              <span>
                <b>{project.taskCount}</b> 验收任务
              </span>
            </div>
            <div className="projectCardBottom">
              <span>创建于 {new Date(project.createdAt).toLocaleDateString('zh-CN')}</span>
              <Icon name="arrow" size={17} />
            </div>
          </Link>
        ))}
      </div>
      {!projects.length && (
        <div className="projectBlank">
          <Icon name="projects" size={32} />
          <h2>{keyword ? '没有匹配的工程' : '创建你的第一个工程'}</h2>
          <p>{keyword ? '试试其他关键词。' : '每个工程拥有独立的需求资料、对话记录和测试结果。'}</p>
          {!keyword && (
            <button className="workButton primary" onClick={() => setCreating(true)}>
              新建工程
            </button>
          )}
        </div>
      )}
      {creating && (
        <Suspense fallback={null}>
          <ProjectDialog
            open={creating}
            onClose={() => setCreating(false)}
            onSaved={(id) => navigate(`/projects/${id}/overview`)}
          />
        </Suspense>
      )}
    </div>
  );
}
