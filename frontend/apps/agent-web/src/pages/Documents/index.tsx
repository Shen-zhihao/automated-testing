import { useProject } from '@/hooks/useProject';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkspaceDocument, AnalysisDraft as Draft } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import DesktopRequired from '@/components/DesktopRequired';
import SourcePreview from './components/SourcePreview';
import AnalysisReport from './components/AnalysisReport';
import AnalysisDraft from './components/AnalysisDraft';
import './index.less';

export default function DocumentsPage() {
  const { api } = useProject();
  const [params, setParams] = useSearchParams();
  const { state, error: workspaceError, refresh } = useWorkspace();
  const requestedId = params.get('document');
  const activeId =
    state?.documents.find((item) => item.id === requestedId)?.id ?? state?.documents[0]?.id ?? '';
  const setActiveId = (id: string) => setParams(id ? { document: id } : {});
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<'analysis' | 'source'>('source');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const selected = state?.documents.find((item) => item.id === activeId);
  const job = state?.jobs[activeId];
  const loadedId = useRef('');
  const goalLoadedId = useRef('');
  const actionVersion = useRef(0);
  useEffect(() => {
    let disposed = false;
    const switched = loadedId.current !== activeId;
    if (switched) {
      loadedId.current = activeId;
      goalLoadedId.current = '';
      actionVersion.current++;
      setDocument(null);
      setDraft(null);
      setGoal('');
      setError('');
      setBusy('');
    }
    if (activeId)
      void api
        ?.getDocument(activeId)
        .then((value) => {
          if (!disposed) {
            loadedId.current = activeId;
            setDocument(value);
            if (goalLoadedId.current !== value.id) {
              goalLoadedId.current = value.id;
              setGoal(value.analysisDraft?.goal ?? value.analysis?.goal ?? '');
              setTab(value.analysis || value.analysisDraft ? 'analysis' : 'source');
            }
          }
        })
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : '文档读取失败');
        });
    return () => {
      disposed = true;
    };
  }, [api, activeId, selected?.updatedAt, job?.status]);
  useEffect(() => {
    let disposed = false;
    if (activeId)
      void api
        ?.getAnalysisDraft(activeId)
        .then((value) => {
          if (!disposed) setDraft(value);
        })
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : '草稿读取失败');
        });
    return () => {
      disposed = true;
    };
  }, [api, activeId, job?.revision, job?.status, selected?.updatedAt]);
  if (!api) return <DesktopRequired />;
  if (!state) return <div className="workEmpty">{workspaceError || '正在读取本机文档…'}</div>;
  const desktop = api;
  const running = job?.status === 'running';
  const importing = state.importing || busy === 'files' || busy === 'link';
  const modelName = state.settings.model.model.trim();
  const modelConfigured = Boolean(modelName);
  const modelSetupHint = state.settings.hasApiKey
    ? 'API Key 已保存，请补充模型名称。'
    : '配置模型后，即可分析文档。';
  const action = async (name: string, operation: () => Promise<void>) => {
    const version = ++actionVersion.current;
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await operation();
      if (version === actionVersion.current) await refresh();
    } catch (cause) {
      if (version === actionVersion.current)
        setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      if (version === actionVersion.current) setBusy('');
    }
  };
  const openFeishuImport = () => {
    setError('');
    setLinkOpen(true);
  };
  const importFiles = () =>
    void action('files', async () => {
      const result = await desktop.importFiles();
      if (result.imported.length) {
        await refresh();
        setActiveId(result.imported[0]);
        setNotice(`已导入 ${result.imported.length} 份文档。`);
      }
      if (result.errors.length)
        setError(result.errors.map((item) => `${item.name}：${item.message}`).join('\n'));
    });
  return (
    <div className="documentsPage workPage">
      <header className="workHeading">
        <div>
          <div className="workEyebrow">工程需求资料</div>
          <h1>需求分析</h1>
          <p>按功能拆分实现步骤和验收标准，预览并保存 Markdown 文档。</p>
        </div>
        <div className="headingActions">
          <button className="workButton" disabled={importing} onClick={openFeishuImport}>
            导入飞书链接
          </button>
          <button className="workButton primary" disabled={importing} onClick={importFiles}>
            {importing ? '正在导入…' : '＋ 导入本地文档'}
          </button>
        </div>
      </header>
      <p className="formatHint">
        支持 PDF、DOCX、XLSX、PPTX、TXT、Markdown、CSV、TSV、HTML、JSON · 每份最多 20 MB / 20 万字符
        · 扫描件需先 OCR
      </p>
      {(error || workspaceError) && (
        <div className="workAlert error" role="alert">
          {error || workspaceError}
        </div>
      )}
      {notice && (
        <div className="workAlert success" role="status">
          {notice}
        </div>
      )}
      <section className="documentDetail">
        {!activeId ? (
          <div className="documentWelcome">
            <div className="documentIllustration" aria-hidden="true">
              文
            </div>
            <h2>让需求变得清晰</h2>
            <p>
              选择一个文档，或粘贴飞书链接。
              <br />
              先核对原文，再生成逐项对应的功能实现步骤与验收标准。
            </p>
            <div className="welcomeSteps">
              <span>01 导入资料</span>
              <span className={modelConfigured ? 'complete' : undefined}>
                {modelConfigured ? '02 模型已配置' : '02 配置模型'}
              </span>
              <span>03 生成并保存文档</span>
            </div>
            <div className="welcomeNextStep">
              <p className="welcomeModelStatus" role="status">
                {modelConfigured ? `已配置模型：${modelName}` : modelSetupHint}
              </p>
              {modelConfigured ? (
                <div className="welcomeActions">
                  <button className="workButton primary" disabled={importing} onClick={importFiles}>
                    {importing ? '正在导入…' : '＋ 导入本地文档'}
                  </button>
                  <button className="workButton" disabled={importing} onClick={openFeishuImport}>
                    导入飞书链接
                  </button>
                </div>
              ) : (
                <Link className="workButton" to="/settings">
                  {state.settings.hasApiKey ? '补充模型名称' : '前往设置模型'}
                </Link>
              )}
            </div>
          </div>
        ) : !document || document.id !== activeId ? (
          <div className="workEmpty">正在打开文档…</div>
        ) : (
          <>
            <div className="documentDetailHeading">
              <div>
                <span className="workEyebrow">{document.kind.toUpperCase()} · 本地资料</span>
                <h2>{document.name}</h2>
                <p title={document.source}>{document.source}</p>
              </div>
              <button
                className="workButton subtle"
                disabled={running || Boolean(busy)}
                onClick={() => setDeleteOpen(true)}
              >
                移除
              </button>
            </div>
            {document.warnings.length > 0 && (
              <div className="documentWarnings" role="note">
                {document.warnings.map((warning, index) => (
                  <p key={index}>
                    {document.kind === 'feishu' &&
                    warning ===
                      '文档包含图片；点击分析时会识别图片文字与界面，对照正文去重后补充需求。'
                      ? '文档包含图片，尚未识别图片内文字；图片仅供本机预览，分析只使用提取的文档文字。'
                      : warning}
                  </p>
                ))}
              </div>
            )}
            <div className="analysisControls">
              <label htmlFor="analysis-goal">
                补充要求 <span>可选</span>
              </label>
              <textarea
                id="analysis-goal"
                placeholder={
                  ['html', 'htm'].includes(document.kind)
                    ? '例如：梳理完整流程、关键交互和失败恢复，给出可以自动化的测试场景'
                    : '例如：按前端交互和业务规则拆分，重点补充权限、异常分支及边界验收条件'
                }
                rows={2}
                maxLength={4000}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              />
              {running && (
                <p className="analysisScope">
                  可随时编辑补充要求，点击「应用补充要求」后生效。将按新要求重新生成，上一版内容保留查看。
                </p>
              )}
              <p className="analysisScope">
                {['html', 'htm'].includes(document.kind)
                  ? 'HTML 原型还会梳理完整流程、关键交互、错误处理与测试实施方向，并区分演示行为和真实能力。'
                  : '输出包含功能清单、实现步骤、验收标准、实施顺序与待确认问题；每项对应原文依据。'}
              </p>
              <div className="analysisActions">
                <div>
                  {modelConfigured ? (
                    <>
                      <strong>{modelName}</strong>
                      <small>分析时将文档文字发送至 {state.settings.model.baseUrl}</small>
                      <small>按功能分步生成，截断自动续写，中断后可继续。</small>
                    </>
                  ) : (
                    <Link to="/settings">{modelSetupHint} →</Link>
                  )}
                </div>
                {running ? (
                  <div className="analysisRunningActions">
                    {goal.trim() !==
                      (job.goal ?? draft?.goal ?? document.analysisDraft?.goal ?? '') && (
                      <button
                        className="workButton primary"
                        disabled={busy === 'revise'}
                        onClick={() => {
                          setTab('analysis');
                          void action('revise', () => desktop.reviseAnalysis(activeId, goal));
                        }}
                      >
                        {busy === 'revise' ? '正在应用…' : '应用补充要求'}
                      </button>
                    )}
                    <button
                      className="workButton"
                      onClick={() => void action('cancel', () => desktop.cancelAnalysis(activeId))}
                    >
                      取消生成
                    </button>
                  </div>
                ) : (
                  <button
                    className="workButton primary"
                    disabled={!modelConfigured || importing || Boolean(busy)}
                    onClick={() => {
                      setTab('analysis');
                      void action('analyze', async () => {
                        await desktop.analyze(activeId, goal);
                      });
                    }}
                  >
                    {document.analysisDraft?.goal === goal.trim()
                      ? '继续生成文档'
                      : document.analysis?.kind === 'implementation-plan'
                        ? '重新生成文档'
                        : '生成实施与验收文档'}
                  </button>
                )}
              </div>
              {job && (
                <div
                  className={`analysisProgress ${job.status}`}
                  role={job.status === 'error' ? 'alert' : 'status'}
                >
                  {running && <span className="activityDot" />}
                  {job.message}
                </div>
              )}
            </div>
            <div className="documentTabs" role="tablist" aria-label="文档视图">
              <button role="tab" aria-selected={tab === 'source'} onClick={() => setTab('source')}>
                提取原文
              </button>
              <button
                role="tab"
                aria-selected={tab === 'analysis'}
                onClick={() => setTab('analysis')}
              >
                实施与验收
              </button>
            </div>
            <div className="documentBody" role="tabpanel">
              {tab === 'source' ? (
                <>
                  <div className="sourceRefresh">
                    <span className="documentMeta">
                      {document.content.length.toLocaleString()} 字符 · 分析使用提取后的文字
                    </span>
                    <button
                      className="workButton subtle"
                      disabled={running || importing || Boolean(busy)}
                      onClick={() =>
                        void action('refresh-source', async () => {
                          const result = await desktop.refreshDocument(activeId);
                          setDocument(result.document);
                          setNotice(
                            result.contentChanged
                              ? '已重新提取，原文内容有变化，请重新分析。'
                              : '原文格式已更新，文字内容未变化。',
                          );
                        })
                      }
                    >
                      {busy === 'refresh-source' ? '正在重新提取…' : '重新提取格式'}
                    </button>
                  </div>
                  {!document.preview &&
                    !['txt', 'json', 'md', 'markdown'].includes(document.kind) && (
                      <p className="sourceFormatNotice">
                        当前为纯文字预览。飞书、Word、HTML
                        和表格文档可点击「重新提取格式」；需要原文件或可访问的飞书链接。PDF
                        和幻灯片暂保留文字与页码。
                      </p>
                    )}
                  <SourcePreview key={document.id} document={document} />
                </>
              ) : draft || running || document.analysis ? (
                <>
                  {(draft || running) && (
                    <AnalysisDraft
                      key={document.id}
                      draft={draft}
                      running={running}
                      appliedGoal={job?.goal ?? draft?.goal}
                    />
                  )}
                  {document.analysis &&
                    (draft || running ? (
                      <details className="previousAnalysis">
                        <summary>查看上次保存的完整报告</summary>
                        <AnalysisReport document={document} running={running} />
                      </details>
                    ) : (
                      <AnalysisReport
                        key={`${document.id}:${document.analysis.createdAt}`}
                        document={document}
                        running={running}
                      />
                    ))}
                </>
              ) : (
                <div className="resultEmpty">
                  <h3>
                    {running ? '正在拆分功能并编写验收标准…' : '将需求变成可实施、可验收的文档'}
                  </h3>
                  <p>点击「生成实施与验收文档」，按功能输出实现步骤与验收条件。</p>
                  <p>生成后支持格式预览、查看 Markdown 源码和保存为 .md 文件。</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <Modal
        open={linkOpen}
        title="导入飞书文档"
        description="请先在设置中配置飞书应用并测试连接，应用须拥有目标文档的阅读权限。"
        dismissible={!importing}
        onClose={() => setLinkOpen(false)}
        footer={
          <div className="modalImportActions">
            <button className="workButton" disabled={importing} onClick={() => setLinkOpen(false)}>
              取消
            </button>
            <button
              className="workButton primary"
              disabled={!url.trim() || importing}
              onClick={() =>
                void action('link', async () => {
                  const id = await desktop.importFeishu(url.trim());
                  await refresh();
                  setActiveId(id);
                  setLinkOpen(false);
                  setUrl('');
                  setNotice('飞书文档已保存到本机。');
                })
              }
            >
              {importing ? '正在读取…' : '读取并导入'}
            </button>
          </div>
        }
      >
        <div className="workPage">
          <label className="linkLabel" htmlFor="feishu-link">
            飞书链接
          </label>
          <input
            id="feishu-link"
            type="url"
            placeholder="https://你的企业.feishu.cn/docx/… 或 /wiki/…"
            value={url}
            disabled={importing}
            onChange={(event) => setUrl(event.target.value)}
          />
          <p className="linkHint">
            首次使用可前往
            <Link to="/settings" onClick={() => setLinkOpen(false)}>
              设置 → 飞书
            </Link>
            配置应用并测试连接。请确保该应用已获得文档或知识库的阅读权限。
          </p>
          {error && (
            <div className="workAlert error" role="alert">
              {error}
            </div>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={deleteOpen}
        title="移除文档"
        danger
        loading={busy === 'delete'}
        content="将移除本地文字、分析结果，以及关联的对话、测试任务和执行记录。原始文件和飞书文档保留，导出文件可在“文件与缓存”中清理。"
        confirmText="移除"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() =>
          void action('delete', async () => {
            await desktop.deleteDocument(activeId);
            setDeleteOpen(false);
            setActiveId('');
          })
        }
      />
    </div>
  );
}
