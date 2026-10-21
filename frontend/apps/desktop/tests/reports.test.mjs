import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildImplementationReport } from '../src/requirements.mjs';
import { reportFilename, saveMarkdownReport } from '../src/reports.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { reportFixture } from './report-fixture.mjs';

const source = { name: '登录需求.md', kind: 'md', source: '/example/需求.md', content: '需求原文' };
const metadata = {
  model: 'fixture-model',
  baseUrl: 'http://127.0.0.1/v1',
  goal: '',
  createdAt: '2026-10-20T08:00:00.000Z',
  segments: 1,
};

test('report unwraps a Markdown envelope, retains source and acceptance details, and rejects absent or empty sections', () => {
  const report = buildImplementationReport(
    source,
    `\`\`\`markdown\n${reportFixture}\`\`\``,
    metadata,
  );
  assert.equal(report.kind, 'implementation-plan');
  assert.match(report.content, /^# 登录需求\.md — 功能实现步骤与验收标准/);
  assert.ok(report.content.includes(reportFixture.trim()));
  assert.match(report.content, /需求来源：\/example\/需求\.md/);
  for (const invalid of [
    '仅有摘要',
    '## 功能实现步骤\n实现登录\n## 功能验收标准\n',
    '## 功能实现步骤\n\n## 功能验收标准\n登录成功进入工作区',
    '以下只是代码样例：\n```md\n## 功能实现步骤\n样例\n## 功能验收标准\n样例\n```',
  ])
    assert.throws(() => buildImplementationReport(source, invalid, metadata), /未返回完整/);
});

test('generated report survives restart and Markdown export exactly matches the stored preview', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = path.join(dir, 'workspace.sqlite');
  let store = new WorkspaceStore(database);
  const original = store.addDocument(source);
  store.saveAnalysis(original.id, buildImplementationReport(source, reportFixture, metadata));
  store.close();
  store = new WorkspaceStore(database);
  try {
    const document = store.getDocument(original.id);
    assert.equal(document.analysis.kind, 'implementation-plan');
    let chosen;
    const file = path.join(dir, '功能验收.md');
    assert.equal(
      await saveMarkdownReport(document, async (filename) => {
        chosen = filename;
        return { canceled: false, filePath: file };
      }),
      file,
    );
    assert.equal(chosen, '登录需求-功能实现与验收.md');
    assert.equal(await readFile(file, 'utf8'), document.analysis.content);
    assert.equal(store.getDocument(original.id).content, source.content);
    assert.ok(!(await readdir(dir)).some((name) => name.endsWith('.tmp')));
  } finally {
    store.close();
  }
});

test('cancel, unavailable output, and failed replacement preserve the previous file and report', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const document = {
    ...source,
    analysis: buildImplementationReport(source, reportFixture, metadata),
  };
  const file = path.join(dir, '已有结果.md');
  await writeFile(file, '原有文件');
  assert.equal(
    await saveMarkdownReport(document, async () => ({ canceled: true, filePath: file })),
    null,
  );
  assert.equal(await readFile(file, 'utf8'), '原有文件');
  await assert.rejects(
    saveMarkdownReport(document, async () => ({ canceled: false, filePath: file }), {
      replaceFile: async () => {
        throw new Error('file locked');
      },
    }),
    /保存失败/,
  );
  assert.equal(await readFile(file, 'utf8'), '原有文件');
  assert.deepEqual(await readdir(dir), ['已有结果.md']);
  await assert.rejects(
    saveMarkdownReport(document, async () => ({
      filePath: path.join(dir, 'missing', 'result.md'),
    })),
    /保存失败/,
  );
  await assert.rejects(
    saveMarkdownReport({ ...source, analysis: null }, async () => {
      throw new Error('should not show');
    }),
    /请先生成/,
  );
  assert.ok(document.analysis.content.includes('AC-002-01'));
});

test('export protects original requirements and accepts only a Markdown destination', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-report-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, '需求.md');
  await writeFile(original, '原始需求');
  const document = { ...source, source: original, analysis: { content: '# 旧版报告' } };
  await assert.rejects(
    saveMarkdownReport(document, async () => ({ filePath: original })),
    /不能覆盖原需求/,
  );
  if (process.platform !== 'win32') {
    const alias = path.join(dir, '别名.md');
    await symlink(original, alias);
    await assert.rejects(
      saveMarkdownReport(document, async () => ({ filePath: alias })),
      /不能覆盖原需求/,
    );
  }
  for (const filePath of ['relative.md', path.join(dir, 'result.exe'), path.join(dir, 'result')])
    await assert.rejects(
      saveMarkdownReport(document, async () => ({ filePath })),
      /\.md/,
    );
  assert.equal(await readFile(original, 'utf8'), '原始需求');
  const exported = path.join(dir, '历史报告.md');
  await saveMarkdownReport(document, async () => ({ filePath: exported }));
  assert.equal(await readFile(exported, 'utf8'), '# 旧版报告');
});

test('default report filenames are portable across Windows and macOS, bounded, and keep Chinese', () => {
  for (const name of [
    'CON.md',
    '../功能:登录? <体验>|*.docx',
    '需求'.repeat(200),
    '....',
    'A\u0000B\r\n',
  ]) {
    const result = reportFilename({ name, analysis: { kind: 'implementation-plan' } });
    assert.ok(!/[\u0000-\u001f<>:"/\\|?*]/.test(result));
    assert.ok(Buffer.byteLength(result, 'utf8') < 240);
    assert.match(result, /\.md$/);
    assert.equal(path.win32.basename(result), result);
  }
  assert.equal(
    reportFilename({ name: '登录需求.docx', analysis: { kind: 'implementation-plan' } }),
    '登录需求-功能实现与验收.md',
  );
});

test('HTML reports require workflows, interactions, recovery and test direction rather than a generic feature summary', () => {
  const html = { ...source, kind: 'html', name: '原型.html' };
  const titles = ['端到端业务流程', '关键交互与状态流转', '错误处理与恢复', '测试实施方向'];
  const sections = titles.map((title) => `## ${title}\n具体场景与断言，状态待验收。\n`);
  for (let i = 0; i < titles.length; i++) {
    assert.throws(
      () =>
        buildImplementationReport(
          html,
          reportFixture + sections.filter((_, index) => index !== i).join('\n'),
          metadata,
        ),
      new RegExp(titles[i]),
    );
  }
  const report = buildImplementationReport(html, reportFixture + sections.join('\n'), metadata);
  assert.match(report.content, /## 测试实施方向/);
  assert.doesNotThrow(() => buildImplementationReport(source, reportFixture, metadata));
});
