import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import { convert } from 'html-to-text';

export const FILE_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'html',
  'htm',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
];
export const MAX_CHARACTERS = 200000;
const MAX_BYTES = 20 * 1024 * 1024;

export function normalizeContent(text) {
  if (typeof text !== 'string') throw new Error('文档未返回可读取的文字。');
  const value = text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
  if (!value) throw new Error('未读取到文字。扫描件或图片需先进行 OCR；本版本只提取文档中的文字。');
  if (value.length > MAX_CHARACTERS)
    throw new Error('文档文字超过 20 万字符，请拆分后导入；内容没有被截断保存。');
  return value;
}

function checkedZip(buffer) {
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
  if (extension === 'pdf') content = await parsePdf(buffer, warnings);
  else if (['docx', 'xlsx', 'pptx'].includes(extension)) {
    const zip = checkedZip(buffer);
    if (extension === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
      if (result.messages.length) warnings.push('Word 中部分对象可能无法提取，请核对原文预览。');
    } else if (extension === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheets = [];
      let cells = 0;
      workbook.eachSheet((sheet) => {
        const rows = [];
        sheet.eachRow((row, index) => {
          const values = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            if (++cells > 50000) throw new Error('表格超过 5 万单元格，请拆分后导入。');
            values.push(cell.text.replace(/\t|\n/g, ' '));
          });
          rows.push(`${index}\t${values.join('\t')}`);
        });
        if (rows.length) sheets.push(`[工作表：${sheet.name}]\n${rows.join('\n')}`);
      });
      content = sheets.join('\n\n');
      warnings.push('公式使用文件保存时的结果，不执行重新计算。');
    } else {
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
    warnings.push('仅导入文字；图片、图表、附件和版式不参与分析。');
  } else {
    content = decode(buffer);
    if (content.includes('\0')) throw new Error('文件不是可读取的纯文本。');
    if (['html', 'htm'].includes(extension))
      content = convert(content, {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { ignoreHref: true } },
        ],
      });
  }
  return {
    name: path.basename(filePath),
    source: filePath,
    kind: extension,
    content: normalizeContent(content),
    warnings,
  };
}
