import { Link, useParams } from 'react-router-dom';
import { usePrototype } from '@/hooks/usePrototype';
import { taskKindLabels } from '@/utils/tasks';
import './index.less';

export default function TaskDetailPage() {
  const { taskId } = useParams();
  const { tasks } = usePrototype();
  const task = tasks.find((item) => item.id === Number(taskId));
  return (
    <div className="taskDetailPage">
      <div className="pageHeader">
        <Link className="backBtn" to="/tasks">
          ← 返回列表
        </Link>
        <h1 className="pageTitle">任务详情</h1>
      </div>
      {!task ? (
        <div className="detailCard">任务不存在，或本地草稿已随页面刷新清空。</div>
      ) : (
        <>
          <div className="detailCard">
            {[
              ['任务名称', task.name],
              ['测试类型', taskKindLabels[task.kind]],
              ['当前状态', '草稿 · 未执行'],
              ['测试目标', task.target || '暂未填写'],
              ['创建时间', new Date(task.createdAt).toLocaleString('zh-CN')],
            ].map(([label, value]) => (
              <div className="detailRow" key={label}>
                <div className="detailLabel">{label}</div>
                <div className="detailValue">{value}</div>
              </div>
            ))}
          </div>
          <div className="logsCard">
            <h2 className="cardTitle">执行日志</h2>
            <p>暂无执行记录。接入测试执行器后，可在此展示步骤、日志和结果。</p>
          </div>
        </>
      )}
    </div>
  );
}
