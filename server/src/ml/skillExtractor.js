/**
 * 技能自动抽取 —— 用嵌入模型从简历正文里"读出"技能标签
 *
 * 要解决的问题：现在 `resume.skills` 完全靠人填。学生懒得填、或者只填两三个，
 * 导致后面所有匹配都建立在稀薄的标签上。
 *
 * 两条互补的路径：
 *   ① **词典精确匹配**（precision 高）：正文里出现了词表里的词，就直接认定。
 *      "熟悉 Vue3 和 TypeScript" → 命中 vue / typescript。
 *   ② **语义近邻**（recall 高）：把正文向量与词表每项的向量比余弦，
 *      超过阈值就认为是"语义上提到了"，即使字面不同。
 *      例如正文写"做过微信小程序"，可能语义上拉近"前端开发"。
 *
 * 保守策略：
 *   · 语义路径阈值设得较高（默认 0.62），宁可漏也不乱标
 *   · 结果里带 `source`（exact / semantic）与 `score`，前端可以区分展示
 *   · 只写 `skills_auto`，**绝不覆盖人工填的 `skills`**
 */
import { db } from '../db/connection.js';
import { nowIso } from '../utils/id.js';
import { isReady, embedTexts, embedOwner, cosine } from './embeddingService.js';

/** 语义路径的阈值：余弦超过它才认为"语义上提到" */
const SEMANTIC_THRESHOLD = Number(process.env.ML_SKILL_THRESHOLD || 0.62);
/** 语义路径最多补充多少个标签 */
const SEMANTIC_TOP_K = Number(process.env.ML_SKILL_TOP_K || 6);

/**
 * 技能词表（中英混排）
 * 说明：这是"受控词表"，不是模型。它的作用是给抽取结果一个统一的命名口径，
 *      避免同义表述（"JS"/"JavaScript"/"js"）在库里各写一份。
 */
export const SKILL_VOCAB = [
  // 前端
  'JavaScript', 'TypeScript', 'Vue', 'React', 'HTML', 'CSS', 'Sass', 'Webpack', 'Vite',
  '小程序', 'H5', '前端开发', '组件化', '响应式布局',
  // 后端 / 数据
  'Node.js', 'Express', 'Python', 'Java', 'Go', 'SQL', 'MySQL', 'PostgreSQL', 'Redis',
  'RESTful API', '后端开发', '数据库设计',
  // AI / 算法
  '机器学习', '深度学习', 'PyTorch', 'TensorFlow', '数据分析', '数据可视化', 'Pandas',
  '自然语言处理', '计算机视觉', '大模型',
  // 设计 / 影视
  'Photoshop', 'Illustrator', 'Figma', '海报设计', 'UI设计', 'UX设计', '排版', '配色',
  '视觉传达', '摄影', '视频剪辑', 'Premiere', 'After Effects', '动画制作',
  // 文案 / 传播
  '文案写作', '公众号运营', '新媒体运营', '活动策划', '活动组织', '主持', '采访',
  '新闻写作', '社群运营', '品牌推广',
  // 组织 / 通用
  '项目管理', '团队协作', '沟通协调', '时间管理', '外联赞助', '财务预算', 'excel',
  'PPT', '演讲', '组织能力', '执行力',
  // 文体 / 特长
  '篮球', '足球', '羽毛球', '乒乓球', '田径', '舞蹈', '声乐', '乐器', '吉他', '钢琴',
  '话剧表演', '朗诵', '书法', '绘画',
  // 学术 / 公益
  '数学建模', 'ACM', '科研', '论文写作', '志愿服务', '支教', '公益项目',
];

/** 词表统一小写，便于精确匹配 */
const VOCAB_LOWER = SKILL_VOCAB.map((t) => ({ term: t, lower: t.toLowerCase() }));

