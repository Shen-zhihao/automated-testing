import test from 'node:test';
import assert from 'node:assert/strict';
import {
  animationSettings,
  replyPrefix,
} from '../../agent-web/src/pages/ChatHome/components/TypewriterReply/frames.mjs';

test('long replies have bounded render updates and do not split Unicode or change the final Markdown', () => {
  const content = '## 需求😀\n\n- 验证数据保持。\n'.repeat(1800);
  const settings = animationSettings(content.length);
  assert.ok(Math.ceil(settings.duration / settings.interval) <= 80);
  let previous = '';
  for (let step = 0; step <= 100; step++) {
    const prefix = replyPrefix(content, step / 100);
    assert.ok(prefix.isWellFormed());
    assert.ok(content.startsWith(prefix));
    assert.ok(prefix.startsWith(previous));
    previous = prefix;
  }
  assert.equal(previous, content);
  assert.equal(replyPrefix('😀测试', 0), '😀');
  assert.equal(replyPrefix('', 0), '');
  assert.equal(animationSettings(100).interval, 45);
});
