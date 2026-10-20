import { parentPort, workerData } from 'node:worker_threads';
import { parseDocument } from './parse.mjs';

try {
  parentPort.postMessage({ ok: true, value: await parseDocument(workerData) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error.message || '文件无法解析，请确认格式正确且未加密。',
  });
}
