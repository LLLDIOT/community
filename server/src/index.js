import { createApp } from './app.js';
import { migrate } from './db/connection.js';

// 启动时自动执行迁移（幂等）
migrate();

const port = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`[community-server] listening on http://localhost:${port}`);
  console.log(`[community-server] api base: http://localhost:${port}/api/v1`);
});
