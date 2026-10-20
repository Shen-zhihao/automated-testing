import { Worker } from 'node:worker_threads';

export function parseInWorker(filePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      workerData: filePath,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Error('文件解析超过 60 秒，请拆分文档或转换格式后重试。')),
      60000,
    );
    worker.once('message', (result) =>
      finish(result.ok ? null : new Error(result.error), result.value),
    );
    worker.once('error', () => finish(new Error('文档解析失败，文件可能损坏或过于复杂。')));
    worker.once('exit', () => finish(new Error('文档解析进程提前退出。')));
  });
}
