import type { TestingJob } from '@project/shared-api';

export default function TaskFeedback({
  error,
  notice,
  job,
  onCancel,
}: {
  error: string;
  notice: string;
  job?: TestingJob;
  onCancel: () => void;
}) {
  return (
    <>
      {error && error !== job?.message && (
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
        <div className={`testJob ${job.status}`} role={job.status === 'error' ? 'alert' : 'status'}>
          {job.message}
          {job.status === 'running' && (
            <button className="testButton" style={{ marginLeft: 12 }} onClick={onCancel}>
              停止当前操作
            </button>
          )}
        </div>
      )}
    </>
  );
}
