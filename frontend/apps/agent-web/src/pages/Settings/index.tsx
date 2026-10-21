import { useEffect, useState } from 'react';
import type { SettingsInput } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import AppearanceSettings from '@/components/AppearanceSettings';
import DesktopRequired from '@/components/DesktopRequired';
import Select from '@/components/Select';
import FeishuSettings from './components/FeishuSettings';
import StorageSettings from './components/StorageSettings';
import './index.less';

const outputTokenOptions = [
  512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 393216,
];

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
          <p>管理界面外观、分析模型、飞书连接和本机数据。设置仅保存在这台电脑。</p>
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
      <AppearanceSettings />
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
              <Select
                aria-label="接口格式"
                value={form.model.format}
                disabled={Boolean(busy)}
                onChange={(value) => change('format', value)}
                options={[
                  { value: 'chat-completions', label: 'Chat Completions（通用兼容）' },
                  { value: 'responses', label: 'Responses' },
                ]}
              />
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
                  state.settings.hasApiKey &&
                  !form.clearApiKey &&
                  form.model.baseUrl === state.settings.model.baseUrl
                    ? '********'
                    : '本地免鉴权模型可留空'
                }
              />
              <small>
                {state.settings.hasApiKey && !form.clearApiKey ? '已保存，留空保留现有 Key。' : ''}
                使用系统安全存储加密。更换服务地址时须重新填写 Key。
              </small>
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
              <Select
                aria-label="最大输出 Token"
                value={String(form.model.maxTokens)}
                disabled={Boolean(busy)}
                onChange={(value) => change('maxTokens', Number(value))}
                options={[
                  ...(!outputTokenOptions.includes(form.model.maxTokens)
                    ? [
                        {
                          value: String(form.model.maxTokens),
                          label: `${form.model.maxTokens.toLocaleString()} Token（已保存）`,
                        },
                      ]
                    : []),
                  ...outputTokenOptions.map((tokens) => ({
                    value: String(tokens),
                    label: `${tokens >= 1024 ? `${tokens / 1024}K` : tokens}（${tokens.toLocaleString()} Token）`,
                  })),
                ]}
              />
              <small>
                限制单次回复长度，不是上下文容量。请按模型支持的输出上限选择；1M 上下文不代表能输出
                1M。
              </small>
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
                <Select
                  aria-label="输出 Token 参数"
                  value={form.model.tokenParameter}
                  disabled={Boolean(busy)}
                  onChange={(value) => change('tokenParameter', value)}
                  options={[
                    { value: 'max_tokens', label: 'max_tokens（通用服务）' },
                    {
                      value: 'max_completion_tokens',
                      label: 'max_completion_tokens（新版 OpenAI）',
                    },
                  ]}
                />
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
      <StorageSettings />
    </div>
  );
}
