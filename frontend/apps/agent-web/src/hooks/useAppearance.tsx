import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppearanceMode, AppearanceState } from '@project/shared-api';

const key = 'test-agent-appearance';
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const valid = (value: unknown): value is AppearanceMode =>
  ['system', 'light', 'dark'].includes(value as string);
function readInitial(): AppearanceState {
  if (window.desktop?.initialAppearance)
    return { ...window.desktop.initialAppearance, theme: media().matches ? 'dark' : 'light' };
  let mode: AppearanceMode = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) mode = saved;
  } catch {
    /* Storage can be unavailable in a browser preview. */
  }
  return { mode, theme: mode === 'system' ? (media().matches ? 'dark' : 'light') : mode };
}
function apply(value: AppearanceState) {
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.style.colorScheme = value.theme;
  try {
    localStorage.setItem(key, value.mode);
  } catch {
    /* Native persistence remains authoritative. */
  }
}
// Apply before React mounts so route loading and the first paint use the correct palette.
const initial = readInitial();
apply(initial);
const Context = createContext<{
  appearance: AppearanceState;
  setMode: (mode: AppearanceMode) => Promise<void>;
}>({ appearance: initial, setMode: async () => {} });
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(initial);
  const revision = useRef(0);
  const accept = (value: AppearanceState) => {
    apply(value);
    setAppearance(value);
  };
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const current = ++revision.current;
      try {
        const value = await window.desktop?.getAppearance();
        if (active && value && current === revision.current) accept(value);
      } catch {
        /* Keep the last applied choice if the desktop bridge is restarting. */
      }
    };
    const bridge = window.desktop;
    if (bridge?.getAppearance) void refresh();
    const unsubscribe = bridge?.onAppearanceChanged?.(() => void refresh());
    const query = media();
    const systemChanged = () => {
      if (bridge?.getAppearance) {
        void refresh();
        return;
      }
      setAppearance((previous) => {
        if (previous.mode !== 'system') return previous;
        const next: AppearanceState = { mode: 'system', theme: query.matches ? 'dark' : 'light' };
        apply(next);
        return next;
      });
    };
    query.addEventListener('change', systemChanged);
    return () => {
      active = false;
      ++revision.current;
      unsubscribe?.();
      query.removeEventListener('change', systemChanged);
    };
  }, []);
  const setMode = async (mode: AppearanceMode) => {
    if (!valid(mode)) throw new Error('请选择有效的外观模式。');
    const current = ++revision.current;
    const value = window.desktop?.setAppearance
      ? await window.desktop.setAppearance(mode)
      : ({
          mode,
          theme: mode === 'system' ? (media().matches ? 'dark' : 'light') : mode,
        } as AppearanceState);
    if (current === revision.current) accept(value);
  };
  return <Context.Provider value={{ appearance, setMode }}>{children}</Context.Provider>;
}
export const useAppearance = () => useContext(Context);
