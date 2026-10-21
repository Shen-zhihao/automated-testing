import { useEffect, useState } from 'react';
import type { CommandMode, TerminalInfo } from '@project/shared-api';
import { useProject } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import CommandPanel from '@/components/CommandPanel';
import Modal from '@/components/Modal';
import './index.less';
export default function TerminalPage() {
  const { api, project } = useProject(),
    { state, refresh } = useWorkspace();
  const [info, setInfo] = useState<TerminalInfo | null>(null),
    [mode, setMode] = useState<CommandMode | null>(null);
  const [command, setCommand] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      ?.terminalInfo()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api, state]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="terminalPage">
      <header className="workHeading">
        <div>
          <span className="workEyebrow">{project?.name || '当前工程'}</span>
          <h1>命令执行</h1>
          <p>运行工程检查、构建与测试。执行记录与生成文件保留在当前工程。</p>
        </div>
        <button
          className="workButton"
          disabled={!api || busy}
          onClick={() => api && void perform(() => api.openCommandDirectory())}
        >
          打开工作目录
        </button>
      </header>
      {error && (
        <div role="alert" className="workAlert error">
          {error}
        </div>
      )}
      <section className="terminalSettings">
        <div>
          <strong>执行权限</strong>
          <p>
            {info?.mode === 'managed'
              ? '完全托管 · 审查通过后自动执行'
              : '手动确认 · 每条命令审查通过后等待你批准'}
          </p>
        </div>
        <select
          aria-label="命令执行权限"
          value={info?.mode || 'manual'}
          disabled={!info || busy}
          onChange={(event) => setMode(event.target.value as CommandMode)}
        >
          <option value="manual">手动确认</option>
          <option value="managed">完全托管</option>
        </select>
        <div className="terminalEnvironment">
          <span>系统 Shell：{info?.shell || '正在读取…'}</span>
          <span>工作目录：{info?.directory}</span>
          <p>
            命令以当前系统账号运行，工作目录不等于系统沙箱。仅在可信工程中启用托管；危险操作与越界请求仍会拦截。
          </p>
        </div>
      </section>
      <form
        className="terminalForm"
        onSubmit={(event) => {
          event.preventDefault();
          if (api)
            void perform(async () => {
              await api.proposeCommand({ command, reason });
              setCommand('');
              setReason('');
            });
        }}
      >
        <label>
          工程命令
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="例如 pnpm test 或 python3 tests/check.py"
            maxLength={2000}
            spellCheck={false}
            required
          />
        </label>
        <label>
          执行目的
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明与本工程需求、测试或验收的关系"
            maxLength={2000}
            required
          />
        </label>
        <div>
          <p>
            支持单条读取、构建、测试命令。脚本放入工作目录后使用；不开放管道、重定向、内联代码和提权操作。
          </p>
          <button
            className="workButton primary"
            disabled={busy || !api || !command.trim() || !reason.trim()}
          >
            {busy ? '正在审查…' : '提交命令'}
          </button>
        </div>
      </form>
      <div className="terminalHistoryHeading">
        <h2>执行记录</h2>
        <span>最近 100 条 · 单次最长 120 秒</span>
      </div>
      <CommandPanel />
      <Modal
        open={Boolean(mode)}
        title={mode === 'managed' ? '启用完全托管' : '切换为手动确认'}
        onClose={() => setMode(null)}
        dismissible={!busy}
        footer={
          <>
            <button className="workButton" disabled={busy} onClick={() => setMode(null)}>
              取消
            </button>
            <button
              className="workButton primary"
              disabled={busy}
              onClick={() =>
                api &&
                mode &&
                void perform(async () => {
                  setInfo(await api.setCommandMode(mode));
                  setMode(null);
                })
              }
            >
              确认切换
            </button>
          </>
        }
      >
        <div className="terminalModeNotice">
          <p>
            {mode === 'managed'
              ? '当前工程后续提出的命令，在工程范围与安全审查通过后会自动执行。命令能够使用当前系统账号的权限，请仅信任你了解的工程脚本和依赖。'
              : '后续命令需要逐条批准才能执行。请先停止当前运行中的命令再切换。'}
          </p>
          <p>已在等待确认的命令保持等待，不会因切换模式批量执行。此设置只影响当前工程。</p>
          {error && (
            <div role="alert" className="workAlert error">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
