import { Parser } from 'htmlparser2';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 10000;

export function decodeImport(buffer) {
  if (!buffer.length || buffer.length > MAX_IMPORT_BYTES)
    throw new Error('请选择非空文件，每个文件最多 10 MB。');
  try {
    const encoding =
      buffer[0] === 0xff && buffer[1] === 0xfe
        ? 'utf-16le'
        : buffer[0] === 0xfe && buffer[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    return new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('文件编码无法识别，请使用浏览器导出的 UTF-8 文件。');
  }
}

function website(value) {
  const url = new URL(value.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    value.length > 8192
  )
    throw new Error('无效网址');
  return url;
}
function limit(count) {
  if (count > MAX_ENTRIES) throw new Error('每次最多导入 10,000 条记录，请拆分文件后重试。');
}

export function parseBookmarks(text) {
  const entries = [],
    folders = [];
  let folder = null,
    heading = null,
    link = null,
    total = 0,
    skipped = 0,
    lists = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === 'h3') heading = '';
        if (name === 'dl') {
          folders.push(folder);
          folder = null;
          lists++;
        }
        if (name === 'a') link = { url: attributes.href || '', title: '' };
      },
      ontext(value) {
        if (heading !== null) heading += value;
        if (link) link.title += value;
      },
      onclosetag(name) {
        if (name === 'h3' && heading !== null) {
          folder = heading.trim().slice(0, 300);
          heading = null;
        }
        if (name === 'dl') folders.pop();
        if (name === 'a' && link) {
          limit(++total);
          try {
            const url = website(link.url);
            entries.push({
              url: url.href,
              title: link.title.trim().slice(0, 500) || url.hostname,
              folder: folders.filter(Boolean).join(' / ').slice(0, 2000),
            });
          } catch {
            skipped++;
          }
          link = null;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(text);
  if (!lists) throw new Error('这不是浏览器书签 HTML，请从浏览器的书签管理器导出后再导入。');
  return { entries, total, skipped };
}

// RFC 4180: quoted commas, doubled quotes and multiline fields are retained verbatim.
function csvRows(text) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  const addField = () => {
    row.push(field);
    field = '';
    closed = false;
    if (row.length > 100) throw new Error('CSV 列数过多。');
  };
  const addRow = () => {
    addField();
    if (row.some((value) => value.length)) rows.push(row);
    row = [];
    limit(Math.max(0, rows.length - 1));
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ',') addField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      addRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else {
      if (closed || char === '"') throw new Error('CSV 引号格式无效，请重新导出密码文件。');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV 内容不完整，请重新导出密码文件。');
  if (field || row.length || closed) addRow();
  return rows;
}

export function parsePasswords(text) {
  const [header, ...rows] = csvRows(text.replace(/^\uFEFF/, ''));
  if (!header) throw new Error('密码 CSV 为空。');
  const columns = header.map((value) => value.trim().toLowerCase());
  const find = (names) => columns.findIndex((name) => names.includes(name));
  const urlIndex = find(['url', 'website', 'login_uri', '网址', '网站']);
  const usernameIndex = find(['username', 'user name', 'login_username', '用户名', '账号']);
  const passwordIndex = find(['password', 'login_password', '密码']);
  if ([urlIndex, usernameIndex, passwordIndex].includes(-1))
    throw new Error(
      '密码 CSV 需要 url、username、password 三列；支持 Chrome、Edge、Firefox 和 Safari 的常用导出格式。',
    );
  if (new Set(columns).size !== columns.length)
    throw new Error('CSV 表头存在重复列，请重新导出文件。');
  const entries = [];
  let skipped = 0;
  for (const row of rows) {
    try {
      if (row.length !== header.length) throw new Error();
      const origin = website(row[urlIndex]).origin;
      const username = row[usernameIndex],
        password = row[passwordIndex];
      if (
        !password ||
        password.length > 8192 ||
        username.length > 1000 ||
        /\0/.test(username + password)
      )
        throw new Error();
      entries.push({ origin, username, password });
    } catch {
      skipped++;
    }
  }
  return { entries, total: rows.length, skipped };
}
