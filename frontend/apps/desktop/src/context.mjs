// 字符预算只用于本机保守限流，不等同于供应商的精确 Token 数或上下文窗口。
export const CHAT_INPUT_CHARACTERS = 48000;
export const messageCharacters = (messages) =>
  messages.reduce((size, message) => size + message.content.length + 32, 0);

export function contextTerms(query) {
  const words =
    String(query)
      .toLowerCase()
      .match(/[a-z0-9_]+(?:-[a-z0-9_]+)*|[\u4e00-\u9fff]+/g) ?? [];
  const terms = new Set();
  for (const word of words) {
    if (/^[\u4e00-\u9fff]+$/.test(word)) {
      for (let index = 0; index < word.length - 1; index++) terms.add(word.slice(index, index + 2));
    } else if (word.length > 1) terms.add(word);
    if (terms.size >= 160) break;
  }
  return [...terms].slice(0, 160);
}

export function relevance(text, terms) {
  const value = text.toLowerCase();
  return terms.reduce(
    (sum, term) => sum + (value.includes(term) ? (/^[a-z]+-\d/.test(term) ? 12 : 1) : 0),
    0,
  );
}

function head(text, length) {
  let end = Math.max(0, length);
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
  return text.slice(0, Math.max(0, end));
}
function tail(text, length) {
  let start = Math.max(0, text.length - length);
  if (/[\uDC00-\uDFFF]/.test(text[start] ?? '')) start++;
  return text.slice(start);
}

export function excerptText(value, limit, query = '') {
  const text = String(value ?? '');
  limit = Math.max(0, Math.floor(limit));
  if (text.length <= limit) return text;
  const gap = '\n[…上下文节选，部分内容省略…]\n';
  if (limit <= gap.length) return head(gap, limit);
  const room = limit - gap.length;
  // 优先保留直接命中的段落，避免只截开头而漏掉尾部的规则或错误。
  const terms = contextTerms(query);
  if (terms.length && room >= 200) {
    const lines = text.split(/(?<=\n)/);
    let offset = 0;
    const ranked = lines
      .map((line) => {
        const positions = terms
          .map((term) => line.toLowerCase().indexOf(term))
          .filter((at) => at >= 0);
        const item = {
          offset: offset + (positions.length ? Math.min(...positions) : 0),
          score: relevance(line, terms),
        };
        offset += line.length;
        return item;
      })
      .sort((a, b) => b.score - a.score || b.offset - a.offset);
    if (ranked[0]?.score > 0) {
      let start = Math.max(
        0,
        Math.min(text.length - room, ranked[0].offset - Math.floor(room / 5)),
      );
      if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
      return gap + head(text.slice(start), room);
    }
  }
  const first = Math.floor(room / 2);
  return head(text, first) + gap + tail(text, room - first);
}
