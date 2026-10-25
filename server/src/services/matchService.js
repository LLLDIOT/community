/**
 * 匹配服务 —— 对外统一接口
 *
 * ── 这一层现在只做「分发」──
 *   ML 可用  → 走 src/ml/semanticMatchService.js（预训练中文嵌入 + 标签融合）
 *   ML 不可用 → 走本文件内的规则基线（字符串集合求交）
 *
 * 为什么保留规则路径：
 *   1. 模型首次下载失败 / 离线 / 依赖缺失时，系统必须还能用
 *   2. 规则分是可解释的辅助信号（"命中了哪几个技能"在招新场景必须说得出）
 *   3. 作为对照基线，才能衡量语义匹配到底提升了多少
 *
 * ⚠️ 这两个函数已改为 **async**（要跑模型推理）。调用方必须 await，
 *    路由层请用 utils/asyncHandler.js 包裹，否则 Express 4 不会捕获 Promise 异常。
 */
import * as semantic from '../ml/semanticMatchService.js';
import { ML_ENABLED, isReady, getStatus } from '../ml/embeddingService.js';
import { db } from '../db/connection.js';
import { notFound } from '../utils/errors.js';

// 纯规则工具从 skillTags 透出，保持旧引用路径可用
export { parseSkills, matchSkills, jaccardSkills } from '../ml/skillTags.js';
import { parseSkills, matchSkills } from '../ml/skillTags.js';

/** 当前匹配能力状态（供 /api/v1/ml/status 与前端展示） */
export function matchCapability() {
  const st = getStatus();
  return {
    mode: st.enabled && st.ready ? 'semantic' : 'rules',
    ml: st,
    note:
      st.enabled && st.ready
        ? '语义匹配已启用（预训练中文嵌入 bge-small-zh + 标签融合）'
        : '语义匹配未就绪，当前为规则匹配（字符串命中）',
  };
}

/**
 * 简历 → 推荐岗位
 * @returns {Promise<{resume, recommendations, total, method}>}
 */
export async function recommendPositionsForResume(resumeId, opts = {}) {
  return semantic.recommendPositionsForResume(resumeId, opts);
}

/**
 * 社团侧：发现"投错岗"的人（语义版）
 * @returns {Promise<Array>}
 */
export async function matchClubApplicants(clubId, opts = {}) {
  return semantic.matchClubApplicants(clubId, opts);
}

/**
 * 同步版：单份简历 vs 单个岗位的**规则**匹配度
 *
 * 保留这个是为了兼容那些"只在列表里显示一行提示"的场景（如面试工作台），
 * 那里不适合为每个候选人 inflight 一次模型推理。
 * 需要真正的语义分请 await recommendPositionsForResume / scoreResumeVsPosition。
 */
export function matchSkillsRuleOnly(resumeSkillsRaw, requiredRaw) {
  return matchSkills(resumeSkillsRaw, requiredRaw);
}

/**
 * 语义版：单份简历 vs 单个岗位（供"为什么推荐他"这类解释场景按需调用）
 */
export async function scoreResumeVsPosition(resumeId, positionId) {
  const resume = db.prepare('SELECT * FROM resume WHERE id = ?').get(resumeId);
  if (!resume) throw notFound('简历不存在');
  const pos = db
    .prepare(
      `SELECT p.*, r.title AS recruitment_title, c.name AS club_name
       FROM position p
       JOIN recruitment r ON r.id = p.recruitment_id
       JOIN club c ON c.id = r.club_id
       WHERE p.id = ?`
    )
    .get(positionId);
  if (!pos) throw notFound('招新岗位不存在');

  if (!ML_ENABLED || !isReady()) {
    const m = matchSkills(resume.skills, pos.required_skills);
    return { ...m, semantics: null, method: 'tags-only' };
  }

  const { embedOwner } = await import('../ml/embeddingService.js');
  const [rv, pv] = await Promise.all([
    embedOwner('resume', resume.id, semantic.buildResumeText(resume)),
    embedOwner('position', pos.id, semantic.buildPositionText(pos)),
  ]);
  return semantic.scorePair(rv, pv, resume.skills, pos.required_skills);
}

/** 供内部复用：解析技能（保持旧函数名可用） */
export const parseSkillsCompat = parseSkills;
