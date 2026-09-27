import { createApp } from './app.js';
import { migrate } from './db/connection.js';
import { loadEnv } from './utils/env.js';
import { ensureSeedAccounts, purgeExpiredSessions } from './services/authService.js';

// 加载 server 上级目录的 .env（若存在），必须在读任何配置前执行
loadEnv();

// 启动时自动执行迁移（幂等）
migrate();

// 社团端账号：清掉过期会话；给还没有账号的社团播种一个初始社长账号
purgeExpiredSessions();
ensureSeedAccounts();

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`[community-server] listening on http://localhost:${port}`);
  console.log(`[community-server] api base: http://localhost:${port}/api/v1`);
});
