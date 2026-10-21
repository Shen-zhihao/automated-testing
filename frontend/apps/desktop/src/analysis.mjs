import { createAnalysisWriter, hash, splitText } from './analysis-text.mjs';
import { cleanMarkdown, parseCatalog } from './analysis-format.mjs';
import {
  HTML_PROTOTYPE_CONTEXT,
  HTML_PROTOTYPE_REPORT,
  buildImplementationReport,
} from './requirements.mjs';

const CATALOG = `逐个提取本段全部可交付功能、角色、规则和独有约束。不要用摘要代替功能，不跨段分配 F/S/AC 编号。功能名称包含页面或模块以避免同名歧义；跨段的同一功能使用相同全名。保留原文短句、已有章节、数值及单位、输入输出、依赖、状态变化、异常、验收要点和待确认问题。没有功能的片段允许 features 为空，禁止编造。
仅输出 JSON，不加说明或代码围栏：
{"scope":"目标、角色、范围与明确不做的内容及依据", "features":[{"name":"模块·功能全名", "requirements":"逐项保留全部需求与原文依据", "dependencies":["原文明确的依赖功能全名或外部条件"], "questions":["原文缺失、冲突或歧义；未发现则留空"]}], "questions":["影响整体范围的待确认问题；未发现则留空"]}`;
const STEPS = `只编写当前功能的实现步骤正文，不输出二级或三级标题，不写其他功能，不包裹全文代码围栏。先写目标与约束，再按实际实现顺序拆步骤，每步必须带指定的 S 编号，并写明要做什么、输入、处理规则、产出或可观察的完成标志与依赖。覆盖原文的界面交互、状态变化、校验、权限和异常。引用原文短句与分段编号。未明确的方案标为“实现建议”，缺失规则关联给定 Q 编号，不擅自补全。`;
const ACCEPTANCE = `只编写当前功能的功能验收标准正文，不输出二级或三级标题，不写其他功能，不包裹全文代码围栏。每条必须带指定的 AC 编号并关联给定的 S 步骤，每条写出原文依据、前置条件、操作或输入、可观察且可判断通过/失败的预期结果、状态“待验收”。必须逐项覆盖本次提供的 S 步骤，覆盖原文正常、异常、边界、权限与状态变化，保留原文数值、次数、时间、范围与单位；缺少阈值写“待确认，暂不能定版验收”，额外验证标为建议，不声称已执行。`;
const HTML_SECTIONS = ['端到端业务流程', '关键交互与状态流转', '错误处理与恢复', '测试实施方向'];
const number = (value) => String(value).padStart(3, '0');
const label = (value) => value.replace(/[\r\n|]/g, ' ').replace(/[\\`*_[\]<>#]/g, '\\$&');
function ids(text, prefix) {
  return [...new Set(text.match(new RegExp(`\\b${prefix}-\\d+\\b`, 'g')) || [])];
}

function validateBody(text) {
  const body = cleanMarkdown(text);
  if (!body.replace(/[#\s|:\-`]/g, ''))
    throw new Error('模型返回了错误的章节结构，请继续生成重试；已有文档保留。');
  return body;
}

