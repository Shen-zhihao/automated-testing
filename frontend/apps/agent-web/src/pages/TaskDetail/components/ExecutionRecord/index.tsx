import { useEffect, useState } from 'react';
import type { BrowserRun } from '@project/shared-api';

export default function ExecutionRecord({
  run,
  labels,
}: {
  run: BrowserRun;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(run.status === 'running');
  useEffect(() => setOpen(run.status === 'running'), [run.status]);
  return (
    <details
      className="testRun"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="testTag">{labels[run.status]}</span>
        {new Date(run.createdAt).toLocaleString('zh-CN')} · {run.steps.length} 个已执行步骤
      </summary>
      {open && (
        <>
          <p>{run.message}</p>
          <p className="testMuted">
            对应文档：{run.reportId} · 本次未选择 {run.untestedCaseIds.length} 条用例
          </p>
          {run.cases.map((item) => (
            <p key={item.caseId}>
              {item.caseId} · {labels[item.status]} · {item.message}
            </p>
          ))}
          <ol>
            {run.steps.map((step, index) => (
              <li
                key={index}
                className={`testPlanStep ${step.status === 'failed' ? 'stepFailed' : 'stepPassed'}`}
              >
                {step.caseId} · {step.description} · {labels[step.status]}
                <small>{step.evidence}</small>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
