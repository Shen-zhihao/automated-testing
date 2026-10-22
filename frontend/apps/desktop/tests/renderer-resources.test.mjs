import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { parseChatReply } from '../src/testing/model.mjs';

test('closed execution histories omit evidence DOM; running records show it, and Markdown remains safe', async (t) => {
  const root = fileURLToPath(new URL('../../agent-web/', import.meta.url));
  const server = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
    logLevel: 'error',
  });
  t.after(() => server.close());
  const require = createRequire(`${root}package.json`);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { default: Record } = await server.ssrLoadModule(
    '/src/pages/TaskDetail/components/ExecutionRecord/index.tsx',
  );
  const run = {
    id: 'fixture',
    status: 'passed',
    createdAt: '2026-10-21T00:00:00Z',
    message: '已完成',
    reportId: 'report',
    untestedCaseIds: [],
    cases: [],
    steps: [
      {
        caseId: 'case',
        description: '步骤',
        status: 'passed',
        evidence: '历史步骤证据'.repeat(10000),
      },
    ],
  };
  const closed = renderToStaticMarkup(
    React.createElement(Record, { run, labels: { passed: '通过' } }),
  );
  assert.match(closed, /summary/);
  assert.doesNotMatch(closed, /历史步骤证据/);
  assert.ok(closed.length < 1000);
  const active = renderToStaticMarkup(
    React.createElement(Record, {
      run: { ...run, status: 'running' },
      labels: { running: '执行中' },
    }),
  );
  assert.match(active, /历史步骤证据/);
  assert.match(active, /open=""/);
  const { default: Renderer } = await server.ssrLoadModule(
    '/src/components/MarkdownContent/components/Renderer/index.tsx',
  );
  const html = renderToStaticMarkup(
    React.createElement(Renderer, {
      content:
        '[安全链接](https://example.com) ![图片](https://example.com/a.png) <script>injected()</script> [坏链接](javascript:alert)',
      openBrowser: async () => {},
    }),
  );
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /<img\b|<script\b|href="javascript:/i);
  const markdown =
    '## 直接结论\n\n| 场景 | 工期 |\n| --- | --- |\n| 基准 | **4–6 周** |\n\n- 确认排期\n\n```js\nconst retries = 3;\n```';
  const formatted = renderToStaticMarkup(
    React.createElement(Renderer, {
      content: parseChatReply(JSON.stringify({ answer: markdown })).content,
      openBrowser: async () => {},
    }),
  );
  assert.match(formatted, /<h2>直接结论<\/h2>/);
  assert.match(formatted, /<table>/);
  assert.match(formatted, /<strong>4–6 周<\/strong>/);
  assert.match(formatted, /<li>确认排期<\/li>/);
  assert.match(formatted, /<pre><code class="language-js">/);
  assert.doesNotMatch(formatted, /&quot;answer&quot;|\\n/);
  const { default: Feedback } = await server.ssrLoadModule(
    '/src/pages/TaskDetail/components/TaskFeedback/index.tsx',
  );
  const message = '已保存生成进度，可以继续生成';
  const feedback = (error, job) =>
    renderToStaticMarkup(
      React.createElement(Feedback, { error, notice: '', job, onCancel: () => {} }),
    );
  const duplicated = feedback(message, { status: 'error', kind: 'document', message });
  assert.equal(duplicated.split(message).length - 1, 1);
  assert.equal(duplicated.match(/role="alert"/g).length, 1);
  assert.match(
    feedback('设置保存失败', { status: 'error', kind: 'document', message }),
    /设置保存失败/,
  );
  assert.match(
    feedback('', { status: 'running', kind: 'plan', message: '正在自动续写' }),
    /停止当前操作/,
  );
  assert.doesNotMatch(duplicated, /停止当前操作/);
  const { default: MessageWindow } = await server.ssrLoadModule(
    '/src/pages/ChatHome/components/MessageWindow/index.tsx',
  );
  const messages = Array.from({ length: 400 }, (_, index) => ({
    id: `message-${index}`,
    content: `正文-${index}`,
  }));
  const windowed = renderToStaticMarkup(
    React.createElement(MessageWindow, {
      messages,
      viewport: { current: null },
      followReply: { current: true },
      children: (message) =>
        React.createElement(
          'article',
          { key: message.id, 'data-message': message.id },
          message.content,
        ),
    }),
  );
  assert.equal(windowed.match(/<article/g).length, 40);
  assert.match(windowed, /还有 360 条/);
  assert.match(windowed, /data-message="message-399"/);
  assert.doesNotMatch(windowed, /data-message="message-0"/);
  assert.equal(messages.length, 400);
});
