import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractHtml } from '../src/documents/html.mjs';
import { parseDocument } from '../src/documents/parse.mjs';
import { parseDocument as parseHtml, DomUtils } from 'htmlparser2';

const bundle = (html, pages = []) => `<!doctype html><p>Unpacking...</p>
<script>throw new Error('bootstrap must never run')</script>
<script type="__bundler/manifest">{"image":{"data":"NOT_ANALYSIS_INPUT"}}</script>
<script type="__bundler/page_order">${JSON.stringify(pages)}</script>
<script type="__bundler/template">${JSON.stringify(html).replace(/<\/script/gi, '<\\/script')}</script>`;

test('single file prototype imports the real template, controls, conditions and business logic without executing it', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'html-prototype-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '原型.html');
  await writeFile(
    file,
    bundle(`<div data-screen-label="发布作品"><h1>发布</h1>
    <input name="title" placeholder="作品标题" required maxlength="30">
    <sc-if value="{{ pending }}"><button sc-camel-on-click="{{ withdraw }}">撤回申请</button></sc-if>
    <dialog hidden>审核未通过</dialog></div>
    <script type="text/x-dc">globalThis.__prototypeExecuted = true;
    const INFO = { scope: 'App 首版不做，方案预研' }; const upload = () => alert('仅模拟上传');</script>`),
  );
  const doc = await parseDocument(file);
  assert.match(doc.content, /作品标题.*required="".*maxlength="30"/);
  assert.match(doc.content, /sc-camel-on-click="{{ withdraw }}"/);
  assert.match(doc.content, /条件="{{ pending }}"/);
  assert.match(doc.content, /hidden=""/);
  assert.match(doc.content, /App 首版不做，方案预研/);
  assert.match(doc.content, /L2:.*仅模拟上传/);
  assert.doesNotMatch(doc.content, /Unpacking|NOT_ANALYSIS_INPUT|bootstrap must/);
  assert.equal(globalThis.__prototypeExecuted, undefined);
  assert.match(doc.preview.content, /&lt;button&gt;/);
  assert.doesNotMatch(doc.preview.content, /<script|<input|<button/);
  assert.ok(doc.warnings.some((message) => message.includes('已解包')));
});

test('ordinary HTML keeps its document formatting, and form options and constraints remain analyzable', () => {
  const simple = extractHtml('<h1>规则</h1><table><tr><td>最多三次</td></tr></table>', []);
  assert.match(simple.content, /最多三次/);
  assert.match(simple.preview.content, /<table>/);
  const doc = extractHtml(
    `<form method="post" action="/save"><label>邮箱<input type="email" required placeholder="填写邮箱"></label>
    <select name="quality"><option value="standard">标准</option><option value="premium" selected>高级</option></select>
    <button disabled onclick="save()">提交</button><div style="display:none"><button onclick="retry()">重试</button></div></form>`,
    [],
  );
  assert.match(doc.content, /type="email".*required="".*placeholder="填写邮箱"/);
  assert.match(doc.content, /value="premium".*selected=""/);
  assert.match(doc.content, /disabled="".*onclick="save\(\)"/);
  assert.match(doc.content, /内联样式隐藏/);
});

test('damaged, empty, oversized and excessively nested templates fail instead of importing loading text', () => {
  for (const value of ['{invalid', 'null', '""', JSON.stringify('x'.repeat(8 * 1024 * 1024 + 1))])
    assert.throws(
      () => extractHtml(`<script type="__bundler/template">${value}</script>`, []),
      /模板/,
    );
  assert.throws(() => extractHtml(bundle(bundle(bundle(bundle('<p>深层</p>')))), []), /层级/);
  assert.throws(
    () => extractHtml('<div>'.repeat(160) + '文字' + '</div>'.repeat(160), []),
    /过于复杂/,
  );
});

test('external scripts, extra bundled pages and omitted large scripts are explicit in text sent to the model', () => {
  const warnings = [];
  const doc = extractHtml(
    bundle(
      `<h1>首页</h1><script src="https://example.invalid/app.js"></script><script>${'x'.repeat(64001)}</script><script>const tail = '尾部业务规则';</script>`,
      ['second-page'],
    ),
    warnings,
  );
  assert.match(doc.content, /其他打包页面/);
  assert.match(doc.content, /脚本未加载/);
  assert.match(doc.content, /整段跳过/);
  assert.match(doc.content, /尾部业务规则/);
  assert.doesNotMatch(doc.content, /x{100}/);
  const shell = extractHtml('<script src="app.js"></script>', []);
  assert.match(shell.content, /没有静态正文/);
});

