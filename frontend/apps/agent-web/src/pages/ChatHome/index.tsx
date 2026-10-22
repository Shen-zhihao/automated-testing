import { useProject } from '@/hooks/useProject';
import { APP_NAME } from '@/brand';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkChat, WorkChatMessage, WorkChatSummary } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import DesktopRequired from '@/components/DesktopRequired';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import ConfirmDialog from '@/components/ConfirmDialog';
import DeleteContextMenu, { type ContextMenuAnchor } from '@/components/DeleteContextMenu';
import Icon from '@/components/Icon';
import CommandPanel from '@/components/CommandPanel';
import AttachmentMenu from './components/AttachmentMenu';
import TypewriterReply from './components/TypewriterReply';
import MessageWindow from './components/MessageWindow';
import { useBrowserWorkspace } from '@/components/BrowserWorkspace';
import './index.less';
import '../../styles/testing.less';

export default function ChatHomePage() {
  const { api, projectPath } = useProject();
  const { state, refresh, error: workspaceError } = useWorkspace();
  const browser = useBrowserWorkspace();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get('session') || '';
  const documentId = params.get('document') || '';
  const featureId = params.get('feature') || '';
  const [documentIds, setDocumentIds] = useState<string[]>(documentId ? [documentId] : []);
  const [chat, setChat] = useState<WorkChat | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [pendingReply, setPendingReply] = useState<{
    sessionId: string;
    messageIds: Set<string>;
  } | null>(null);
  const [skipTyping, setSkipTyping] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<
    (ContextMenuAnchor & { sessionId: string }) | null
  >(null);
  const [deleting, setDeleting] = useState<WorkChatSummary | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [commandMessageId, setCommandMessageId] = useState<string | null>(null);
  const [retaining, setRetaining] = useState<WorkChatMessage | null>(null);
  const [targetTask, setTargetTask] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const activeSession = useRef(sessionId);
  activeSession.current = sessionId;
  const updated = state?.testSessions.find((item) => item.id === sessionId)?.updatedAt;
  const job = state?.testJobs[`chat:${sessionId}`];
  useEffect(() => {
    let active = true;
    setChat((previous) => (previous?.id === sessionId ? previous : null));
    if (sessionId)
      void api
        ?.getChat(sessionId)
        .then((value) => {
          if (!active || activeSession.current !== sessionId) return;
          setChat(value);
        })
        .catch((cause) => {
          if (active && activeSession.current === sessionId) setError(String(cause.message));
        });
    return () => {
      active = false;
    };
  }, [api, sessionId, documentId, updated]);
  useEffect(() => {
    setDocumentIds(documentId ? [documentId] : []);
  }, [api, sessionId, documentId]);
  useEffect(() => {
    if (viewport.current && followReply.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [chat?.messages.length]);
  useEffect(() => setContextMenu(null), [api, sessionId, query]);
  if (!api) return <DesktopRequired />;
  if (!state) return <div className="testingPage">{workspaceError || '正在读取本机对话…'}</div>;
  const running = job?.status === 'running';
  const loading = Boolean(sessionId && !chat);
  const menuSession = state.testSessions.find((session) => session.id === contextMenu?.sessionId);
  const menuRunning = state.testJobs[`chat:${menuSession?.id}`]?.status === 'running';
  const selectedDocuments = documentIds.flatMap((id) =>
    state.documents.filter((doc) => doc.id === id),
  );
  const isNewReply = (message: WorkChatMessage) =>
    pendingReply?.sessionId === chat?.id &&
    !pendingReply?.messageIds.has(message.id) &&
    message.role === 'assistant' &&
    message.status === 'complete';
  const replyArrived = Boolean(chat?.messages.some(isNewReply));
  const typing = replyArrived && !skipTyping;
  const thinking = (sending || running) && !replyArrived;
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
    if (!value || busy || running || loading || typing) return;
    const draft = prompt;
    const references = selectedDocuments.map((doc) => doc.id);
    setPrompt('');
    setDocumentIds([]);
    setSending(true);
    setSkipTyping(false);
    followReply.current = true;
    void perform(async () => {
      try {
        const current = chat || (await api.createChat(documentId ? { documentId, featureId } : {}));
        if (!chat) {
          activeSession.current = current.id;
          setChat(current);
          setParams({ session: current.id });
        }
        setPendingReply({
          sessionId: current.id,
          messageIds: new Set(current.messages.map((message) => message.id)),
        });
        const result = await api.sendChat(current.id, value, references);
        if (activeSession.current === current.id) setChat(result);
      } catch (cause) {
        setPendingReply(null);
        setPrompt((current) => current || draft);
        throw cause;
      } finally {
        setSending(false);
      }
    });
  };
  const deleteChat = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setDeleteError('');
    setError('');
    setNotice('');
    try {
      await api.deleteChat(deleting.id);
      if (activeSession.current === deleting.id) {
        activeSession.current = '';
        setParams({}, { replace: true });
        setChat(null);
        setPrompt('');
        setDocumentIds([]);
        setPendingReply(null);
        setSkipTyping(false);
        setCommandMessageId(null);
        setRenaming(false);
        setRetaining(null);
      }
      setDeleting(null);
      setNotice(`已删除对话「${deleting.title}」。`);
      await refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="chatHomePage connectedChat">
      <aside className="conversationPanel">
        <div className="panelHeader">
          <div className="panelTitle">工程对话</div>
          <button
            className="newChatBtn"
            disabled={busy}
            onClick={() => {
              setContextMenu(null);
              setParams({});
              setPrompt('');
              setDocumentIds([]);
              setError('');
              setNotice('');
              setPendingReply(null);
              composer.current?.focus();
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
                  disabled={busy}
                  title={`${session.title} · 右键管理对话`}
                  aria-haspopup="menu"
                  aria-expanded={contextMenu?.sessionId === session.id}
                  onClick={() => {
                    setContextMenu(null);
                    setParams({ session: session.id });
                    setPrompt('');
                    setError('');
                    setNotice('');
                    setPendingReply(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (busy) return;
                    event.currentTarget.focus();
                    setContextMenu({
                      sessionId: session.id,
                      x: event.clientX,
                      y: event.clientY,
                      trigger: event.currentTarget,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
                      return;
                    event.preventDefault();
                    if (busy) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      sessionId: session.id,
                      x: rect.left + 12,
                      y: rect.bottom,
                      trigger: event.currentTarget,
                    });
                  }}
                >
                  <div className="conversationName">{session.title}</div>
                  <div className="conversationMeta">
                    <span>{session.featureId || (session.sourceId ? '文档讨论' : '工程对话')}</span>
                    <span>{session.taskId ? '已关联测试任务' : '讨论中'}</span>
                  </div>
                </button>
              ))}
            {!state.testSessions.length && <p className="emptyState">输入问题，开始第一次对话。</p>}
          </div>
        </div>
        <div className="conversationFooter">
          <span className="accountName">本机保存 · 重启后保留</span>
        </div>
      </aside>
      <section className="chatPanel">
        <header className="chatHeader">
          <div className="chatHeaderMain">
            <div className="chatEyebrow">工程对话</div>
            <h1 className="chatTitle">{chat?.title || '新对话'}</h1>
            {chat?.source && (
              <p className="chatSubtitle">
                {chat.source.name}
                {chat.featureId ? ` · ${chat.featureId}` : ''}
                {chat.source.changed ? ' · 原文已有变化，历史消息保留引用时的版本' : ''}
              </p>
            )}
            {chat?.taskId && (
              <Link className="testLink" to={`${projectPath('tasks')}/${chat.taskId}`}>
                查看关联测试任务 →
              </Link>
            )}
          </div>
          {chat && (
            <button
              className="workButton subtle"
              disabled={running || busy}
              onClick={() => {
                setTitle(chat.title);
                setRenaming(true);
              }}
            >
              重命名
            </button>
          )}
        </header>
        <div
          className={`messageViewport ${!chat?.messages.length ? 'empty' : ''}`}
          ref={viewport}
          onScroll={(event) => {
            const node = event.currentTarget;
            followReply.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }}
        >
          {!sessionId && (
            <div className="chatWelcome">
              <Icon name="chat" size={30} />
              <h2>有什么想一起讨论的？</h2>
              <p>直接输入问题，需要资料时通过下方附件图标引用。</p>
            </div>
          )}
          {loading && <p className="emptyState">正在读取对话…</p>}
          <div className="messageList">
            {chat && (
              <MessageWindow
                key={chat.id}
                messages={chat.messages}
                viewport={viewport}
                followReply={followReply}
              >
                {(message) => (
                  <article key={message.id} className={`messageItem ${message.role}`}>
                    <div className="messageRole">{message.role === 'user' ? '你' : APP_NAME}</div>
                    <div className="messageBubble">
                      {Boolean(message.references?.length) && (
                        <div className="messageReferences" aria-label="本轮引用的文档">
                          {message.references?.map((reference) => (
                            <span
                              key={reference.id}
                              title={
                                reference.changed
                                  ? '原文已有变化，保留引用时的版本'
                                  : reference.name
                              }
                            >
                              <Icon name="document" size={13} />
                              {reference.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {message.role === 'assistant' ? (
                        <TypewriterReply
                          content={message.content}
                          animate={Boolean(isNewReply(message)) && !skipTyping}
                          paused={Boolean(browser.activeId)}
                          onComplete={() =>
                            setPendingReply((pending) =>
                              pending?.sessionId === chat.id && !pending.messageIds.has(message.id)
                                ? null
                                : pending,
                            )
                          }
                          onProgress={() => {
                            if (followReply.current && viewport.current)
                              viewport.current.scrollTop = viewport.current.scrollHeight;
                          }}
                        />
                      ) : (
                        <p className="userMessageText">{message.content}</p>
                      )}
                      {Boolean(
                        message.references?.some((reference) => reference.warnings?.length),
                      ) && (
                        <details className="messageEvidence">
                          <summary>文档提取提示</summary>
                          {message.references?.map((reference) =>
                            reference.warnings?.length ? (
                              <p key={reference.id}>
                                {reference.name}：{reference.warnings.join('；')}
                              </p>
                            ) : null,
                          )}
                        </details>
                      )}
                      {message.contextUsage && (
                        <details className="messageEvidence">
                          <summary>本轮上下文</summary>
                          <p>
                            近期讨论 {message.contextUsage.recentTurns} 轮，相关早期讨论{' '}
                            {message.contextUsage.recalledTurns} 轮；引用{' '}
                            {message.contextUsage.documents} 份文档、
                            {message.contextUsage.sourceExcerpts} 段原文。
                          </p>
                          {message.contextUsage.historyCompacted && (
                            <p>
                              较长内容已节选，另有 {message.contextUsage.omittedTurns}{' '}
                              轮未纳入本轮。完整历史仍保存在此对话中。
                            </p>
                          )}
                          {message.contextUsage.referenceChanged && (
                            <p>部分历史讨论使用了不同的文档版本，不能直接作为当前资料的结论。</p>
                          )}
                        </details>
                      )}
                      {Boolean(message.excerpts?.length) && (
                        <details className="messageEvidence messageExcerpts">
                          <summary>本轮引用的原文片段</summary>
                          {message.excerpts?.map((excerpt, index) => (
                            <section className="sourceExcerpt" key={`${excerpt.id}-${index}`}>
                              <strong className="sourceExcerptId">{excerpt.id}</strong>
                              <div
                                className="sourceExcerptText"
                                role="region"
                                aria-label={`${excerpt.id} 原文片段`}
                                tabIndex={0}
                              >
                                {excerpt.text
                                  .replace(/\r\n?/g, '\n')
                                  .replace(/\n(?:[\t ]*\n)+/g, '\n')
                                  .trim()}
                              </div>
                            </section>
                          ))}
                        </details>
                      )}
                      {Boolean(message.commandIds?.length) && !(typing && isNewReply(message)) && (
                        <details
                          className="messageEvidence"
                          onToggle={(event) => {
                            const open = event.currentTarget.open;
                            setCommandMessageId((current) =>
                              open ? message.id : current === message.id ? null : current,
                            );
                          }}
                        >
                          <summary>后台执行记录（{message.commandIds?.length}）</summary>
                          {commandMessageId === message.id && (
                            <CommandPanel ids={message.commandIds} />
                          )}
                        </details>
                      )}
                      {message.role === 'assistant' &&
                        message.status === 'complete' &&
                        !(typing && isNewReply(message)) &&
                        !message.refused &&
                        Boolean(message.references?.length) && (
                          <button
                            className="testButton keepMessage"
                            disabled={busy}
                            onClick={() => {
                              setRetaining(message);
                              setTargetTask(
                                state.testTasks.find(
                                  (task) =>
                                    task.id === chat.taskId &&
                                    task.sourceId === message.references?.[0]?.id,
                                )?.id || '',
                              );
                            }}
                          >
                            保留到测试任务
                          </button>
                        )}
                    </div>
                  </article>
                )}
              </MessageWindow>
            )}
            {thinking && (
              <article className="messageItem assistant">
                <div className="messageRole">{APP_NAME}</div>
                <div className="chatThinking" role="status" aria-live="polite">
                  <span className="thinkingDots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    {job?.message === '正在后台执行工程命令…' ? '正在后台执行命令…' : '思考中…'}
                  </span>
                </div>
              </article>
            )}
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
          {job && ['error', 'cancelled'].includes(job.status) && (
            <p className={`testJob ${job.status}`}>{job.message}</p>
          )}
          <div className="composerBox">
            {selectedDocuments.length > 0 && (
              <div className="composerReferences" aria-label="待发送的引用文档">
                {selectedDocuments.map((doc) => (
                  <span key={doc.id}>
                    <Icon name="document" size={14} />
                    <span title={doc.name}>{doc.name}</span>
                    <button
                      type="button"
                      aria-label={`移除引用：${doc.name}`}
                      disabled={busy || running}
                      onClick={() => setDocumentIds((ids) => ids.filter((id) => id !== doc.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={composer}
              className="composerInput"
              aria-label="对话内容"
              placeholder="输入问题，或通过附件图标引用资料…"
              disabled={loading}
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
                <AttachmentMenu
                  documents={state.documents}
                  selected={selectedDocuments.map((doc) => doc.id)}
                  onSelect={setDocumentIds}
                  disabled={busy || running || loading}
                  onNotice={setNotice}
                  onDocuments={refresh}
                />
                <span className="composerTip">Enter 发送 · Shift + Enter 换行</span>
              </div>
              {running ? (
                <button
                  className="testButton"
                  onClick={() => void api.cancelTesting(`chat:${sessionId}`)}
                >
                  停止回答
                </button>
              ) : typing ? (
                <button
                  className="testButton"
                  onClick={() => {
                    setSkipTyping(true);
                    setPendingReply(null);
                  }}
                >
                  显示完整回复
                </button>
              ) : (
                <button
                  className="sendBtn"
                  disabled={!prompt.trim() || busy || loading}
                  onClick={send}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </footer>
      </section>
      {contextMenu && menuSession && (
        <DeleteContextMenu
          title={menuSession.title}
          label="对话"
          anchor={contextMenu}
          disabled={busy || menuRunning}
          disabledReason={menuRunning ? '此对话正在回答，请先停止回答再删除。' : undefined}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            setContextMenu(null);
            setDeleteError('');
            setDeleting(menuSession);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="删除对话"
        content={
          <>
            <p>将永久删除「{deleting?.title}」及其消息记录，无法撤销。</p>
            <p>已保留到测试任务的结论和引用文档会继续保留。</p>
            {deleteError && (
              <div className="workAlert error" role="alert">
                {deleteError}
              </div>
            )}
          </>
        }
        confirmText="删除对话"
        danger
        loading={busy}
        onConfirm={() => void deleteChat()}
        onCancel={() => setDeleting(null)}
      />
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
        open={Boolean(retaining)}
        title="保留到测试任务"
        description={
          retaining?.references?.[0]
            ? `任务依据：${retaining.references[0].name}。保留本轮引用的版本。`
            : undefined
        }
        onClose={() => setRetaining(null)}
        dismissible={!busy}
        footer={
          <button
            className="workButton primary"
            disabled={busy}
            onClick={() =>
              chat &&
              retaining &&
              void perform(async () => {
                const task = await api.keepChatMessage(chat.id, retaining.id, targetTask);
                setRetaining(null);
                setNotice(`已保留到测试任务「${task.name}」。`);
              })
            }
          >
            保留结论
          </button>
        }
      >
        <div className="projectForm">
          <label>
            测试任务
            <Select
              aria-label="保留结论的测试任务"
              value={targetTask}
              onChange={setTargetTask}
              options={[
                { value: '', label: '新建测试任务' },
                ...state.testTasks
                  .filter((task) => task.sourceId === retaining?.references?.[0]?.id)
                  .map((task) => ({ value: task.id, label: task.name })),
              ]}
            />
          </label>
          {error && <div className="workAlert error">{error}</div>}
        </div>
      </Modal>
    </div>
  );
}
