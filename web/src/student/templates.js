/**
 * 简历模板 —— 按社团分类给出不同的填写要点
 *
 * 从原来的 portal-adapter.js 平移过来，字段定义与生成正文的格式保持不变，
 * 这样历史投递的简历正文结构仍然一致（【字段名】+ 换行 + 内容，段落之间空行）。
 */

const BASE_FIELDS = [
  { key: 'basic_info', label: '基本信息（学院/专业/年级）', type: 'input', source: 'auto' },
  { key: 'contact', label: '联系方式（电话/邮箱）', type: 'input', source: 'auto' },
];

const TAIL_FIELD = { key: 'self_intro', label: '自我介绍（为什么想加入）', type: 'textarea', source: 'auto' };

const CATEGORY_TEMPLATE = {
  technical: {
    desc: '侧重展示编程能力、项目经验与技术成果',
    fields: [
      { key: 'skills', label: '技术技能', type: 'textarea', source: 'auto' },
      { key: 'experience', label: '项目/工作经历', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '竞赛/获奖经历', type: 'textarea', source: 'auto' },
      { key: 'project_detail', label: '代表项目作品描述（选填）', type: 'textarea', source: 'manual' },
    ],
  },
  artistic: {
    desc: '侧重展示才艺、作品与舞台经验',
    fields: [
      { key: 'talents', label: '才艺/特长', type: 'textarea', source: 'auto' },
      { key: 'experience', label: '演出/创作/学生工作经历', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '获奖经历', type: 'textarea', source: 'auto' },
      { key: 'work_sample', label: '代表作品或演出说明（选填）', type: 'textarea', source: 'manual' },
    ],
  },
  organizing: {
    desc: '侧重展示组织协调能力与活动策划经验',
    fields: [
      { key: 'experience', label: '学生工作/活动组织经历', type: 'textarea', source: 'auto' },
      { key: 'skills', label: '技能特长', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '获奖经历', type: 'textarea', source: 'auto' },
      { key: 'plan_idea', label: '如果由你策划一场活动，你的思路是（选填）', type: 'textarea', source: 'manual' },
    ],
  },
  sports: {
    desc: '侧重展示运动经历、身体素质与坚持度',
    fields: [
      { key: 'talents', label: '运动特长', type: 'textarea', source: 'auto' },
      { key: 'experience', label: '训练/比赛经历', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '比赛获奖经历', type: 'textarea', source: 'auto' },
      { key: 'training', label: '每周可投入训练时间（选填）', type: 'input', source: 'manual' },
    ],
  },
  academic: {
    desc: '侧重展示学习成绩、学术兴趣与研究经历',
    fields: [
      { key: 'skills', label: '专业技能', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '学术竞赛/获奖经历', type: 'textarea', source: 'auto' },
      { key: 'experience', label: '科研/学习经历', type: 'textarea', source: 'auto' },
      { key: 'research_interest', label: '感兴趣的研究方向（选填）', type: 'textarea', source: 'manual' },
    ],
  },
  service: {
    desc: '侧重展示志愿服务经历、责任心与时间投入',
    fields: [
      { key: 'experience', label: '志愿服务/学生工作经历', type: 'textarea', source: 'auto' },
      { key: 'skills', label: '技能特长', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '获奖经历', type: 'textarea', source: 'auto' },
      { key: 'volunteer_hours', label: '已有志愿服务时长（选填）', type: 'input', source: 'manual' },
    ],
  },
  other: {
    desc: '通用招新简历模板',
    fields: [
      { key: 'skills', label: '技能特长', type: 'textarea', source: 'auto' },
      { key: 'experience', label: '相关经历', type: 'textarea', source: 'auto' },
      { key: 'awards', label: '获奖经历', type: 'textarea', source: 'auto' },
      { key: 'extra', label: '补充说明（选填）', type: 'textarea', source: 'manual' },
    ],
  },
};

/** 取某分类的模板（含说明与字段） */
export function templateFor(category) {
  const conf = CATEGORY_TEMPLATE[category] || CATEGORY_TEMPLATE.other;
  return {
    desc: conf.desc,
    fields: [...BASE_FIELDS, ...conf.fields, TAIL_FIELD],
  };
}

/** 用学生档案自动填充模板字段（只填 source=auto 且当前为空的项） */
export function autoFill(fields, profile, current = {}) {
  const pick = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean).join('；');
    return String(v || '').trim();
  };
  const autoMap = {
    basic_info: [profile.college, profile.major, profile.grade].filter(Boolean).join(' / '),
    contact: [profile.phone, profile.email].filter(Boolean).join(' / '),
    skills: pick(profile.skills),
    talents: pick(profile.talents),
    experience: pick(profile.experiences),
    awards: pick(profile.awards),
    self_intro: pick(profile.intro),
  };

  const out = { ...current };
  for (const f of fields) {
    if (f.source !== 'auto') continue;
    if (out[f.key] && String(out[f.key]).trim()) continue;
    if (autoMap[f.key]) out[f.key] = autoMap[f.key];
  }
  return out;
}

/** 把模板字段拼成简历正文（格式与旧版一致） */
export function buildContent(fields, data) {
  const lines = [];
  for (const f of fields) {
    const v = String((data && data[f.key]) || '').trim();
    if (v) lines.push(`【${f.label}】\n${v}`);
  }
  return lines.join('\n\n');
}

/** 社团分类 → 简历类型标签（供社团端分类归档） */
export function guessTypeTag(category) {
  const allow = ['technical', 'organizing', 'artistic', 'sports', 'academic', 'service', 'other'];
  return allow.includes(category) ? category : 'other';
}
