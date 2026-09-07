# ===== 阶段 1：构建前端 =====
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npm run build

# ===== 阶段 2：运行后端（单端口托管前端 dist + API） =====
FROM node:22-alpine
WORKDIR /app

# 后端依赖
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# 后端源码
COPY server/ ./server/
# 前端构建产物（server 启动时检测 web/dist 自动托管）
COPY --from=web-build /app/web/dist ./web/dist

# 运行时数据与附件目录（compose 中以 volume 挂载）
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "src/index.js"]
