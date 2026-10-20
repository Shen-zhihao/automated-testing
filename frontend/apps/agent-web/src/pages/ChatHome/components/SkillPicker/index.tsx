import { useState } from 'react';
import { usePrototype } from '@/hooks/usePrototype';
import './index.less';

interface SkillPickerProps {
  selectedSkillIds: number[];
  onSelectionChange: (ids: number[]) => void;
  onSelect?: () => void;
}

export default function SkillPicker({
  selectedSkillIds,
  onSelectionChange,
  onSelect,
}: SkillPickerProps) {
  const { skills } = usePrototype();
  const [keyword, setKeyword] = useState('');
  const filtered = skills.filter((skill) =>
    `${skill.displayName} ${skill.name}`.toLowerCase().includes(keyword.trim().toLowerCase()),
  );
  return (
    <div className="skillPicker">
      <label className="skillPickerSearch">
        <input
          value={keyword}
          placeholder="搜索技能模板"
          aria-label="搜索技能模板"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </label>
      <div className="skillPickerSummary">
        <span>示例模板 {filtered.length}</span>
        <span>已选 {selectedSkillIds.length}</span>
      </div>
      <div className="skillPickerList">
        {filtered.map((skill) => {
          const selected = selectedSkillIds.includes(skill.id);
          return (
            <button
              key={skill.id}
              className={`skillPickerItem ${selected ? 'selected' : ''}`}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onSelectionChange(selected ? [] : [skill.id]);
                onSelect?.();
              }}
            >
              <span className="skillPickerIcon" aria-hidden="true">
                {skill.displayName.slice(0, 1)}
              </span>
              <span className="skillPickerBody">
                <span className="skillPickerNameRow">
                  <strong>{skill.displayName}</strong>
                  <span className="skillPickerVersion">v{skill.version}</span>
                </span>
                <span className="skillPickerDesc">{skill.description}</span>
              </span>
              <span className="skillPickerCheck" aria-hidden="true">
                {selected ? '✓' : ''}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && <div className="skillPickerEmpty">暂无匹配的模板</div>}
      </div>
      <p className="skillPickerHint">每次选择一个模板，仅影响演示消息中的选择回显。</p>
    </div>
  );
}