/* ------------------------------------------------------------------ */
/* ① 词典精确匹配                                                      */
/* ------------------------------------------------------------------ */
export function extractExact(text) {
  const src = String(text || '').toLowerCase();
  if (!src) return [];
  const hits = [];
  for (const { term, lower } of VOCAB_LOWER) {
    if (src.includes(lower)) hits.push({ term, source: 'exact', score: 1 });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* ② 语义近邻                                                          */
/* ------------------------------------------------------------------ */
/** 词表向量只在第一次用到时编码一次，之后走 embedding_cache */
let vocabVectorsPromise = null;

async function getVocabVectors() {
  if (vocabVectorsPromise) return vocabVectorsPromise;
  vocabVectorsPromise = (async () => {
    const vecs = await embedTexts(SKILL_VOCAB);
    // 顺手落缓存，方便排查
    try {
      const stmt = db.prepare(
        `INSERT INTO embedding_cache (owner_type, owner_id, model, dim, vector, text_hash, updated_at)
         VALUES ('vocab', @id, 'vocab', @dim, '', 'static', @now)
         ON CONFLICT(owner_type, owner_id, model) DO NOTHING`
      );
      for (const t of SKILL_VOCAB) stmt.run({ id: t, dim: vecs[0].length, now: nowIso() });
    } catch {
      /* 缓存失败忽略 */
    }
    return SKILL_VOCAB.map((term, i) => ({ term, vector: vecs[i] }));
  })();
  return vocabVectorsPromise;
}

/**
 * 语义近邻：正文整体向量 vs 词表每项向量
 * @returns {Promise<Array<{term, source, score}>>}
 */
export async function extractSemantic(resumeId, text) {
  if (!isReady()) return [];
  const vocab = await getVocabVectors();
  const textVec = await embedOwner('resume_text', `${resumeId}:fulltext`, text);

  const scored = vocab
    .map((v) => ({ term: v.term, score: cosine(textVec, v.vector) }))
    .filter((x) => x.score >= SEMANTIC_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, SEMANTIC_TOP_K);

  return scored.map((x) => ({ term: x.term, source: 'semantic', score: Number(x.score.toFixed(4)) }));
}

/* ------------------------------------------------------------------ */
/* ③ 合并并写库                                                        */
/* ------------------------------------------------------------------ */
/**
 * 对一份简历做自动技能抽取。
 * @param {string} resumeId
 * @param {{persist?: boolean}} opts persist=true 时会写回 resume.skills_auto
 */
export async function extractResumeSkills(resumeId, { persist = true } = {}) {
  const resume = db.prepare('SELECT * FROM resume WHERE id = ?').get(resumeId);
  if (!resume) throw new Error('简历不存在');

  // 把技能列 + 正文揉成一段供模型阅读
  const text = [resume.skills, resume.content].filter(Boolean).join('\n');
  const exact = extractExact(text);

  let semantic = [];
  if (isReady()) {
    try {
      semantic = await extractSemantic(resumeId, text);
    } catch (e) {
      console.warn('[ml] 语义抽取失败，仅用词典结果：', e.message);
    }
  }

  // 合并：exact 优先；语义路径补 exact 没覆盖到的
  const byTerm = new Map();
  for (const h of exact) byTerm.set(h.term.toLowerCase(), h);
  for (const h of semantic) {
    const k = h.term.toLowerCase();
    if (!byTerm.has(k)) byTerm.set(k, h);
  }

  const merged = [...byTerm.values()].sort((a, b) => b.score - a.score);
  const terms = merged.map((m) => m.term);

  if (persist) {
    db.prepare('UPDATE resume SET skills_auto = ?, updated_at = ? WHERE id = ?').run(
      terms.join(','),
      nowIso(),
      resumeId
    );
  }

  return {
    resumeId,
    skills: terms,
    details: merged,
    humanSkills: resume.skills || '',
    method: isReady() ? 'dictionary+semantic' : 'dictionary-only',
  };
}

/** 批量：给某社团所有收到的简历做自动抽取（供"刷新标签"按钮用） */
export async function extractClubResumeSkills(clubId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT res.id
       FROM application a
       JOIN resume res ON res.id = a.resume_id
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ?`
    )
    .all(clubId);

  const out = [];
  for (const r of rows) {
    try {
      out.push(await extractResumeSkills(r.id));
    } catch (e) {
      out.push({ resumeId: r.id, error: e.message });
    }
  }
  return { clubId, processed: out.length, results: out };
}
