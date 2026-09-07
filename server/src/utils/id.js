import { randomBytes } from 'node:crypto';

/**
 * 生成带前缀的可读 id，如 clu_1a2b3c4d5e6f7g8h9i0j
 * @param {string} prefix 表名前缀（club / rec / pos / res / app / tag）
 */
export function genId(prefix) {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

export function nowIso() {
  return new Date().toISOString();
}
