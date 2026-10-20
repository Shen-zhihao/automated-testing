export async function readJsonResponse(response, limit = 4 * 1024 * 1024) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('服务返回内容过大。');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('服务没有返回内容。');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('服务返回内容过大。');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof SyntaxError) throw new Error('服务返回了非 JSON 内容，请检查接口地址。');
    throw error;
  } finally {
    reader.releaseLock();
  }
}
