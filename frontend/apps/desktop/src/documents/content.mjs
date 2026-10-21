// Shared metadata does not load any document parsing libraries.
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
