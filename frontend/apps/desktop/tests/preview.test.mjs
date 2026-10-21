import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { parseDocument } from '../src/documents/parse.mjs';
import { createFixtures } from './fixtures.mjs';
import { renderFeishuBlocks } from '../src/feishu/preview.mjs';
import { FeishuService } from '../src/feishu.mjs';
import { SettingsService } from '../src/settings.mjs';
import { WorkspaceStore } from '../src/store.mjs';
import { TOKEN_URL } from '../src/feishu/api.mjs';

test('Word and spreadsheets preserve headings, emphasis, cells and merged columns', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'test-agent-preview-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await createFixtures(dir);
  const file = path.join(dir, 'requirements.docx');
  const zip = new AdmZip(file);
  zip.updateFile(
    'word/document.xml',
    Buffer.from(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>需求标题</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  </w:body></w:document>`),
  );
  zip.writeZip(file);
  const doc = await parseDocument(file);
  assert.match(doc.preview.content, /<h1>需求标题<\/h1>/);
  assert.match(doc.preview.content, /<table>.*<td>.*<strong>项目<\/strong>.*<td>.*内容/);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('规则');
  sheet.addRows([
    ['名称', '值'],
    ['合并内容', ''],
    ['普通', '数据'],
  ]);
  sheet.mergeCells('A2:B2');
  await workbook.xlsx.writeFile(path.join(dir, 'merged.xlsx'));
  const spreadsheet = await parseDocument(path.join(dir, 'merged.xlsx'));
  assert.match(spreadsheet.preview.content, /colspan="2">合并内容/);
  assert.equal((spreadsheet.preview.content.match(/合并内容/g) ?? []).length, 1);
  await writeFile(path.join(dir, 'quoted.csv'), '项目,内容\n"多行\n标题","含逗号,以及""引号"""\n');
  const csv = await parseDocument(path.join(dir, 'quoted.csv'));
  assert.match(csv.preview.content, /多行<br>标题/);
  assert.match(csv.preview.content, /含逗号,以及&quot;引号&quot;/);
  assert.equal((await parseDocument(path.join(dir, '登录需求.md'))).preview.format, 'markdown');
});

const text = (content, style = {}) => ({
  elements: [{ text_run: { content, text_element_style: style } }],
});
const blocks = [
  { block_id: 'Doc123', page: text('原文标题'), children: ['h', 'table', 'list1', 'list2'] },
  { block_id: 'h', parent_id: 'Doc123', heading2: text('文档信息') },
  {
    block_id: 'table',
    parent_id: 'Doc123',
    table: {
      property: {
        row_size: 2,
        column_size: 2,
        header_row: true,
        merge_info: [{ row_span: 1, col_span: 2 }],
      },
      cells: ['c1', 'c2', 'c3', 'c4'],
    },
  },
  ...['c1', 'c2', 'c3', 'c4'].map((id, i) => ({
    block_id: id,
    parent_id: 'table',
    table_cell: {},
    children: [`p${i}`],
  })),
  ...['合并标题', '', '项目', '<script>不可执行</script>'].map((value, i) => ({
    block_id: `p${i}`,
    parent_id: `c${i + 1}`,
    text: text(value, { bold: i === 2 }),
  })),
  { block_id: 'list1', parent_id: 'Doc123', ordered: text('第一条') },
  { block_id: 'list2', parent_id: 'Doc123', ordered: text('第二条') },
];

test('Feishu structure restores table order, merges, nested formatting and lists without interpreting text as HTML', () => {
  const preview = renderFeishuBlocks(blocks, 'Doc123', '', []);
  assert.match(preview.content, /<h2>文档信息<\/h2>/);
  assert.match(preview.content, /colspan="2"><div><p>合并标题/);
  assert.match(preview.content, /<strong>项目<\/strong>/);
  assert.match(preview.content, /&lt;script&gt;不可执行&lt;\/script&gt;/);
  assert.match(preview.content, /<ol><li>第一条<\/li><li>第二条<\/li><\/ol>/);
  assert.throws(
    () =>
      renderFeishuBlocks(
        [{ block_id: 'loop', page: text('循环'), children: ['loop'] }],
        'loop',
        '',
        [],
      ),
    /结构异常/,
  );
});

test('Feishu reads every block page; a missing format permission falls back explicitly to complete plain text', async (t) => {
  const store = new WorkspaceStore(':memory:');
  const settings = new SettingsService(store, {
    encrypt: async (value) => Buffer.from(value),
    decrypt: async (value) => value.toString(),
  });
  const urls = [];
  let denied = false;
  const json = (data) => new Response(JSON.stringify(data));
  const service = new FeishuService(settings, {
    fetchImpl: async (url) => {
      if (url === TOKEN_URL) return json({ access_token: 'fixture', expires_in: 7200 });
      if (url.endsWith('/raw_content')) return json({ data: { content: '完整原文' } });
      if (url.includes('/blocks?')) {
        urls.push(url);
        if (denied) return json({ code: 99991672 });
        return json({
          data: url.includes('page_token=')
            ? { items: blocks.slice(2), has_more: false }
            : { items: blocks.slice(0, 2), has_more: true, page_token: 'next+/=' },
        });
      }
      return json({ data: { document: { title: '需求', revision_id: 12 } } });
    },
  });
  t.after(async () => {
    await service.close();
    store.close();
  });
  await service.testConnection({ appId: 'cli_fixture', appSecret: 'fixture' });
  const document = await service.read('https://tenant.feishu.cn/docx/Doc123');
  assert.match(document.preview.content, /合并标题/);
  assert.match(urls[1], /document_revision_id=12&page_token=next%2B%2F%3D/);
  denied = true;
  const fallback = await service.read('https://tenant.feishu.cn/docx/Doc123');
  assert.equal(fallback.content, '完整原文');
  assert.equal(fallback.preview, null);
  assert.match(fallback.warnings[0], /格式预览未获取成功.*权限/);
});
