/**
 * 技能标签的纯函数工具（规则层）
 *
 * 单独抽出来是为了**打破循环依赖**：
 *   - semanticMatchService（ML 层）需要 parseSkills
 *   - matchService（对外 API 层）要转发给 semanticMatchService
 * 如果 parseSkills 留在 matchService 里，两者就互相 import 了。
 *
 * 这里只放**确定性、无副作用、无 IO** 的函数，方便单独测试，
 * 也让"规则基线"始终可调用——ML 不可用时靠它降级。
 */

/**
 * 技能标签解析与归一化
 * 输入："Vue, Node.js ，沟通" → ["vue", "node.js", "沟通"]
 * - 支持中英文逗号 / 顿号 / 分号分隔
 * - 忽略空项；英文小写化以便精确匹配
 * - 保留内部空格（如 "Node.js"），仅去首尾空格
 */
export function parseSkills(raw) {
  if (!raw) return [];
  const tokens = String(raw).split(/[,，、;；]/);
  return [...new Set(tokens.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/**
 * 规则版匹配度：命中数 / 期望数
 *
 * 这是 ML 引入之前的基线算法，现在有两个用途：
 *   1. ML 不可用时的降级路径
 *   2. 作为可解释的辅助分（"命中了哪几个技能"是招新场景必须能说清的）
 *
 * 已知局限（见 docs/ML_PERSPECTIVE.md）：
 *   · 只惩罚漏掉的技能，不惩罚堆砌 —— 简历把所有技能都填上会虚高
 *   · 无同义词、无权重、无语义
 */
export function matchSkills(resumeSkillsRaw, requiredRaw) {
  const resumeSkills = Array.isArray(resumeSkillsRaw)
    ? resumeSkillsRaw
    : parseSkills(resumeSkillsRaw);
  const requiredSkills = Array.isArray(requiredRaw)
    ? requiredRaw
    : parseSkills(requiredRaw);

  if (requiredSkills.length === 0) {
    return { score: 0, hitSkills: [], missingSkills: [], resumeSkills, requiredSkills };
  }

  const resumeSet = new Set(resumeSkills);
  const hitSkills = requiredSkills.filter((s) => resumeSet.has(s));
  const missingSkills = requiredSkills.filter((s) => !resumeSet.has(s));
  const score = Math.round((hitSkills.length / requiredSkills.length) * 100);

  return { score, hitSkills, missingSkills, resumeSkills, requiredSkills };
}

/**
 * Jaccard 相似度（备用度量）
 * 与 matchSkills 的差别：分母是并集，会惩罚"技能写得越多分越高"的堆砌行为。
 */
export function jaccardSkills(resumeSkillsRaw, requiredRaw) {
  const a = new Set(parseSkills(resumeSkillsRaw));
  const b = new Set(parseSkills(requiredRaw));
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of b) if (a.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}
