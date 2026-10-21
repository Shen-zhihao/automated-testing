import { memo, useMemo, useState } from 'react';
import createDOMPurify from 'dompurify';
import type { WorkspaceDocument } from '@project/shared-api';
import MarkdownContent from '@/components/MarkdownContent';
import './index.less';
import previewStyle from './preview.less?inline';
import themeStyle from '@/styles/theme.less?inline';
import { useAppearance } from '@/hooks/useAppearance';

const purifier = createDOMPurify();
const prototypeClasses = new Set([
  'prototype-root',
  'prototype-pages',
  'prototype-page',
  'prototype-page-body',
  'prototype-number',
  'prototype-kind',
  'prototype-intro',
  'prototype-heading',
  'prototype-meta',
  'prototype-dynamic',
  'prototype-control',
  'prototype-control-label',
  'prototype-field',
  'prototype-field-label',
  'prototype-field-value',
  'prototype-repeat',
  'prototype-branch',
  'prototype-branch-body',
  'prototype-evidence',
  'prototype-inline-control',
  'prototype-text-large',
  'prototype-stack',
  'prototype-row',
]);
purifier.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    data.attrName === 'src' &&
    !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(data.attrValue)
  )
    data.keepAttr = false;
  if (data.attrName === 'class') {
    data.attrValue = data.attrValue
      .split(/\s+/)
      .filter((value) => prototypeClasses.has(value))
      .join(' ');
    if (!data.attrValue) data.keepAttr = false;
  }
});

export default memo(function SourcePreview({ document }: { document: WorkspaceDocument }) {
  const { appearance } = useAppearance();
  // Native prefers-color-scheme updates within the scriptless iframe without reloading it.
  const previewTheme = window.desktop?.getAppearance ? '' : appearance.theme;
  const [plain, setPlain] = useState(false);
  const preview =
    document.preview ??
    (['md', 'markdown'].includes(document.kind)
      ? { format: 'markdown', content: document.content }
      : null);
  const html = useMemo(() => {
    if (preview?.format !== 'html') return '';
    const content = purifier.sanitize(preview.content, {
      ALLOWED_TAGS: [
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'br',
        'div',
        'span',
        'strong',
        'b',
        'em',
        'i',
        's',
        'del',
        'u',
        'sup',
        'sub',
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
        'caption',
        'colgroup',
        'col',
        'blockquote',
        'pre',
        'code',
        'hr',
        'img',
        'details',
        'summary',
      ],
      ALLOWED_ATTR: [
        'colspan',
        'rowspan',
        'start',
        'style',
        'src',
        'alt',
        'width',
        'height',
        'align',
        'class',
        'open',
      ],
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    const owner = content.ownerDocument;
    content.querySelectorAll('table').forEach((table) => {
      const wrapper = owner.createElement('div');
      wrapper.className = 'previewTable';
      wrapper.tabIndex = 0;
      wrapper.setAttribute('role', 'region');
      wrapper.setAttribute('aria-label', '原文表格，较宽时可左右滚动');
      table.replaceWith(wrapper);
      wrapper.append(table);
    });
    content.querySelectorAll('img:not([src])').forEach((image) => {
      const placeholder = owner.createElement('span');
      placeholder.className = 'previewPlaceholder';
      placeholder.textContent = `[图片：${image.getAttribute('alt') || '请对照原文件'}]`;
      image.replaceWith(placeholder);
    });
    const container = owner.createElement('div');
    container.append(content);
    return `<!doctype html><html lang="zh-CN" data-theme="${previewTheme}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>${themeStyle}${previewStyle}</style></head><body>${container.innerHTML}</body></html>`;
  }, [preview?.format, preview?.content, previewTheme]);
  return (
    <div className="sourcePreview">
      {preview && (
        <div className="sourcePreviewModes" aria-label="原文显示方式">
          <button
            className="workButton subtle"
            aria-pressed={!plain}
            onClick={() => setPlain(false)}
          >
            格式预览
          </button>
          <button className="workButton subtle" aria-pressed={plain} onClick={() => setPlain(true)}>
            纯文字
          </button>
        </div>
      )}
      {!preview || plain ? (
        <pre>{document.content}</pre>
      ) : preview.format === 'html' ? (
        <iframe title="文档原文格式预览" sandbox="" referrerPolicy="no-referrer" srcDoc={html} />
      ) : (
        <MarkdownContent>{preview.content}</MarkdownContent>
      )}
    </div>
  );
});
