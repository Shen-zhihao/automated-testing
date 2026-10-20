import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createFixtures } from './fixtures.mjs';
import { parseDocument, normalizeContent } from '../src/documents/parse.mjs';
import { parseInWorker } from '../src/documents/import.mjs';

test('common document formats preserve useful content, slide order and sheet labels', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-formats-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await createFixtures(dir);
  for (const [file, expected] of [
    ['登录需求.md', '连续 5 次错误'],
    ['需求.txt', '连续 5 次错误'],
    ['cases.csv', 'TC-01'],
    ['需求.html', '15 分钟'],
    ['requirements.docx', '连续 5 次错误'],
    ['cases.xlsx', '[工作表：边界]'],
    ['requirements.pptx', '[幻灯片 1]\n第一张'],
    ['requirements.pdf', 'five failures'],
  ]) {
    await t.test(file, async () => {
      const doc = await parseDocument(path.join(dir, file));
      assert.ok(doc.content.includes(expected), doc.content);
      assert.ok(!doc.content.includes('SECRET_SCRIPT'));
    });
  }
  const result = await parseInWorker(path.join(dir, 'requirements.pdf'));
  assert.match(result.content, /five failures/);
});

test('empty, oversized, corrupt and unsupported files fail without partial content', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'corrupt.docx'), 'not a zip');
  await writeFile(path.join(dir, 'empty.txt'), '  ');
  await assert.rejects(parseDocument(path.join(dir, 'corrupt.docx')));
  await assert.rejects(parseDocument(path.join(dir, 'empty.txt')), /未读取到文字/);
  await assert.rejects(parseDocument(path.join(dir, 'old.doc')), /不支持此格式/);
  assert.throws(() => normalizeContent('x'.repeat(200001)), /20 万/);
});
