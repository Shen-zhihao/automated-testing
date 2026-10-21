import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FeishuService, parseFeishuUrl } from '../src/feishu.mjs';
import { FeishuApi, TOKEN_URL } from '../src/feishu/api.mjs';
import { SettingsService, DEFAULT_MODEL } from '../src/settings.mjs';
import { WorkspaceStore } from '../src/store.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokens = (n = 1, lifetime = 7200) => ({
  code: 0,
  access_token: `private-app-access-${n}`,
  expires_in: lifetime,
  token_type: 'Bearer',
});
const credentials = { appId: 'cli_test_app', appSecret: 'private-app-secret' };
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const vault = () => {
  const key = randomBytes(32);
  return {
    async encrypt(value) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    async decrypt(value) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString();
    },
  };
};
function setup(t, options = {}) {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, vault());
  const service = new FeishuService(settings, {
    fetchImpl: async () => json(tokens()),
    ...options,
  });
  t.after(async () => {
    await service.close();
    store.close();
  });
  return { store, settings, service };
}
function documentResponse(url) {
  if (url.includes('/get_node?'))
    return json({ code: 0, data: { node: { obj_type: 'docx', obj_token: 'Doc123' } } });
  if (url.endsWith('/raw_content'))
    return json({ code: 0, data: { content: '登录失败三次后锁定账号。' } });
  if (url.includes('/blocks?'))
    return json({
      code: 0,
      data: {
        items: [
          {
            block_id: 'Doc123',
            page: { elements: [{ text_run: { content: '登录需求' } }] },
            children: ['paragraph', 'image'],
          },
          {
            block_id: 'paragraph',
            parent_id: 'Doc123',
            text: { elements: [{ text_run: { content: '登录失败三次后锁定账号。' } }] },
          },
          { block_id: 'image', parent_id: 'Doc123', image: { token: 'not-downloaded' } },
        ],
        has_more: false,
      },
    });
  return json({ code: 0, data: { document: { title: '登录需求' } } });
}

test('Feishu docx/wiki URLs reject lookalike hosts, credential URLs and unsupported resources', () => {
  assert.deepEqual(parseFeishuUrl('https://tenant.feishu.cn/wiki/AbCd12?from=share#part'), {
    url: 'https://tenant.feishu.cn/wiki/AbCd12',
    type: 'wiki',
    token: 'AbCd12',
  });
  for (const url of [
    'https://feishu.cn.evil.example/docx/Abc',
    'https://feishu.cn@evil.example/docx/Abc',
    'http://tenant.feishu.cn/docx/Abc',
    'https://tenant.feishu.cn/base/Abc',
    'file:///docx/Abc',
  ])
    assert.throws(() => parseFeishuUrl(url));
});

test('migration retains encrypted app credentials and local data but removes user OAuth state', async (t) => {
  const { store, settings } = setup(t);
  const encrypted = (await settings.vault.encrypt(credentials.appSecret)).toString('base64');
  store.writeSettings({
    model: { ...DEFAULT_MODEL, model: 'my-model' },
    apiKey: 'encrypted-model-key',
    connectorPath: '/not/read/old/config.toml',
    feishu: {
      appId: credentials.appId,
      appSecret: encrypted,
      callbackPort: 42819,
      tokens: 'old-user-tokens',
      expiresAt: 9999999999999,
      refreshExpiresAt: 9999999999999,
    },
  });
  const document = store.addDocument({
    name: '已有文档',
    source: 'local',
    kind: 'txt',
    content: '原文',
    warnings: [],
  });
  const migrated = new FeishuService(settings, { fetchImpl: async () => json(tokens()) });
  t.after(() => migrated.close());
  assert.deepEqual(settings.stored().feishu, { appId: credentials.appId, appSecret: encrypted });
  assert.equal(settings.stored().connectorPath, undefined);
  assert.equal(settings.stored().apiKey, 'encrypted-model-key');
  assert.equal(settings.public().model.model, 'my-model');
  assert.equal(store.getDocument(document.id).content, '原文');
  assert.equal(migrated.status().configured, true);
  assert.equal(migrated.status().connected, false);
  assert.equal(await migrated.accessToken(), tokens().access_token);
});

