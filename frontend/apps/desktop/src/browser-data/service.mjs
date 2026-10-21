import { open } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

const mask = (value) =>
  value
    ? `${[...value].slice(0, 2).join('')}***${value.includes('@') ? value.slice(value.lastIndexOf('@')) : ''}`
    : '未设置用户名';
export class BrowserDataService {
  constructor(store, vault) {
    this.store = store;
    this.vault = vault;
    this.pending = Promise.resolve();
  }
  list() {
    return {
      bookmarks: this.store.db
        .prepare('SELECT id, title, url, folder FROM browser_bookmarks ORDER BY folder, title, id')
        .all(),
      passwords: this.store.db
        .prepare(
          'SELECT id, origin, username_label AS usernameLabel FROM browser_passwords ORDER BY origin, username_label, id',
        )
        .all(),
    };
  }
  importFile(kind, file) {
    // Serialize duplicate checks and commits, including concurrent imports from chat and browser.
    const operation = this.pending.then(() => this.performImport(kind, file));
    this.pending = operation.catch(() => {});
    return operation;
  }
  async performImport(kind, file) {
    if (!['bookmarks', 'passwords'].includes(kind)) throw new Error('导入类型无效。');
    const { decodeImport, MAX_IMPORT_BYTES, parseBookmarks, parsePasswords } =
      await import('./imports.mjs');
    const extension = path.extname(file).toLowerCase();
    if (!(kind === 'bookmarks' ? ['.html', '.htm'] : ['.csv']).includes(extension))
      throw new Error(kind === 'bookmarks' ? '请选择书签 HTML 文件。' : '请选择密码 CSV 文件。');
    let handle, buffer;
    try {
      handle = await open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_IMPORT_BYTES) throw new Error();
      buffer = await handle.readFile();
    } catch {
      throw new Error('无法读取此文件，请选择不超过 10 MB 的本地文件。');
    } finally {
      await handle?.close();
    }
    let parsed;
    try {
      const text = decodeImport(buffer);
      parsed = kind === 'bookmarks' ? parseBookmarks(text) : parsePasswords(text);
    } finally {
      buffer.fill(0);
    }
    const result = {
      kind,
      total: parsed.total,
      imported: 0,
      duplicates: 0,
      skipped: parsed.skipped,
    };
    const records = [],
      seen = new Set();
    try {
      for (const item of parsed.entries) {
        const key = createHash('sha256')
          .update(
            JSON.stringify(
              kind === 'bookmarks' ? [item.url, item.folder] : [item.origin, item.username],
            ),
          )
          .digest('hex');
        const table = kind === 'bookmarks' ? 'browser_bookmarks' : 'browser_passwords';
        if (
          seen.has(key) ||
          this.store.db.prepare(`SELECT id FROM ${table} WHERE import_key = ?`).get(key)
        ) {
          result.duplicates++;
          continue;
        }
        seen.add(key);
        if (kind === 'bookmarks') records.push({ ...item, key });
        else {
          let encrypted;
          try {
            encrypted = (
              await this.vault.encrypt(
                JSON.stringify({ username: item.username, password: item.password }),
              )
            ).toString('base64');
          } catch {
            throw new Error('系统安全存储不可用，密码未导入。请解锁系统凭据存储后重试。');
          }
          records.push({ origin: item.origin, usernameLabel: mask(item.username), encrypted, key });
        }
      }
      this.store.db.exec('BEGIN');
      try {
        for (const item of records) {
          if (kind === 'bookmarks')
            this.store.db
              .prepare(
                'INSERT INTO browser_bookmarks (id, import_key, title, url, folder) VALUES (?, ?, ?, ?, ?)',
              )
              .run(randomUUID(), item.key, item.title, item.url, item.folder);
          else
            this.store.db
              .prepare(
                'INSERT INTO browser_passwords (id, import_key, origin, username_label, encrypted) VALUES (?, ?, ?, ?, ?)',
              )
              .run(randomUUID(), item.key, item.origin, item.usernameLabel, item.encrypted);
        }
        this.store.db.exec('COMMIT');
      } catch {
        this.store.db.exec('ROLLBACK');
        throw new Error('本地保存失败，本次导入未写入。');
      }
      result.imported = records.length;
      return result;
    } finally {
      for (const item of parsed.entries) {
        delete item.password;
        delete item.username;
      }
    }
  }
  remove(kind, id) {
    if (!['bookmarks', 'passwords'].includes(kind) || typeof id !== 'string')
      throw new Error('记录无效。');
    this.store.db
      .prepare(
        `DELETE FROM ${kind === 'bookmarks' ? 'browser_bookmarks' : 'browser_passwords'} WHERE id = ?`,
      )
      .run(id);
  }
  async fill(browser, id) {
    if (!browser?.alive() || browser.automationOrigin)
      throw new Error('请在任务未执行时打开登录页面。');
    const entry = this.store.db
      .prepare('SELECT origin, encrypted FROM browser_passwords WHERE id = ?')
      .get(id);
    if (!entry) throw new Error('此密码记录已不存在。');
    if (new URL(browser.info().url).origin !== entry.origin)
      throw new Error('当前网站与该密码所属网站不一致，未填入。');
    let credentials;
    try {
      credentials = JSON.parse(await this.vault.decrypt(Buffer.from(entry.encrypted, 'base64')));
    } catch {
      throw new Error('无法解密此密码，请在原系统账号下重试，或移除此记录后重新导入。');
    }
    try {
      await browser.fillCredential(entry.origin, credentials);
    } finally {
      credentials.username = '';
      credentials.password = '';
    }
  }
}