test('HTML beyond html-to-text default input limit preserves tail rules and rejects oversized extracted text', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'html-prototype-tail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const doc = extractHtml(`<style>${' '.repeat(17000000)}</style><h1>末尾独有规则</h1>`, []);
  assert.match(doc.content, /末尾独有规则/);
  const file = path.join(dir, 'too-long.html');
  await writeFile(file, `<p>${'字'.repeat(200001)}</p>`);
  await assert.rejects(parseDocument(file), /20 万字符/);
});

test('prototype preview separates pages and nested dialogs, readable bindings and conditional content without losing analysis evidence', () => {
  const source = `<div data-screen-label="App"><div data-screen-label="首页" style="position:absolute;width:390px">
    <h1>新建任务</h1><p>请先选择<strong>参考视频</strong>。</p><button onclick="open()">上传视频</button>
    <div data-screen-label="上传弹窗"><textarea placeholder="粘贴分享链接">{{ link }}</textarea>
    <sc-if value="{{ error }}"><p>读取失败，请重试</p></sc-if><div hidden>积分不足</div></div>
    </div><div data-screen-label="我的任务"><sc-for list="{{ tasks }}"><p>{{ t.title }}</p></sc-for></div></div>
    <script>const rule = '只重试失败分段';</script>`;
  const doc = extractHtml(bundle(source), []);
  const dom = parseHtml(doc.preview.content);
  const cards = DomUtils.findAll((node) => node.attribs?.class === 'prototype-page', dom.children);
  assert.equal(cards.length, 3);
  const homepage = DomUtils.getOuterHTML(cards[0], { encodeEntities: 'utf8' });
  const popup = DomUtils.getOuterHTML(cards[1], { encodeEntities: 'utf8' });
  assert.match(homepage, /<h1>新建任务<\/h1>/);
  assert.match(homepage, /请先选择<strong>参考视频<\/strong>。/);
  assert.doesNotMatch(homepage, /粘贴分享链接|读取失败|position:absolute|onclick/);
  assert.match(popup, /所属页面：首页/);
  assert.match(popup, /粘贴分享链接/);
  assert.match(popup, /prototype-branch.*条件内容.*读取失败/s);
  assert.match(popup, /隐藏内容.*积分不足/s);
  assert.match(popup, /prototype-dynamic/);
  assert.doesNotMatch(popup, /{{|<textarea|<script/);
  assert.match(doc.content, /{{ link }}/);
  assert.match(doc.content, /只重试失败分段/);
  assert.match(doc.content, /onclick="open\(\)"/);
});

test('HTML reading preview preserves table merges, paragraph order and form constraints while discarding layout styles', () => {
  const doc = extractHtml(
    `<main><h1>发布作品</h1><p>第一段说明</p><p>第二段说明</p>
    <table><tr><th colspan="2">规则</th></tr><tr><td>标题</td><td>1–30字</td></tr></table>
    <label>作品标题<input required maxlength="30" placeholder="填写标题"></label>
    <div style="display:flex;flex-direction:column"><span style="font-size:28px;font-weight:700">开始创作</span><span>制作一个新视频</span></div>
    <span style="text-decoration:line-through">30 积分</span><p>查看<a href="https://example.invalid">说明</a>后提交。</p>
    <button style="position:fixed;top:0" onclick="submit()">提交审核</button></main>`,
    [],
  );
  const dom = parseHtml(doc.preview.content);
  const pages = DomUtils.findOne((node) => node.attribs?.class === 'prototype-pages', dom.children);
  const html = DomUtils.getOuterHTML(pages, { encodeEntities: 'utf8' });
  assert.match(html, /第一段说明<\/p><p>第二段说明/);
  assert.match(html, /<th colspan="2">规则<\/th>/);
  assert.match(html, /必填 · 最多 30 个字符/);
  assert.match(html, /prototype-control/);
  assert.match(html, /prototype-stack.*prototype-text-large.*<strong>开始创作/s);
  assert.match(html, /<s>30 积分<\/s>/);
  assert.match(html, /查看<span class="prototype-inline-control">说明<\/span>后提交。/);
  assert.doesNotMatch(html, /<input|<button|position:fixed|onclick/);
});
