import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { prototypeApi, type ChatSession } from '@project/shared-api';
import ConfirmDialog from '@/components/ConfirmDialog';
import Modal from '@/components/Modal';
import { usePrototype } from '@/hooks/usePrototype';
import type { MainLayoutOutletContext } from '@/layouts/MainLayout/types';
import SkillPicker from './components/SkillPicker';
import './index.less';

const suggestions = [
  '整理登录页面的测试场景',
  '设计一个接口测试任务',
  '梳理核心流程的回归测试步骤',
  '列出测试报告需要展示的内容',
];

export default function ChatHomePage() {
  const { sessions, skills } = usePrototype();
  const { selectedSkillIds, onSelectedSkillIdsChange } =
    useOutletContext<MainLayoutOutletContext>();
  const [activeId, setActiveId] = useState<number | null>(sessions[0]?.id ?? null);
  const [prompt, setPrompt] = useState('');
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatSession | null>(null);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find((session) => session.id === activeId);
  const selectedSkills = skills.filter((skill) => selectedSkillIds.includes(skill.id));

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [activeSession]);

  useEffect(() => {
    if (copiedId === null) return;
    const timer = window.setTimeout(() => setCopiedId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedId]);

  const send = () => {
    if (!prompt.trim()) return;
    try {
      const session = activeSession ?? prototypeApi.createSession();
      prototypeApi.sendMessage(session.id, prompt, selectedSkillIds);
      setActiveId(session.id);
      setPrompt('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发送失败');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      send();
    }
  };

  const copy = async (id: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
    } catch {
      setError('复制失败，请手动选择消息文本。');
    }
  };

  return (
    <div className="chatHomePage">
      <aside className={`conversationPanel ${mobileListOpen ? 'mobileOpen' : ''}`}>
        <div className="panelHeader">
          <div className="panelTitle">对话列表</div>
          <button
            className="newChatBtn"
            onClick={() => {
              setActiveId(null);
              setPrompt('');
              setError('');
              setMobileListOpen(false);
            }}
          >
            新建
          </button>
        </div>
        <div className="conversationSection">
          <div className="sectionTitle">当前页面会话</div>
          <div className="conversationList">
            {sessions.length === 0 && (
              <div className="emptyState">还没有会话，先描述一个测试目标。</div>
            )}
            {sessions.map((session) => (
              <div key={session.id} className="conversationRow">
                <button
                  className={`conversationItem ${activeId === session.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveId(session.id);
                    setPrompt('');
                    setError('');
                    setMobileListOpen(false);
                  }}
                >
                  <div className="conversationName">{session.title}</div>
                  <div className="conversationMeta">
                    <span>本地演示</span>
                    <span>
                      {new Date(session.updatedAt).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </button>
                <button
                  className="deleteChatBtn"
                  type="button"
                  aria-label={`删除对话 ${session.title}`}
                  onClick={() => setDeleteTarget(session)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="conversationFooter">
          <div className="accountAvatar">T</div>
          <div className="accountInfo">
            <div className="accountName">测试工作区</div>
            <div className="accountPhone">刷新页面后清空</div>
          </div>
        </div>
      </aside>
      {mobileListOpen && (
        <button
          className="drawerBackdrop"
          aria-label="关闭对话列表"
          onClick={() => setMobileListOpen(false)}
        />
      )}
      <section className="chatPanel">
        <header className="chatHeader">
          <button
            className="mobileListTrigger"
            aria-label="展开对话列表"
            aria-expanded={mobileListOpen}
            onClick={() => setMobileListOpen((value) => !value)}
          >
            ☰
          </button>
          <div className="chatHeaderMain">
            <div className="chatEyebrow">测试助手工作台</div>
            <h1 className="chatTitle">{activeSession?.title ?? '从一个测试目标开始'}</h1>
            <p className="chatSubtitle">整理目标与思路，逐步搭建你的测试 Agent。</p>
          </div>
        </header>
        <div className="messageViewport" ref={viewportRef}>
          {!activeSession && (
            <div className="welcomeCard">
              <div className="welcomeTitle">你想测试什么？</div>
              <div className="welcomeDesc">
                先描述页面、接口或流程。这里保留对话与技能选择的基础交互，回复为本地演示内容。
              </div>
              <div className="suggestionList">
                {suggestions.map((item) => (
                  <button key={item} className="suggestionItem" onClick={() => setPrompt(item)}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="messageList" aria-live="polite">
            {activeSession?.messages.map((message) => (
              <div key={message.id} className={`messageItem ${message.role}`}>
                <div className="messageRole">{message.role === 'user' ? '你' : 'Agent · 演示'}</div>
                <div className="messageBubble">
                  {message.role === 'assistant' ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  ) : (
                    <p className="userMessageText">{message.content}</p>
                  )}
                  <button
                    className="copyBtn"
                    onClick={() => void copy(message.id, message.content)}
                  >
                    {copiedId === message.id ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <footer className="composer">
          {error && (
            <div className="errorBanner" role="alert">
              {error}
            </div>
          )}
          <div className="composerBox">
            <div className="composerHeader">
              <div className="composerTitle">描述测试目标</div>
              <div className="composerTip">Enter 发送，Shift + Enter 换行</div>
            </div>
            <textarea
              className="composerInput"
              aria-label="测试目标"
              placeholder="输入要测试的页面、接口或流程"
              value={prompt}
              rows={3}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="composerActions">
              <div className="composerLeft">
                <div className="skillChips">
                  {selectedSkills.map((skill) => (
                    <span key={skill.id} className="skillChip">
                      <span className="skillChipName">{skill.displayName}</span>
                      <button
                        className="skillChipRemove"
                        aria-label={`移除技能 ${skill.displayName}`}
                        onClick={() =>
                          onSelectedSkillIdsChange(selectedSkillIds.filter((id) => id !== skill.id))
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <button
                  className="skillBtn"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={skillPickerOpen}
                  onClick={() => setSkillPickerOpen(true)}
                >
                  ✦ 选择技能
                </button>
              </div>
              <button className="sendBtn" disabled={!prompt.trim()} onClick={send}>
                发送
              </button>
            </div>
          </div>
        </footer>
      </section>
      <Modal
        open={skillPickerOpen}
        title="选择技能"
        description="选择示例模板，预览交互；当前不会执行技能。"
        onClose={() => setSkillPickerOpen(false)}
      >
        <SkillPicker
          selectedSkillIds={selectedSkillIds}
          onSelectionChange={onSelectedSkillIdsChange}
          onSelect={() => setSkillPickerOpen(false)}
        />
      </Modal>
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除对话"
        danger
        confirmText="删除"
        content={`删除「${deleteTarget?.title ?? ''}」及其本地演示消息？`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          prototypeApi.deleteSession(deleteTarget.id);
          if (activeId === deleteTarget.id) setActiveId(null);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
