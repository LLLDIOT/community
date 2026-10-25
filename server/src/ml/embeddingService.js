/**
 * 嵌入服务（EmbeddingService）—— 系统的 ML 基础设施
 *
 * 用什么模型：`Xenova/bge-small-zh-v1.5`
 *   · BAAI 的中文小模型，512 维，int8 量化后约 20-30MB
 *   · 通过 ONNX Runtime 在本地 CPU 推理，单条约 2ms
 *   · **不需要 API、不需要付费、运行时不依赖梯子**（首次下载走 hf-mirror 国内镜像）
 *
 * 为什么用"预训练模型"而不是"自己训练"：
 *   本项目有标样本为 0，任何监督学习都不可能。预训练模型自带通用语言知识，
 *   即使只有 4 份简历也能给出有意义的语义相似度——这是唯一诚实的做法。
 *
 * 设计要点：
 *   1. **懒加载 + 预热**：启动后异步 warmup，不阻塞端口监听
 *   2. **可降级**：模型不可用时 isReady() 返回 false，调用方回退到规则匹配，
 *      绝不让整个系统因为模型挂了而不可用
 *   3. **两级缓存**：内存 Map（快）+ SQLite 表（重启复用）
 *   4. **按文本哈希失效**：简历/岗位文本改了，旧向量自动作废
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../db/connection.js';
import { nowIso } from '../utils/id.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 模型标识：写进缓存表，模型升级后可识别旧向量 */
export const MODEL_NAME = 'Xenova/bge-small-zh-v1.5';
/** 向量维度（bge-small-zh 是 512） */
export const EMBEDDING_DIM = 512;

/** 受环境影响：国内直连 huggingface.co 不通，镜像可达 */
const REMOTE_HOST = process.env.HF_MIRROR || 'https://hf-mirror.com';
const CACHE_DIR = process.env.MODEL_CACHE_DIR || path.resolve(__dirname, '../../data/models');

/** 是否启用 ML（可用 ML_ENABLED=0 一键回退到纯规则模式） */
export const ML_ENABLED = process.env.ML_ENABLED !== '0';

let extractor = null;
let loadingPromise = null;
let loadError = null;
let ready = false;

/** 内存缓存：key = `${type}:${id}:${hash}`，value = number[] */
const memCache = new Map();
const MEM_CACHE_MAX = 500;

function sha1(text) {
  return createHash('sha1').update(String(text || '')).digest('hex');
}

/** 把向量压缩成可存 SQLite 的紧凑字符串（Float32 → base64） */
function vectorToText(vec) {
  return Buffer.from(new Float32Array(vec).buffer).toString('base64');
}

function textToVector(text) {
  const buf = Buffer.from(text, 'base64');
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

/**
 * 加载模型（幂等，并发调用共享同一个 Promise）
 * @returns {Promise<boolean>} 是否可用
 */
export async function loadModel() {
  if (!ML_ENABLED) return false;
  if (ready) return true;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // 动态 import：即使依赖缺失也不影响服务启动（只是 ML 不可用）
      const { env, pipeline } = await import('@xenova/transformers');
      const fs = await import('node:fs');

      env.remoteHost = REMOTE_HOST;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;
      env.cacheDir = CACHE_DIR;

      fs.mkdirSync(CACHE_DIR, { recursive: true });

      const t0 = Date.now();
      extractor = await pipeline('feature-extraction', MODEL_NAME, { quantized: true });
      ready = true;
      console.log(
        `[ml] 嵌入模型已就绪：${MODEL_NAME}（${EMBEDDING_DIM} 维，${((Date.now() - t0) / 1000).toFixed(1)}s）`
      );
      return true;
    } catch (e) {
      loadError = e;
      ready = false;
      console.warn('[ml] 嵌入模型不可用，将回退到规则匹配：', e.message);
      return false;
    }
  })();

  return loadingPromise;
}

/** 后台预热（不阻塞服务启动） */
export function warmup() {
  if (!ML_ENABLED) {
    console.log('[ml] ML_ENABLED=0，已关闭机器学习能力（纯规则模式）');
    return;
  }
  loadModel().catch(() => {});
}

export function isReady() {
  return ready;
}

