import { FILE_EXTENSIONS, MAX_CHARACTERS, normalizeContent } from './content.mjs';
export { FILE_EXTENSIONS, MAX_CHARACTERS, normalizeContent } from './content.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { escapeHtml, htmlPreview, delimitedPreview } from './preview.mjs';

const MAX_BYTES = 20 * 1024 * 1024;
const DOCX_STYLE_MAP = [
  ...Array.from({ length: 6 }, (_, index) => index + 1).flatMap((level) => [
    `p[style-name='标题 ${level}'] => h${level}:fresh`,
    `p[style-name='标题${level}'] => h${level}:fresh`,
  ]),
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='标题'] => h1:fresh",
  'u => u',
];

async function checkedZip(buffer) {
  const { default: AdmZip } = await import('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (
    entries.length > 10000 ||
    entries.reduce((size, entry) => size + entry.header.size, 0) > 100 * 1024 * 1024
  ) {
    throw new Error('文档解压后过大或结构过于复杂，请拆分后导入。');
  }
  return zip;
}

function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(buffer);
  }
}

const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const decodeXmlText = (value) =>
  value.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (match, name) => {
    const predefined = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (predefined[name]) return predefined[name];
    const code = name.startsWith('#x') ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) &&
      code > 0 &&
      code <= 0x10ffff &&
      !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : match;
  });
function slideText(node) {
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => {
    if (key === 'a:t')
      return asArray(value).map((item) =>
        decodeXmlText(String(typeof item === 'object' ? (item['#text'] ?? '') : item)),
      );
    return asArray(value).flatMap(slideText);
  });
}

