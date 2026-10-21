import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { FeishuService, parseFeishuUrl } from '../src/feishu.mjs';
import { FeishuApi, TOKEN_URL } from '../src/feishu/api.mjs';
import { MAX_IMAGE_BYTES, readImageResponse } from '../src/feishu/images.mjs';
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

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const imageBlocks = (imageTokens) => [
  {
    block_id: 'Doc123',
    page: {},
    children: ['before', ...imageTokens.map((_, i) => `image${i}`), 'after'],
  },
  { block_id: 'before', text: { elements: [{ text_run: { content: '图前说明' } }] } },
  ...imageTokens.map((token, i) => ({ block_id: `image${i}`, image: { token, width: 640 } })),
  { block_id: 'after', text: { elements: [{ text_run: { content: '图后说明' } }] } },
];
function imageResponse(url, imageTokens = ['Image123', 'Image123']) {
  return url.includes('/blocks?')
    ? json({ data: { items: imageBlocks(imageTokens), has_more: false } })
    : documentResponse(url);
}

test('docx/wiki images download once per material, retain reading order and persist separately from analysis text', async (t) => {
  let downloads = 0;
  const { store, service } = setup(t, {
    fetchImpl: async (url, options) => {
      if (url === TOKEN_URL) return json(tokens());
      if (url.includes('/medias/')) {
        downloads++;
        const parsed = new URL(url);
        assert.equal(parsed.origin, 'https://open.feishu.cn');
        assert.equal(parsed.pathname, '/open-apis/drive/v1/medias/Image123/download');
        assert.deepEqual(JSON.parse(parsed.searchParams.get('extra')), {
          doc_id: 'Doc123',
          doc_type: 'docx',
        });
        assert.equal(options.headers.Authorization, 'Bearer private-app-access-1');
        assert.equal(options.redirect, 'error');
        return new Response(png, { headers: { 'Content-Type': 'application/octet-stream' } });
      }
      return imageResponse(url);
    },
  });
  await service.testConnection(credentials);
  for (const type of ['docx', 'wiki']) {
    const result = await service.read(`https://tenant.feishu.cn/${type}/Doc123`);
    assert.equal((result.preview.content.match(/src="data:image\/png;base64,/g) ?? []).length, 2);
    assert.match(result.preview.content, /width="640"/);
    assert.ok(result.preview.content.indexOf('图前说明') < result.preview.content.indexOf('<img'));
    assert.ok(
      result.preview.content.lastIndexOf('<img') < result.preview.content.indexOf('图后说明'),
    );
    assert.doesNotMatch(JSON.stringify(result), /private-app|Image123|open-apis\/drive/);
    assert.doesNotMatch(result.content, /data:image|base64/);
    assert.ok(!result.warnings.some((warning) => warning.includes('未展开')));
    assert.ok(result.warnings.some((warning) => warning.includes('尚未识别图片内文字')));
    const saved = store.addDocument(result);
    store.saveAnalysis(saved.id, { content: '已有分析' });
    assert.equal(store.getDocument(saved.id).preview.content, result.preview.content);
    const updated = store.updateDocumentSource(saved.id, result);
    assert.equal(
      updated.analysis.content,
      '已有分析',
      'refreshing image preview keeps analysis when text is unchanged',
    );
    assert.equal(updated.content, '登录失败三次后锁定账号。');
  }
  assert.equal(downloads, 2, 'duplicate image references share one download in each import');
});

test('image token expiry renews once and preserves the document preview', async (t) => {
  let acquisitions = 0,
    downloads = 0;
  const { service } = setup(t, {
    fetchImpl: async (url, options) => {
      if (url === TOKEN_URL) return json(tokens(++acquisitions));
      if (url.includes('/medias/')) {
        downloads++;
        return options.headers.Authorization.endsWith('-1')
          ? json({ code: 99991663 }, 401)
          : new Response(png);
      }
      return imageResponse(url);
    },
  });
  await service.testConnection(credentials);
  const result = await service.read('https://tenant.feishu.cn/docx/Doc123');
  assert.match(result.preview.content, /src="data:image\/png;base64,/);
  assert.equal(acquisitions, 2);
  assert.equal(downloads, 2);
});

test('missing image download permissions keep text and structure, with actionable guidance and no remote secret', async (t) => {
  const { service } = setup(t, {
    fetchImpl: async (url) => {
      if (url === TOKEN_URL) return json(tokens());
      if (url.includes('/medias/'))
        return json({ code: 99991672, msg: 'private-remote-secret' }, 403);
      return imageResponse(url);
    },
  });
  await service.testConnection(credentials);
  const result = await service.read('https://tenant.feishu.cn/docx/Doc123');
  assert.equal(result.content, '登录失败三次后锁定账号。');
  assert.match(result.preview.content, /图前说明.*图片未展开.*图后说明/);
  assert.match(result.warnings[0], /2 张图片未展开.*下载只读权限.*阅读和下载/);
  assert.doesNotMatch(JSON.stringify(result), /private-remote-secret/);
  assert.equal(service.status().connected, true);
});

test('image decoding rejects SVG, HTML, fake JSON success, redirects and oversized responses without following remote URLs', async () => {
  const responses = [
    new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
      headers: { 'Content-Type': 'image/svg+xml' },
    }),
    new Response('<html>login page</html>', { headers: { 'Content-Type': 'image/png' } }),
    json({ code: 0, data: {} }),
    new Response(null, { status: 302, headers: { Location: 'https://evil.example/image' } }),
    new Response(png, { headers: { 'Content-Length': String(MAX_IMAGE_BYTES + 1) } }),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
          controller.close();
        },
      }),
    ),
  ];
  for (const response of responses) {
    const calls = [];
    const api = new FeishuApi(async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, 'error');
      return response;
    });
    await assert.rejects(api.downloadImage('Image123', 'Doc123', 'private-token'));
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^https:\/\/open\.feishu\.cn\//);
  }
  const api = new FeishuApi(() => assert.fail('invalid material IDs must not be fetched'));
  for (const token of ['../image', 'https://evil.example/image', 'Image?url=evil', ''])
    await assert.rejects(api.downloadImage(token, 'Doc123', 'private-token'), /标识无效/);
  for (const [type, data] of [
    ['png', png],
    ['jpeg', Buffer.from('ffd8ffe0', 'hex')],
    ['gif', Buffer.from('GIF89a')],
    ['webp', Buffer.from('RIFF0000WEBP')],
  ]) {
    const result = await readImageResponse(new Response(data), MAX_IMAGE_BYTES);
    assert.match(result.src, new RegExp(`^data:image/${type};base64,`));
  }
});

