import AdmZip from 'adm-zip';

export function createStructuredDocx(file) {
  const zip = new AdmZip();
  const add = (name, content) => zip.addFile(name, Buffer.from(content));
  const p = (text, properties = '') => `<w:p>${properties}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (content, properties = '') =>
    `<w:tc><w:tcPr>${properties}</w:tcPr>${content}</w:tc>`;
  const list = (text, level) =>
    p(text, `<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`);
  const picture = (id, label) =>
    `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${id === 'image1' ? 1 : 2}" name="${label}" descr="${label}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  add(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="png" ContentType="image/png"/><Default Extension="emf" ContentType="image/x-emf"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  </Types>`,
  );
  add(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  add(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    <Relationship Id="numbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
    <Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/check.png"/>
    <Relationship Id="image2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.emf"/>
  </Relationships>`,
  );
  add(
    'word/styles.xml',
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:style w:type="paragraph" w:styleId="ChineseHeading"><w:name w:val="标题1"/></w:style>
    <w:style w:type="paragraph" w:styleId="ChineseDetail"><w:name w:val="标题 4"/></w:style>
    <w:style w:type="paragraph" w:styleId="Custom"><w:name w:val="产品说明样式"/></w:style>
  </w:styles>`,
  );
  add(
    'word/numbering.xml',
    `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="0">
      <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    </w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  </w:numbering>`,
  );
  zip.addFile(
    'word/media/check.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1cAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  add('word/media/chart.emf', 'unsupported-image-fixture');
  const columns = [
    '功能编号',
    '功能名称',
    '优先级',
    '前置条件',
    '操作步骤',
    '预期结果',
    '原文依据',
    '责任模块',
    '状态',
  ];
  add(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
    ${p('1 登录与权限', '<w:pPr><w:pStyle w:val="ChineseHeading"/></w:pPr>')}
    <w:p><w:r><w:rPr><w:b/><w:u w:val="single"/></w:rPr><w:t>关键规则</w:t></w:r><w:r><w:br/><w:t>失败 5 次后锁定 15 分钟。</w:t></w:r></w:p>
    ${list('填写登录信息', 0)}${list('账号不可为空', 1)}${list('密码不可为空', 1)}${list('提交并展示结果', 0)}
    <w:tbl>
      <w:tr>${cell(p('验收规则'), '<w:gridSpan w:val="3"/>')}</w:tr>
      <w:tr>${cell(p('登录模块'), '<w:vMerge w:val="restart"/>')}${cell(p('空密码'))}${cell(p('阻止提交'))}</w:tr>
      <w:tr>${cell(p(''), '<w:vMerge/>')}${cell(p('错误密码'))}${cell(p('显示错误提示'))}</w:tr>
    </w:tbl>
    ${p('1.1.1.1 边界条件', '<w:pPr><w:pStyle w:val="ChineseDetail"/></w:pPr>')}
    ${p('宽表格应独立滚动，后续段落顺序保持不变。')}
    <w:tbl><w:tr>${columns.map((text) => cell(p(text))).join('')}</w:tr><w:tr>${columns.map((text, index) => cell(p(index === 0 ? 'F-001' : `${text}示例`))).join('')}</w:tr></w:tbl>
    ${picture('image1', '内嵌图片')}${picture('image2', '矢量图')}
    ${p('图后说明：本段位于图片之后。', '<w:pPr><w:pStyle w:val="Custom"/></w:pPr>')}
  </w:body></w:document>`,
  );
  zip.writeZip(file);
}