export function getStatus() {
  return {
    enabled: ML_ENABLED,
    ready,
    model: MODEL_NAME,
    dim: EMBEDDING_DIM,
    remoteHost: REMOTE_HOST,
    cacheDir: CACHE_DIR,
    error: loadError ? loadError.message : null,
    memoryCacheSize: memCache.size,
  };
}

/**
 * 批量编码文本。
 * @param {string[]} texts
 * @returns {Promise<number[][]>} 归一化后的向量（归一化后余弦相似度 = 点积）
 */
export async function embedTexts(texts) {
  if (!ready) {
    const okReady = await loadModel();
    if (!okReady) throw new Error('嵌入模型不可用');
  }
  const batch = texts.map((t) => String(t || '').trim() || '（空）');
  const out = await extractor(batch, { pooling: 'cls', normalize: true });
  return out.tolist();
}

/** 编码单条 */
export async function embedText(text) {
  const [v] = await embedTexts([text]);
  return v;
}

/** 余弦相似度（向量已归一化，故等于点积；这里仍做通用实现以便复用） */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * 读取/写入持久化向量缓存。
 * 文本哈希不同（内容变了）就重新编码，避免用过期向量。
 */
function readCache(ownerType, ownerId, hash) {
  const key = `${ownerType}:${ownerId}:${hash}`;
  if (memCache.has(key)) return memCache.get(key);
  try {
    const row = db
      .prepare(
        `SELECT vector, text_hash FROM embedding_cache
         WHERE owner_type = ? AND owner_id = ? AND model = ?`
      )
      .get(ownerType, ownerId, MODEL_NAME);
    if (row && row.text_hash === hash) {
      const vec = textToVector(row.vector);
      memCache.set(key, vec);
      return vec;
    }
  } catch {
    /* 表不存在等情况直接跳过缓存 */
  }
  return null;
}

function writeCache(ownerType, ownerId, hash, vec) {
  const key = `${ownerType}:${ownerId}:${hash}`;
  if (memCache.size >= MEM_CACHE_MAX) memCache.clear();
  memCache.set(key, vec);
  try {
    db.prepare(
      `INSERT INTO embedding_cache (owner_type, owner_id, model, dim, vector, text_hash, updated_at)
       VALUES (@ownerType, @ownerId, @model, @dim, @vector, @hash, @updatedAt)
       ON CONFLICT(owner_type, owner_id, model) DO UPDATE SET
         dim = excluded.dim, vector = excluded.vector,
         text_hash = excluded.text_hash, updated_at = excluded.updated_at`
    ).run({
      ownerType,
      ownerId,
      model: MODEL_NAME,
      dim: vec.length,
      vector: vectorToText(vec),
      hash,
      updatedAt: nowIso(),
    });
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/**
 * 取某个业务对象（简历/岗位）的向量，带两级缓存。
 * @param {'resume'|'position'} ownerType
 * @param {string} ownerId
 * @param {string} text 用于编码的文本；文本变了向量会自动重建
 */
export async function embedOwner(ownerType, ownerId, text) {
  const hash = sha1(text);
  const cached = readCache(ownerType, ownerId, hash);
  if (cached) return cached;
  const vec = await embedText(text);
  writeCache(ownerType, ownerId, hash, vec);
  return vec;
}

/** 批量取向量（同一批内并发编码，命中缓存的直接返回） */
export async function embedOwners(items) {
  const results = [];
  const toEncode = [];
  for (const it of items) {
    const hash = sha1(it.text);
    const cached = readCache(it.ownerType, it.ownerId, hash);
    if (cached) {
      results.push({ ...it, vector: cached });
    } else {
      const placeholder = { ...it, hash, vector: null };
      results.push(placeholder);
      toEncode.push(placeholder);
    }
  }

  if (toEncode.length > 0) {
    const vectors = await embedTexts(toEncode.map((x) => x.text));
    toEncode.forEach((item, i) => {
      item.vector = vectors[i];
      writeCache(item.ownerType, item.ownerId, item.hash, vectors[i]);
    });
  }
  return results;
}

/** 清空缓存（模型升级或手工维护时用） */
export function clearCache() {
  memCache.clear();
  try {
    db.prepare('DELETE FROM embedding_cache WHERE model = ?').run(MODEL_NAME);
  } catch {
    /* 忽略 */
  }
}
