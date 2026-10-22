import { contextTerms, excerptText, relevance } from '../context.mjs';
import { splitText } from '../analysis-text.mjs';

export function documentContext(
  source,
  query,
  featureId = '',
  prefix = '',
  budget = 16000,
  primaryQuestion = query,
) {
  const terms = contextTerms(query + ' ' + featureId);
  const primary = contextTerms(primaryQuestion + ' ' + featureId);
  const rank = (items) =>
    items
      .map((item, index) => ({
        ...item,
        index,
        score:
          relevance(item.text, terms) +
          3 * relevance(item.text, primary) +
          (terms.some(
            (term) =>
              term === item.id.toLowerCase() ||
              term === item.id.replace(/^D\d+-/, '').toLowerCase(),
          )
            ? 50
            : 0),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
  const raw = rank(
    splitText(source.content ?? '', 4000).map((text, index) => ({
      id: `${prefix}P-${String(index + 1).padStart(3, '0')}`,
      text,
    })),
  );
  const analysis = rank(
    splitText(source.analysis ?? '', 1600).map((text, index) => ({
      id: `${prefix}A-${String(index + 1).padStart(3, '0')}`,
      text,
    })),
  );
  const header = excerptText(
    `引用文档：${source.name}\n文档快照：${source.id ?? '未标识'}\n${source.analysisCreatedAt ? `分析时间：${source.analysisCreatedAt}` : '尚未生成需求分析，仅引用已提取的原文。'}\n讨论功能：${featureId || '整份文档'}\n${source.warnings?.length ? `提取提示：${source.warnings.join('；')}\n` : ''}以下为相关片段，不能据此断言其他内容不存在。`,
    Math.min(1000, Math.floor(budget / 3)),
    query,
  );
  const available = Math.max(0, budget - header.length - 20);
  const select = (items, limit) => {
    const chosen = [];
    let left = limit;
    for (const item of items.slice(0, 3)) {
      const allowance = Math.min(
        item.text.length,
        Math.floor(limit / Math.min(2, items.length)),
        left - item.id.length * 2 - 14,
      );
      if (allowance <= 0 || (allowance < 80 && allowance < item.text.length)) continue;
      const text = excerptText(item.text, allowance, query);
      const material = `<${item.id}>\n${text}\n</${item.id}>`;
      if (material.length > left) continue;
      chosen.push({ id: item.id, text, index: item.index, material });
      left -= material.length + 2;
    }
    return chosen.sort((a, b) => a.index - b.index);
  };
  const selectedRaw = select(raw, analysis.length ? Math.floor(available * 0.6) : available);
  const selectedAnalysis = select(
    analysis,
    available - selectedRaw.reduce((sum, item) => sum + item.material.length + 2, 0),
  );
  return {
    material: [
      header,
      ...selectedAnalysis.map((item) => item.material),
      ...selectedRaw.map((item) => item.material),
    ].join('\n\n'),
    excerpts: selectedRaw.map(({ id, text }) => ({ id, text })),
  };
}

export function ranked(items, textOf, query) {
  const terms = contextTerms(query);
  return items
    .map((item, index) => ({ item, index, score: relevance(textOf(item), terms) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .map(({ item }) => item);
}

export function taskContext(task, query, budget = 3000) {
  if (!task) return '';
  if (typeof task === 'string') return excerptText(task, budget, query);
  const notes = task.notes ?? [],
    cases = task.cases ?? [];
  const result = {
    name: task.name,
    scope: excerptText(task.scope, 700, query),
    sourceId: task.sourceId,
    reportStale: task.reportStale,
    notes: [],
    cases: [],
    recentRuns: (task.recentRuns ?? []).map((run) => ({
      status: run.status,
      message: excerptText(run.message, 150, query),
      createdAt: run.createdAt,
    })),
    omittedNotes: notes.length,
    omittedCases: cases.length,
  };
  const add = (field, value) => {
    result[field].push(value);
    if (JSON.stringify(result).length > budget) result[field].pop();
  };
  const orderedNotes = ranked(notes, (item) => item.content, query);
  if (orderedNotes[0])
    add('notes', {
      id: orderedNotes[0].id,
      content: excerptText(orderedNotes[0].content, 650, query),
    });
  // 为相关用例与保留结论分别留位置，避免一类条目占满任务预算。
  for (const item of ranked(cases, (value) => JSON.stringify(value), query))
    add('cases', {
      id: item.id,
      title: item.title,
      requirement: excerptText(item.requirement, 200, query),
      steps: excerptText(item.steps?.join('\n'), 400, query),
      expected: excerptText(item.expected?.join('\n'), 400, query),
    });
  for (const note of orderedNotes.slice(1))
    add('notes', { id: note.id, content: excerptText(note.content, 650, query) });
  result.omittedNotes -= result.notes.length;
  result.omittedCases -= result.cases.length;
  return JSON.stringify(result);
}

export function commandContext(value, budget = 1800) {
  if (!value) return '';
  if (typeof value === 'string') return excerptText(value, budget);
  const result = {
    execution: value.execution,
    shell: value.shell,
    directory: value.directory,
    platform: value.platform,
    recentCommands: [],
    omittedCommands: (value.recentCommands ?? []).length,
  };
  for (const run of value.recentCommands ?? []) {
    const item = {
      command: run.command,
      status: run.status,
      exitCode: run.exitCode,
      output: excerptText(run.output, 300),
      error: excerptText(run.error, 300),
      truncated: Boolean(run.truncated || run.output?.length > 300),
    };
    result.recentCommands.push(item);
    if (JSON.stringify(result).length > budget) {
      result.recentCommands.pop();
      break;
    }
  }
  result.omittedCommands -= result.recentCommands.length;
  return JSON.stringify(result);
}

export function commandResults(runs, budget = 9000) {
  if (!runs) return '';
  const result = runs.map((run) => ({
    command: run.command,
    status: run.status,
    exitCode: run.exitCode,
    output: '',
    error: excerptText(run.error, 400),
    truncated: true,
  }));
  while (JSON.stringify(result).length + runs.length > budget) {
    let changed = false;
    for (const item of result) {
      if (item.command.length > 100) {
        item.command = excerptText(item.command, Math.floor(item.command.length / 2));
        item.commandTruncated = true;
        changed = true;
      }
      if (item.error.length > 100) {
        item.error = excerptText(item.error, Math.floor(item.error.length / 2));
        changed = true;
      }
    }
    if (!changed) throw new Error('命令记录超出上下文预算，请减少本轮命令数量。');
  }
  let allowance = Math.max(0, budget - JSON.stringify(result).length - runs.length);
  for (const [index, run] of runs.entries()) {
    const available = Math.floor(allowance / (runs.length - index));
    // JSON 转义后的大小也计入预算；始终保留可解析的完整记录。
    let limit = Math.min(run.output?.length ?? 0, available);
    let output = excerptText(run.output, limit);
    while (JSON.stringify(output).length - 2 > available && limit > 0) {
      limit = Math.floor(limit / 2);
      output = excerptText(run.output, limit);
    }
    result[index].output = output;
    result[index].truncated = Boolean(run.truncated || output !== (run.output ?? ''));
    allowance -= JSON.stringify(output).length - 2;
  }
  return JSON.stringify(result);
}
