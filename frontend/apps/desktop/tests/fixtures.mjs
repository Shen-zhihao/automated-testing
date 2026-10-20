import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';

export function pdfFixture(text = 'Login requirements: five failures lock the account.') {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}

export async function createFixtures(dir) {
  await mkdir(dir, { recursive: true });
  const text =
    '# 登录需求\n\n账号密码登录；连续 5 次错误后锁定 15 分钟。\n空密码不可提交，成功后进入工作区。';
  for (const [name, data] of Object.entries({
    '登录需求.md': text,
    '需求.txt': Buffer.from('\ufeff' + text, 'utf16le'),
    'cases.csv': '编号,场景,预期\nTC-01,空密码,不可提交\n',
    '需求.html':
      '<h1>登录需求</h1><p>连续 5 次错误后锁定 15 分钟。</p><script>SECRET_SCRIPT</script>',
    'requirements.pdf': pdfFixture(),
  }))
    await writeFile(path.join(dir, name), data);
  const docx = new AdmZip();
  docx.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
  );
  docx.addFile(
    '_rels/.rels',
    Buffer.from(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
  );
  docx.addFile(
    'word/document.xml',
    Buffer.from(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>登录需求：连续 5 次错误后锁定 15 分钟。</w:t></w:r></w:p></w:body></w:document>',
    ),
  );
  docx.writeZip(path.join(dir, 'requirements.docx'));
  const book = new ExcelJS.Workbook();
  book.addWorksheet('测试场景').addRows([
    ['场景', '预期'],
    ['空密码', '不可提交'],
  ]);
  book.addWorksheet('边界').addRows([
    ['失败次数', '锁定分钟'],
    [5, 15],
  ]);
  await book.xlsx.writeFile(path.join(dir, 'cases.xlsx'));
  const pptx = new AdmZip();
  pptx.addFile(
    'ppt/presentation.xml',
    Buffer.from(
      '<p:presentation><p:sldIdLst><p:sldId r:id="b"/><p:sldId r:id="a"/></p:sldIdLst></p:presentation>',
    ),
  );
  pptx.addFile(
    'ppt/_rels/presentation.xml.rels',
    Buffer.from(
      '<Relationships><Relationship Id="a" Target="slides/slide1.xml"/><Relationship Id="b" Target="slides/slide2.xml"/></Relationships>',
    ),
  );
  for (const [name, content] of [
    ['slide1.xml', '第二张：异常流程'],
    ['slide2.xml', '第一张：登录需求'],
  ])
    pptx.addFile(
      `ppt/slides/${name}`,
      Buffer.from(
        `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${content}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      ),
    );
  pptx.writeZip(path.join(dir, 'requirements.pptx'));
  return dir;
}
