/**
 * 候选人聚类 —— 无监督学习（K-means）
 *
 * 为什么这里选无监督：
 *   本项目有标样本为 0，任何监督学习都不可能。但**聚类不需要标签**——
 *   它只在嵌入空间里找"哪些候选人彼此相似"，这恰好能回答一个实际问题：
 *
 *     「这 40 份投递里，大致可以分成几类人？」
 *
 *   社团干部面对一堆简历时，先按"画像"分组再逐组筛选，比逐份看要快得多。
 *
 * 实现要点：
 *   · K-means++ 初始化（比随机初始化稳，避免空簇）
 *   · 固定种子的伪随机数 → 同样的数据每次跑出同样的分组（可复现）
 *   · 自动选 k：候选 2..6，用轮廓系数（silhouette）挑最好的
 *   · 每簇给出"画像"：该簇成员高频出现的技能词
 */
import { db } from '../db/connection.js';
import { isReady } from './embeddingService.js';
import { embedOwners, cosine } from './embeddingService.js';
import { buildResumeText } from './semanticMatchService.js';

/** 固定种子的随机数发生器（保证聚类结果可复现） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function euclideanSq(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

function meanVector(vectors) {
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i += 1) out[i] += v[i];
  for (let i = 0; i < dim; i += 1) out[i] /= vectors.length;
  return out;
}

/** K-means++ 初始化：按距离平方概率挑初始中心，减少退化成空簇的概率 */
function kmeansPlusPlus(vectors, k, rnd) {
  const centers = [vectors[Math.floor(rnd() * vectors.length)]];
  while (centers.length < k) {
    const dists = vectors.map((v) => {
      let best = Infinity;
      for (const c of centers) best = Math.min(best, euclideanSq(v, c));
      return best;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) {
      // 所有点重合，随便补一个
      centers.push(vectors[Math.floor(rnd() * vectors.length)]);
      continue;
    }
    let r = rnd() * total;
    let idx = 0;
    for (let i = 0; i < dists.length; i += 1) {
      r -= dists[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centers.push(vectors[idx]);
  }
  return centers;
}

/** 单次 K-means 迭代 */
function kmeans(vectors, k, { maxIter = 100, seed = 42 } = {}) {
  const rnd = mulberry32(seed);
  let centers = kmeansPlusPlus(vectors, k, rnd);
  let assign = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIter; iter += 1) {
    // 分配
    let changed = false;
    for (let i = 0; i < vectors.length; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const d = euclideanSq(vectors[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    }
    if (!changed) break;

    // 更新中心
    const groups = Array.from({ length: centers.length }, () => []);
    for (let i = 0; i < vectors.length; i += 1) groups[assign[i]].push(vectors[i]);
    centers = centers.map((old, c) => (groups[c].length > 0 ? meanVector(groups[c]) : old));
  }

  // 惯性（簇内平方和）
  let inertia = 0;
  for (let i = 0; i < vectors.length; i += 1) inertia += euclideanSq(vectors[i], centers[assign[i]]);

  return { centers, assign, inertia };
}

/** 轮廓系数：衡量"簇内紧、簇间远"，越接近 1 越好 */
function silhouette(vectors, assign, centers) {
  const n = vectors.length;
  const k = centers.length;
  if (k < 2 || n <= k) return -1;

  const sizes = new Array(k).fill(0);
  for (const a of assign) sizes[a] += 1;

  let total = 0;
  let counted = 0;
  for (let i = 0; i < n; i += 1) {
    const own = assign[i];
    if (sizes[own] <= 1) continue;

    let intra = 0;
    let intraN = 0;
    const interSum = new Array(k).fill(0);
    const interN = new Array(k).fill(0);

    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const d = Math.sqrt(euclideanSq(vectors[i], vectors[j]));
      if (assign[j] === own) {
        intra += d;
        intraN += 1;
      } else {
        interSum[assign[j]] += d;
        interN[assign[j]] += 1;
      }
    }
    if (intraN === 0) continue;
    const a = intra / intraN;
    let b = Infinity;
    for (let c = 0; c < k; c += 1) {
      if (c === own || interN[c] === 0) continue;
      b = Math.min(b, interSum[c] / interN[c]);
    }
    if (!Number.isFinite(b)) continue;
    total += (b - a) / Math.max(a, b);
    counted += 1;
  }
  return counted === 0 ? -1 : total / counted;
}

/** 从一组技能里挑出最高频的几个，作为该簇的"画像" */
function profileSkills(members, topN = 5) {
  const counter = new Map();
  for (const m of members) {
    for (const s of String(m.skills || '')
      .split(/[,，、;；]/)
      .map((x) => x.trim())
      .filter(Boolean)) {
      counter.set(s, (counter.get(s) || 0) + 1);
    }
  }
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([skill, count]) => ({ skill, count }));
}

/**
 * 对某社团收到的候选人做聚类
 * @param {string} clubId
 * @param {{k?: number, autoK?: boolean}} opts
 */
export async function clusterCandidates(clubId, { k = 0, autoK = true } = {}) {
  const rows = db
    .prepare(
      `SELECT app.id AS application_id, app.position_id, app.status, app.decision,
              res.id AS resume_id, res.student_name, res.skills, res.content,
              res.major, res.grade, res.school,
              p.title AS position_title
       FROM application app
       JOIN resume res ON res.id = app.resume_id
       JOIN position p ON p.id = app.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ?
       ORDER BY app.created_at`
    )
    .all(clubId);

  if (!isReady()) {
    return {
      clubId,
      available: false,
      reason: '嵌入模型未就绪，聚类不可用（不影响其他功能）',
      clusters: [],
    };
  }
  /*
   * 样本太小时的保护：
   *   K-means 在 n 很小时，k 一逼近 n 就会出现"单点簇"，
   *   而轮廓系数对单点簇无定义（会被跳过），结果可能虚高到 1.0 —— 这是假象，不是"分得好"。
   *   所以：n < MIN_N 直接不聚类；k 最多取到 floor(n/2)，保证每簇至少有 2 个点的余地。
   */
  const MIN_N = 6;
  if (rows.length < MIN_N) {
    return {
      clubId, available: true, clusters: [], k: 0,
      reason: `候选人数 ${rows.length}（<${MIN_N}）太少，聚类没有统计意义；建议直接人工筛选`,
    };
  }

  // 一次性编码（缓存命中率高）
  const withVec = await embedOwners(
    rows.map((r) => ({
      ownerType: 'resume',
      ownerId: r.resume_id,
      text: buildResumeText(r),
      row: r,
    }))
  );
  const vectors = withVec.map((x) => x.vector);

  // 选定 k：在 2..min(4, floor(n/2)) 里用轮廓系数挑最优（上限保证每簇不至于是单点）
  let best = null;
  const maxK = Math.max(2, Math.min(4, Math.floor(rows.length / 2)));
  const candidates = autoK
    ? Array.from({ length: Math.max(1, maxK - 1) }, (_, i) => i + 2)
    : [Math.min(k || 3, maxK)];

  for (const kk of candidates) {
    const res = kmeans(vectors, kk, { seed: 42 });
    const score = silhouette(vectors, res.assign, res.centers);
    if (!best || score > best.score) best = { k: kk, ...res, score };
  }

  if (!best) {
    const res = kmeans(vectors, Math.min(3, rows.length - 1), { seed: 42 });
    best = { k: res.centers.length, ...res, score: -1 };
  }

  // 组装结果
  const groups = Array.from({ length: best.centers.length }, () => []);
  best.assign.forEach((c, i) => groups[c].push(withVec[i].row));

  const clusters = groups
    .map((members, idx) => ({
      index: idx,
      size: members.length,
      profile: profileSkills(members),
      members: members.map((m) => ({
        applicationId: m.application_id,
        resumeId: m.resume_id,
        studentName: m.student_name,
        positionTitle: m.position_title,
        grade: m.grade,
        major: m.major,
        status: m.status,
        decision: m.decision,
        skills: m.skills || '',
      })),
    }))
    .filter((c) => c.size > 0)
    .sort((a, b) => b.size - a.size);

  // 质心之间的余弦相似度矩阵（看类别分得开不开）
  const separations = [];
  for (let i = 0; i < best.centers.length; i += 1) {
    for (let j = i + 1; j < best.centers.length; j += 1) {
      separations.push({
        a: i, b: j,
        cosine: Number(cosine(best.centers[i], best.centers[j]).toFixed(4)),
      });
    }
  }

  return {
    clubId,
    available: true,
    k: clusters.length,
    silhouette: Number(best.score.toFixed(4)),
    inertia: Number(best.inertia.toFixed(2)),
    note:
      '轮廓系数越接近 1 表示分组越清晰；接近 0 或为负说明这批人本身比较同质、分不出明显类别。',
    centroidSimilarity: separations,
    clusters,
  };
}
