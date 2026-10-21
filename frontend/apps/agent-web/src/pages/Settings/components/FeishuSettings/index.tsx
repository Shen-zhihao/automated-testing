import { useState } from 'react';
import type { FeishuSettingsInput } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';

export default function FeishuSettings() {
  const { state, refresh } = useWorkspace();
  const status = state!.feishu;
  const [form, setForm] = useState<FeishuSettingsInput>({ appId: status.appId, appSecret: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = form.appId.trim() !== status.appId || Boolean(form.appSecret);
  const waiting = busy || status.testing;
  const connected = status.connected && !dirty && !error;
  const hasSavedSecret = status.hasAppSecret && form.appId.trim() === status.appId;
  const update = (next: FeishuSettingsInput) => {
    setForm(next);
    setError('');
    setMessage('');
  };
  const testConnection = async () => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await window.desktop!.testFeishu(form);
      setForm({ appId: saved.appId, appSecret: '' });
      setMessage('连接成功，应用凭据已加密保存。可以导入已授权给此应用的文档。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '飞书连接失败，请重试。');
    } finally {
      try {
        await refresh();
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <section className="settingsCard" aria-labelledby="feishu-settings-title">
      <div className="settingsTitle">
        <div>
          <h2 id="feishu-settings-title">飞书应用</h2>
          <p>以应用身份读取已授权的文档，Windows 和 macOS 均可使用。</p>
        </div>
        <span className={`workPill ${connected ? 'green' : ''}`}>
          {waiting
            ? '测试中'
            : error
              ? '连接失败'
              : connected
                ? '已连接'
                : dirty
                  ? '待测试'
                  : status.configured
                    ? '已配置'
                    : '未配置'}
        </span>
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void testConnection();
        }}
      >
        <fieldset disabled={waiting}>
          <div className="settingsGrid">
            <label>
              App ID
              <input
                value={form.appId}
                maxLength={150}
                autoComplete="off"
                placeholder="cli_…"
                required
                onChange={(event) => update({ ...form, appId: event.target.value })}
              />
            </label>
            <label>
              App Secret
              <input
                type="password"
                value={form.appSecret}
                maxLength={8000}
                autoComplete="new-password"
                placeholder={hasSavedSecret ? '********' : '填写自建应用的 App Secret'}
                required={!hasSavedSecret}
                onChange={(event) => update({ ...form, appSecret: event.target.value })}
              />
              {hasSavedSecret && <small>已保存，留空保留现有 App Secret。</small>}
            </label>
          </div>
          <div className="settingsActions">
            <button
              className="workButton primary"
              type="submit"
              disabled={!form.appId.trim() || (!hasSavedSecret && !form.appSecret.trim())}
            >
              {waiting ? '测试连接中…' : '测试连接'}
            </button>
            <span>测试成功后自动保存，密钥仅加密保存在这台电脑。</span>
          </div>
        </fieldset>
      </form>
      <p className="settingsFootnote">
        请在飞书后台开通应用身份的文档、知识库只读权限并发布，再为应用授予目标文档的阅读权限。连接测试只验证应用凭据，文档权限会在导入时检查。
      </p>
    </section>
  );
}
