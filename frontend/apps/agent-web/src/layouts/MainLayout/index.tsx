import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Modal from '@/components/Modal';
import SkillCenter from '@/components/SkillCenter';
import type { MainLayoutOutletContext } from './types';
import './index.less';

export default function MainLayout() {
  const { pathname } = useLocation();
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);
  const outletContext = useMemo<MainLayoutOutletContext>(
    () => ({ selectedSkillIds, onSelectedSkillIdsChange: setSelectedSkillIds }),
    [selectedSkillIds],
  );

  return (
    <div className="mainLayout">
      <header className="topBar">
        <NavLink className="brandBlock" to="/documents">
          <span className="brandTitle">自动化测试助手</span>
        </NavLink>
        <nav className="mainNav" aria-label="主导航">
          <NavLink to="/documents">文档分析</NavLink>
          <NavLink to="/chat">对话工作台</NavLink>
          <NavLink to="/tasks">测试任务</NavLink>
          <NavLink to="/settings">设置</NavLink>
        </nav>
        <div className="topBarRight">
          <span className="prototypeBadge">本地工作区</span>
          <button
            className="skillMenuTrigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={skillModalOpen}
            onClick={() => setSkillModalOpen(true)}
          >
            <span aria-hidden="true">✦</span>
            <span>技能模板</span>
          </button>
        </div>
      </header>
      <div className="prototypeNotice" role="note">
        {pathname === '/chat' || pathname.startsWith('/tasks')
          ? '对话和测试任务仍为演示，刷新后清空。真实的文档读取和模型分析请使用「文档分析」。'
          : '文档与分析结果保存在本机。导入仅提取文字，点击分析后才调用你配置的模型。'}
      </div>
      <main className={`contentArea ${pathname !== '/chat' ? 'scrollable' : ''}`}>
        <Outlet context={outletContext} />
      </main>
      <Modal
        open={skillModalOpen}
        title="技能模板"
        description="预览技能列表和详情，后续可按需接入实际能力。"
        size="large"
        onClose={() => setSkillModalOpen(false)}
      >
        <SkillCenter />
      </Modal>
    </div>
  );
}