test('connection test uses client credentials, encrypts only the secret and never exposes or persists tokens', async (t) => {
  let calls = 0;
  const { settings, store, service } = setup(t, {
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://accounts.feishu.cn/oauth/v3/token');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.deepEqual(JSON.parse(options.body), {
        grant_type: 'client_credentials',
        client_id: credentials.appId,
        client_secret: credentials.appSecret,
      });
      return json(tokens());
    },
  });
  const status = await service.testConnection(credentials);
  assert.equal(status.connected, true);
  assert.equal(status.testing, false);
  assert.doesNotMatch(
    JSON.stringify(status),
    /private-|tokens|appSecret"|callback|redirect|refresh/,
  );
  assert.doesNotMatch(JSON.stringify(store.readSettings()), /private-|accessToken|expiresAt/);
  assert.equal(
    await settings.vault.decrypt(Buffer.from(settings.stored().feishu.appSecret, 'base64')),
    credentials.appSecret,
  );
  await settings.save({
    model: { ...DEFAULT_MODEL, model: 'my-model' },
    apiKey: '',
    clearApiKey: false,
  });
  await service.testConnection({ ...credentials, appSecret: '' });
  assert.equal(calls, 2, 'test connection always verifies with Feishu, even with a cached token');
  assert.equal(settings.public().model.model, 'my-model');
  await assert.rejects(
    service.testConnection({ appId: 'cli_different', appSecret: '' }),
    /填写 App Secret/,
  );
  assert.equal(calls, 2);
});

test('failed replacement, malformed response and encryption failure preserve saved credentials', async (t) => {
  let response = () => json(tokens());
  const { settings, service } = setup(t, { fetchImpl: async () => response() });
  await service.testConnection(credentials);
  const previous = structuredClone(settings.stored());
  const replacement = { appId: 'cli_other_app', appSecret: 'private-replacement' };
  response = () => json({ code: 20002, msg: 'private-replacement' }, 400);
  await assert.rejects(service.testConnection(replacement), /App Secret/);
  assert.deepEqual(settings.stored(), previous);
  response = () => json({ access_token: 'malformed', expires_in: 0 });
  await assert.rejects(service.testConnection(replacement), /有效的应用访问凭证/);
  assert.deepEqual(settings.stored(), previous);
  response = () => json(tokens());
  settings.vault.encrypt = async () => {
    throw new Error('系统安全存储暂不可用');
  };
  await assert.rejects(service.testConnection(replacement), /安全存储/);
  assert.deepEqual(settings.stored(), previous);
  assert.equal(service.status().connected, true);
  for (const invalid of [
    null,
    { appId: 'bad', appSecret: 'secret' },
    { appId: 'cli_valid', appSecret: 123 },
  ])
    await assert.rejects(service.testConnection(invalid));
});

test('docx and wiki import reuse app tokens and reacquire once on expiry or restart', async (t) => {
  let now = 1000000,
    calls = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url === TOKEN_URL) {
      calls++;
      return json(tokens(calls));
    }
    assert.equal(new URL(url).hostname, 'open.feishu.cn');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer private-app-access-${calls}`);
    return documentResponse(url);
  };
  const { settings, service } = setup(t, { now: () => now, fetchImpl });
  await service.testConnection(credentials);
  for (const type of ['wiki', 'docx']) {
    const doc = await service.read(`https://tenant.feishu.cn/${type}/Doc123`);
    assert.equal(doc.name, '登录需求');
    assert.match(doc.content, /锁定账号/);
    assert.match(doc.warnings[0], /图片.*未展开/);
    assert.match(doc.preview.content, /<h1>登录需求<\/h1>/);
  }
  assert.equal(calls, 1);
  now += 7190000;
  assert.deepEqual(await Promise.all([service.accessToken(), service.accessToken()]), [
    tokens(2).access_token,
    tokens(2).access_token,
  ]);
  assert.equal(calls, 2);
  const reopened = new FeishuService(settings, { now: () => now, fetchImpl });
  t.after(() => reopened.close());
  assert.equal(reopened.status().connected, false);
  assert.equal(await reopened.accessToken(), tokens(3).access_token);
  assert.equal(calls, 3);
});

test('invalid app tokens retry once with a shared replacement and never loop', async (t) => {
  let calls = 0,
    rejected = 0,
    alwaysInvalid = false;
  const { service } = setup(t, {
    fetchImpl: async (url, options) => {
      if (url === TOKEN_URL) {
        calls++;
        return json(tokens(calls));
      }
      if (alwaysInvalid || options.headers.Authorization === 'Bearer private-app-access-1') {
        rejected++;
        return json({ code: 99991663 }, 401);
      }
      return documentResponse(url);
    },
  });
  await service.testConnection(credentials);
  assert.match((await service.read('https://tenant.feishu.cn/docx/Doc123')).content, /锁定/);
  assert.equal(calls, 2);
  assert.equal(rejected, 2);
  alwaysInvalid = true;
  await assert.rejects(service.read('https://tenant.feishu.cn/wiki/Wiki123'), /重新测试连接/);
  assert.equal(calls, 3);
  assert.equal(service.status().connected, false);
});

