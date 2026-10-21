import { useMemo, useRef, useState } from 'react';
import type { AnalysisDraft as Draft } from '@project/shared-api';
import MarkdownContent from '@/components/MarkdownContent';
import Select from '@/components/Select';
import './index.less';

export default function AnalysisDraft({
  draft,
  running,
  appliedGoal,
}: {
  draft: Draft | null;
  running: boolean;
  appliedGoal?: string;
}) {
  const [previous, setPrevious] = useState(false);
  const [selected, setSelected] = useState('scope');
  const [follow, setFollow] = useState(true);
  const [notice, setNotice] = useState('');
  const latestSection = useRef<HTMLElement>(null);
  const viewing = previous && draft?.previous ? draft.previous : draft;
  const groups = useMemo(() => {
    const result = new Map<string, string>();
    for (const section of viewing?.sections ?? [])
      result.set(
        section.featureId,
        section.featureId === 'scope'
          ? '范围与功能清单'
          : `${section.featureId} ${section.featureName}`,
      );
    return result;
  }, [viewing]);
  const active =
    follow && !previous
      ? (viewing?.sections[viewing.sections.length - 1]?.featureId ?? 'scope')
      : groups.has(selected)
        ? selected
        : (groups.keys().next().value ?? 'scope');
  const sections = viewing?.sections.filter((section) => section.featureId === active) ?? [];
  const stale = Boolean(
    previous || (draft && appliedGoal !== undefined && appliedGoal !== draft.goal),
  );
  return (
    <section className="analysisDraft" aria-label="逐段生成的分析草稿">
      <div className="draftHeading">
        <div>
          <h3>{stale ? '上一版已生成内容' : '已生成内容'}</h3>
          <p>
            {viewing
              ? `已保存 ${viewing.completed} 段 · 功能清单 ${viewing.featureCount} 项`
              : '正在准备，生成的内容会逐段显示在这里。'}
          </p>
        </div>
        <span className="workPill">
          {stale ? '待按新要求更新' : running ? '生成中草稿' : '未完成草稿'}
        </span>
      </div>
      <p className="draftHint">
        {stale
          ? '以下保留上一版内容供核对，不代表已经满足新的补充要求。'
          : '可以先阅读或复制已生成部分；当前草稿尚未完成，所有验收项均待执行。'}
      </p>
      {viewing?.goal && <p className="draftGoal">本版补充要求：{viewing.goal}</p>}
      <div className="draftToolbar">
        <label className="draftPicker">
          查看内容
          <Select
            aria-label="查看已生成的功能"
            value={active}
            onChange={(value) => {
              setSelected(value);
              setFollow(false);
            }}
            disabled={!groups.size}
            placeholder="等待首段内容"
            options={[...groups].map(([value, label]) => ({ value, label }))}
          />
        </label>
        <button
          className="workButton subtle"
          disabled={!draft?.sections.length}
          onClick={() => {
            setPrevious(false);
            setSelected(draft?.sections[draft.sections.length - 1]?.featureId ?? 'scope');
            requestAnimationFrame(() =>
              latestSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
            );
          }}
        >
          查看最新内容
        </button>
        {draft?.previous && (
          <button
            className="workButton subtle"
            onClick={() => {
              setPrevious(!previous);
              setFollow(false);
            }}
          >
            {' '}
            {previous ? '返回当前版本' : '查看上一版'}{' '}
          </button>
        )}
        <button
          className="workButton"
          disabled={!viewing?.sections.length}
          onClick={() => {
            const content = `# 需求分析草稿（部分生成，尚未完成）\n\n${stale ? '> 上一版内容，待按新的补充要求更新。\n\n' : ''}${viewing?.goal ? `补充要求：${viewing.goal}\n\n` : ''}${viewing?.sections.map((section) => `## ${section.featureId === 'scope' ? '' : section.featureId + ' '}${section.featureName} ${section.title}\n\n> ${section.status === 'complete' ? '已生成，仍需核对' : '尚未完成或正在修正'}\n\n${section.content}`).join('\n\n')}`;
            void navigator.clipboard
              .writeText(content)
              .then(() => setNotice('已生成内容已复制。'))
              .catch(() => setNotice('复制失败，请重试。'));
          }}
        >
          复制已生成内容
        </button>
      </div>
      {running && (
        <label className="draftAutoSwitch">
          <input
            type="checkbox"
            checked={follow && !previous}
            onChange={(event) => {
              setFollow(event.target.checked);
              if (event.target.checked) setPrevious(false);
              else setSelected(active);
            }}
          />
          新内容生成时自动切换
        </label>
      )}
      {notice && (
        <p className="draftHint" role="status">
          {notice}
        </p>
      )}
      {!sections.length && (
        <p className="draftHint">
          {running ? '正在生成首段内容…' : '尚无可展示的正文，可继续生成。'}
        </p>
      )}
      {sections.map((section, index) => (
        <article
          className="draftSection"
          key={section.id}
          ref={index === sections.length - 1 ? latestSection : undefined}
        >
          <div className="draftSectionHeading">
            <h4>{section.title}</h4>
            <span>
              {section.status === 'complete'
                ? '已保存'
                : section.status === 'revising'
                  ? running && !stale
                    ? '正在修正，暂供参考'
                    : '待修正，暂供参考'
                  : running
                    ? '正在续写，待校验'
                    : '未完成，可继续'}
            </span>
          </div>
          <MarkdownContent>{section.content}</MarkdownContent>
        </article>
      ))}
    </section>
  );
}
