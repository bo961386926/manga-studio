FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

# 镜像内只需 Vite 打包，不装 electron / electron-builder（依赖树极大，npm 会长时间停在 deprecated 警告后解析/下载，看起来像“卡住”）
# 与 package.json 中 devDependencies 保持一致，避免镜像与本地行为漂移
RUN npm install --omit=dev && \
    npm install --no-save vite@^6.2.0 @vitejs/plugin-react@^4.2.0 typescript@~5.8.2 @types/node@^22.14.0

COPY . .

RUN npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物到 nginx 目录（Vite 会把 index.html、带 hash 的 JS/CSS 等打进 dist）
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
