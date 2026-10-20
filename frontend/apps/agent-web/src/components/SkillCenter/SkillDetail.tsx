import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Skill } from '@project/shared-api';
import './index.less';

export default function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <div className="skillDetail">
      <p className="skillDetailDesc">{skill.description}</p>
      <dl className="skillDetailGrid">
        <div className="skillDetailRow">
          <dt>标识</dt>
          <dd>{skill.name}</dd>
        </div>
        <div className="skillDetailRow">
          <dt>版本</dt>
          <dd>v{skill.version}</dd>
        </div>
        <div className="skillDetailRow">
          <dt>状态</dt>
          <dd>示例模板，未接入执行</dd>
        </div>
      </dl>
      <div className="skillDetailMarkdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.instructions}</ReactMarkdown>
      </div>
    </div>
  );
}
