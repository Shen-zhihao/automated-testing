export function cleanMarkdown(text) {
  const body = text
    .trim()
    .replace(/^```(?:md|markdown)?\s*\n([\s\S]*)\n```$/i, '$1')
    .trim();
  // 正文标题收至功能标题之下，代码围栏中的示例保持原样。
  let fence = null;
  return body
    .split('\n')
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && !fence) fence = marker;
      else if (marker && marker[0] === fence?.[0] && marker.length >= fence.length) fence = null;
      else if (!fence)
        return line.replace(
          /^(\s{0,3})(#{1,6})([ \t]+)/,
          (_, space, heading, gap) => space + '#'.repeat(Math.min(6, heading.length + 3)) + gap,
        );
      return line;
    })
    .join('\n');
}

export function parseCatalog(text) {
  let data;
  try {
    data = JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*)\n```$/i, '$1'));
  } catch {
    throw new Error('功能清单格式不完整，请继续生成重试；已完成步骤保留。');
  }
  const isText = (value) => typeof value === 'string' && value.trim();
  const strings = (value) => Array.isArray(value) && value.every(isText);
  if (
    !isText(data?.scope) ||
    !Array.isArray(data.features) ||
    !strings(data.questions ?? []) ||
    data.features.some(
      (feature) =>
        !isText(feature?.name) ||
        feature.name.length > 200 ||
        !isText(feature.requirements) ||
        !strings(feature.dependencies ?? []) ||
        !strings(feature.questions ?? []),
    )
  )
    throw new Error('模型未返回有效的功能清单，请继续生成重试；已完成步骤保留。');
  return data;
}
