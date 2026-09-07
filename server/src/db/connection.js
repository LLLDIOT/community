import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 数据库文件根目录（server 包内），与 uploads 同级 */
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(dataDir, 'club.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * 执行 db/migrations 下所有 *.sql（按文件名排序，幂等）。
 * 通过 user_version 记录已执行的迁移数量。
 */
export function migrate() {
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const runMigrations = db.transaction(() => {
    const applied = db.pragma('user_version', { simple: true });
    for (let i = applied; i < files.length; i += 1) {
      const sql = fs.readFileSync(path.join(migrationsDir, files[i]), 'utf8');
      db.exec(sql);
      db.pragma(`user_version = ${i + 1}`);
      console.log(`[migrate] applied ${files[i]}`);
    }
  });

  runMigrations();
  return files.length;
}
