import { escapeHtml, htmlPreview } from './preview.mjs';

const ignoredTags = new Set(['head', 'script', 'style', 'svg', 'template', 'noscript']);
const inlineTags = new Set([
  'span',
  'a',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'small',
  's',
  'del',
  'sup',
  'sub',
  'code',
  'br',
]);
const semanticTags = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'blockquote',
  'pre',
]);
const clickAttribute = /^(?:onclick|sc-camel-on-click|@click|v-on:click)$/i;
const isBinding = /{{[\s\S]*?}}/g;

function readableText(value) {
  return String(value ?? '')
    .split(/({{[\s\S]*?}})/g)
    .map((part) => {
      if (!part.startsWith('{{') || !part.endsWith('}}')) return escapeHtml(part);
      const key = part.slice(2, -2).trim().split('.').at(-1)?.toLowerCase();
      const label =
        {
          title: '动态标题',
          name: '动态名称',
          label: '动态文案',
          btnlabel: '按钮文案',
          count: '动态数量',
          status: '当前状态',
          reason: '原因说明',
          author: '作者',
          desc: '说明内容',
          meta: '详细信息',
          bubble: '提示内容',
          toast: '提示内容',
        }[key] || '动态内容';
      return `<span class="prototype-dynamic">${label}</span>`;
    })
    .join('');
}

function excerpt(node) {
  if (!node || ignoredTags.has(node.name)) return '';
  if (node.type === 'text') return node.data.replace(isBinding, '').replace(/\s+/g, ' ').trim();
  return (node.children ?? []).map(excerpt).filter(Boolean).join(' ').trim();
}

function heading(node) {
  const queue = [...(node.children ?? [])];
  while (queue.length) {
    const next = queue.shift();
    if (ignoredTags.has(next.name)) continue;
    if (/^h[1-6]$/.test(next.name) && excerpt(next)) return excerpt(next).slice(0, 70);
    queue.push(...(next.children ?? []));
  }
  return '';
}

function isHidden(attrs) {
  return (
    'hidden' in attrs ||
    attrs['aria-hidden'] === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? '')
  );
}

