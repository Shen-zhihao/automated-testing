import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@project/shared-api';
import Modal from '@/components/Modal';
import { useProjectId } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import './index.less';

export default function DeleteProjectDialog({
  project,
  onClose,
}: {
  project: ProjectSummary;
  onClose: () => void;
}) {
  const navigate = useNavigate(),
    currentProjectId = useProjectId(),
    { refresh } = useWorkspace();
  const nameInput = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const remove = async (event: FormEvent) => {
    event.preventDefault();
    const bridge = window.desktop;
    if (!bridge || busy || confirmation !== project.name) return;
    setBusy(true);
    setError('');
    try {
      await bridge.project.deleteProject(project.id, confirmation);
      if (currentProjectId === project.id) navigate('/projects', { replace: true });
      else await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工程删除失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="删除整个工程"
      description={`即将删除「${project.name}」，此操作无法撤销。`}
      dismissible={!busy}
      initialFocusRef={nameInput}
      onClose={onClose}
    >
      <form className="deleteProjectForm" onSubmit={(event) => void remove(event)}>
        <p>
          将清除 {project.documentCount} 份需求、{project.chatCount} 个对话、{project.taskCount}{' '}
          个测试任务，以及本工程的命令文件、导出文件和浏览器存储。运行中的任务必须先停止。
        </p>
        <p>客户端模型配置、书签和密码库属于全局资料，会继续保留。</p>
        <label>
          输入工程名称「{project.name}」确认
          <input
            ref={nameInput}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </label>
        {error && (
          <div className="workAlert error" role="alert">
            {error}
          </div>
        )}
        <div className="deleteProjectActions">
          <button type="button" className="workButton" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="workButton danger"
            disabled={!window.desktop || busy || confirmation !== project.name}
          >
            {busy ? '正在删除…' : '删除工程'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