test('missing API scopes and document permissions give application-specific guidance without repeated token requests', async (t) => {
  let code = 91403,
    calls = 0;
  const { service } = setup(t, {
    fetchImpl: async (url) => {
      if (url === TOKEN_URL) {
        calls++;
        return json(tokens());
      }
      return json({ code, msg: 'private-remote-detail' }, 403);
    },
  });
  await service.testConnection(credentials);
  await assert.rejects(service.read('https://tenant.feishu.cn/wiki/Wiki123'), /为|应用.*阅读权限/);
  code = 99991672;
  await assert.rejects(service.read('https://tenant.feishu.cn/docx/Doc123'), /应用身份.*只读权限/);
  assert.equal(calls, 1);
  assert.equal(service.status().connected, true, 'valid credentials do not imply document access');
});

test('remote and transport errors never echo credentials; unexpected API routes are blocked', async () => {
  const api = new FeishuApi(async () =>
    json({ code: 20002, msg: 'private-secret', error_description: 'private-secret' }, 400),
  );
  await assert.rejects(api.token(credentials), (error) => {
    assert.match(error.message, /App Secret/);
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
  const broken = new FeishuApi(async () => {
    throw new Error('private-secret');
  });
  await assert.rejects(broken.token(credentials), /无法连接飞书/);
  for (const route of [
    '/docx/v1/documents/../../other',
    '//evil.example',
    '/docx/v1/documents/id?url=evil',
    '/wiki/v2/spaces/get_node?url=evil',
  ])
    assert.throws(() => api.get(route, 'private-token'), /不支持/);
});

test('configuration replacement aborts old acquisition and ignores late token responses', async (t) => {
  let now = 100000,
    calls = 0;
  const started = deferred(),
    release = deferred();
  const { service } = setup(t, {
    now: () => now,
    fetchImpl: async () => {
      calls++;
      if (calls === 2) {
        started.resolve();
        await release.promise;
        return json(tokens(2));
      }
      return json(tokens(calls, 10));
    },
  });
  await service.testConnection(credentials);
  now += 11000;
  const old = assert.rejects(service.accessToken(), /改变|取消/);
  await started.promise;
  await service.testConnection({ appId: 'cli_new_app', appSecret: 'private-new-secret' });
  release.resolve();
  await old;
  assert.equal(service.status().appId, 'cli_new_app');
  assert.equal(await service.accessToken(), tokens(3).access_token);
});

test('close during credential encryption cannot save a late connection test', async (t) => {
  const { service, settings } = setup(t);
  const started = deferred(),
    release = deferred();
  const encrypt = settings.vault.encrypt;
  settings.vault.encrypt = async (value) => {
    started.resolve();
    await release.promise;
    return encrypt(value);
  };
  const tested = assert.rejects(service.testConnection(credentials), /abort|取消/i);
  await started.promise;
  await assert.rejects(service.testConnection(credentials), /正在测试/);
  const closed = service.close();
  release.resolve();
  await Promise.all([tested, closed]);
  assert.equal(settings.stored().feishu, undefined);
  assert.equal(service.status().connected, false);
});

test('JWT tokens longer than 8 KB and short expiry follow server lifetime without persisting tokens', async (t) => {
  let now = 100000,
    calls = 0;
  const accessToken = 'jwt.' + 'a'.repeat(12000);
  const { service, settings } = setup(t, {
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return json({ code: 0, access_token: accessToken, expires_in: 30 });
    },
  });
  await service.testConnection(credentials);
  now += 26000;
  assert.equal(await service.accessToken(), accessToken);
  assert.equal(calls, 1);
  now += 5000;
  assert.equal(service.status().connected, false);
  assert.equal(await service.accessToken(), accessToken);
  assert.equal(calls, 2);
  assert.doesNotMatch(JSON.stringify(settings.stored()), /jwt\./);
});

test('unconfigured or undecryptable credentials request configuration, without asking for login', async (t) => {
  const { service, settings } = setup(t);
  await assert.rejects(
    service.read('https://tenant.feishu.cn/docx/Doc123'),
    /App ID.*App Secret.*测试连接/,
  );
  await service.testConnection(credentials);
  const reopened = new FeishuService(settings);
  t.after(() => reopened.close());
  settings.vault.decrypt = async () => {
    throw new Error('private-storage-detail');
  };
  await assert.rejects(
    reopened.testConnection({ ...credentials, appSecret: '' }),
    /无法解密.*测试连接/,
  );
});
