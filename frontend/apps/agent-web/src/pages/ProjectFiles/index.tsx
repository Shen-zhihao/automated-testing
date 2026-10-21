import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectFilesInfo } from '@project/shared-api';
import { useProject } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import './index.less';

export const fileSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export default function ProjectFilesPage() {
  const { api, project } = useProject(),
    { state, refresh } = useWorkspace(),
    navigate = useNavigate();
  const [info, setInfo] = useState<ProjectFilesInfo | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [documents, setDocuments] = useState<string[]>([]),
    [exports, setExports] = useState<string[]>([]);
  const [action, setAction] = useState<'files' | 'cache' | 'delete' | 'detach' | 'commands' | null>(
      null,
    ),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api
      ?.listFiles()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [api]);
  if (!api || !project || !state) return <div className="workspaceLoading">正在读取工程文件…</div>;
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  const run = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (action === 'delete') {
        await api.deleteProject(confirmation);
        navigate('/projects', { replace: true });
        return;
      }
      if (action === 'cache') await api.clearCache();
      else if (action === 'commands') await api.cleanFiles({ cleanCommands: true });
      else
        await api.cleanFiles({
          documentIds: action === 'detach' ? [] : documents,
          exportIds: exports,
          detach: action === 'detach',
        });
      setDocuments([]);
      setExports([]);
      setInfo(await api.listFiles());
      setAction(null);
      setNotice('清理完成。');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清理失败，请重试。');
    } finally {
      setBusy(false);
    }
  };
  const titles = {
    files: '清理所选文件',
    cache: '清理浏览器缓存',
    delete: '删除整个工程',
    detach: '保留文件并解除关联',
    commands: '清理命令工作目录',
  };
  return (
    <div className="projectFilesPage">
      <header className="workHeading">
        <div>
          <span className="workEyebrow">工程管理</span>
          <h1>文件与缓存</h1>
          <p>管理「{project.name}」的需求资料、生成文件和浏览器缓存。</p>
        </div>
        <div className="headingActions">
          <button
            className="workButton"
            disabled={busy}
            onClick={() => {
              setError('');
              void api
                .listFiles()
                .then(setInfo)
                .catch((cause) => setError(cause.message));
            }}
          >
            刷新文件占用
          </button>
          <span className="workPill">
            <Icon name="projects" size={14} />
            本机保存
          </span>
        </div>
      </header>
      {error && !action && (
        <div role="alert" className="workAlert error">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="workAlert success">
          {notice}
        </div>
      )}
      <div className="fileStats">
        <div>
          <span>需求与分析</span>
          <strong>{fileSize(info?.documentBytes || 0)}</strong>
          <small>{state.documents.length} 份资料</small>
        </div>
        <div>
          <span>已登记导出文件</span>
          <strong>
            {info?.exports.length || 0}
            <small> 份</small>
          </strong>
          <small>应用生成的 Markdown 与浏览器下载</small>
        </div>
        <div>
          <span>浏览器缓存</span>
          <strong>{fileSize(info?.cacheBytes || 0)}</strong>
          <small>仅当前工程的网站资料</small>
        </div>
      </div>
      <section className="filesCard">
        <header>
          <div>
            <h2>需求资料</h2>
            <p>清理会同时删除对应的分析、讨论、测试用例和执行记录。导入前的原始文件保留。</p>
          </div>
        </header>
        {state.documents.map((doc) => (
          <label className="fileRow" key={doc.id}>
            <input
              type="checkbox"
              checked={documents.includes(doc.id)}
              onChange={() => setDocuments(toggle(documents, doc.id))}
            />
            <Icon name="document" />
            <div>
              <strong>{doc.name}</strong>
              <small>
                {doc.kind.toUpperCase()} · {doc.analyzed ? '已分析' : '待分析'} ·{' '}
                {doc.characters.toLocaleString()} 字符
              </small>
            </div>
          </label>
        ))}
        {!state.documents.length && <p className="fileEmpty">暂无导入的需求资料。</p>}
      </section>
      <section className="filesCard">
        <header>
          <div>
            <h2>导出与下载</h2>
            <p>
              这里登记的文件随工程清理。旧版本导出的文件需手动管理；应用外修改过的文件会受到保护。
            </p>
          </div>
        </header>
        {info?.exports.map((file) => (
          <label className="fileRow" key={file.id}>
            <input
              type="checkbox"
              checked={exports.includes(file.id)}
              onChange={() => setExports(toggle(exports, file.id))}
            />
            <Icon name="document" />
            <div>
              <strong>{file.name}</strong>
              <small>{file.path}</small>
            </div>
            <span className={`fileState ${file.status}`}>
              {file.status === 'changed'
                ? '外部已修改'
                : file.status === 'missing'
                  ? '文件已移走'
                  : fileSize(file.bytes)}
            </span>
          </label>
        ))}
        {!info?.exports.length && <p className="fileEmpty">暂无已登记的导出文件。</p>}
      </section>
      <div className="fileActions">
        <span>已选择 {documents.length + exports.length} 项</span>
        <button
          className="workButton"
          disabled={!exports.length}
          onClick={() => {
            setError('');
            setAction('detach');
          }}
        >
          保留导出文件并解除关联
        </button>
        <button
          className="workButton"
          disabled={!documents.length && !exports.length}
          onClick={() => {
            setError('');
            setAction('files');
          }}
        >
          清理所选文件
        </button>
      </div>
      {info?.commandDirectory && (
        <section className="filesCard compact">
          <div>
            <h2>命令工作目录</h2>
            <p>{info.commandDirectory}</p>
            <p>{fileSize(info.commandBytes || 0)} · 包含测试脚本、命令生成文件、依赖与命令记录。</p>
          </div>
          <button
            className="workButton"
            onClick={() => {
              setError('');
              setAction('commands');
            }}
          >
            清理工作目录
          </button>
        </section>
      )}
      <section className="filesCard compact">
        <div>
          <h2>浏览器缓存</h2>
          <p>关闭本工程网页并清理缓存。清理缓存保留登录状态；删除工程会一并清除登录状态。</p>
        </div>
        <button
          className="workButton"
          onClick={() => {
            setError('');
            setAction('cache');
          }}
        >
          清理缓存
        </button>
      </section>
      <section className="filesCard compact dangerZone">
        <div>
          <h2>删除工程</h2>
          <p>清除需求、对话、测试结果、命令目录、已登记导出文件和网站存储。此操作无法撤销。</p>
          <p>客户端模型设置、书签和密码库属于全局资料，可在客户端设置中单独管理。</p>
        </div>
        <button
          className="workButton danger"
          onClick={() => {
            setConfirmation('');
            setError('');
            setAction('delete');
          }}
        >
          删除工程
        </button>
      </section>
      <Modal
        open={Boolean(action)}
        title={action ? titles[action] : ''}
        dismissible={!busy}
        onClose={() => setAction(null)}
        footer={
          <>
            <button className="workButton" disabled={busy} onClick={() => setAction(null)}>
              取消
            </button>
            <button
              className={`workButton ${action === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy || (action === 'delete' && confirmation !== project.name)}
              onClick={() => void run()}
            >
              {busy ? '正在处理…' : '确认'}
            </button>
          </>
        }
      >
        <div className="fileConfirmation">
          {action === 'delete' ? (
            <>
              <p>
                将清除 {state.documents.length} 份需求、{state.testSessions.length} 个对话、
                {state.testTasks.length}{' '}
                个测试任务，以及本工程的命令文件、导出文件和浏览器存储。运行中的任务必须先停止。
              </p>
              <label>
                输入工程名称「{project.name}」确认
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
            </>
          ) : action === 'files' ? (
            <p>
              将清除 {documents.length} 份需求及其关联讨论、测试记录，并删除 {exports.length}{' '}
              份已登记导出文件。此操作无法撤销。
            </p>
          ) : action === 'detach' ? (
            <p>
              保留所选 {exports.length}{' '}
              份导出文件，解除与本工程的清理关联。以后删除工程也不会删除这些文件。
            </p>
          ) : action === 'commands' ? (
            <p>
              将删除整个命令工作目录及命令历史，包括手动放入此目录的文件。请先保存需要保留的内容。
            </p>
          ) : (
            <p>本工程网页会关闭，缓存将清除，网站登录状态保留。其他工程不受影响。</p>
          )}
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
