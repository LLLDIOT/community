// 一次性迁移检查：只跑 migrate()，验证 004 的 SQL 能被 SQLite 接受
import { migrate, db } from '../src/db/connection.js';

try {
  migrate();
  console.log('MIGRATE OK, user_version =', db.pragma('user_version', { simple: true }));
  const cols = db.prepare('PRAGMA table_info(application)').all().map((c) => c.name);
  console.log('application columns:', cols.join(', '));
  const clubCols = db.prepare('PRAGMA table_info(club)').all().map((c) => c.name);
  console.log('club columns:', clubCols.join(', '));
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((t) => t.name);
  console.log('tables:', tables.join(', '));
} catch (e) {
  console.error('MIGRATE FAILED:', e.message);
  process.exitCode = 1;
}
