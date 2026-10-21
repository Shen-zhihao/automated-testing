import { useState } from 'react';
import type { AppearanceMode } from '@project/shared-api';
import { useAppearance } from '@/hooks/useAppearance';
import Icon from '@/components/Icon';
import './index.less';
const modes: {
  mode: AppearanceMode;
  label: string;
  icon: 'system' | 'sun' | 'moon';
  description: string;
}[] = [
  {
    mode: 'system',
    label: '跟随系统',
    icon: 'system',
    description: '随 Windows 或 macOS 外观自动切换',
  },
  { mode: 'light', label: '浅色', icon: 'sun', description: '始终使用明亮界面' },
  { mode: 'dark', label: '深色', icon: 'moon', description: '始终使用深色界面' },
];
export default function AppearanceSettings({ compact = false }: { compact?: boolean }) {
  const { appearance, setMode } = useAppearance();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = async (mode: AppearanceMode) => {
    setBusy(true);
    setError('');
    try {
      await setMode(mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '外观保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  if (compact)
    return (
      <div className="appearanceQuick">
        <label>
          <Icon name={appearance.theme === 'dark' ? 'moon' : 'sun'} size={16} />
          <select
            aria-label="外观模式"
            value={appearance.mode}
            disabled={busy}
            onChange={(event) => void change(event.target.value as AppearanceMode)}
          >
            {modes.map((item) => (
              <option key={item.mode} value={item.mode}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  return (
    <section className="settingsCard appearanceCard" aria-labelledby="appearance-title">
      <div className="settingsTitle">
        <div>
          <h2 id="appearance-title">外观</h2>
          <p>选择适合你的界面主题，切换后立即生效并自动保存。</p>
        </div>
        <span className="workPill">当前为{appearance.theme === 'dark' ? '深色' : '浅色'}</span>
      </div>
      <div className="appearanceOptions" role="group" aria-label="界面主题">
        {modes.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={appearance.mode === item.mode}
            disabled={busy}
            className={`appearanceOption preview-${item.mode}`}
            onClick={() => void change(item.mode)}
          >
            <div className="appearanceMini" aria-hidden="true">
              <i />
              <div>
                <b />
                <span />
                <span />
              </div>
            </div>
            <div className="appearanceOptionTitle">
              <Icon name={item.icon} size={17} />
              <strong>{item.label}</strong>
              <span className="appearanceCheck" aria-hidden="true">
                {appearance.mode === item.mode ? '✓' : ''}
              </span>
            </div>
            <p>{item.description}</p>
          </button>
        ))}
      </div>
      {error && (
        <p className="workAlert error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
