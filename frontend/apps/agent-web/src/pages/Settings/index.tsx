import { useEffect, useState } from 'react';
import type { SettingsInput } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import DesktopRequired from '@/components/DesktopRequired';
import FeishuSettings from './components/FeishuSettings';
import './index.less';

export default function SettingsPage() {
  const { state, error: workspaceError, refresh } = useWorkspace();
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (state && !form)
      setForm({ model: { ...state.settings.model }, apiKey: '', clearApiKey: false });
  }, [state, form]);
  if (!window.desktop) return <DesktopRequired />;
  if (!state || !form)
    return <div className="workEmpty">{workspaceError || '正在读取本机设置…'}</div>;
  const desktop = window.desktop;
  const change = (key: keyof SettingsInput['model'], value: string | number | null) => {
    setForm({ ...form, model: { ...form.model, [key]: value } });
    setMessage('');
  };
  const dirty =
    JSON.stringify(form.model) !== JSON.stringify(state.settings.model) ||
    Boolean(form.apiKey) ||
    form.clearApiKey;
  const run = async (name: string, operation: () => Promise<string>) => {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      setMessage(await operation());
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    const saved = await desktop.saveSettings(form);
    setForm({ model: saved.model, apiKey: '', clearApiKey: false });
  };
  return (
    <div className="settingsPage workPage">
      <header className="workHeading">
        <div>
          <div className="workEyebrow">偏好设置</div>
          <h1>设置</h1>
          <p>配置分析模型，连接你的飞书。所有配置仅保存在这台电脑。</p>
        </div>
        <span className="workPill">本机配置</span>
      </header>
      {(error || workspaceError) && (
        <div className="workAlert error" role="alert">
          {error || workspaceError}
        </div>
      )}
      {message && (
        <div className="workAlert success" role="status">
          {message}
        </div>
      )}
      <section className="settingsCard">
        <div className="settingsTitle">
          <div>
            <h2>大模型</h2>
            <p>使用 OpenAI 兼容服务，也可连接本机模型。</p>
          </div>
          <span className="workPill">
            {dirty ? '有未保存的更改' : state.settings.model.model ? '已保存' : '待配置'}
          </span>
        </div>
        <fieldset disabled={Boolean(busy)}>
          <div className="settingsGrid">
            <label className="wide">
              服务地址（Base URL）
              <input
                value={form.model.baseUrl}
                onChange={(event) => change('baseUrl', event.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <small>
                填写接口根地址，如 https://api.openai.com/v1 或 http://localhost:11434/v1。
              </small>
            </label>
            <label>
              接口格式
              <select
                value={form.model.format}
                onChange={(event) => change('format', event.target.value)}
              >
                <option value="chat-completions">Chat Completions（通用兼容）</option>
                <option value="responses">Responses</option>
              </select>
            </label>
            <label>
              模型名称
              <input
                value={form.model.model}
                maxLength={200}
                onChange={(event) => change('model', event.target.value)}
                placeholder="填写服务商提供的模型 ID"
              />
            </label>
            <label className="wide">
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={form.apiKey}
                maxLength={8000}
                onChange={(event) =>
                  setForm({ ...form, apiKey: event.target.value, clearApiKey: false })
                }
                placeholder={
                  state.settings.hasApiKey ? '已加密保存；留空保留现有 Key' : '本地免鉴权模型可留空'
                }
              />
              <small>使用系统安全存储加密，保存后不回显。更换服务地址时须重新填写 Key。</small>
            </label>
            {state.settings.hasApiKey && (
              <label className="wide inlineCheck">
                <input
                  type="checkbox"
                  checked={form.clearApiKey}
                  onChange={(event) =>
                    setForm({ ...form, clearApiKey: event.target.checked, apiKey: '' })
                  }
                />
                清除已保存的 API Key
              </label>
            )}
            <label>
              最大输出 Token
              <input
                type="number"
                min={512}
                max={32768}
                step={512}
                value={form.model.maxTokens}
                onChange={(event) => change('maxTokens', Number(event.target.value))}
              />
            </label>
            <label>
              请求超时（秒）
              <input
                type="number"
                min={15}
                max={600}
                value={form.model.timeoutSeconds}
                onChange={(event) => change('timeoutSeconds', Number(event.target.value))}
              />
            </label>
            <label>
              温度（可选）
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.model.temperature ?? ''}
                onChange={(event) =>
                  change(
                    'temperature',
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
                placeholder="留空使用模型默认值"
              />
              <small>部分推理模型不接受温度参数，请留空。</small>
            </label>
            {form.model.format === 'chat-completions' && (
              <label>
                输出 Token 参数
                <select
                  value={form.model.tokenParameter}
                  onChange={(event) => change('tokenParameter', event.target.value)}
                >
                  <option value="max_tokens">max_tokens（通用服务）</option>
                  <option value="max_completion_tokens">
                    max_completion_tokens（新版 OpenAI）
                  </option>
                </select>
              </label>
            )}
          </div>
        </fieldset>
        <div className="settingsActions">
          <button
            className="workButton primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run('save', async () => {
                await save();
                return '模型设置已保存。';
              })
            }
          >
            {busy === 'save' ? '保存中…' : '保存设置'}
          </button>
          <button
            className="workButton"
            disabled={Boolean(busy) || !form.model.model.trim()}
            onClick={() =>
              void run('test', async () => {
                await save();
                return desktop.testModel();
              })
            }
          >
            {busy === 'test' ? '正在测试…' : '保存并测试连接'}
          </button>
          <span>测试只发送一条简短消息，不发送文档。</span>
        </div>
      </section>
      <FeishuSettings />
      <section className="settingsCard compact">
        <h2>本地数据</h2>
        <p>
          导入的文字、分析结果和设置保存在本机 SQLite
          中，重启后保留。原始文件不会修改。只有点击「分析文档」时，才向已配置的模型服务发送文档内容。
        </p>
      </section>
    </div>
  );
}
