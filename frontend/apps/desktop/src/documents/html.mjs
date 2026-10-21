import { parseDocument as parseHtml, DomUtils } from 'htmlparser2';
import { convert } from 'html-to-text';
import { htmlPreview } from './preview.mjs';
import { prototypePreview } from './html-preview.mjs';

const MAX_TEMPLATE = 8 * 1024 * 1024;
const MAX_SCRIPT = 64000;
const MAX_SCRIPTS = 120000;
const eventAttribute = /^(?:on[a-z]|@|v-on:|sc-camel-on-)/i;
const fieldAttributes = new Set([
  'id',
  'name',
  'type',
  'role',
  'placeholder',
  'value',
  'required',
  'disabled',
  'readonly',
  'min',
  'max',
  'step',
  'minlength',
  'maxlength',
  'pattern',
  'accept',
  'multiple',
  'checked',
  'selected',
  'href',
  'action',
  'method',
  'aria-label',
  'aria-expanded',
  'aria-controls',
]);
const stateAttributes = ['hidden', 'aria-hidden', 'v-if', 'v-show', 'data-screen-label'];

function elements(root) {
  const result = [],
    stack = [[root, 0]];
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++count > 50000 || depth > 150) throw new Error('HTML 结构过于复杂，请拆分后导入。');
    if (node.name && node.attribs) result.push(node);
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
  }
  return result;
}

function unpack(source, warnings) {
  let bundled = false;
  for (let depth = 0; depth <= 3; depth++) {
    const root = parseHtml(source);
    const nodes = elements(root);
    const templates = nodes.filter(
      (n) => n.name === 'script' && n.attribs.type === '__bundler/template',
    );
    if (!templates.length) return { source, nodes, bundled };
    if (templates.length !== 1 || depth === 3)
      throw new Error('HTML 内嵌模板层级或数量异常，请导出单页原型后重试。');
    try {
      source = JSON.parse(DomUtils.textContent(templates[0]));
    } catch {
      throw new Error('HTML 内嵌模板数据损坏，无法读取真实页面，请重新导出。');
    }
    if (typeof source !== 'string' || !source.trim() || source.length > MAX_TEMPLATE)
      throw new Error('HTML 内嵌模板无效或超过 8 MB，请拆分后导入。');
    bundled = true;
    const pageOrder = nodes.find(
      (n) => n.name === 'script' && n.attribs.type === '__bundler/page_order',
    );
    if (pageOrder) {
      try {
        const pages = JSON.parse(DomUtils.textContent(pageOrder));
        if (!Array.isArray(pages) || pages.length)
          warnings.push(
            '原型可能包含其他打包页面，本次仅提取内嵌主页面；请将其他页面分别导出后导入。',
          );
      } catch {
        warnings.push('无法读取原型页面目录，本次仅提取内嵌主页面。');
      }
    }
  }
}

function shortText(node) {
  const parts = [],
    stack = [node];
  let size = 0;
  while (stack.length && size < 240) {
    const current = stack.pop();
    if (['script', 'style', 'svg'].includes(current.name)) continue;
    if (current.type === 'text') {
      const value = current.data.replace(/\s+/g, ' ').trim();
      parts.push(value);
      size += value.length;
    }
    for (let i = (current.children?.length ?? 0) - 1; i >= 0; i--) stack.push(current.children[i]);
  }
  return parts.join(' ').slice(0, 240);
}

function conditions(node) {
  const values = [];
  for (let current = node; current?.name; current = current.parent) {
    for (const key of stateAttributes) {
      if (key in current.attribs) values.push(`${key}=${JSON.stringify(current.attribs[key])}`);
    }
    if (current.name === 'sc-if')
      values.push(`条件=${JSON.stringify(current.attribs.value ?? '')}`);
    if (current.name === 'sc-for')
      values.push(`循环=${JSON.stringify(current.attribs.list ?? '')}`);
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(current.attribs.style ?? ''))
      values.push('内联样式隐藏');
  }
  return [...new Set(values)].reverse().join('；');
}

