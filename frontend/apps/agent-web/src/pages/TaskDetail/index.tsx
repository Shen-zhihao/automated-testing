import { useProject } from '@/hooks/useProject';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { WorkTestTask } from '@project/shared-api';
import { useWorkspace } from '@/hooks/useWorkspace';
import DesktopRequired from '@/components/DesktopRequired';
import MarkdownContent from '@/components/MarkdownContent';
import { useBrowserWorkspace } from '@/components/BrowserWorkspace';
import '../../styles/testing.less';
const statusLabels: Record<string, string> = {
  running: '执行中',
  passed: '通过',
  failed: '失败',
  partial: '部分完成',
  cancelled: '已取消',
  manual: '需人工核验',
  skipped: '未执行',
};
export default function TaskDetailPage() {
  const { api, projectPath } = useProject();
  const { taskId = '' } = useParams();
  const { state, refresh } = useWorkspace();
  const navigate = useNavigate();
  const browser = useBrowserWorkspace();
  const [task, setTask] = useState<WorkTestTask | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [url, setUrl] = useState('');
  const [tab, setTab] = useState('document');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedCases, setSelectedCases] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState('');
  const updated = state?.testTasks.find((item) => item.id === taskId)?.updatedAt;
  const job = state?.testJobs[`task:${taskId}`];
  const running = job?.status === 'running';
  useEffect(() => {
    let active = true;
    if (!api) return;
    void api
      .getTestTask(taskId)
      .then((value) => {
        if (active) setTask(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [taskId, updated, job?.status, job?.message]);
  useEffect(() => {
    if (task) {
      setName(task.name);
      setScope(task.scope);
      setUrl(task.url);
    }
  }, [task?.id]);
  useEffect(() => {
    setSelectedCases([]);
    setHistoryId('');
  }, [task?.report?.id]);
  if (!api) return <DesktopRequired />;
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      setTask(await api.getTestTask(taskId));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  if (!task || task.id !== taskId)
    return (
      <div className="testingPage">
        <Link to={projectPath('tasks')}>← 返回测试任务</Link>
        <p className={error ? 'testError' : 'testMuted'}>{error || '正在打开测试任务…'}</p>
      </div>
    );
  const locked = busy || running;
  const changed = name !== task.name || scope !== task.scope || url !== task.url;
  const report = historyId ? task.reportHistory.find((item) => item.id === historyId) : task.report;
  return (
    <div className="testingPage">
      <header className="testHeading">
        <div>
          <Link className="testLink" to={projectPath('tasks')}>
            ← 测试任务
          </Link>
          <h1>{task.name}</h1>
          <p>
            {task.source.name} · {task.featureId || '完整需求'} · 需求快照{' '}
            {task.sourceId.slice(0, 12)}
          </p>
        </div>
        <div className="testActions">
          <button
            className="testButton"
            disabled={locked}
            onClick={() =>
              void perform(async () => {
                if (task.sessionId) {
                  navigate(`${projectPath('chat')}?session=${task.sessionId}`);
                  return;
                }
                const chat = await api.createChat({ taskId });
                navigate(`${projectPath('chat')}?session=${chat.id}`);
              })
            }
          >
            在工作台继续讨论
          </button>
          <button
            className="testButton"
            disabled={!task.url}
            onClick={() => void browser.open({ taskId })}
          >
            打开测试网页
          </button>
        </div>
      </header>
      {task.source.changed && (
        <div className="testNotice">
          当前需求文档已变化或被移除；本任务保留创建时的需求和分析快照。新的需求版本可在需求分析中创建新的任务。
        </div>
      )}
      <details className="testCard">
        <summary>任务范围与测试网址{!task.url ? ' · 网址待填写' : ''}</summary>
        <div className="testingForm">
          <label>
            任务名称
            <input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            测试网址
            <input
              value={url}
              maxLength={2000}
              placeholder="https://你的测试环境"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="fullWidth">
            测试范围
            <textarea
              rows={3}
              value={scope}
              maxLength={4000}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <button
            className="testButton primary"
            disabled={locked || !changed}
            onClick={() =>
              void perform(async () => {
                await api.updateTestTask(taskId, { name, scope, url });
                const saved = await api.getTestTask(taskId);
                setName(saved.name);
                setScope(saved.scope);
                setUrl(saved.url);
                setNotice('任务设置已保存。');
              })
            }
          >
            保存任务设置
          </button>
        </div>
      </details>
      {error && (
        <div className="testError" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="testNotice" role="status">
          {notice}
        </div>
      )}
      {job && (
        <div className={`testJob ${job.status}`} role="status">
          {job.message}
          {running && (
            <button
              className="testButton"
              style={{ marginLeft: 12 }}
              onClick={() => void api.cancelTesting(`task:${taskId}`)}
            >
              停止当前操作
            </button>
          )}
        </div>
      )}
      <nav className="testTabs" aria-label="测试任务内容">
        {[
          ['document', '详细测试文档'],
          ['notes', `讨论结论 (${task.notes.length})`],
          ['automation', '网页自动化'],
          ['runs', `执行记录 (${task.runs.length})`],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {tab === 'document' && (
        <section className="testCard">
          <div className="testHeading">
            <div>
              <h2>结合需求编写测试文档</h2>
              <p>包含需求对应关系、环境与数据、详细用例、步骤、预期结果、风险和待确认项。</p>
            </div>
            <div className="testActions">
              <button
                className="testButton primary"
                disabled={locked || changed}
                onClick={() =>
                  void perform(async () => {
                    await api.generateTestDocument(taskId);
                    setHistoryId('');
                    setNotice('详细测试文档已生成并保存在本机。');
                  })
                }
              >
                {task.report ? '重新生成测试文档' : '生成详细测试文档'}
              </button>
              <button
                className="testButton"
                disabled={!task.report || locked}
                onClick={() =>
                  void perform(async () => {
                    const file = await api.exportTestDocument(taskId);
                    if (file) setNotice(`测试文档与执行记录已保存至：${file}`);
                  })
                }
              >
                保存当前文档为 .md
              </button>
            </div>
          </div>
          {changed && <p className="testMuted">请先保存上方的任务设置。</p>}
          {task.reportStale && (
            <div className="testNotice">
              讨论结论或测试范围已经更新，请重新生成测试文档。旧版本仍可查看。
            </div>
          )}
          {task.reportHistory.length > 0 && (
            <label className="testMuted">
              查看版本{' '}
              <select value={historyId} onChange={(event) => setHistoryId(event.target.value)}>
                <option value="">当前版本</option>
                {task.reportHistory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </option>
                ))}
              </select>
            </label>
          )}
          {report ? (
            <MarkdownContent>{report.markdown}</MarkdownContent>
          ) : (
            <p className="testMuted">
              生成时会结合需求原文、分析结果和已保留的讨论结论。文档生成不代表测试已执行。
            </p>
          )}
        </section>
      )}
      {tab === 'notes' && (
        <section className="testCard">
          <h2>从对话管理保留的结论</h2>
          {task.notes.length ? (
            task.notes.map((note) => (
              <article key={note.id} className="testCase">
                <p className="testMuted">
                  {new Date(note.createdAt).toLocaleString('zh-CN')} ·{' '}
                  <Link
                    className="testLink"
                    to={`${projectPath('chat')}?session=${note.sessionId}`}
                  >
                    回到原对话
                  </Link>
                </p>
                <MarkdownContent>{note.content}</MarkdownContent>
              </article>
            ))
          ) : (
            <p className="testMuted">
              在助手回复下点击“保留到测试任务”，重要结论会保存到这里并用于生成测试文档。
            </p>
          )}
        </section>
      )}
      {tab === 'automation' && (
        <>
          <section className="testCard">
            <h2>1. 打开网站并登录</h2>
            {changed && <p className="testNotice">上方网址或范围尚未保存，请先保存任务设置。</p>}
            <p className="testMuted">
              在网页中直接登录。网页会显示在顶部标签栏，关闭标签不会中断任务。
            </p>
            <button
              className="testButton"
              disabled={changed || !task.url}
              onClick={() => void browser.open({ taskId })}
            >
              {task.browserOpen ? '查看测试网页' : '打开测试网页'}
            </button>
          </section>
          <section className="testCard">
            <h2>2. 选择用例，生成可审阅的执行计划</h2>
            <p className="testMuted">
              每次选择 1–5
              条用例。模型会读取当前网页的文字与控件；无法可靠自动化的用例会注明人工核验原因。
            </p>
            {!task.report && <p>请先在“详细测试文档”中生成用例。</p>}
            {task.report?.cases.map((item) => (
              <details key={item.id} className="testCase">
                <summary>
                  <span className="testTag">
                    {item.id} · {item.priority}
                  </span>
                  {item.title}
                </summary>
                <label className="testCheck">
                  <input
                    type="checkbox"
                    disabled={
                      locked || (!selectedCases.includes(item.id) && selectedCases.length >= 5)
                    }
                    checked={selectedCases.includes(item.id)}
                    onChange={(event) =>
                      setSelectedCases((value) =>
                        event.target.checked
                          ? [...value, item.id]
                          : value.filter((id) => id !== item.id),
                      )
                    }
                  />
                  加入本次执行计划
                </label>
                <p className="testMuted">需求依据：{item.requirement}</p>
                <h3>操作步骤</h3>
                <ol>
                  {item.steps.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
                <h3>预期结果</h3>
                <ol>
                  {item.expected.map((expected, index) => (
                    <li key={index}>{expected}</li>
                  ))}
                </ol>
                <p className="testMuted">{item.automation}</p>
              </details>
            ))}
            <div className="testActions" style={{ marginTop: 18 }}>
              <button
                className="testButton primary"
                disabled={locked || !selectedCases.length || task.reportStale || changed}
                onClick={() =>
                  void perform(async () => {
                    await api.prepareTestPlan(taskId, selectedCases);
                    setNotice('执行计划已生成，请核对操作和断言后开始测试。');
                  })
                }
              >
                生成执行计划 ({selectedCases.length}/5)
              </button>
            </div>
          </section>
          {task.plan && (
            <section className="testCard">
              <h2>3. 审阅并执行</h2>
              <p className="testMuted">
                起始页面：{task.plan.startUrl}。只按以下操作与断言执行，其他用例不计入本次结果。
              </p>
              {task.plan.cases.map((item) => (
                <article className="testCase" key={item.caseId}>
                  <h3>
                    {item.caseId} ·{' '}
                    {task.report?.cases.find((test) => test.id === item.caseId)?.title}
                  </h3>
                  {item.manualReason ? (
                    <p className="testNotice">需人工核验：{item.manualReason}</p>
                  ) : (
                    <ol>
                      {item.steps.map((step, index) => (
                        <li className="testPlanStep" key={index}>
                          {step.description}
                          <details>
                            <summary className="testMuted">定位与预期</summary>
                            {step.locator && (
                              <p className="testMuted">
                                {step.locator.by}：{step.locator.value}
                              </p>
                            )}
                            {step.value && <p className="testMuted">内容：{step.value}</p>}
                            {step.expectedIndex !== undefined && (
                              <p className="testMuted">
                                对应预期：
                                {
                                  task.report?.cases.find((test) => test.id === item.caseId)
                                    ?.expected[step.expectedIndex]
                                }
                              </p>
                            )}
                          </details>
                        </li>
                      ))}
                    </ol>
                  )}
                </article>
              ))}
              <button
                className="testButton primary"
                style={{ marginTop: 16 }}
                disabled={locked || changed || !task.plan.cases.some((item) => item.steps.length)}
                onClick={() =>
                  void perform(async () => {
                    await api.runTestPlan(taskId);
                    setTab('runs');
                  })
                }
              >
                开始执行已审阅的步骤
              </button>
            </section>
          )}
        </>
      )}
      {tab === 'runs' && (
        <section className="testCard">
          <h2>实际执行记录</h2>
          {!task.runs.length && (
            <p className="testMuted">暂无执行记录。测试文档中的用例目前均未验证。</p>
          )}
          {task.runs.map((run) => (
            <details key={run.id} className="testRun" open={run.status === 'running'}>
              <summary>
                <span className="testTag">{statusLabels[run.status]}</span>
                {new Date(run.createdAt).toLocaleString('zh-CN')} · {run.steps.length} 个已执行步骤
              </summary>
              <p>{run.message}</p>
              <p className="testMuted">
                对应文档：{run.reportId} · 本次未选择 {run.untestedCaseIds.length} 条用例
              </p>
              {run.cases.map((item) => (
                <p key={item.caseId}>
                  {item.caseId} · {statusLabels[item.status]} · {item.message}
                </p>
              ))}
              <ol>
                {run.steps.map((step, index) => (
                  <li
                    key={index}
                    className={`testPlanStep ${step.status === 'failed' ? 'stepFailed' : 'stepPassed'}`}
                  >
                    {step.caseId} · {step.description} · {statusLabels[step.status]}
                    <small>{step.evidence}</small>
                  </li>
                ))}
              </ol>
            </details>
          ))}
        </section>
      )}
    </div>
  );
}