async function parsePdf(buffer, warnings) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfModule = import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    standardFontDataUrl: fileURLToPath(new URL('../../standard_fonts/', pdfModule)),
    cMapUrl: fileURLToPath(new URL('../../cmaps/', pdfModule)),
    cMapPacked: true,
    wasmUrl: fileURLToPath(new URL('../../wasm/', pdfModule)),
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 300) throw new Error('PDF 超过 300 页，请拆分后导入。');
    const pages = [];
    const blank = [];
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const data = await page.getTextContent();
      const text = data.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      if (!text) blank.push(number);
      else pages.push(`[第 ${number} 页]\n${text}`);
      characters += text.length;
      if (characters > MAX_CHARACTERS) throw new Error('PDF 文字超过 20 万字符，请拆分后导入。');
      page.cleanup();
    }
    if (blank.length)
      warnings.push(
        `${blank.length} 页未提取到文字，可能是图片或空白页（如第 ${blank.slice(0, 10).join('、')} 页）；尚未进行 OCR。`,
      );
    return pages.join('\n\n');
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('PDF 受密码保护，请解密后导入。');
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function parseDocument(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!FILE_EXTENSIONS.includes(extension))
    throw new Error('不支持此格式。旧版 DOC / XLS / PPT 请另存为 DOCX / XLSX / PPTX。');
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('请选择 20 MB 以内的文件。');
  const buffer = await readFile(filePath);
  if (buffer.length > MAX_BYTES) throw new Error('文件超过 20 MB。');
  const warnings = [];
  let content;
  let preview = null;
  if (extension === 'pdf') content = await parsePdf(buffer, warnings);
  else if (['docx', 'xlsx', 'pptx'].includes(extension)) {
    const zip = await checkedZip(buffer);
    if (extension === 'docx') {
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
      let imageBytes = 0;
      const imageWarnings = new Set();
      const formatted = await mammoth.convertToHtml(
        { buffer },
        {
          styleMap: DOCX_STYLE_MAP,
          convertImage: mammoth.images.imgElement(async (image) => {
            if (
              !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.contentType)
            ) {
              imageWarnings.add('部分图片格式暂不支持，已保留图片位置说明，请对照原文件。');
              return { src: '', alt: '此图片格式暂不支持预览' };
            }
            try {
              const data = await image.read();
              imageBytes += data.length;
              if (imageBytes > 6 * 1024 * 1024) {
                imageWarnings.add('内嵌图片总量超过 6 MB，部分图片以位置说明显示，请对照原文件。');
                return { src: '', alt: '图片过大，请查看原文件' };
              }
              return { src: `data:${image.contentType};base64,${data.toString('base64')}` };
            } catch {
              imageWarnings.add('部分图片无法读取，已保留图片位置说明，请对照原文件。');
              return { src: '', alt: '图片无法读取，请查看原文件' };
            }
          }),
        },
      );
      preview = htmlPreview(formatted.value, warnings);
      warnings.push(...imageWarnings);
      if (result.messages.length || formatted.messages.length)
        warnings.push('Word 中部分对象或样式无法完整转换，请核对原文预览。');
    } else if (extension === 'xlsx') {
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheets = [];
      const formattedSheets = [];
      let cells = 0;
      workbook.eachSheet((sheet) => {
        const rows = [];
        const formattedRows = [];
        if (sheet.rowCount * sheet.columnCount > 50000)
          throw new Error('表格超过 5 万单元格，请拆分后导入。');
        const merges = new Map();
        for (const range of sheet.model.merges ?? []) {
          const [start, end = start] = range.split(':');
          const first = sheet.getCell(start),
            last = sheet.getCell(end);
          merges.set(start, { rows: last.row - first.row + 1, columns: last.col - first.col + 1 });
        }
        sheet.eachRow((row, index) => {
          const values = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            if (++cells > 50000) throw new Error('表格超过 5 万单元格，请拆分后导入。');
            values.push(cell.text.replace(/\t|\n/g, ' '));
          });
          rows.push(`${index}\t${values.join('\t')}`);
          const formattedCells = [];
          for (let column = 1; column <= sheet.columnCount; column++) {
            const cell = row.getCell(column);
            if (cell.isMerged && cell.master.address !== cell.address) continue;
            const merge = merges.get(cell.address);
            const value = escapeHtml(cell.text).replace(/\n/g, '<br>');
            formattedCells.push(
              `<td${merge ? ` rowspan="${merge.rows}" colspan="${merge.columns}"` : ''}>${cell.font?.bold ? `<strong>${value}</strong>` : value}</td>`,
            );
          }
          formattedRows.push(`<tr>${formattedCells.join('')}</tr>`);
        });
        if (rows.length) {
          sheets.push(`[工作表：${sheet.name}]\n${rows.join('\n')}`);
          formattedSheets.push(
            `<h2>${escapeHtml(sheet.name)}</h2><table><tbody>${formattedRows.join('')}</tbody></table>`,
          );
        }
      });
      content = sheets.join('\n\n');
      preview = htmlPreview(formattedSheets.join('\n'), warnings);
      warnings.push('公式使用文件保存时的结果，不执行重新计算。');
    } else {
      const { XMLParser } = await import('fast-xml-parser');
      const parser = new XMLParser({
        ignoreAttributes: false,
        parseTagValue: false,
        processEntities: false,
      });
      const presentation = parser.parse(zip.readAsText('ppt/presentation.xml'));
      const relationships = parser.parse(zip.readAsText('ppt/_rels/presentation.xml.rels'));
      const targets = new Map(
        asArray(relationships.Relationships?.Relationship).map((item) => [
          item['@_Id'],
          item['@_Target'],
        ]),
      );
      const ids = asArray(presentation['p:presentation']?.['p:sldIdLst']?.['p:sldId']);
      if (ids.length > 500) throw new Error('演示文稿超过 500 页，请拆分后导入。');
      content = ids
        .map((item, index) => {
          const target = targets.get(item['@_r:id']);
          if (!target) throw new Error('幻灯片关联文件缺失。');
          const entry = path.posix.normalize(
            target.startsWith('/') ? target.slice(1) : `ppt/${target}`,
          );
          if (!/^ppt\/slides\/[^/]+\.xml$/.test(entry) || !zip.getEntry(entry))
            throw new Error('幻灯片文件结构无效。');
          return `[幻灯片 ${index + 1}]\n${slideText(parser.parse(zip.readAsText(entry))).join('\n')}`;
        })
        .join('\n\n');
    }
    warnings.push(
      '分析仅使用提取文字。格式预览保留可识别的标题、段落和表格，复杂分页、图表与浮动布局请对照原文件。',
    );
  } else {
    content = decode(buffer);
    if (content.includes('\0')) throw new Error('文件不是可读取的纯文本。');
    if (['html', 'htm'].includes(extension)) {
      const { extractHtml } = await import('./html.mjs');
      ({ content, preview } = extractHtml(content, warnings));
    } else if (['md', 'markdown'].includes(extension)) preview = { format: 'markdown', content };
    else if (['csv', 'tsv'].includes(extension))
      preview = htmlPreview(delimitedPreview(content, extension === 'csv' ? ',' : '\t'), warnings);
  }
  return {
    name: path.basename(filePath),
    source: filePath,
    kind: extension,
    content: normalizeContent(content),
    preview,
    warnings,
  };
}
