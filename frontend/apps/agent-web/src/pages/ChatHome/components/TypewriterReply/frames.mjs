export function animationSettings(length) {
  return {
    duration: Math.min(12000, Math.max(600, length * 14)),
    interval: Math.min(180, Math.max(45, Math.floor(length / 100))),
  };
}

// 不再逐帧复制字符数组；UTF-16 切片只在完整字符边界停止。
export function replyPrefix(content, progress) {
  if (progress >= 1) return content;
  let end = Math.max(1, Math.floor(content.length * Math.max(0, progress)));
  if (/[\uD800-\uDBFF]/.test(content[end - 1] ?? '')) end--;
  if (!end && content.length) end = content.codePointAt(0) > 0xffff ? 2 : 1;
  return content.slice(0, end);
}
