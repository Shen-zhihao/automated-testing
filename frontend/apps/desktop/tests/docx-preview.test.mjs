import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseDocument } from '../src/documents/parse.mjs';
import { createStructuredDocx } from './docx-structure-fixture.mjs';

test('DOCX retains Chinese heading levels, nested lists, merged cells and image positions in reading order', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-docx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '产品需求.docx');
  createStructuredDocx(file);
  const document = await parseDocument(file);
  const html = document.preview.content;
  assert.match(html, /<h1>1 登录与权限<\/h1>/);
  assert.match(html, /<h4>1\.1\.1\.1 边界条件<\/h4>/);
  assert.match(html, /<u>关键规则<\/u>/);
  assert.match(html, /<br\s*\/>失败 5 次后锁定 15 分钟/);
  assert.match(
    html,
    /<ol><li>填写登录信息<ul><li>账号不可为空<\/li><li>密码不可为空<\/li><\/ul><\/li><li>提交并展示结果<\/li><\/ol>/,
  );
  assert.match(html, /colspan="3"[^>]*><p>验收规则/);
  assert.match(html, /rowspan="2"[^>]*><p>登录模块/);
  assert.equal((html.match(/登录模块/g) ?? []).length, 1);
  assert.match(html, /src="data:image\/png;base64,/);
  assert.match(html, /alt="此图片格式暂不支持预览"/);
  assert.ok(html.indexOf('内嵌图片') < html.indexOf('此图片格式暂不支持预览'));
  assert.ok(html.indexOf('此图片格式暂不支持预览') < html.indexOf('图后说明'));
  assert.ok(document.warnings.some((warning) => warning.includes('图片格式暂不支持')));
  assert.ok(document.warnings.some((warning) => warning.includes('对象或样式')));
  assert.match(document.content, /图后说明/);
  assert.ok(!document.content.includes('data:image'));
});
