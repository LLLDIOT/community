/**
 * 兼容入口：历史上 index.js 从这里取 createApp()。
 * 现在拆成两个站点，真正的实现在 apps/clubApp.js 与 apps/studentApp.js。
 * 保留本文件与 createApp 别名，避免旧脚本/文档里的引用失效。
 */
export { createClubApp } from './apps/clubApp.js';
export { createStudentApp } from './apps/studentApp.js';

// 旧名字 = 社团端（历史行为：单站点就是社团端）
export { createClubApp as createApp } from './apps/clubApp.js';
