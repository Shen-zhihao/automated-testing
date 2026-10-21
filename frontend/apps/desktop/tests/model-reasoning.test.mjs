import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument } from '../src/model.mjs';
import { completePart } from '../src/model-client.mjs';
import { DEFAULT_MODEL } from '../src/settings.mjs';
import { analysisReply, modelAnswer } from './analysis-fixture.mjs';

const config = {
  ...DEFAULT_MODEL,
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: 'fixture-secret',
};

for (const format of ['chat-completions', 'responses']) {
  for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
    test(`${format} ${model}: document analysis reserves the configured allowance for visible output in every step`, async () => {
      const requests = [];
      const result = await analyzeDocument(
        { name: '登录规则', kind: 'md', source: '/fixture.md', content: '密码错误 5 次后锁定。' },
        '',
        { ...config, format, model },
        {
          fetchImpl: async (_, request) => {
            const body = JSON.parse(request.body);
            requests.push(body);
            const direct =
              format === 'responses'
                ? body.reasoning?.effort === 'none'
                : body.thinking?.type === 'disabled';
            // 模拟原故障：默认 high 思考耗尽额度，正文为空，无法通过锚点续写。
            if (!direct) return modelAnswer('', 'length', format);
            assert.equal(body.max_tokens ?? body.max_output_tokens, 4096);
            return modelAnswer(analysisReply(body.messages ?? body.input), 'stop', format);
          },
        },
      );
      assert.equal(requests.length, 4); // 范围审查、功能清单、步骤、验收。
      assert.match(result.content, /S-001-01/);
      assert.match(result.content, /AC-001-01/);
    });
  }

  test(`${format}: continuation also disables DeepSeek thinking without dropping the saved prefix`, async () => {
    let tail;
    const result = await analyzeDocument(
      { name: '登录规则', kind: 'md', source: '/fixture.md', content: '密码错误 5 次后锁定。' },
      '',
      { ...config, format },
      {
        fetchImpl: async (_, request) => {
          const body = JSON.parse(request.body);
          assert.equal(
            format === 'responses' ? body.reasoning?.effort : body.thinking?.type,
            format === 'responses' ? 'none' : 'disabled',
          );
          const messages = body.messages ?? body.input;
          if (messages.length > 2) {
            const anchor = JSON.parse(messages.at(-1).content.split('锚点：').at(-1));
            return modelAnswer(anchor + tail, 'stop', format);
          }
          const reply = analysisReply(messages);
          if (messages[1]?.content.includes('S 编号从')) {
            tail = reply.slice(-8);
            return modelAnswer(reply.slice(0, -8), 'length', format);
          }
          return modelAnswer(reply, 'stop', format);
        },
      },
    );
    assert.match(result.content, /S-001-01/);
    assert.match(result.content, /AC-001-01/);
  });
}

test('provider-specific reasoning switches never reach other endpoints or unsupported models; ordinary calls retain their defaults', async () => {
  for (const [baseUrl, model, options] of [
    ['https://api.deepseek.com.evil.example', 'deepseek-flash', { reasoningEffort: 'none' }],
    ['http://127.0.0.1:1234/v1', 'deepseek-flash', { reasoningEffort: 'none' }],
    ['https://api.deepseek.com', 'another-model', { reasoningEffort: 'none' }],
    ['https://api.deepseek.com', 'deepseek-flash', {}],
  ]) {
    for (const format of ['chat-completions', 'responses']) {
      await completePart({ ...config, baseUrl, model, format }, [], {
        ...options,
        fetchImpl: async (_, request) => {
          const body = JSON.parse(request.body);
          assert.equal(body.thinking, undefined);
          assert.equal(body.reasoning, undefined);
          assert.equal(body.reasoning_effort, undefined);
          return modelAnswer('OK', 'stop', format);
        },
      });
    }
  }
});

test('reasoning-only exhaustion is still an error, never a report or an unbounded automatic retry', async () => {
  let calls = 0;
  await assert.rejects(
    completePart(config, [], {
      reasoningEffort: 'none',
      fetchImpl: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            choices: [
              { finish_reason: 'length', message: { content: '', reasoning_content: '思考片段' } },
            ],
          }),
        );
      },
    }),
    /没有返回正文/,
  );
  assert.equal(calls, 1);
});
