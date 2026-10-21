import { cleanMarkdown, parseCatalog } from './analysis-format.mjs';

const escape = (value) => String(value).replace(/[\\`*_[\]<>#|]/g, '\\$&');

// 只公开可读草稿，不向渲染进程传递检查点指纹、提示哈希或执行状态。
export function analysisDraftView(checkpoint, previous = true) {
  if (!checkpoint) return null;
  const names = new Map();
  const catalogs = new Map();
  const steps = Object.entries(checkpoint.steps ?? {});
  for (const [key, step] of steps) {
    if (!key.startsWith('catalog:') || !step.complete) continue;
    try {
      const catalog = parseCatalog(step.text);
      catalogs.set(key, catalog);
      for (const feature of catalog.features ?? [])
        if (!names.has(feature.name.trim())) names.set(feature.name.trim(), names.size + 1);
    } catch {
      /* 未校验的结构不当作功能清单展示。 */
    }
  }
  const featureNames = new Map(
    [...names].map(([name, index]) => [`F-${String(index).padStart(3, '0')}`, name]),
  );
  const sections = [];
  for (const [key, step] of steps) {
    const parts = key.split(':');
    let content = step.text || step.previousText || '';
    let title;
    const featureId = parts[0] === 'steps' || parts[0] === 'acceptance' ? parts[1] : 'scope';
    if (parts[0] === 'catalog') {
      const catalog = catalogs.get(key);
      if (!catalog) continue;
      title = `原文第 ${Number(parts[1]) + 1} 段 · 范围与功能`;
      content = `${catalog.scope}\n\n${(catalog.features ?? []).map((feature) => `- **${escape(feature.name)}**：${feature.requirements}`).join('\n')}`;
    } else if (parts[0] === 'steps') title = `实现步骤 · 依据组 ${Number(parts[2]) + 1}`;
    else if (parts[0] === 'acceptance')
      title = `验收标准 · 依据组 ${Number(parts[2]) + 1} / ${Number(parts[3]) + 1}`;
    else if (parts[0] === 'html') title = `${parts[1]} · 原文第 ${Number(parts[2]) + 1} 段`;
    else continue;
    if (!content) continue;
    sections.push({
      id: key,
      featureId,
      featureName: featureNames.get(featureId) ?? '',
      title,
      content: cleanMarkdown(content),
      status: step.complete ? 'complete' : step.validationError ? 'revising' : 'partial',
    });
  }
  return {
    goal: checkpoint.goal ?? '',
    sections,
    completed: sections.filter((section) => section.status === 'complete').length,
    featureCount: names.size,
    previous:
      previous && checkpoint.previous ? analysisDraftView(checkpoint.previous, false) : null,
  };
}
