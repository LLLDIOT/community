import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

import App from './App.vue';
import router from './router.js';

/**
 * 学生端（公开站点）入口
 *
 * 与社团端分开打包：都用 Vue + Element Plus + vue-router，
 * 但刻意不共享 router 与 layout，避免任何社团端页面被误打进学生端产物。
 */
const app = createApp(App);

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(ElementPlus, { locale: zhCn });
app.use(router);
app.mount('#app');