export function extractHtml(source, warnings) {
  const page = unpack(source, warnings);
  const controls = [],
    states = [],
    scripts = [];
  let scriptSize = 0,
    skippedScripts = 0,
    externalScripts = 0;
  for (const node of page.nodes) {
    const attrs = node.attribs;
    if (node.name === 'script') {
      if (attrs.src) {
        externalScripts++;
        continue;
      }
      if (attrs.type?.startsWith('__bundler/')) continue;
      const code = DomUtils.textContent(node).trim();
      if (!code) continue;
      if (code.length > MAX_SCRIPT || scriptSize + code.length > MAX_SCRIPTS) {
        skippedScripts++;
        continue;
      }
      scriptSize += code.length;
      scripts.push(
        `脚本 ${scripts.length + 1}（${attrs.type || 'JavaScript'}，未执行）\n${code
          .split('\n')
          .map((line, i) => `L${i + 1}: ${line}`)
          .join('\n')}`,
      );
      continue;
    }
    if (['style', 'svg', 'path'].includes(node.name)) continue;
    const events = Object.entries(attrs).filter(([key]) => eventAttribute.test(key));
    if (
      ['input', 'textarea', 'select', 'option', 'button', 'a', 'form', 'summary'].includes(
        node.name,
      ) ||
      ['button', 'tab', 'checkbox', 'switch', 'combobox'].includes(attrs.role) ||
      events.length
    ) {
      const fields = Object.entries(attrs).filter(([key]) => fieldAttributes.has(key));
      const detail = [...fields, ...events]
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('；');
      controls.push(
        `C-${String(controls.length + 1).padStart(3, '0')} <${node.name}> 文字摘要：${shortText(node) || '（无文字）'}\n属性与事件：${detail || '未声明'}\n所在页面/条件：${conditions(node) || '未声明；是否可见取决于运行时样式与状态'}`,
      );
    }
    if (
      ['sc-if', 'sc-for', 'dialog', 'details'].includes(node.name) ||
      stateAttributes.some((key) => key in attrs)
    )
      states.push(
        `B-${String(states.length + 1).padStart(3, '0')} <${node.name}> ${conditions(node) || '未声明条件'}${'open' in attrs ? '；open=true' : ''}\n文字摘要：${shortText(node) || '（无文字）'}`,
      );
  }
  if (externalScripts)
    warnings.push(
      `有 ${externalScripts} 个外部或打包资源脚本未加载，依赖它们生成的页面内容可能缺失。`,
    );
  if (skippedScripts)
    warnings.push(
      `有 ${skippedScripts} 个内联脚本超出提取上限（单个 6.4 万、合计 12 万字符），已整段跳过；相关交互分析不完整，请单独提供业务源码。`,
    );
  const text = convert(page.source, {
    wordwrap: false,
    limits: { maxInputLength: page.source.length + 1, maxDepth: 160, maxChildNodes: 50000 },
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { ignoreHref: true } },
    ],
  }).trim();
  const prototype =
    page.bundled ||
    controls.length > 0 ||
    states.length > 0 ||
    scripts.length > 0 ||
    externalScripts > 0 ||
    skippedScripts > 0;
  if (!prototype) return { content: text, preview: htmlPreview(page.source, warnings) };
  const note =
    'HTML 静态提取：以下是页面文字、控件、条件分支与内联逻辑，未运行原型。隐藏页与弹窗文字可能同时出现；{{…}} 等是模板绑定。定时器、固定数据、模拟审核、仅弹出提示的上传/下载/分享不代表真实功能已实现。';
  warnings.push(
    page.bundled
      ? '已解包单文件 HTML 的内嵌页面。格式预览展示提取结构，不运行交互或还原动态画面。'
      : 'HTML 按静态结构提取，格式预览不运行交互；纯运行时生成内容可能不完整。',
  );
  const sections = [
    ['提取说明', `${note}\n${warnings.join('\n')}`],
    [
      '页面文字（包含隐藏与条件内容）',
      text || '没有静态正文，请结合内联逻辑；外部脚本生成的内容需补充源码。',
    ],
    ...(controls.length ? [['控件与事件绑定', controls.join('\n\n')]] : []),
    ...(states.length ? [['页面与条件分支', states.join('\n\n')]] : []),
    ...(scripts.length ? [['内联逻辑与数据（原始源码，仅供分析）', scripts.join('\n\n')]] : []),
  ];
  return {
    content: sections.map(([title, content]) => `## ${title}\n\n${content}`).join('\n\n'),
    preview: prototypePreview(page, sections, warnings),
  };
}
