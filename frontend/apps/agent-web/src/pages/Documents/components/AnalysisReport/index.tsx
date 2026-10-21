import { useProject } from '@/hooks/useProject';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkspaceDocument, RequirementFeature } from '@project/shared-api';
import MarkdownContent from '@/components/MarkdownContent';
import Select from '@/components/Select';
import './index.less';

export default function AnalysisReport({
  document,
  running,
}: {
  document: WorkspaceDocument;
  running: boolean;
}) {
  const { api, projectPath } = useProject();
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [features, setFeatures] = useState<RequirementFeature[]>([]);
  const [featureId, setFeatureId] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    setFeatures([]);
    setFeatureId('');
    void api
      ?.testingFeatures(document.id)
      .then((value) => {
        if (active) setFeatures(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [document.id, document.analysis?.content]);
  const analysis = document.analysis!;
  const run = async (name: string, operation: () => Promise<string>) => {
    setBusy(name);
    setNotice('');
    setError('');
    try {
      setNotice(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="analysisReport" aria-label="生成的 Markdown 文档">
      <div className="reportHeading">
        <div>
          <h3>
            {analysis.kind === 'implementation-plan' ? '功能实现步骤与验收标准' : '历史分析结果'}
          </h3>
          <p>
            {new Date(analysis.createdAt).toLocaleString('zh-CN')} · {analysis.model} · 已保存在本机
          </p>
        </div>
        <span className="workPill">Markdown</span>
      </div>
      <div className="reportToolbar">
        <div className="reportViews" role="group" aria-label="Markdown 显示方式">
          <button aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
            预览
          </button>
          <button aria-pressed={view === 'source'} onClick={() => setView('source')}>
            Markdown 源码
          </button>
        </div>
        <div className="reportActions">
          <button
            className="workButton subtle"
            disabled={Boolean(busy) || running}
            onClick={() =>
              void run('copy', async () => {
                await navigator.clipboard.writeText(analysis.content);
                return 'Markdown 已复制。';
              })
            }
          >
            复制 Markdown
          </button>
          <button
            className="workButton"
            disabled={Boolean(busy) || running}
            onClick={() =>
              void run('save', async () => {
                const file = await api!.exportAnalysis(document.id);
                return file ? `Markdown 已保存至：${file}` : '';
              })
            }
          >
            {busy === 'save' ? '正在保存…' : '保存为 .md'}
          </button>
        </div>
      </div>
      <div className="testActions" style={{ margin: '12px 0 20px' }}>
        <label className="testMuted">
          讨论或测试范围{' '}
          <Select
            aria-label="分析功能范围"
            value={featureId}
            onChange={setFeatureId}
            options={[
              { value: '', label: '整份需求' },
              ...features.map((feature) => ({
                value: feature.id,
                label: `${feature.id} ${feature.title}`,
              })),
            ]}
          />
        </label>
        <button
          className="workButton"
          disabled={running || Boolean(busy)}
          onClick={() =>
            navigate(
              `${projectPath('chat')}?${new URLSearchParams({ document: document.id, feature: featureId })}`,
            )
          }
        >
          在工作台讨论
        </button>
        <button
          className="workButton"
          disabled={running || Boolean(busy)}
          onClick={() =>
            void run('task', async () => {
              const task = await api!.createTestTask({
                documentId: document.id,
                featureId,
              });
              navigate(`${projectPath('tasks')}/${task.id}`);
              return '';
            })
          }
        >
          创建测试任务
        </button>
      </div>
      {error && (
        <div className="workAlert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="workAlert success" role="status">
          {notice}
        </div>
      )}
      {running && <p className="documentMeta">正在重新生成，以下为上次保存的结果。</p>}
      {analysis.kind !== 'implementation-plan' && (
        <p className="documentMeta">
          这是之前保存的分析。点击「生成实施与验收文档」可按新的格式重新拆分需求。
        </p>
      )}
      {view === 'preview' ? (
        <MarkdownContent>{analysis.content}</MarkdownContent>
      ) : (
        <pre className="reportSource" tabIndex={0} aria-label="Markdown 源码">
          {analysis.content}
        </pre>
      )}
    </section>
  );
}
