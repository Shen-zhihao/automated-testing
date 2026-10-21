import { useProject } from '@/hooks/useProject';
import { APP_NAME } from '@/brand';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RequirementFeature, WorkChat } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import DesktopRequired from '@/components/DesktopRequired';
import Modal from '@/components/Modal';
import CommandPanel from '@/components/CommandPanel';
import MarkdownContent from '@/components/MarkdownContent';
import AttachmentMenu from './components/AttachmentMenu';
import './index.less';
import '../../styles/testing.less';

export default function ChatHomePage() {
  const { api, projectPath } = useProject();
  const { state, refresh, error: workspaceError } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session') || '';
  const [documentId, setDocumentId] = useState(params.get('document') || '');
  const [featureId, setFeatureId] = useState(params.get('feature') || '');
  const [features, setFeatures] = useState<RequirementFeature[]>([]);
  const [chat, setChat] = useState<WorkChat | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(false),
    [title, setTitle] = useState('');
  const [commandIds, setCommandIds] = useState<string[] | null>(null);
  const [targetTask, setTargetTask] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const updated = state?.testSessions.find((item) => item.id === sessionId)?.updatedAt;
  const job = state?.testJobs[`chat:${sessionId}`];
  useEffect(() => {
    let active = true;
    setChat((previous) => (previous?.id === sessionId ? previous : null));
    setTargetTask('');
    if (sessionId)
      void api
        ?.getChat(sessionId)
        .then((value) => {
          if (active) {
            setChat(value);
            setTargetTask(value.taskId || '');
          }
        })
        .catch((cause) => {
          if (active) setError(String(cause.message));
        });
    return () => {
      active = false;
    };
  }, [sessionId, updated]);
  useEffect(() => {
    let active = true;
    setFeatures([]);
    if (documentId)
      void api
        ?.testingFeatures(documentId)
        .then((value) => {
          if (active) setFeatures(value);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [documentId]);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [chat?.messages.length]);
  if (!api) return <DesktopRequired />;
  if (!state) return <div className="testingPage">{workspaceError || '正在读取本机对话…'}</div>;
  const docs = state.documents.filter((doc) => doc.analyzed);
  const running = job?.status === 'running';
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const send = () => {
    const value = prompt.trim();
    if (!value || !chat || busy || running) return;
    setPrompt('');
    void perform(async () => {
      await api.sendChat(chat.id, value);
    });
  };
  return (
    <div className="chatHomePage connectedChat">
      <aside className="conversationPanel">
        <div className="panelHeader">
          <div className="panelTitle">工程对话</div>
          <button
            className="newChatBtn"
            onClick={() => {
              setParams({});
              setPrompt('');
              setError('');
              setNotice('');
            }}
          >
            新建
          </button>
        </div>
        <div className="conversationSection">
          <label className="conversationSearch">
            <input
              aria-label="搜索工程对话"
              placeholder="搜索对话…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="conversationList">
            {state.testSessions
              .filter((session) => session.title.toLowerCase().includes(query.toLowerCase()))
              .map((session) => (
                <button
                  key={session.id}
                  className={`conversationItem ${session.id === sessionId ? 'active' : ''}`}
                  onClick={() => {
                    setParams({ session: session.id });
                    setPrompt('');
                    setNotice('');
                  }}
                >
                  <div className="conversationName">{session.title}</div>
                  <div className="conversationMeta">
                    <span>{session.featureId || '完整需求'}</span>
                    <span>{session.taskId ? '已关联测试任务' : '讨论中'}</span>
                  </div>
                </button>
              ))}
            {!state.testSessions.length && (
              <p className="emptyState">选择已分析的需求，开始第一次任务讨论。</p>
            )}
          </div>
        </div>
        <div className="conversationFooter">
          <span className="accountName">本机保存 · 重启后保留</span>
        </div>
      </aside>
      <section className="chatPanel">
        <header className="chatHeader">
          <div className="chatHeaderMain">
            <div className="chatEyebrow">文档 → 讨论 → 测试任务</div>
            <h1 className="chatTitle">{chat?.title || '从需求分析继续讨论'}</h1>
            {chat && (
              <p className="chatSubtitle">
                {chat.source.name} · {chat.featureId || '完整需求'} · 分析于{' '}
                {new Date(chat.source.analysisCreatedAt).toLocaleString('zh-CN')}
                {chat.source.changed ? ' · 当前文档已有变化，本对话保留原版本依据' : ''}
              </p>
            )}
            {chat?.taskId && (
              <Link className="testLink" to={`${projectPath('tasks')}/${chat.taskId}`}>
                查看关联测试任务 →
              </Link>
            )}
          </div>
          <div className="chatHeaderTools">
            {chat && (
              <button
                className="workButton subtle"
                disabled={running}
                onClick={() => {
                  setTitle(chat.title);
                  setRenaming(true);
                }}
              >
                重命名
              </button>
            )}
            <Link className="workButton subtle" to={projectPath('terminal')}>
              命令执行
            </Link>
          </div>
        </header>
        <div className="messageViewport" ref={viewport}>
          {!sessionId && (
            <div className="welcomeCard">
              <h2 className="welcomeTitle">选择需求与功能</h2>
              <p className="welcomeDesc">
                结合需求原文、实现步骤和验收标准连续追问。需要保留的回复可直接加入测试任务。
              </p>
              <div className="testingForm">
                <label>
                  需求文档
                  <select
                    value={documentId}
                    onChange={(event) => {
                      setDocumentId(event.target.value);
                      setFeatureId('');
                    }}
                  >
                    <option value="">请选择已分析的文档</option>
                    {docs.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  讨论范围
                  <select value={featureId} onChange={(event) => setFeatureId(event.target.value)}>
                    <option value="">整份需求与完整流程</option>
                    {features.map((feature) => (
                      <option key={feature.id} value={feature.id}>
                        {feature.id} {feature.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="testButton primary"
                  disabled={!documentId || busy}
                  onClick={() =>
                    void perform(async () => {
                      const value = await api.createChat({ documentId, featureId });
                      setParams({ session: value.id });
                    })
                  }
                >
                  开始讨论
                </button>
                {!docs.length && (
                  <Link to={projectPath('documents')}>先导入需求并生成实施与验收文档 →</Link>
                )}
              </div>
            </div>
          )}
          {sessionId && !chat && <p className="emptyState">正在读取讨论…</p>}
          <div className="messageList">
            {chat?.messages.map((message) => (
              <article key={message.id} className={`messageItem ${message.role}`}>
                <div className="messageRole">{message.role === 'user' ? '你' : APP_NAME}</div>
                <div className="messageBubble">
                  {message.role === 'assistant' ? (
                    <MarkdownContent>{message.content}</MarkdownContent>
                  ) : (
                    <p className="userMessageText">{message.content}</p>
                  )}
                  {Boolean(message.excerpts?.length) && (
                    <details className="messageEvidence">
                      <summary>本轮引用的原文片段</summary>
                      {message.excerpts?.map((excerpt) => (
                        <div key={excerpt.id}>
                          <strong>{excerpt.id}</strong>
                          <p>{excerpt.text}</p>
                        </div>
                      ))}
                    </details>
                  )}
                  {Boolean(message.commandIds?.length) && (
                    <button
                      className="testButton keepMessage"
                      onClick={() => setCommandIds(message.commandIds || [])}
                    >
                      查看命令与审批（{message.commandIds?.length}）
                    </button>
                  )}
                  {message.role === 'assistant' &&
                    message.status === 'complete' &&
                    !message.refused && (
                      <button
                        className="testButton keepMessage"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            const task = await api.keepChatMessage(
                              chat.id,
                              message.id,
                              targetTask || undefined,
                            );
                            setTargetTask(task.id);
                            setNotice(`已保留到测试任务「${task.name}」。`);
                          })
                        }
                      >
                        保留到测试任务
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        </div>
        <footer className="composer">
          {(error || workspaceError) && (
            <div className="errorBanner" role="alert">
              {error || workspaceError}
            </div>
          )}
          {notice && (
            <div className="testNotice" role="status">
              {notice}
            </div>
          )}
          {job && <p className={`testJob ${job.status}`}>{job.message}</p>}
          {chat && (
            <>
              <div className="chatTaskTarget">
                <label>
                  保留到{' '}
                  <select
                    value={targetTask}
                    onChange={(event) => setTargetTask(event.target.value)}
                  >
                    <option value="">新建测试任务</option>
                    {state.testTasks
                      .filter((task) => task.sourceId === chat.sourceId)
                      .map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.name}
                        </option>
                      ))}
                  </select>
                </label>
                {targetTask && (
                  <Link className="testLink" to={`${projectPath('tasks')}/${targetTask}`}>
                    生成详细测试文档 →
                  </Link>
                )}
              </div>
              <div className="chatQuickActions">
                {[
                  '细化这个功能的实现步骤和验收条件',
                  '补充关键交互、错误处理和边界测试',
                  '梳理端到端流程，并给出测试用例方向',
                ].map((value) => (
                  <button key={value} onClick={() => setPrompt(value)}>
                    {value}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="composerBox">
            <textarea
              className="composerInput"
              aria-label="任务讨论内容"
              placeholder={
                chat
                  ? '结合这份需求继续提问，或补充明确的业务规则…'
                  : '先选择需求开始讨论，或点击左下角附件导入资料…'
              }
              disabled={!chat}
              value={prompt}
              maxLength={12000}
              rows={2}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="composerActions">
              <div className="composerLeft">
                <AttachmentMenu onNotice={setNotice} onDocuments={refresh} />
                <span className="composerTip">
                  {chat ? '仅当前工程 · Enter 发送' : '附件先保存在本机'}
                </span>
              </div>
              {running ? (
                <button
                  className="testButton"
                  onClick={() => void api.cancelTesting(`chat:${sessionId}`)}
                >
                  停止回答
                </button>
              ) : (
                <button
                  className="sendBtn"
                  disabled={!chat || !prompt.trim() || busy}
                  onClick={send}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </footer>
      </section>
      <Modal
        open={renaming}
        title="重命名对话"
        onClose={() => setRenaming(false)}
        footer={
          <button
            className="workButton primary"
            disabled={busy || !title.trim()}
            onClick={() =>
              chat &&
              void perform(async () => {
                await api.renameChat(chat.id, title);
                setRenaming(false);
              })
            }
          >
            保存名称
          </button>
        }
      >
        <div className="projectForm">
          <label>
            对话名称
            <input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && <div className="workAlert error">{error}</div>}
        </div>
      </Modal>
      <Modal
        open={commandIds !== null}
        title="工程命令与执行记录"
        description="仅执行已通过工程范围与安全审查的命令。关闭此窗口不会停止运行。"
        size="large"
        onClose={() => setCommandIds(null)}
      >
        {commandIds && <CommandPanel ids={commandIds} />}
      </Modal>
    </div>
  );
}
