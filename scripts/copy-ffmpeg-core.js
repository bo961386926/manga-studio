// 把 @ffmpeg/core 的 esm 文件复制到 public/ffmpeg，供浏览器端 ffmpeg.wasm 加载
// ESM 版本（根 package.json 声明 "type": "module"，CJS require 会崩溃）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const dest = path.join(__dirname, '..', 'public', 'ffmpeg');
try {
  if (fs.existsSync(src)) {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, 'ffmpeg-core.js'), path.join(dest, 'ffmpeg-core.js'));
    fs.copyFileSync(path.join(src, 'ffmpeg-core.wasm'), path.join(dest, 'ffmpeg-core.wasm'));
    console.log('[postinstall] ffmpeg core 已复制到 public/ffmpeg');
  }
} catch (e) {
  console.warn('[postinstall] 跳过 ffmpeg core 复制:', e.message);
}
