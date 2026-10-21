import { useEffect, useState } from 'react';
import type { CommandRun } from '@project/shared-api';
import { useProject } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import './index.less';
const statusNames: Record<CommandRun['status'], string> = {
  reviewing: '安全审查中',
  pending: '等待确认',
  running: '运行中',
  passed: '已完成',
  failed: '执行失败',
  blocked: '已拦截',
  rejected: '已拒绝',
  cancelled: '已停止',
  'timed-out': '已超时',
  interrupted: '已中断',
};
export default function CommandPanel({ ids }: { ids?: string[] }) {
  const { api } = useProject(),
    { state } = useWorkspace();
  const [runs, setRuns] = useState<CommandRun[]>([]),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<CommandRun | null>(null);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      ?.terminalRuns()
      .then((value) => {
        if (active) setRuns(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api, state]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selected)
      void api
        ?.terminalRun(selected)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    return () => {
      active = false;
    };
  }, [api, selected, runs]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      if (api) setRuns(await api.terminalRuns());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const visible = ids ? runs.filter((run) => ids.includes(run.id)) : runs;
  return (
    <div className="commandPanel">
      {error && (
        <div className="workAlert error" role="alert">
          {error}
        </div>
      )}
      {!visible.length && (
        <div className="commandEmpty">
          <strong>还没有执行记录</strong>
          <p>从对话提出工程构建或测试请求，也可以在这里提交命令。</p>
        </div>
      )}
      {visible.map((run) => (
        <article className="commandCard" key={run.id}>
          <header>
            <span className={`commandStatus ${run.status}`}>{statusNames[run.status]}</span>
            <time>{new Date(run.createdAt).toLocaleString('zh-CN')}</time>
            {run.approval && <span>{run.approval === 'managed' ? '完全托管' : '手动确认'}</span>}
          </header>
          <code className="commandLine">{run.command}</code>
          <p className="commandReason">{run.reason}</p>
          <p className="commandLocation" title={run.cwd}>
            {run.cwd}
          </p>
          {run.error && <p className="commandError">{run.error}</p>}
          {run.output && (
            <pre className="commandOutput">
              {selected === run.id && detail ? detail.output : run.output}
            </pre>
          )}
          {run.truncated && <p className="commandLocation">输出已截断，保留最后 128K 字符。</p>}
          <footer>
            {run.status === 'pending' && (
              <>
                <button
                  className="workButton primary"
                  disabled={busy}
                  onClick={() => api && void perform(() => api.approveCommand(run.id))}
                >
                  批准并执行
                </button>
                <button
                  className="workButton"
                  disabled={busy}
                  onClick={() => api && void perform(() => api.rejectCommand(run.id))}
                >
                  拒绝
                </button>
              </>
            )}
            {run.status === 'running' && (
              <button
                className="workButton danger"
                disabled={busy}
                onClick={() => api && void perform(() => api.stopCommand())}
              >
                停止命令
              </button>
            )}
            {run.output && (
              <button
                className="workButton subtle"
                onClick={() => setSelected(selected === run.id ? '' : run.id)}
              >
                {selected === run.id ? '收起输出' : '查看完整输出'}
              </button>
            )}
            {run.exitCode !== null && <span className="commandExit">退出码 {run.exitCode}</span>}
          </footer>
        </article>
      ))}
    </div>
  );
}