/** Rebuild a readable document from structure; never copy source styles or run bindings. */
export function prototypePreview(page, sections, warnings) {
  const candidates = page.nodes.filter(
    (node) =>
      node.attribs['data-screen-label'] || node.name === 'dialog' || node.attribs.role === 'dialog',
  );
  const containers = new Set();
  for (const node of candidates) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (/^(app|application|应用|原型)$/i.test(parent.attribs?.['data-screen-label'] ?? ''))
        containers.add(parent);
    }
  }
  const screens = candidates.filter((node) => !containers.has(node));
  const screenSet = new Set(screens);
  const root = page.nodes.find((node) => node.name === 'body') ?? page.nodes[0]?.parent;

  function render(node, active, insideCondition = false) {
    if (node.type === 'text') return readableText(node.data);
    if (!node.name) return (node.children ?? []).map((child) => render(child, active)).join('');
    if (ignoredTags.has(node.name) || (screenSet.has(node) && node !== active)) return '';
    const attrs = node.attribs ?? {};
    const children = () => (node.children ?? []).map((child) => render(child, active)).join('');
    const conditional =
      node.name === 'sc-if' || 'v-if' in attrs || 'v-show' in attrs || isHidden(attrs);
    if (conditional && !insideCondition && node !== active) {
      const body = render(node, active, true);
      if (!body.trim()) return '';
      const description = excerpt(node);
      const label =
        description.length > 44 ? description.slice(0, 44) + '…' : description || '动态状态内容';
      return `<details class="prototype-branch"><summary>${isHidden(attrs) ? '隐藏内容' : '条件内容'} · ${escapeHtml(label)}</summary><div class="prototype-branch-body">${body}</div></details>`;
    }
    if (['input', 'textarea', 'select'].includes(node.name)) {
      const label =
        attrs['aria-label'] ||
        attrs.placeholder ||
        attrs.name ||
        { input: '输入框', textarea: '多行输入', select: '选择项' }[node.name];
      const constraints = [
        'required' in attrs ? '必填' : '',
        'disabled' in attrs ? '有禁用条件' : '',
        'readonly' in attrs ? '只读' : '',
        attrs.maxlength ? `最多 ${attrs.maxlength} 个字符` : '',
        attrs.min ? `最小值 ${attrs.min}` : '',
        attrs.max ? `最大值 ${attrs.max}` : '',
        attrs.accept ? `支持 ${attrs.accept}` : '',
      ].filter(Boolean);
      const value =
        node.name === 'input' ? (attrs.value ? readableText(attrs.value) : '') : children();
      return `<div class="prototype-field"><div class="prototype-field-label">${readableText(label)}</div>${value ? `<div class="prototype-field-value">${value}</div>` : ''}${constraints.length ? `<p class="prototype-meta">${readableText(constraints.join(' · '))}</p>` : ''}</div>`;
    }
    if (node.name === 'option') return `<p>${'selected' in attrs ? '✓ ' : ''}${children()}</p>`;
    if (node.name === 'img')
      return `<span class="prototype-meta">［图片${attrs.alt ? `：${readableText(attrs.alt)}` : ''}］</span>`;
    if (node.name === 'br' || node.name === 'hr') return `<${node.name}>`;
    const body = children();
    if (!body.trim()) return '';
    if (node.name === 'sc-for')
      return `<div class="prototype-repeat"><p class="prototype-meta">列表项示例</p>${body}</div>`;
    if (
      node.name === 'button' ||
      node.name === 'a' ||
      attrs.role === 'button' ||
      Object.keys(attrs).some((key) => clickAttribute.test(key))
    ) {
      if (node.name === 'a' || inlineTags.has(node.name) || node.parent?.name === 'p')
        return `<span class="prototype-inline-control">${body}</span>`;
      return `<div class="prototype-control"><span class="prototype-control-label">操作</span><div>${body}</div></div>`;
    }
    if (semanticTags.has(node.name)) {
      const kept = ['colspan', 'rowspan', 'start']
        .filter((key) => /^\d{1,4}$/.test(attrs[key] ?? ''))
        .map((key) => ` ${key}="${attrs[key]}"`)
        .join('');
      return `<${node.name}${kept}>${body}</${node.name}>`;
    }
    const large = Number(/font-size\s*:\s*([\d.]+)px/i.exec(attrs.style ?? '')?.[1]) >= 17;
    const bold = /font-weight\s*:\s*(?:[6-9]00|bold)/i.test(attrs.style ?? '');
    let formatted = bold ? `<strong>${body}</strong>` : body;
    if (/text-decoration(?:-line)?\s*:[^;]*line-through/i.test(attrs.style ?? ''))
      formatted = `<s>${formatted}</s>`;
    if (inlineTags.has(node.name))
      return `<${node.name}${large ? ' class="prototype-text-large"' : ''}>${formatted}</${node.name}>`;
    if (/display\s*:\s*(?:inline-)?flex/i.test(attrs.style ?? '')) {
      const column = /flex-direction\s*:\s*column/i.test(attrs.style ?? '');
      return `<div class="${column ? 'prototype-stack' : 'prototype-row'}">${body}</div>`;
    }
    const hasBlock = (node.children ?? []).some(
      (child) => child.name && !inlineTags.has(child.name) && !ignoredTags.has(child.name),
    );
    if (hasBlock) return `<div>${body}</div>`;
    return `<p${large ? ' class="prototype-heading"' : ''}>${formatted}</p>`;
  }

  const pages = (screens.length ? screens : [root]).filter(Boolean).map((node, index) => {
    const title =
      node.attribs?.['data-screen-label'] ||
      node.attribs?.['aria-label'] ||
      heading(node) ||
      '页面内容';
    let parent = node.parent;
    while (parent && !screenSet.has(parent)) parent = parent.parent;
    const parentTitle = parent?.attribs?.['data-screen-label'];
    const kind =
      node.name === 'dialog' ||
      node.attribs?.role === 'dialog' ||
      /弹[层窗]/.test(title) ||
      parentTitle
        ? '弹窗 / 子页面'
        : '页面';
    const context = parentTitle
      ? `<p class="prototype-meta">所属页面：${escapeHtml(parentTitle)}</p>`
      : '';
    return `<details class="prototype-page"${index === 0 ? ' open' : ''}><summary><span class="prototype-number">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(title)}</strong><span class="prototype-kind">${kind}</span></summary><div class="prototype-page-body">${context}${render(node, node)}</div></details>`;
  });
  const shared = screens.length && root ? render(root, null) : '';
  const evidence = sections
    .filter(([title]) => title !== '页面文字（包含隐藏与条件内容）')
    .map(
      ([title, content]) =>
        `<details class="prototype-evidence"><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(content)}</pre></details>`,
    )
    .join('');
  return htmlPreview(
    `<div class="prototype-root"><h2>页面文字</h2><p class="prototype-intro">${pages.length} 个页面与弹窗 · 点击标题展开。动态内容以占位标签显示，条件状态单独收起；页面文字按原文顺序保留。</p><div class="prototype-pages">${pages.join('')}</div>${shared.trim() ? `<details class="prototype-evidence"><summary>原型说明与公共内容</summary><div class="prototype-page-body">${shared}</div></details>` : ''}<h2>提取细节</h2><p class="prototype-intro">控件、状态条件与完整内联逻辑用于分析，可按需展开核对。</p>${evidence}</div>`,
    warnings,
  );
}
