export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 60;

export class ImagePreviewError extends Error {}

function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return '';
}

export async function readImageResponse(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => {});
    throw new ImagePreviewError('图片超过本地预览大小上限');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImagePreviewError('图片没有返回内容');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ImagePreviewError('图片超过本地预览大小上限');
      chunks.push(value);
    }
    const data = Buffer.concat(chunks);
    const type = imageType(data);
    if (!type) throw new ImagePreviewError('图片格式暂不支持或返回内容不是图片');
    return { src: `data:${type};base64,${data.toString('base64')}`, bytes: size };
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function loadFeishuImages(blocks, download, signal, warnings) {
  const images = blocks.filter((block) => block.image);
  const assets = new Map();
  if (!images.length) return assets;
  const imageSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
  let bytes = 0,
    attempted = 0;
  for (const block of images) {
    signal.throwIfAborted();
    const token = block.image.token;
    if (assets.has(token)) continue;
    let error = '';
    if (typeof token !== 'string' || !/^[A-Za-z0-9]{1,256}$/.test(token)) error = '图片标识无效';
    else if (imageSignal.aborted) error = '图片读取超时，可重新提取格式重试';
    else if (attempted >= MAX_IMAGES) error = '单份文档最多读取 60 张不同图片';
    else if (bytes >= MAX_TOTAL_BYTES) error = '图片总量超过 5 MB 本地预览上限';
    else {
      try {
        attempted++;
        const image = await download(
          token,
          imageSignal,
          Math.min(MAX_IMAGE_BYTES, MAX_TOTAL_BYTES - bytes),
        );
        signal.throwIfAborted();
        imageSignal.throwIfAborted();
        bytes += image.bytes;
        assets.set(token, image);
        continue;
      } catch (cause) {
        signal.throwIfAborted();
        error = imageSignal.aborted ? '图片读取超时，可重新提取格式重试' : cause.message;
      }
    }
    assets.set(token, { error });
  }
  const failures = images.filter((block) => assets.get(block.image.token)?.error);
  if (failures.length) {
    const reasons = [...new Set(failures.map((block) => assets.get(block.image.token).error))];
    warnings.push(
      `${failures.length} 张图片未展开：${reasons.join('；')}。请对照飞书原文，处理后可重新提取格式。`,
    );
  }
  warnings.push('文档包含图片，尚未识别图片内文字；图片仅供本机预览，分析只使用提取的文档文字。');
  return assets;
}