test('image budgets retain smaller images and all text while oversized and excess images have visible placeholders', async (t) => {
  const requested = [];
  const { service } = setup(t, {
    fetchImpl: async (url) => {
      if (url === TOKEN_URL) return json(tokens());
      if (url.includes('/medias/')) {
        const token = new URL(url).pathname.split('/').at(-2);
        requested.push(token);
        const bytes = token === 'Image3' ? 2 * 1024 * 1024 : 3 * 1024 * 1024;
        const data = Buffer.alloc(bytes);
        png.copy(data);
        return new Response(data, { headers: { 'Content-Length': String(bytes) } });
      }
      return imageResponse(url, ['Image1', 'Image2', 'Image3', 'Image4']);
    },
  });
  await service.testConnection(credentials);
  const result = await service.read('https://tenant.feishu.cn/docx/Doc123');
  assert.deepEqual(requested, ['Image1', 'Image2', 'Image3']);
  assert.equal((result.preview.content.match(/<img /g) ?? []).length, 2);
  assert.match(result.preview.content, /图片超过本地预览大小上限/);
  assert.match(result.preview.content, /图片总量超过 5 MB/);
  assert.match(result.preview.content, /图后说明/);
  assert.equal(result.content, '登录失败三次后锁定账号。');
});

test('changing app configuration during an image download rejects stale document results', async (t) => {
  const started = deferred(),
    release = deferred();
  const { service } = setup(t, {
    fetchImpl: async (url) => {
      if (url === TOKEN_URL) return json(tokens());
      if (url.includes('/medias/')) {
        started.resolve();
        await release.promise;
        return new Response(png);
      }
      return imageResponse(url);
    },
  });
  await service.testConnection(credentials);
  const reading = assert.rejects(
    service.read('https://tenant.feishu.cn/docx/Doc123'),
    /abort|取消/i,
  );
  await started.promise;
  await service.testConnection({ appId: 'cli_replacement', appSecret: 'new-secret' });
  release.resolve();
  await reading;
  assert.equal(service.status().appId, 'cli_replacement');
});
