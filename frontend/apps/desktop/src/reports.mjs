import { open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function reportFilename(document) {
  let name = document.name
    .normalize('NFC')
    .replace(/\.[a-z0-9]{1,10}$/i, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  let short = '';
  for (const char of name) {
    if (Buffer.byteLength(short + char, 'utf8') > 140) break;
    short += char;
  }
  name = short.replace(/[.\s]+$/g, '') || '需求文档';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `文档-${name}`;
  return `${name}-${document.analysis?.kind === 'implementation-plan' ? '功能实现与验收' : document.analysis?.kind === 'test-plan' ? '详细测试文档' : '分析结果'}.md`;
}

// 仅主进程通过原生保存对话框提供路径，渲染层不能指定任意路径或文件内容。
export async function saveMarkdownReport(document, choosePath, { replaceFile = rename } = {}) {
  const content = document.analysis?.content;
  if (typeof content !== 'string' || !content.trim())
    throw new Error('请先生成文档，再保存 Markdown。');
  const result = await choosePath(reportFilename(document));
  if (result.canceled || !result.filePath) return null;
  const file = result.filePath;
  if (!path.isAbsolute(file) || !/\.md$/i.test(file))
    throw new Error('请选择以 .md 结尾的 Markdown 文件保存位置。');
  if (document.kind !== 'feishu') {
    const sourcePath = await realpath(document.source).catch(() => path.resolve(document.source));
    const targetPath = await realpath(file).catch(() => path.resolve(file));
    if (targetPath === sourcePath) throw new Error('请使用新文件名，不能覆盖原需求文档。');
  }
  const temporary = path.join(path.dirname(file), `.test-agent-export-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFile(temporary, file);
    return file;
  } catch {
    throw new Error('Markdown 保存失败，请检查目录权限、磁盘空间或文件是否被占用后重试。');
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
