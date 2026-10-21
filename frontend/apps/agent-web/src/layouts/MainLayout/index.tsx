import { Fragment, lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Modal from '@/components/Modal';
import Icon, { type IconName } from '@/components/Icon';
import BrandLogo from '@/components/BrandLogo';
import { APP_NAME, APP_TAGLINE } from '@/brand';
import ProjectDialog from '@/components/ProjectDialog';
import DeleteProjectDialog from '@/components/DeleteProjectDialog';
import ProjectContextMenu, { type ProjectMenuAnchor } from './components/ProjectContextMenu';
import DocumentLibrary from './components/DocumentLibrary';
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
const sidebarPreference = 'test-agent-sidebar-collapsed';
function readSidebarPreference() {
  try {
    return localStorage.getItem(sidebarPreference) === 'true';
  } catch {
    return false;
  }
}
const sections: { path: string; label: string; icon: IconName }[] = [
  { path: 'overview', label: '工程概览', icon: 'overview' },
  { path: 'documents', label: '需求分析', icon: 'document' },
  { path: 'chat', label: '对话管理', icon: 'chat' },
  { path: 'tasks', label: '测试验收', icon: 'check' },
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
  const [collapsed, setCollapsed] = useState(readSidebarPreference),
    [projectMenu, setProjectMenu] = useState<ProjectMenuAnchor | null>(null),
    [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(sidebarPreference, String(collapsed));
    } catch {
      // The navigation still works when local preferences cannot be saved.
    }
  }, [collapsed]);
  useEffect(() => setProjectMenu(null), [pathname]);
  const menuProject = projects.find((item) => item.id === projectMenu?.projectId),
    deletingProject = projects.find((item) => item.id === deleteProjectId);
  const section = sections.find((item) => pathname.split('/')[3] === item.path);
  return (
    <div className={`mainLayout ${collapsed ? 'sidebarCollapsed' : ''}`}>
      <aside id="project-sidebar" className="projectSidebar" aria-label="工程导航">
        <div className="sidebarTop">
          <Link
            className="brandBlock"
            to="/projects"
            aria-label={`${APP_NAME}，${APP_TAGLINE}`}
            title={collapsed ? APP_NAME : undefined}
            onClick={() => browser.select(null)}
          >
            <span className="brandMark">
              <BrandLogo size={40} />
            </span>
            <div className="brandCopy">
              <strong>{APP_NAME}</strong>
              <span>{APP_TAGLINE}</span>
            </div>
          </Link>
          <button
            className="sidebarToggle"
            type="button"
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
            aria-expanded={!collapsed}
            aria-controls="project-sidebar"
            onClick={() => {
              setProjectMenu(null);
              setCollapsed((value) => !value);
            }}
          >
            <Icon name={collapsed ? 'sidebarExpand' : 'sidebarCollapse'} size={18} />
          </button>
        </div>
        <button
          className="sidebarCreate"
          aria-label="新建工程"
          title={collapsed ? '新建工程' : undefined}
          disabled={!window.desktop}
          onClick={() => setCreateOpen(true)}
        >
          <Icon name="plus" />
          <span className="sidebarText">新建工程</span>
        </button>
        <NavLink
          className="sidebarAll"
          to="/projects"
          end
          aria-label={`全部工程（${projects.length}）`}
          title={collapsed ? `全部工程（${projects.length}）` : undefined}
          onClick={() => browser.select(null)}
        >
          <Icon name="overview" />
          <span className="sidebarText">全部工程</span>
          <span className="sidebarCount">{projects.length}</span>
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
            .filter(
              (item) => collapsed || item.name.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .map((item, index) => (
              <div className="sidebarProjectGroup" key={item.id}>
                <Link
                  className={`sidebarProject ${item.id === projectId ? 'selected' : ''}`}
                  to={`/projects/${item.id}/overview`}
                  aria-label={item.name}
                  title={`${item.name} · 右键管理工程`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenu?.projectId === item.id}
                  onClick={() => browser.select(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.currentTarget.focus();
                    setProjectMenu({
                      projectId: item.id,
                      x: event.clientX,
                      y: event.clientY,
                      trigger: event.currentTarget,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                      return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setProjectMenu({
                      projectId: item.id,
                      x: rect.left + 12,
                      y: rect.bottom,
                      trigger: event.currentTarget,
                    });
                  }}
                >
                  <span className={`projectDot tone${index % 4}`} aria-hidden="true">
                    <span className="projectInitial">{Array.from(item.name)[0]}</span>
                  </span>
                  <span className="sidebarText">{item.name}</span>
                </Link>
                {item.id === projectId && (
                  <nav className="projectSectionNav" aria-label="当前工程功能">
                    {sections.map((item) => (
                      <Fragment key={item.path}>
                        <NavLink
                          to={projectPath(item.path)}
                          aria-label={item.label}
                          title={collapsed ? item.label : undefined}
                          onClick={() => browser.select(null)}
                        >
                          <Icon name={item.icon} size={16} />
                          <span className="sidebarText">{item.label}</span>
                        </NavLink>
                        {item.path === 'documents' && section?.path === 'documents' && (
                          <DocumentLibrary onSelect={() => browser.select(null)} />
                        )}
                      </Fragment>
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
          <button
            aria-label="技能模板"
            title={collapsed ? '技能模板' : undefined}
            onClick={() => setSkillOpen(true)}
          >
            <span aria-hidden="true">✦</span>
            <span className="sidebarText">技能模板</span>
          </button>
          <NavLink
            to="/settings"
            aria-label="客户端设置"
            title={collapsed ? '客户端设置' : undefined}
            onClick={() => browser.select(null)}
          >
            <Icon name="settings" size={17} />
            <span className="sidebarText">客户端设置</span>
          </NavLink>
          <div className="localStatus">
            <i />
            本地工作区
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
      {projectMenu && menuProject && (
        <ProjectContextMenu
          anchor={projectMenu}
          project={menuProject}
          onClose={() => setProjectMenu(null)}
          onDelete={() => {
            setDeleteProjectId(menuProject.id);
            setProjectMenu(null);
          }}
        />
      )}
      {deletingProject && (
        <DeleteProjectDialog
          key={deletingProject.id}
          project={deletingProject}
          onClose={() => setDeleteProjectId(null)}
        />
      )}
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
