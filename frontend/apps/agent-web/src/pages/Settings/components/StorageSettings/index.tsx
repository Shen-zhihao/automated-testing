import { useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import './index.less';

export default function StorageSettings() {
  const { state, refresh } = useWorkspace();
  const storage = state!.storage;
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const working = Boolean(busy) || storage?.migrating;
  const run = async (name: string, operation: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存目录操作失败。');
    } finally {
      setBusy('');
      await refresh();
    }
  };
  return (
    <section className="settingsCard storageSettings" aria-labelledby="storage-settings-title">
      <div className="settingsTitle">
        <div>
          <h2 id="storage-settings-title">本地数据</h2>
          <p>文档原文、格式预览、分析结果和配置保存在此目录，重启后继续使用。</p>
        </div>
        <span className="workPill">{storage?.migrating ? '迁移中' : '本机保存'}</span>
      </div>
      {error && (
        <div className="workAlert error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="workAlert success" role="status">
          {message}
        </div>
      )}
      <label>
        当前保存目录
        <input readOnly value={storage?.directory ?? ''} placeholder="重启桌面应用后显示保存目录" />
      </label>
      <p className="settingsFootnote storageFile">
        数据文件：{storage?.databasePath ?? '等待桌面应用更新'}
      </p>
      <div className="settingsActions">
        <button
          className="workButton"
          disabled={working || !storage}
          onClick={() => void run('open', () => window.desktop!.openStorageDirectory())}
        >
          打开目录
        </button>
        <button
          className="workButton"
          disabled={working || !storage}
          onClick={() =>
            void run('select', async () => {
              const selected = await window.desktop!.selectStorageDirectory();
              setDirectory(selected && selected !== storage.directory ? selected : '');
            })
          }
        >
          选择保存目录
        </button>
      </div>
      {directory && (
        <div className="storageDestination">
          <label>
            新的保存目录
            <input readOnly value={directory} />
          </label>
          <p>
            保存后立即使用新目录。已有文档、分析结果和加密配置会一起复制过去，旧目录保留迁移时的副本，之后不再更新。目标目录不能已有同名数据文件。
          </p>
          <div className="settingsActions">
            <button
              className="workButton primary"
              disabled={working}
              onClick={() =>
                void run('migrate', async () => {
                  await window.desktop!.relocateStorage(directory);
                  setDirectory('');
                  setMessage('保存目录已更改，已有数据已迁移。原目录保留迁移前的副本。');
                })
              }
            >
              {working ? '处理中…' : '保存并迁移'}
            </button>
            <button className="workButton" disabled={working} onClick={() => setDirectory('')}>
              取消更改
            </button>
          </div>
        </div>
      )}
      <p className="settingsFootnote">
        原始文件不会移动或修改。只有点击生成文档时，才向已配置的模型服务发送文档文字。
      </p>
    </section>
  );
}
