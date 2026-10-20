import { useState, type FormEvent } from 'react';
import { prototypeApi, type TaskKind } from '@project/shared-api';
import { taskKindLabels } from '@/utils/tasks';
import './index.less';

export default function TaskForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskKind>('ui');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      onCreated(prototypeApi.createTask({ name, kind, target }).id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败');
    }
  };
  return (
    <form className="taskForm" onSubmit={submit}>
      <label>
        任务名称
        <input
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：登录页面冒烟测试"
        />
      </label>
      <label>
        测试类型
        <select value={kind} onChange={(event) => setKind(event.target.value as TaskKind)}>
          {Object.entries(taskKindLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        测试目标（可选）
        <textarea
          rows={3}
          maxLength={2000}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="填写页面地址、接口路径或测试范围"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={!name.trim()}>
        创建草稿
      </button>
    </form>
  );
}