export async function generateImplementationPlan(document, goal, config, options = {}) {
  const { onProgress = () => {}, onCheckpoint, checkpoint, signal } = options;
  // 输出额度和超时可调整后继续；服务、模型、提示或原文变化会开始新草稿。不保存密钥。
  const fingerprint = hash({
    version: 1,
    name: document.name,
    source: document.source,
    kind: document.kind,
    content: document.content,
    goal,
    baseUrl: config.baseUrl,
    model: config.model,
    format: config.format,
    tokenParameter: config.tokenParameter,
    temperature: config.temperature,
  });
  const state =
    checkpoint?.fingerprint === fingerprint
      ? structuredClone(checkpoint)
      : {
          fingerprint,
          goal,
          steps: {},
          ...(checkpoint ? { previous: { goal: checkpoint.goal, steps: checkpoint.steps } } : {}),
        };
  signal?.throwIfAborted();
  if (checkpoint?.fingerprint !== fingerprint) onCheckpoint?.(state);
  if (Object.keys(state.steps).length) onProgress('正在恢复已保存的生成进度');
  const write = createAnalysisWriter(config, state, { ...options, onProgress, onCheckpoint });
  const chunks = splitText(document.content, 6000);
  if (!chunks.length) throw new Error('文档没有可供分析的文字。');
  const isPrototype = ['html', 'htm'].includes(document.kind);
  const context = `文档：${document.name}\n用户分析重点：${goal || '拆分功能实现步骤和可判定的功能验收标准'}\n${isPrototype ? HTML_PROTOTYPE_CONTEXT + '\n' : ''}`;
  const catalogs = [];
  for (const [index, chunk] of chunks.entries()) {
    const text = await write(
      `catalog:${index}`,
      `正在阅读第 ${index + 1} / ${chunks.length} 段`,
      `${context}${CATALOG}\n<文档分段 ${index + 1}>\n${chunk}\n</文档分段>`,
      parseCatalog,
    );
    catalogs.push(parseCatalog(text));
  }
  // 保留每段证据，不再反复压缩全文笔记。只合并完全同名的功能，语义相似项保留供核对。
  const features = [],
    byName = new Map(),
    questions = [],
    questionIds = new Map();
  const addQuestion = (text, featureId = '') => {
    const key = JSON.stringify([featureId, text]);
    if (questionIds.has(key)) return questionIds.get(key);
    const question = { id: `Q-${number(questions.length + 1)}`, text, featureId };
    questions.push(question);
    questionIds.set(key, question.id);
    return question.id;
  };
  for (const [segment, catalog] of catalogs.entries()) {
    for (const text of catalog.questions ?? []) addQuestion(text);
    for (const item of catalog.features) {
      const key = item.name.trim();
      let feature = byName.get(key);
      if (!feature) {
        feature = {
          id: `F-${number(features.length + 1)}`,
          name: key,
          parts: [],
          dependencies: new Set(),
          questions: new Set(),
          steps: [],
          acceptance: [],
        };
        byName.set(key, feature);
        features.push(feature);
      }
      feature.parts.push({ segment, requirements: item.requirements });
      for (const dependency of item.dependencies ?? []) feature.dependencies.add(dependency);
      for (const question of item.questions ?? [])
        feature.questions.add(addQuestion(question, feature.id));
    }
  }
  if (!features.length) {
    state.steps = {};
    onCheckpoint?.(state);
    throw new Error('未提取到可交付功能，请核对原文或补充需求；原有文档保留。');
  }
  const globalScope = [...new Set(catalogs.map((catalog) => catalog.scope))].join('\n\n');

  for (const [index, feature] of features.entries()) {
    let nextStep = 1,
      nextAC = 1;
    const suffix = feature.id.slice(2);
    const featureContext = `${context}<全文范围与约束>\n${globalScope}\n</全文范围与约束>\n当前功能：${feature.id} ${feature.name}\n原文依赖：${[...feature.dependencies].map((name) => (byName.has(name) ? `${byName.get(name).id} ${name}` : name)).join('；') || '未明确'}\n待确认问题：${
      questions
        .filter((q) => !q.featureId || q.featureId === feature.id)
        .map((q) => `${q.id} ${q.text}`)
        .join('\n') || '未发现明确待确认项；若仍有缺失，明确写待确认。'
    }\n`;
    const materials = feature.parts.flatMap(({ segment, requirements }) =>
      splitText(`提取要点：${requirements}\n原文：\n${chunks[segment]}`, 9000).map(
        (part) => `原文分段 ${segment + 1}：\n${part}`,
      ),
    );
    for (const [part, material] of materials.entries()) {
      const prefix = `S-${suffix}`;
      const steps = cleanMarkdown(
        await write(
          `steps:${feature.id}:${part}`,
          `正在编写实现步骤 ${index + 1} / ${features.length} · ${feature.name}`,
          `${featureContext}${STEPS}\nS 编号从 ${prefix}-${String(nextStep).padStart(2, '0')} 起连续递增。当前依据组 ${part + 1}/${materials.length}，仅覆盖本组，不重复其他组；不完整的跨组条件明确待确认。\n<依据>\n${material}\n</依据>`,
          (text) => {
            validateBody(text);
            const identifiers = ids(text, prefix);
            if (!identifiers.length)
              throw new Error(
                `模型未返回 ${feature.id} 的功能实现步骤，请继续生成重试；原有文档保留。`,
              );
            const numbers = identifiers
              .map((id) => Number(id.split('-').at(-1)))
              .sort((a, b) => a - b);
            if (
              numbers.some(
                (value, index) => !Number.isSafeInteger(value) || value !== nextStep + index,
              )
            )
              throw new Error(
                `${feature.id} 的实现步骤编号重复或不连续，应从 ${prefix}-${String(nextStep).padStart(2, '0')} 连续递增，当前编号：${identifiers.join('、')}；已有文档保留。`,
              );
          },
        ),
      );
      feature.steps.push(steps);
      const stepIds = ids(steps, prefix);
      nextStep = Math.max(...stepIds.map((id) => Number(id.split('-').at(-1)))) + 1;
      const stepGroups = splitText(steps, 9000);
      for (const [group, stepText] of stepGroups.entries()) {
        const expected = ids(stepText, prefix);
        const acPrefix = `AC-${suffix}`;
        const acceptance = cleanMarkdown(
          await write(
            `acceptance:${feature.id}:${part}:${group}`,
            `正在编写验收标准 ${index + 1} / ${features.length} · ${feature.name}`,
            `${featureContext}${ACCEPTANCE}\nAC 编号从 ${acPrefix}-${String(nextAC).padStart(2, '0')} 起连续递增。可引用的 S 编号：${stepIds.join('、')}。\n<依据>\n${material}\n</依据>\n<本次实现步骤>\n${stepText}\n</本次实现步骤>`,
            (text) => {
              validateBody(text);
              const identifiers = ids(text, acPrefix);
              const references = [...new Set(text.match(/\bS-\d+-\d+\b/g) || [])];
              const missing = expected.filter((id) => !references.includes(id));
              const unexpected = references.filter((id) => !stepIds.includes(id));
              if (
                !identifiers.length ||
                !text.includes('待验收') ||
                missing.length ||
                unexpected.length
              )
                throw new Error(
                  `模型未返回完整的 ${feature.id} 功能验收标准或步骤关联（${[
                    !identifiers.length && '缺少 AC 编号',
                    !text.includes('待验收') && '缺少待验收状态',
                    missing.length && `缺少关联：${missing.join('、')}`,
                    unexpected.length && `引用了未提供的步骤：${unexpected.join('、')}`,
                  ]
                    .filter(Boolean)
                    .join('；')}），请继续生成重试；原有文档保留。`,
                );
              const numbers = identifiers
                .map((id) => Number(id.split('-').at(-1)))
                .sort((a, b) => a - b);
              if (
                numbers.some(
                  (value, index) => !Number.isSafeInteger(value) || value !== nextAC + index,
                )
              )
                throw new Error(
                  `${feature.id} 的验收编号重复或不连续，应从 ${acPrefix}-${String(nextAC).padStart(2, '0')} 连续递增，当前编号：${identifiers.join('、')}；已有文档保留。`,
                );
            },
          ),
        );
        feature.acceptance.push(acceptance);
        nextAC =
          Math.max(...ids(acceptance, acPrefix).map((id) => Number(id.split('-').at(-1)))) + 1;
      }
    }
  }

  const extra = new Map();
  if (isPrototype) {
    for (const title of HTML_SECTIONS) {
      const parts = [];
      for (const [segment, chunk] of chunks.entries()) {
        const localFeatures = features.filter((feature) =>
          feature.parts.some((part) => part.segment === segment),
        );
        // 只传本段功能索引。每段都参与四个章节，无“取前 N 项”的隐式丢弃。
        for (const [group, featureIndex] of splitText(
          localFeatures.map((feature) => `${feature.id} ${feature.name}`).join('\n') ||
            '本段没有独立功能，保留范围或跨段证据。',
          6000,
        ).entries()) {
          const text = await write(
            `html:${title}:${segment}:${group}`,
            `正在编写${title} · ${segment + 1} / ${chunks.length} 段`,
            `${context}${HTML_PROTOTYPE_REPORT}\n本次只写“${title}”章节的正文，不输出二级或三级标题，不写其他章节，不加全文代码围栏。关联本次提供的功能编号和原文证据；未提供的 S/AC 不编造。FLOW/TEST 编号以分段 ${segment + 1} 和组 ${group + 1} 为前缀，避免重复。跨段信息不足列为待确认，不宣称已覆盖未知材料。\n<功能索引>\n${featureIndex}\n</功能索引>\n<原文分段 ${segment + 1}>\n${chunk}\n</原文分段>`,
            validateBody,
          );
          parts.push(`### 分段 ${segment + 1} · 依据组 ${group + 1}\n\n${cleanMarkdown(text)}`);
        }
      }
      extra.set(title, parts.join('\n\n'));
    }
  }
  signal?.throwIfAborted();
  onProgress('正在校验功能覆盖与编号并组装完整文档');
  const scope = catalogs
    .map((catalog, index) => `### 分段 ${index + 1} 的范围与约束\n\n${catalog.scope}`)
    .join('\n\n');
  const dependencies = features
    .map(
      (feature) =>
        `- **${feature.id} ${label(feature.name)}**：${[...feature.dependencies].map((name) => (byName.has(name) ? `${byName.get(name).id} ${label(name)}` : label(name))).join('；') || '原文未明确依赖与先后顺序，实施顺序待确认。'}`,
    )
    .join('\n');
  const content = [
    `## 需求范围与功能清单\n\n${scope}\n\n| 功能编号 | 功能名称 | 原文依据 | 优先级 |\n| --- | --- | --- | --- |\n${features.map((feature) => `| ${feature.id} | ${label(feature.name)} | ${[...new Set(feature.parts.map((part) => `分段 ${part.segment + 1}`))].join('、')} | 原文有明确规定时见实现约束，否则待确认 |`).join('\n')}`,
    ...[
      ['功能实现步骤', 'steps'],
      ['功能验收标准', 'acceptance'],
    ].map(
      ([title, field]) =>
        `## ${title}\n\n${features.map((feature) => `### ${feature.id} ${label(feature.name)}\n\n${feature[field].join('\n\n')}`).join('\n\n')}`,
    ),
    `## 实施顺序与依赖\n\n以下保留原文明确依赖；未规定的顺序与可并行项需确认，不推断工期。\n\n${dependencies}`,
    `## 待确认问题\n\n${questions.length ? questions.map((q) => `- **${q.id}**${q.featureId ? `（${q.featureId}）` : ''}：${q.text}`).join('\n') : '未发现明确的待确认问题，仍需结合原文核对草案。'}`,
    ...[...extra].map(([title, body]) => `## ${title}\n\n${body}`),
  ].join('\n\n');
  return buildImplementationReport(document, content, {
    goal,
    model: config.model,
    baseUrl: config.baseUrl,
    createdAt: new Date().toISOString(),
    segments: chunks.length,
  });
}
