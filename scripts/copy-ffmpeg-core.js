// 把 @ffmpeg/core 的 esm 文件复制到 public/ffmpeg，供浏览器端 ffmpeg.wasm 加载
const fs = require('fs');
const path = require('path');
const src = 'node_modules/@ffmpeg/core/dist/esm';
const dest = 'public/ffmpeg';
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
