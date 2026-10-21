import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from '@/components/Icon';
import { useProject } from '@/hooks/useProject';
import { useWorkspace } from '@/hooks/useWorkspace';
import './index.less';

export default function DocumentLibrary({ onSelect }: { onSelect: () => void }) {
  const { state } = useWorkspace();
  const { projectPath } = useProject();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(true);
  const listId = useId();
  if (!state) return null;
  const activeId =
    state.documents.find((item) => item.id === params.get('document'))?.id ??
    state.documents[0]?.id;
  return (
    <div className="sidebarDocumentLibrary">
      <button
        className="sidebarDocumentToggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="documentDisclosure" aria-hidden="true">
          ›
        </span>
        <span>工程文档</span>
        <span className="documentCount">{state.documents.length}</span>
      </button>
      <div id={listId} hidden={!open}>
        <div className="sidebarDocumentList">
          {state.documents.map((document) => {
            const status =
              state.jobs[document.id]?.status === 'running'
                ? '生成中'
                : document.analyzed
                  ? '已有分析'
                  : '待分析';
            return (
              <Link
                key={document.id}
                to={`${projectPath('documents')}?document=${encodeURIComponent(document.id)}`}
                aria-current={document.id === activeId ? 'page' : undefined}
                title={`${document.name} · ${document.characters.toLocaleString()} 字符 · ${status}`}
                onClick={onSelect}
              >
                <Icon name="document" size={13} />
                <span className="sidebarDocumentName">{document.name}</span>
                {status === '生成中' && <span className="documentRunning" aria-label="生成中" />}
              </Link>
            );
          })}
          {!state.documents.length && <p>导入后在这里查看文档</p>}
        </div>
      </div>
    </div>
  );
}
