import { useState } from 'react';
import type { Skill } from '@project/shared-api';
import { usePrototype } from '@/hooks/usePrototype';
import SkillDetail from './SkillDetail';
import './index.less';

export default function SkillCenter() {
  const { skills } = usePrototype();
  const [keyword, setKeyword] = useState('');
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const filteredSkills = skills.filter((skill) =>
    `${skill.displayName} ${skill.name} ${skill.description}`
      .toLowerCase()
      .includes(keyword.trim().toLowerCase()),
  );

  if (activeSkill) {
    return (
      <div className="skillPanel">
        <button className="skillZipBtn" onClick={() => setActiveSkill(null)}>
          ← 返回技能列表
        </button>
        <h3>{activeSkill.displayName}</h3>
        <SkillDetail skill={activeSkill} />
      </div>
    );
  }

  return (
    <div className="skillPanel">
      <label className="skillSearch">
        <input
          value={keyword}
          placeholder="搜索技能模板"
          aria-label="搜索技能模板"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </label>
      <div className="skillSummaryRow">
        <span>示例模板 {skills.length}</span>
      </div>
      <div className="skillList">
        {filteredSkills.length === 0 && <div className="skillEmpty">没有找到匹配的模板</div>}
        {filteredSkills.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className="skillItem"
            aria-label={`查看「${skill.displayName}」详情`}
            onClick={() => setActiveSkill(skill)}
          >
            <span className="skillIcon" aria-hidden="true">
              {skill.displayName.slice(0, 1)}
            </span>
            <span className="skillItemBody">
              <span className="skillNameRow">
                <strong>{skill.displayName}</strong>
                <span className="skillVersion">v{skill.version}</span>
              </span>
              <span className="skillDescription">{skill.description}</span>
              <span className="skillMeta">示例模板 · 未接入执行</span>
            </span>
            <span className="skillItemChevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
      <p className="skillHint">保留技能浏览与选择交互，上传和执行能力可在后续按需添加。</p>
    </div>
  );
}
