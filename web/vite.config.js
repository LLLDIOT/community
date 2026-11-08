import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],

  server: {
    port: 5173,
    proxy: {
      // 开发期将 API 与静态上传代理到后端 (localhost:3000)
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },

  build: {
    rollupOptions: {
      /**
       * 多入口：两个站点各一份 HTML 产物
       *   index.html   → 社团端 SPA（有登录、完整管理功能）
       *   student.html → 学生端 SPA（公开、只调用 5 个白名单接口）
       *
       * 两个入口共享 Vue / Element Plus 依赖，但路由与视图目录完全分开，
       * 不会把社团端页面打进学生端产物。
       */
      input: {
        main: resolve(__dirname, 'index.html'),
        student: resolve(__dirname, 'student.html'),
      },
    },
  },
});
