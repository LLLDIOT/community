# ===== 阶段 1：构建前端 =====
FROM node:22-alpine AS web-build
# 构建期 npm 源。国内服务器建议用 https://registry.npmmirror.com（见 deploy/provision.sh）
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ===== 阶段 2：装后端依赖 =====
# 单独一层，是为了给 better-sqlite3 兜底：
# 它默认去 GitHub releases 下预编译包，国内可能拉不到；
# 拉不到时 prebuild-install 会自动回退到本地编译，所以这里装上最小构建工具。
FROM node:22-alpine AS server-deps
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN apk add --no-cache python3 make g++
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ===== 阶段 3：运行 =====
FROM node:22-alpine
WORKDIR /app

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
# 前端构建产物（server 启动时检测 web/dist 自动托管两个站点）
COPY --from=web-build /app/web/dist ./web/dist

ENV NODE_ENV=production
# 两个站点：社团端（3000，有密码） + 学生端（3001，无密码）
ENV PORT=3000
ENV STUDENT_PORT=3001
EXPOSE 3000 3001

WORKDIR /app/server
CMD ["node", "src/index.js"]
