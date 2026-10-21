export const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char],
  );

export function htmlPreview(content, warnings) {
  if (content.length > 8 * 1024 * 1024) {
    warnings.push('格式预览超过 8 MB，已保留完整提取文字；请用原应用查看版式。');
    return null;
  }
  return { format: 'html', content };
}

export function delimitedPreview(text, separator) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    cells = 0;
  const push = () => {
    if (++cells > 50000) throw new Error('表格超过 5 万单元格，请拆分后导入。');
    row.push(cell);
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && (quoted || !cell)) {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && char === separator) push();
    else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) {
    push();
    rows.push(row);
  }
  return `<table><tbody>${rows
    .map(
      (values, index) =>
        `<tr>${values
          .map((value) => {
            const tag = index === 0 ? 'th' : 'td';
            return `<${tag}>${escapeHtml(value).replace(/\n/g, '<br>')}</${tag}>`;
          })
          .join('')}</tr>`,
    )
    .join('')}</tbody></table>`;
}
