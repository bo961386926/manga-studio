// 把 undici FormData 序列化成 multipart/form-data Buffer。
// fetchUpstream 走自建 http 客户端（重定向循环 + 体积护栏 + 注入认证），
// 不接受 FormData，需要显式序列化才能携带文件部分与边界。
import crypto from 'node:crypto';

export const serializeFormData = async (form) => {
  const boundary = `dsh-${crypto.randomUUID().replace(/-/g, '')}`;
  const chunks = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') {
      chunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      );
      continue;
    }
    const filename = String(value.name || 'blob').replace(/["\r\n]/g, '');
    const type = value.type || 'application/octet-stream';
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
          `Content-Type: ${type}\r\n\r\n`
      )
    );
    const data = typeof value.arrayBuffer === 'function'
      ? new Uint8Array(await value.arrayBuffer())
      : Buffer.from(value);
    chunks.push(Buffer.from(data), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { buffer: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
};
