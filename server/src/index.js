/**
 * 启动入口：同一个进程里跑两个站点
 *
 *   社团端（PC 管理台）  PORT         默认 3000 —— 有全站密码、完整 API、Vue SPA
 *   学生端（手机投递）   STUDENT_PORT 默认 3001 —— 无密码、仅白名单 API、H5 单页
 *
 * 为什么放一个进程：SQLite 是单写者，两个进程同时写同一个库文件会踩锁与 WAL 的坑。
 * 两个端口对外就是两个独立网站，但只有一条写入路径。
 *
 * 只想跑单站点（比如本地开发）时，把 STUDENT_PORT 设成 0 即可关掉学生端监听。
 */
import { createClubApp } from './apps/clubApp.js';
import { createStudentApp } from './apps/studentApp.js';
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

const clubPort = Number(process.env.PORT || 3000);
const studentPort = Number(process.env.STUDENT_PORT ?? 3001);

/* ══════════ 社团端 ══════════ */
const clubApp = createClubApp();
clubApp.listen(clubPort, () => {
  console.log(`[社团端] http://localhost:${clubPort}          （有访问密码 · 完整管理功能）`);
  console.log(`[社团端] API  http://localhost:${clubPort}/api/v1`);
});

/* ══════════ 学生端 ══════════ */
if (studentPort > 0 && studentPort !== clubPort) {
  const studentApp = createStudentApp();
  studentApp.listen(studentPort, () => {
    console.log(`[学生端] http://localhost:${studentPort}          （无需密码 · 手机投递用）`);
  });
} else if (studentPort === clubPort) {
  console.warn('[学生端] STUDENT_PORT 与 PORT 相同，已跳过独立监听（学生端将与社团端同址）');
} else {
  console.log('[学生端] STUDENT_PORT=0，已关闭学生端站点（单站点模式）');
}

/* 端口被占用之类的启动异常，给出可读提示而不是一堆栈 */
for (const [name, server] of [['社团端', clubApp]]) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[${name}] 端口 ${clubPort} 已被占用。请先停掉占用进程，或改 .env 里的 PORT。`);
      process.exit(1);
    }
    throw err;
  });
}
