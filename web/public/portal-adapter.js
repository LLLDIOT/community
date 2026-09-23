/**
 * portal-adapter.js —— 学生端（portal.html）与社团招新系统的适配层
 *
 * 设计目标：不改后端、不改管理端，把原型 H5 接到真实 API 上。
 *  - 结构适配：后端 club/position → 原型期望的 club.positions/resumeTemplate
 *  - 数据持久化：
 *      投递内容 → 真实写入后端 SQLite（POST /resumes + POST /positions/:id/applications）
 *      学生档案 → localStorage（本机缓存，免重复填写）
 *      投递记录 → localStorage 只存 applicationId 索引，状态每次从后端拉最新
 *  - 模板：后端暂无模板表，这里按社团分类生成（technical/artistic/...），
 *          字段全部使用原型 autoFillField 已支持的 key，前端逻辑零改动。
 */
(function () {
  const API = '/api/v1';
  const LS_PROFILE = 'portal_student_profile';
  const LS_APPS = 'portal_applications';

  /* ---------------- 基础请求 ---------------- */
  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* 非 JSON 响应 */ }
    if (!res.ok || (json && json.code !== 0)) {
      const msg = (json && json.message) || `请求失败(${res.status})`;
      throw new Error(msg);
    }
    return json ? json.data : null;
  }

  /* ---------------- 视觉：图标与配色（按 id 稳定生成，无需建库字段） ---------------- */
  const CATEGORY_ICON = {
    technical: '💻', organizing: '📋', artistic: '🎭',
    sports: '🏀', academic: '📚', service: '🤝', other: '🎪',
  };
  const PALETTE = ['#6c5ce7', '#e17055', '#00b894', '#0984e3', '#fd79a8', '#636e72', '#fdcb6e'];

  function hash(str) {
    let h = 0;
    for (let i = 0; i < String(str).length; i += 1) {
      h = (h * 31 + String(str).charCodeAt(i)) % 100000;
    }
    return h;
  }

  /* ---------------- 简历模板：按社团分类生成 ---------------- */
  const BASE_FIELDS = [
    { key: 'name', label: '姓名', type: 'input', source: 'auto' },
    { key: 'basic_info', label: '基本信息（学院/专业/年级）', type: 'input', source: 'auto' },
    { key: 'contact', label: '联系方式（电话/邮箱）', type: 'input', source: 'auto' },
  ];
  const TAIL_FIELD = { key: 'self_intro', label: '自我介绍（为什么想加入）', type: 'textarea', source: 'auto' };

  const CATEGORY_TEMPLATE = {
    technical: {
      desc: '侧重展示编程能力、项目经验、技术成果',
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
      desc: '侧重展示组织协调能力、活动策划经验',
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

  function buildTemplate(club) {
    const conf = CATEGORY_TEMPLATE[club.category] || CATEGORY_TEMPLATE.other;
    return {
      title: `${club.name}·招新简历模板`,
      desc: conf.desc,
      fields: [...BASE_FIELDS, ...conf.fields, TAIL_FIELD],
    };
  }

  /* ---------------- 社团数据适配 ---------------- */
  function adaptClub(raw) {
    const positions = [];
    (raw.recruitments || []).forEach((rec) => {
      (rec.positions || []).forEach((p) => {
        positions.push({
          id: p.id,
          name: p.title,
          requirements: p.requirement || '（暂无具体要求说明）',
          headcount: p.headcount,
          filled: p.filled_count,
          recruitmentId: rec.id,
          recruitmentTitle: rec.title,
          status: rec.status,
          closed: rec.status !== 'open',
        });
      });
    });
    const club = {
      id: raw.id,
      name: raw.name,
      category: raw.category,
      icon: CATEGORY_ICON[raw.category] || CATEGORY_ICON.other,
      color: PALETTE[hash(raw.id) % PALETTE.length],
      intro: raw.description || '（该社团暂未填写介绍）',
      scale: raw.scale,
      honors: [],           // 后端暂无该字段，界面自动隐藏空区块
      zongce: '',
      activities: '',
      contact: [raw.contact_name, raw.contact_phone, raw.contact_email].filter(Boolean).join(' / '),
      positions,
    };
    club.resumeTemplate = buildTemplate(club);
    return club;
  }

  /* ---------------- 对外 API ---------------- */
  async function listClubs() {
    const data = await request('/clubs?page=1&pageSize=100');
    return (data.list || []).map(adaptClub);
  }

  async function getClub(clubId) {
    const raw = await request(`/clubs/${clubId}`);
    return adaptClub(raw);
  }

  /* 学生档案（localStorage） */
  const DEFAULT_PROFILE = {
    name: '', gender: '', birthday: '', age: '',
    college: '', major: '', grade: '',
    phone: '', email: '',
    experiences: ['', '', ''],
    awards: ['', '', ''],
    skills: '', talents: '', intro: '',
  };

  function loadProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_PROFILE) || '{}');
      const p = { ...DEFAULT_PROFILE, ...saved };
      p.experiences = (p.experiences || []).concat(['', '', '']).slice(0, 3);
      p.awards = (p.awards || []).concat(['', '', '']).slice(0, 3);
      return p;
    } catch (e) {
      return { ...DEFAULT_PROFILE };
    }
  }

  function saveProfile(profile) {
    localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
  }

  /* 投递：真实写入后端 */
  async function apply({ club, position, student, templateData, templateFields }) {
    // ① 组装简历正文：模板字段 → 可读文本
    const lines = [];
    templateFields.forEach((f) => {
      const v = (templateData[f.key] || '').trim();
      if (v) lines.push(`【${f.label}】\n${v}`);
    });
    const content = lines.join('\n\n');

    const resume = await request('/resumes', {
      method: 'POST',
      body: {
        studentName: student.name || '未填写姓名',
        phone: student.phone || null,
        email: student.email || null,
        school: student.college || null,
        major: student.major || null,
        grade: student.grade || null,
        skills: student.skills || null,
        content,
      },
    });

    // ② 创建投递（进入社团端简历库，状态 new）
    const application = await request(`/positions/${position.id}/applications`, {
      method: 'POST',
      body: { resumeId: resume.id, typeTag: guessTypeTag(club.category) },
    });

    // ③ 本地只存索引
    const records = loadRecords();
    records.unshift({
      applicationId: application.id,
      clubId: club.id,
      clubName: club.name,
      clubIcon: club.icon,
      clubColor: club.color,
      positionName: position.name,
      createdAt: application.created_at || new Date().toISOString(),
    });
    localStorage.setItem(LS_APPS, JSON.stringify(records.slice(0, 50)));
    return application;
  }

  /* 社团分类 → 简历类型标签（供管理端分类归档） */
  function guessTypeTag(category) {
    const map = {
      technical: 'technical', organizing: 'organizing', artistic: 'artistic',
      sports: 'sports', academic: 'academic', service: 'service', other: 'other',
    };
    return map[category] || 'other';
  }

  function loadRecords() {
    try {
      return JSON.parse(localStorage.getItem(LS_APPS) || '[]');
    } catch (e) {
      return [];
    }
  }

  /** 我的投递记录：本地索引 + 后端最新状态（数据以服务端为准） */
  async function listApplications() {
    const records = loadRecords();
    const result = [];
    for (const r of records) {
      let status = 'new';
      let positionName = r.positionName;
      try {
        const detail = await request(`/applications/${r.applicationId}`);
        status = detail.status;
        positionName = detail.position_title || positionName;
      } catch (e) {
        status = 'unknown'; // 记录已被社团删除
      }
      result.push({ ...r, positionName, status });
    }
    return result;
  }

  function clearRecords() {
    localStorage.removeItem(LS_APPS);
  }

  window.PortalAPI = {
    listClubs, getClub,
    loadProfile, saveProfile,
    apply, listApplications, clearRecords,
    STATUS_LABEL: {
      new: '已送达', screening: '筛选中', interviewing: '面试中',
      admitted: '已录取', rejected: '未通过', archived: '已归档', unknown: '已失效',
    },
  };
})();
