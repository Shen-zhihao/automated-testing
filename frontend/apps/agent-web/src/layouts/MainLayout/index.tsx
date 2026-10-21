import { lazy, Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Modal from '@/components/Modal';
import Icon, { type IconName } from '@/components/Icon';
import AppearanceSettings from '@/components/AppearanceSettings';
import ProjectDialog from '@/components/ProjectDialog';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useProject } from '@/hooks/useProject';
import {
  BrowserWorkspaceProvider,
  BrowserTabs,
  BrowserPanel,
  useBrowserWorkspace,
} from '@/components/BrowserWorkspace';
import './index.less';
const SkillCenter = lazy(() => import('@/components/SkillCenter'));
const sections: { path: string; label: string; icon: IconName }[] = [
  { path: 'overview', label: '工程概览', icon: 'overview' },
  { path: 'documents', label: '需求分析', icon: 'document' },
  { path: 'chat', label: '对话管理', icon: 'chat' },
  { path: 'tasks', label: '测试验收', icon: 'check' },
  { path: 'terminal', label: '命令执行', icon: 'terminal' },
  { path: 'files', label: '文件与缓存', icon: 'projects' },
];
export default function MainLayout() {
  return (
    <BrowserWorkspaceProvider>
      <MainLayoutContent />
    </BrowserWorkspaceProvider>
  );
}
function MainLayoutContent() {
  const browser = useBrowserWorkspace(),
    { state, projects } = useWorkspace();
  const { project, projectId, projectPath } = useProject();
  const { pathname } = useLocation(),
    navigate = useNavigate();
  const [skillOpen, setSkillOpen] = useState(false),
    [createOpen, setCreateOpen] = useState(false),
    [editOpen, setEditOpen] = useState(false);
  const [query, setQuery] = useState('');
  const section = sections.find((item) => pathname.split('/')[3] === item.path);
  return (
    <div className="mainLayout">
      <aside className="projectSidebar" aria-label="工程导航">
        <Link className="brandBlock" to="/projects" onClick={() => browser.select(null)}>
          <span className="brandMark">
            <Icon name="check" size={21} />
          </span>
          <div>
            <strong>测试助手</strong>
            <span>从需求到验收</span>
          </div>
        </Link>
        <button
          className="sidebarCreate"
          disabled={!window.desktop}
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="plus" />
          新建工程
        </button>
        <NavLink className="sidebarAll" to="/projects" end onClick={() => browser.select(null)}>
          <Icon name="overview" />
          全部工程<span>{projects.length}</span>
        </NavLink>
        <div className="sidebarLabel">我的工程</div>
        <label className="sidebarSearch">
          <Icon name="search" size={15} />
          <input
            aria-label="搜索工程"
            placeholder="搜索工程…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="sidebarProjectList">
          {projects
            .filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase()))
            .map((item, index) => (
              <div className="sidebarProjectGroup" key={item.id}>
                <Link
                  className={`sidebarProject ${item.id === projectId ? 'selected' : ''}`}
                  to={`/projects/${item.id}/overview`}
                  onClick={() => browser.select(null)}
                >
                  <span className={`projectDot tone${index % 4}`} />
                  <span>{item.name}</span>
                </Link>
                {item.id === projectId && (
                  <nav className="projectSectionNav" aria-label="当前工程功能">
                    {sections.map((item) => (
                      <NavLink
                        key={item.path}
                        to={projectPath(item.path)}
                        onClick={() => browser.select(null)}
                      >
                        <Icon name={item.icon} size={16} />
                        {item.label}
                      </NavLink>
                    ))}
                  </nav>
                )}
              </div>
            ))}
          {state && !state.projects.length && (
            <p className="sidebarEmpty">创建第一个工程，让资料和讨论有一个归属。</p>
          )}
        </div>
        <div className="sidebarFooter">
          <AppearanceSettings compact />
          <button onClick={() => setSkillOpen(true)}>
            <span aria-hidden="true">✦</span>技能模板
          </button>
          <NavLink to="/settings" onClick={() => browser.select(null)}>
            <Icon name="settings" size={17} />
            客户端设置
          </NavLink>
          <div className="localStatus">
            <i />
            本地工作区<span>Windows · macOS</span>
          </div>
        </div>
      </aside>
      <div className="projectMain">
        <header className="workspaceHeader">
          <div className="workspaceBreadcrumb">
            <Link to="/projects" onClick={() => browser.select(null)}>
              工作空间
            </Link>
            <span>/</span>
            {project ? (
              <>
                <Link to={projectPath()} onClick={() => browser.select(null)}>
                  {project.name}
                </Link>
                <span>/</span>
                <strong>{section?.label || '工程概览'}</strong>
              </>
            ) : (
              <strong>{pathname === '/settings' ? '客户端设置' : '全部工程'}</strong>
            )}
          </div>
          <div className="workspaceHeaderActions">
            {project && (
              <>
                <span className="projectStorageBadge">工程资料 · 本机保存</span>
                <button
                  title="编辑工程信息"
                  aria-label="编辑工程信息"
                  onClick={() => setEditOpen(true)}
                >
                  <Icon name="edit" size={16} />
                </button>
              </>
            )}
            <button
              disabled={!project}
              title="打开内置浏览器"
              aria-label="打开内置浏览器"
              onClick={() => void browser.open({})}
            >
              <Icon name="globe" size={18} />
            </button>
          </div>
        </header>
        <BrowserTabs />
        <main
          className={`contentArea ${section?.path === 'chat' ? 'chatContent' : 'scrollable'}`}
          style={browser.activeId ? { display: 'none' } : undefined}
        >
          <Suspense
            fallback={
              <div className="workspaceLoading" role="status">
                正在打开工作区…
              </div>
            }
          >
            <Outlet key={projectId || 'global'} />
          </Suspense>
        </main>
        <BrowserPanel />
      </div>
      <ProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={(id) => {
          browser.select(null);
          navigate(`/projects/${id}/overview`);
        }}
      />
      <ProjectDialog
        open={editOpen}
        project={project}
        onClose={() => setEditOpen(false)}
        onSaved={() => {}}
      />
      <Modal
        open={skillOpen}
        title="技能模板"
        description="查看可用于需求理解与测试工作的技能模板。"
        size="large"
        onClose={() => setSkillOpen(false)}
      >
        {skillOpen && (
          <Suspense fallback={<p>正在加载…</p>}>
            <SkillCenter />
          </Suspense>
        )}
      </Modal>
    </div>
  );
}
