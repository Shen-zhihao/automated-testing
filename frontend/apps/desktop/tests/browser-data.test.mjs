import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { WorkspaceStore } from '../src/store.mjs';
import { StorageService } from '../src/storage.mjs';
import { BrowserDataService } from '../src/browser-data/service.mjs';
import { decodeImport, parseBookmarks, parsePasswords } from '../src/browser-data/imports.mjs';
import { fillLoginForm } from '../src/browser-data/fill.mjs';

const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
<DT><H3>工作 &amp; 测试</H3><DL><p><DT><A HREF="https://one.example/path?a=1&amp;b=2">测试 &lt;首页&gt;</A>
<DT><H3>嵌套</H3><DL><DT><A HREF="https://two.example/">第二站</A></DL></DL>
<DT><A HREF="javascript:alert(1)">危险链接</A><DT><A HREF="file:///tmp/demo">文件</A>
<DT><A HREF="https://user:secret@one.example/">含凭据</A></DL>`;
const csv =
  'name,url,username,password,note\r\n测试,https://one.example/login,alice," a,""b""\n尾部 ",说明\r\n';
const key = randomBytes(32);
const vault = {
  async encrypt(text) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]);
  },
  async decrypt(buffer) {
    const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
  },
};
async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'test-agent-browser-data-'));
  const storage = new StorageService(path.join(root, 'profile'));
  t.after(async () => {
    storage.store.close();
    await rm(root, { recursive: true, force: true });
  });
  const service = new BrowserDataService(storage.store, { ...vault });
  const file = path.join(root, 'passwords.csv');
  await writeFile(file, csv);
  return { root, storage, store: storage.store, service, file };
}

test('bookmark HTML preserves nested folder paths and decodes entities without executing content', () => {
  const result = parseBookmarks(html);
  assert.equal(result.total, 5);
  assert.equal(result.skipped, 3);
  assert.deepEqual(result.entries, [
    { url: 'https://one.example/path?a=1&b=2', title: '测试 <首页>', folder: '工作 & 测试' },
    { url: 'https://two.example/', title: '第二站', folder: '工作 & 测试 / 嵌套' },
  ]);
  assert.throws(() => parseBookmarks('<p>普通需求文档</p>'), /书签 HTML/);
});
test('password CSV preserves quoted commas, quotes, newlines and password whitespace', () => {
  const result = parsePasswords('\uFEFF' + csv);
  assert.deepEqual(result.entries, [
    { origin: 'https://one.example', username: 'alice', password: ' a,"b"\n尾部 ' },
  ]);
  assert.equal(result.skipped, 0);
  const safari = parsePasswords(
    'Title,URL,Username,Password,Notes,OTPAuth\nTitle,https://example.com,a,b,,\n',
  );
  assert.equal(safari.entries[0].password, 'b');
  const firefox = parsePasswords(
    'url,username,password,httpRealm,formActionOrigin\nhttps://example.com,a,b,,https://example.com\n',
  );
  assert.equal(firefox.entries[0].origin, 'https://example.com');
});
test('malformed CSV and unsupported rows fail without reflecting passwords in errors', () => {
  assert.throws(
    () => parsePasswords('url,username,password\nhttps://a.example,a,"secret-value'),
    (error) => !error.message.includes('secret-value'),
  );
  assert.throws(() => parsePasswords('url,password\nhttps://a.example,b'), /三列/);
  assert.throws(() => parsePasswords('url,username,password,password\n'), /重复列/);
  const invalid = parsePasswords(
    'url,username,password\nfile:///a,a,secret\nhttps://a.example,a,\nandroid://abc,a,secret\nhttps://a.example,,valid\n',
  );
  assert.equal(invalid.skipped, 3);
  assert.equal(invalid.entries.length, 1);
});
test('UTF-8 BOM and Windows UTF-16 exports decode correctly; limits are explicit', () => {
  assert.equal(decodeImport(Buffer.from('\uFEFF标题')), '标题');
  assert.equal(
    decodeImport(Buffer.concat([Buffer.from([255, 254]), Buffer.from('标题', 'utf16le')])),
    '标题',
  );
  assert.throws(() => decodeImport(Buffer.from([255, 0, 255])), /编码/);
  assert.throws(() => decodeImport(Buffer.alloc(10 * 1024 * 1024 + 1)), /10 MB/);
  assert.throws(
    () => parsePasswords('url,username,password\n' + 'https://a.example,a,b\n'.repeat(10001)),
    /10,000/,
  );
});
test('import encrypts credentials, hides public data, and preserves existing records on reimport', async (t) => {
  const { service, file, store, root } = await setup(t);
  const result = await service.importFile('passwords', file);
  assert.equal(result.imported, 1);
  const saved = store.db.prepare('SELECT * FROM browser_passwords').get();
  assert(!JSON.stringify(saved).includes('alice'));
  assert(!JSON.stringify(saved).includes('尾部'));
  const publicData = service.list();
  assert.deepEqual(Object.keys(publicData.passwords[0]).sort(), ['id', 'origin', 'usernameLabel']);
  assert(!JSON.stringify(publicData).includes('encrypted'));
  assert.equal(publicData.passwords[0].usernameLabel, 'al***');
  await writeFile(file, 'url,username,password\nhttps://one.example/another,alice,replacement\n');
  assert.equal((await service.importFile('passwords', file)).duplicates, 1);
  assert.equal(
    store.db.prepare('SELECT encrypted FROM browser_passwords').get().encrypted,
    saved.encrypted,
  );
  const bookmarks = path.join(root, 'bookmarks.html');
  await writeFile(bookmarks, html);
  assert.equal((await service.importFile('bookmarks', bookmarks)).imported, 2);
  assert.equal((await service.importFile('bookmarks', bookmarks)).duplicates, 2);
  service.remove('passwords', saved.id);
  assert.equal(service.list().passwords.length, 0);
});
test('encryption failure is atomic and never exposes a credential through errors', async (t) => {
  const { service, file, store } = await setup(t);
  await service.importFile('passwords', file);
  await writeFile(
    file,
    'url,username,password\nhttps://two.example,second,secret2\nhttps://three.example,third,secret3',
  );
  let count = 0;
  service.vault.encrypt = async (value) => {
    if (++count === 2) throw new Error(value);
    return vault.encrypt(value);
  };
  await assert.rejects(
    service.importFile('passwords', file),
    (error) => error.message.includes('未导入') && !error.message.includes('secret3'),
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM browser_passwords').get().count, 1);
});
test('concurrent imports deduplicate and cancelling before selecting a file needs no write', async (t) => {
  const { service, file } = await setup(t);
  const results = await Promise.all([
    service.importFile('passwords', file),
    service.importFile('passwords', file),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.imported, 0),
    1,
  );
  assert.equal(
    results.reduce((sum, result) => sum + result.duplicates, 0),
    1,
  );
  await assert.rejects(service.importFile('passwords', file + '.html'), /CSV/);
  await assert.rejects(service.importFile('passwords', file + '-missing.csv'), /无法读取/);
});
test('imported browser data survives storage migration and restart with encrypted passwords intact', async (t) => {
  const { service, file, storage, root } = await setup(t);
  await service.importFile('passwords', file);
  const target = await mkdtemp(path.join(root, 'moved-'));
  await storage.relocate(target);
  assert.equal(service.list().passwords.length, 1);
  const reopened = new WorkspaceStore(storage.store.file);
  try {
    const newService = new BrowserDataService(reopened, vault);
    let captured;
    await newService.fill(
      {
        alive: () => true,
        info: () => ({ url: 'https://one.example/login' }),
        fillCredential: async (origin, data) => {
          captured = { origin, ...data };
        },
      },
      newService.list().passwords[0].id,
    );
    assert.equal(captured.password, ' a,"b"\n尾部 ');
  } finally {
    reopened.close();
  }
});
test('credential selection refuses different scheme, port, subdomain, running test or closed page before decryption', async (t) => {
  const { service, file } = await setup(t);
  await service.importFile('passwords', file);
  const id = service.list().passwords[0].id;
  service.vault.decrypt = () => {
    throw new Error('must not decrypt');
  };
  for (const url of [
    'https://evil.example/',
    'http://one.example/',
    'https://one.example:8443/',
    'https://sub.one.example/',
  ])
    await assert.rejects(service.fill({ alive: () => true, info: () => ({ url }) }, id), /不一致/);
  await assert.rejects(
    service.fill({ alive: () => true, automationOrigin: 'https://one.example' }, id),
    /任务未执行/,
  );
  await assert.rejects(service.fill({ alive: () => false }, id), /任务未执行/);
});

function loginPage({
  origin = 'https://one.example',
  action = 'https://one.example/login',
  twoPasswords = false,
  newPassword = false,
  redirectOnUsername = false,
} = {}) {
  const location = { origin, href: origin + '/login' };
  class Input {
    constructor(type, autocomplete = '') {
      this.type = type;
      this.autocomplete = autocomplete;
      this.isConnected = true;
      this._value = '';
    }
    get value() {
      return this._value;
    }
    set value(value) {
      this._value = value;
    }
    getClientRects() {
      return [{}];
    }
    dispatchEvent() {
      if (this.type === 'text' && redirectOnUsername) location.origin = 'https://evil.example';
    }
  }
  const username = new Input('text', 'username'),
    password = new Input('password', newPassword ? 'new-password' : 'current-password');
  const inputs = [username, password];
  if (twoPasswords) inputs.push(new Input('password'));
  const form = { action, querySelectorAll: () => inputs };
  password.form = form;
  const document = {
    querySelectorAll: (selector) =>
      selector.includes('password') ? inputs.filter((input) => input.type === 'password') : inputs,
  };
  return {
    username,
    password,
    run: () =>
      runInNewContext(`(${fillLoginForm.toString()})(data)`, {
        location,
        document,
        HTMLInputElement: Input,
        Event: class {},
        URL,
        getComputedStyle: () => ({ visibility: 'visible' }),
        data: { origin: 'https://one.example', username: 'alice', password: 'secret' },
      }),
  };
}
test('login fill targets a unique same-origin main-frame form without submitting', () => {
  const page = loginPage();
  assert.match(page.run(), /已填入/);
  assert.equal(page.username.value, 'alice');
  assert.equal(page.password.value, 'secret');
});
test('login fill rejects redirect races, cross-origin actions, registration forms and ambiguous passwords', () => {
  for (const options of [
    { origin: 'https://evil.example' },
    { action: 'https://evil.example/login' },
    { twoPasswords: true },
    { newPassword: true },
    { redirectOnUsername: true },
  ]) {
    const page = loginPage(options);
    assert.throws(page.run);
    assert.equal(page.password.value, '');
  }
});
