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
        <NavLink className="brandBlock" to="/chat">
          <span className="brandTitle">Test Agent</span>
        </NavLink>
        <nav className="mainNav" aria-label="主导航">
          <NavLink to="/chat">对话工作台</NavLink>
          <NavLink to="/tasks">测试任务</NavLink>
        </nav>
        <div className="topBarRight">
          <span className="prototypeBadge">本地原型</span>
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
        当前为 UI 原型，模型与测试执行器尚未接入。对话和任务草稿仅在当前页面保留，刷新后清空。
      </div>
      <main className={`contentArea ${pathname.startsWith('/tasks') ? 'scrollable' : ''}`}>
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
