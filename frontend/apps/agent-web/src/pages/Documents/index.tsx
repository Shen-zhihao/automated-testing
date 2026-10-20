import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspaceDocument } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import Modal from '@/components/Modal';
import ConfirmDialog from '@/components/ConfirmDialog';
import DesktopRequired from '@/components/DesktopRequired';
import MarkdownContent from '@/components/MarkdownContent';
import './index.less';

export default function DocumentsPage() {
  const { state, error: workspaceError, refresh } = useWorkspace();
  const [activeId, setActiveId] = useState('');
  const [document, setDocument] = useState<WorkspaceDocument | null>(null);
  const [tab, setTab] = useState<'analysis' | 'source'>('source');
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = state?.documents.find((item) => item.id === activeId);
  useEffect(() => {
    if (!state) return;
    if (!state.documents.some((item) => item.id === activeId))
      setActiveId(state.documents[0]?.id ?? '');
  }, [state, activeId]);
  useEffect(() => {
    let disposed = false;
    setDocument(null);
    setGoal('');
    setError('');
    if (activeId)
      void window.desktop
        ?.getDocument(activeId)
        .then((value) => {
          if (!disposed) {
            setDocument(value);
            setGoal(value.analysis?.goal ?? '');
            setTab(value.analysis ? 'analysis' : 'source');
          }
        })
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : '文档读取失败');
        });
    return () => {
      disposed = true;
    };
  }, [activeId, selected?.updatedAt]);
  if (!window.desktop) return <DesktopRequired />;
  if (!state) return <div className="workEmpty">{workspaceError || '正在读取本机文档…'}</div>;
  const desktop = window.desktop;
  const job = state.jobs[activeId];
  const running = job?.status === 'running';
  const importing = state.importing || busy === 'files' || busy === 'link';
  const modelName = state.settings.model.model.trim();
  const modelConfigured = Boolean(modelName);
  const modelSetupHint = state.settings.hasApiKey
    ? 'API Key 已保存，请补充模型名称。'
    : '配置模型后，即可分析文档。';
  const visible = state.documents.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const action = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy('');
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
          <div className="workEyebrow">文档理解</div>
          <h1>从文档到测试思路</h1>
          <p>导入需求，理解规则，梳理值得验证的场景。</p>
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
      <div className="documentsGrid">
        <aside className="documentLibrary">
          <div className="libraryHeading">
            <h2>文档库</h2>
            <span>{state.documents.length}</span>
          </div>
          <input
            aria-label="搜索文档"
            placeholder="搜索文档名称"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="documentList">
            {visible.map((item) => (
              <button
                key={item.id}
                className={`documentItem ${item.id === activeId ? 'active' : ''}`}
                onClick={() => {
                  setActiveId(item.id);
                  setNotice('');
                }}
              >
                <span className="documentKind">{item.kind.toUpperCase()}</span>
                <strong>{item.name}</strong>
                <span>
                  {item.characters.toLocaleString()} 字符 ·{' '}
                  {state.jobs[item.id]?.status === 'running'
                    ? '分析中'
                    : item.analyzed
                      ? '已分析'
                      : '待分析'}
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="libraryEmpty">
                {search ? '没有匹配的文档' : '文档从这里开始积累。导入后可预览原文并进行分析。'}
              </p>
            )}
          </div>
          <div className="libraryFoot">保存在本机 · 重启后保留</div>
        </aside>
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
                先核对提取的文字，再让模型分析功能、边界与测试点。
              </p>
              <div className="welcomeSteps">
                <span>01 导入资料</span>
                <span className={modelConfigured ? 'complete' : undefined}>
                  {modelConfigured ? '02 模型已配置' : '02 配置模型'}
                </span>
                <span>03 分析测试点</span>
              </div>
              <div className="welcomeNextStep">
                <p className="welcomeModelStatus" role="status">
                  {modelConfigured ? `已配置模型：${modelName}` : modelSetupHint}
                </p>
                {modelConfigured ? (
                  <div className="welcomeActions">
                    <button
                      className="workButton primary"
                      disabled={importing}
                      onClick={importFiles}
                    >
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
          ) : !document ? (
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
                    <p key={index}>{warning}</p>
                  ))}
                </div>
              )}
              <div className="analysisControls">
                <label htmlFor="analysis-goal">
                  分析重点 <span>可选</span>
                </label>
                <textarea
                  id="analysis-goal"
                  placeholder="例如：重点检查登录规则、异常分支和验收标准是否完整"
                  rows={2}
                  maxLength={4000}
                  value={goal}
                  disabled={running}
                  onChange={(event) => setGoal(event.target.value)}
                />
                <div className="analysisActions">
                  <div>
                    {modelConfigured ? (
                      <>
                        <strong>{modelName}</strong>
                        <small>分析时将文档文字发送至 {state.settings.model.baseUrl}</small>
                      </>
                    ) : (
                      <Link to="/settings">{modelSetupHint} →</Link>
                    )}
                  </div>
                  {running ? (
                    <button
                      className="workButton"
                      onClick={() => void action('cancel', () => desktop.cancelAnalysis(activeId))}
                    >
                      取消分析
                    </button>
                  ) : (
                    <button
                      className="workButton primary"
                      disabled={!modelConfigured || Boolean(busy)}
                      onClick={() => {
                        setTab('analysis');
                        void action('analyze', async () => {
                          await desktop.analyze(activeId, goal);
                        });
                      }}
                    >
                      分析文档
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
                <button
                  role="tab"
                  aria-selected={tab === 'source'}
                  onClick={() => setTab('source')}
                >
                  提取原文
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'analysis'}
                  onClick={() => setTab('analysis')}
                >
                  分析结果
                </button>
              </div>
              <div className="documentBody" role="tabpanel">
                {tab === 'source' ? (
                  <>
                    <div className="documentMeta">
                      {document.content.length.toLocaleString()} 字符 · 请核对表格、换行与关键规则
                    </div>
                    <pre>{document.content}</pre>
                  </>
                ) : document.analysis ? (
                  <>
                    <div className="analysisResultMeta">
                      <span>
                        {new Date(document.analysis.createdAt).toLocaleString('zh-CN')} ·{' '}
                        {document.analysis.model} · {document.analysis.segments} 段
                      </span>
                      <button
                        className="workButton subtle"
                        onClick={() =>
                          void action('copy', async () => {
                            await navigator.clipboard.writeText(document.analysis!.content);
                            setNotice('分析结果已复制。');
                          })
                        }
                      >
                        复制结果
                      </button>
                    </div>
                    {running && (
                      <p className="documentMeta">正在重新分析，以下为上次保存的结果。</p>
                    )}
                    <MarkdownContent>{document.analysis.content}</MarkdownContent>
                  </>
                ) : (
                  <div className="resultEmpty">
                    <h3>{running ? '正在阅读文档并整理分析…' : '尚未分析这份文档'}</h3>
                    <p>分析将包括内容摘要、业务规则、测试场景、边界异常与待确认问题。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
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
        content="将移除这份文档的本地文字副本及分析结果，原始文件和飞书文档不受影响。"
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
