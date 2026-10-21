import { useEffect, useState, useRef, type FormEvent } from 'react';
import type { WorkspaceProject } from '@project/shared-api';
import Modal from '@/components/Modal';
import { useWorkspace } from '@/hooks/useWorkspace';

export default function ProjectDialog({
  open,
  project,
  onClose,
  onSaved,
}: {
  open: boolean;
  project?: WorkspaceProject;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { refresh } = useWorkspace();
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(''),
    [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setName(project?.name || '');
      setDescription(project?.description || '');
      setError('');
    }
  }, [open, project?.id]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.desktop || busy) return;
    setBusy(true);
    setError('');
    try {
      const input = { name: name.trim(), description: description.trim() };
      const value = project
        ? await window.desktop.updateProject(project.id, input)
        : await window.desktop.createProject(input);
      await refresh();
      onSaved(value.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '工程保存失败。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title={project ? '编辑工程' : '新建工程'}
      description="在同一个工程中，整理需求、持续讨论并完成测试验收。"
      onClose={onClose}
      dismissible={!busy}
      initialFocusRef={nameInput}
    >
      <form className="projectForm" onSubmit={(event) => void save(event)}>
        <label>
          工程名称
          <input
            ref={nameInput}
            required
            maxLength={80}
            placeholder="例如：会员中心改版"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          工程说明 <span>选填</span>
          <textarea
            rows={3}
            maxLength={1000}
            placeholder="记录产品目标、测试范围或当前迭代…"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {error && (
          <p className="workAlert error" role="alert">
            {error}
          </p>
        )}
        <div className="projectFormActions">
          <button className="workButton" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="workButton primary" disabled={busy || !name.trim()}>
            {busy ? '正在保存…' : project ? '保存修改' : '创建工程'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
