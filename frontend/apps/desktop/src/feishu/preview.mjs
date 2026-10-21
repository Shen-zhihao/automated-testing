import { escapeHtml, htmlPreview } from '../documents/preview.mjs';

const textTypes = [
  'text',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'heading7',
  'heading8',
  'heading9',
  'bullet',
  'ordered',
  'quote',
  'todo',
  'code',
  'page',
];

function inline(text) {
  return (text?.elements ?? [])
    .map((element) => {
      const run = element.text_run;
      let value = escapeHtml(
        run?.content ??
          element.equation?.content ??
          element.mention_doc?.title ??
          element.mention_user?.name ??
          element.link_preview?.title ??
          '',
      );
      const style = run?.text_element_style ?? {};
      if (style.inline_code) value = `<code>${value}</code>`;
      if (style.bold) value = `<strong>${value}</strong>`;
      if (style.italic) value = `<em>${value}</em>`;
      if (style.strikethrough) value = `<s>${value}</s>`;
      if (style.underline) value = `<u>${value}</u>`;
      return value.replace(/\n/g, '<br>');
    })
    .join('');
}

export function renderFeishuBlocks(blocks, documentId, title, warnings, images = new Map()) {
  const byId = new Map(blocks.map((block) => [block.block_id, block]));
  const visiting = new Set();
  const unsupported = new Set();
  let imageCharacters = 0;
  let oversizedImages = false;
  const typeOf = (block) => textTypes.find((type) => block[type]);
  const renderChildren = (ids, depth) => {
    let html = '',
      listType = '';
    for (const id of ids ?? []) {
      const block = byId.get(id);
      if (!block) throw new Error('飞书文档结构不完整，请稍后重新读取。');
      const type = typeOf(block);
      const nextList = type === 'bullet' ? 'ul' : type === 'ordered' ? 'ol' : '';
      if (nextList !== listType) {
        if (listType) html += `</${listType}>`;
        if (nextList) {
          const start = Number(block.ordered?.style?.sequence);
          html += `<${nextList}${nextList === 'ol' && Number.isInteger(start) && start > 0 ? ` start="${start}"` : ''}>`;
        }
        listType = nextList;
      }
      html += render(block, depth);
    }
    return html + (listType ? `</${listType}>` : '');
  };
  const render = (block, depth = 0) => {
    if (depth > 80 || visiting.has(block.block_id)) throw new Error('飞书文档层级过深或结构异常。');
    visiting.add(block.block_id);
    try {
      if (block.table) {
        const {
          row_size: rows,
          column_size: columns,
          merge_info: merges = [],
        } = block.table.property ?? {};
        if (
          !Number.isInteger(rows) ||
          !Number.isInteger(columns) ||
          rows < 1 ||
          columns < 1 ||
          rows * columns > 50000
        )
          throw new Error('飞书表格结构无效或超过 5 万单元格。');
        const covered = new Set();
        let html = '<table><tbody>';
        for (let row = 0; row < rows; row++) {
          html += '<tr>';
          for (let column = 0; column < columns; column++) {
            const index = row * columns + column;
            if (covered.has(index)) continue;
            const merge = merges[index];
            const rowSpan = Math.min(rows - row, Math.max(1, Math.trunc(merge?.row_span) || 1));
            const colSpan = Math.min(
              columns - column,
              Math.max(1, Math.trunc(merge?.col_span) || 1),
            );
            for (let r = row; r < row + rowSpan; r++)
              for (let c = column; c < column + colSpan; c++) covered.add(r * columns + c);
            const cell = byId.get(block.table.cells?.[index] ?? block.children?.[index]);
            if (!cell) throw new Error('飞书表格单元格缺失，请重新读取。');
            const tag = row === 0 && block.table.property.header_row ? 'th' : 'td';
            html += `<${tag} rowspan="${rowSpan}" colspan="${colSpan}">${render(cell, depth + 1)}</${tag}>`;
          }
          html += '</tr>';
        }
        return html + '</tbody></table>';
      }
      const children = () => renderChildren(block.children, depth + 1);
      const type = typeOf(block);
      if (type) {
        const value = inline(block[type]);
        const align = { 1: 'left', 2: 'center', 3: 'right' }[block[type].style?.align];
        const attributes = align ? ` style="text-align:${align}"` : '';
        if (type === 'page') return `<h1>${value || escapeHtml(title)}</h1>${children()}`;
        if (type.startsWith('heading')) {
          const level = Math.min(6, Number(type.slice(7)));
          return `<h${level}${attributes}>${value}</h${level}>${children()}`;
        }
        if (type === 'bullet' || type === 'ordered') return `<li>${value}${children()}</li>`;
        if (type === 'code')
          return `<pre><code>${value.replace(/<br>/g, '\n')}</code></pre>${children()}`;
        if (type === 'quote') return `<blockquote>${value}${children()}</blockquote>`;
        if (type === 'todo')
          return `<p>${block.todo.style?.done ? '☑' : '☐'} ${value}</p>${children()}`;
        return `<p${attributes}>${value || '<br>'}</p>${children()}`;
      }
      if (block.divider) return '<hr>';
      if (block.image) {
        const image = images.get(block.image.token);
        if (image?.src) {
          // 同一素材多次出现也计入预览体积，为正文结构留出空间。
          imageCharacters += image.src.length;
          if (imageCharacters <= 7 * 1024 * 1024) {
            const width = Number(block.image.width);
            return `<p><img src="${escapeHtml(image.src)}" alt="飞书文档图片"${Number.isInteger(width) && width > 0 && width <= 20000 ? ` width="${width}"` : ''}></p>${children()}`;
          }
          oversizedImages = true;
        }
        if (image)
          return `<p><em>[图片未展开：${escapeHtml(image.error || '图片重复展示超过本地预览大小上限')}，请查看飞书原文]</em></p>${children()}`;
      }
      if (
        block.table_cell ||
        block.grid ||
        block.grid_column ||
        block.callout ||
        block.quote_container
      )
        return `<div>${children()}</div>`;
      const label = block.image
        ? '图片'
        : block.file
          ? '附件'
          : block.bitable
            ? '多维表格'
            : block.sheet
              ? '电子表格'
              : block.board
                ? '画板'
                : '嵌入内容';
      unsupported.add(label);
      return `<p><em>[${label}${block.file?.name ? `：${escapeHtml(block.file.name)}` : ''}，请查看飞书原文]</em></p>${children()}`;
    } finally {
      visiting.delete(block.block_id);
    }
  };
  const root = byId.get(documentId) ?? blocks.find((block) => block.page);
  const html = root
    ? render(root)
    : `<h1>${escapeHtml(title)}</h1>${renderChildren(
        blocks.filter((block) => !byId.has(block.parent_id)).map((block) => block.block_id),
        0,
      )}`;
  if (unsupported.size)
    warnings.push(`已保留文档结构；${[...unsupported].join('、')}未展开，请对照飞书原文。`);
  if (oversizedImages)
    warnings.push('图片重复展示超过本地预览大小上限，部分图片以位置说明显示，请对照飞书原文。');
  return htmlPreview(html, warnings);
}
