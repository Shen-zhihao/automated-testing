import { useProject } from '@/hooks/useProject';
import { useEffect, useState, type FormEvent } from 'react';
import type { RequirementFeature } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
export default function TaskForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { api } = useProject();
  const { state, refresh } = useWorkspace();
  const [documentId, setDocumentId] = useState('');
  const [features, setFeatures] = useState<RequirementFeature[]>([]);
  const [featureId, setFeatureId] = useState('');
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!api || busy) return;
    setBusy(true);
    setError('');
    try {
      const task = await api.createTestTask({
        documentId,
        featureId,
        name: name.trim() || undefined,
        scope: scope.trim() || undefined,
      });
      await refresh();
      onCreated(task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="testingForm" onSubmit={(event) => void submit(event)}>
      <label className="fullWidth">
        需求文档
        <select
          required
          value={documentId}
          onChange={(event) => {
            setDocumentId(event.target.value);
            setFeatureId('');
          }}
        >
          <option value="">选择已分析的需求</option>
          {state?.documents
            .filter((doc) => doc.analyzed)
            .map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name}
              </option>
            ))}
        </select>
      </label>
      <label className="fullWidth">
        功能范围
        <select value={featureId} onChange={(event) => setFeatureId(event.target.value)}>
          <option value="">整份需求</option>
          {features.map((feature) => (
            <option key={feature.id} value={feature.id}>
              {feature.id} {feature.title}
            </option>
          ))}
        </select>
      </label>
      <label className="fullWidth">
        任务名称
        <input
          value={name}
          maxLength={160}
          onChange={(event) => setName(event.target.value)}
          placeholder="留空使用功能或文档名称"
        />
      </label>
      <label className="fullWidth">
        补充测试范围
        <textarea
          value={scope}
          maxLength={4000}
          rows={3}
          onChange={(event) => setScope(event.target.value)}
          placeholder="例如：覆盖登录主流程、错误输入、失败恢复和权限边界"
        />
      </label>
      {error && (
        <p className="testError fullWidth" role="alert">
          {error}
        </p>
      )}
      <button className="testButton primary" disabled={!documentId || busy}>
        {busy ? '正在创建…' : '创建测试任务'}
      </button>
    </form>
  );
}
