/**
 * 招新广场 —— 双面板的「全校社团总览」侧
 *
 * 需求：「点进去下面有两个显示，第一个显示是所有学校社团的显示，
 *        我们也可以通过点击图标进去看一看别的社团的招新情况、投递人数」
 *
 * 因此本服务只读：把每个社团的招新情况（批次/岗位/需求人数/已录取）与
 * 投递人数（累计、待处理、候补）聚合成广场卡片；点进去再给一份单社团详情。
 * 不含任何写操作，因此无需登录即可浏览（与"路过看看别的社团"的诉求一致）。
 */
import { db } from '../db/connection.js';
import { notFound } from '../utils/errors.js';

/** 招新阶段展示态：报名前 / 招新中 / 已截止 / 无招新 */
export const STAGE_LABELS = {
  none: '暂无招新',
  upcoming: '即将开始',
  open: '招新中',
  closed: '已截止',
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 根据批次状态与时间窗推导展示阶段。
 * 批次未显式填时间时，回落到社团级投递时间窗。
 */
function deriveStage(rec, club) {
  if (!rec) return { stage: 'none', label: STAGE_LABELS.none };
  if (rec.status === 'draft') return { stage: 'upcoming', label: '未发布' };
  if (rec.status === 'closed') return { stage: 'closed', label: STAGE_LABELS.closed };

  // 兼容两种形状：数据库行用 snake_case（start_at），详情视图里已归一化成 camelCase（startAt）
  const startAt = rec.start_at || rec.startAt || club?.apply_start_at || club?.applyStartAt || null;
  const endAt = rec.end_at || rec.endAt || club?.apply_end_at || club?.applyEndAt || null;
  const now = Date.now();

  if (startAt && new Date(startAt).getTime() > now) {
    return { stage: 'upcoming', label: STAGE_LABELS.upcoming, startAt, endAt };
  }
  if (endAt && new Date(endAt).getTime() < now) {
    return { stage: 'closed', label: STAGE_LABELS.closed, startAt, endAt };
  }
  return { stage: 'open', label: STAGE_LABELS.open, startAt, endAt };
}

/** 广场卡片用的聚合子查询（每个社团一行，避免 N+1） */
const AGG_SELECT = `
  (SELECT COUNT(*) FROM recruitment r WHERE r.club_id = c.id) AS recruitment_count,
  (SELECT COUNT(*) FROM recruitment r WHERE r.club_id = c.id AND r.status = 'open') AS open_recruitment_count,
  (SELECT COUNT(*) FROM position p JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id) AS position_count,
  (SELECT COALESCE(SUM(p.headcount), 0) FROM position p JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND r.status = 'open') AS open_headcount,
  (SELECT COALESCE(SUM(p.filled_count), 0) FROM position p JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND r.status = 'open') AS open_filled,
  (SELECT COUNT(*) FROM application a JOIN position p ON p.id = a.position_id
     JOIN recruitment r ON r.id = p.recruitment_id WHERE r.club_id = c.id) AS application_count,
  (SELECT COUNT(*) FROM application a JOIN position p ON p.id = a.position_id
     JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND a.was_admitted = 1) AS admitted_count,
  (SELECT COUNT(*) FROM application a JOIN position p ON p.id = a.position_id
     JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND a.status = 'new') AS pending_count,
  (SELECT COUNT(*) FROM application a JOIN position p ON p.id = a.position_id
     JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND a.decision = 'waitlist') AS waitlist_count,
  (SELECT COUNT(*) FROM application a JOIN position p ON p.id = a.position_id
     JOIN recruitment r ON r.id = p.recruitment_id
     WHERE r.club_id = c.id AND a.decision = 'adjust') AS adjust_count
`;

/** 把一个社团行整理成广场卡片 */
function toCard(row, openRec) {
  const { stage, label, startAt, endAt } = deriveStage(openRec, row);
  const need = row.open_headcount || 0;
  const filled = row.open_filled || 0;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    scale: row.scale,
    scaleLabel: row.scale_label,
    description: row.description,
    entryCriteria: row.entry_criteria || '',
    applyStartAt: row.apply_start_at,
    applyEndAt: row.apply_end_at,
    stage,
    stageLabel: label,
    currentRecruitment: openRec
      ? { id: openRec.id, title: openRec.title, status: openRec.status, startAt, endAt }
      : null,
    stats: {
      recruitmentCount: row.recruitment_count,
      openRecruitmentCount: row.open_recruitment_count,
      positionCount: row.position_count,
      openHeadcount: need,
      openFilled: filled,
      fillRate: need > 0 ? Math.round((filled / need) * 100) : 0,
      applicationCount: row.application_count,
      admittedCount: row.admitted_count,
      pendingCount: row.pending_count,
      waitlistCount: row.waitlist_count,
      adjustCount: row.adjust_count,
    },
  };
}

/** 全校社团总览（面板一） */
export function listSquareClubs({ keyword = '', category = '', stage = '', sort = 'applications' } = {}) {
  const where = ['c.is_visible = 1'];
  const params = {};
  if (keyword) {
    where.push('(c.name LIKE @kw OR c.description LIKE @kw OR c.entry_criteria LIKE @kw)');
    params.kw = `%${keyword}%`;
  }
  if (category) {
    where.push('c.category = @category');
    params.category = category;
  }

  const rows = db
    .prepare(`SELECT c.*, ${AGG_SELECT} FROM club c WHERE ${where.join(' AND ')}`)
    .all(params);

  // 每个社团当前"进行中"的批次（用于阶段判断与"查看招新情况"入口）
  const openRecs = db
    .prepare(
      `SELECT * FROM recruitment WHERE status = 'open'
       ORDER BY COALESCE(start_at, created_at) DESC`
    )
    .all();
  const openByClub = new Map();
  for (const r of openRecs) if (!openByClub.has(r.club_id)) openByClub.set(r.club_id, r);

  let cards = rows
    .map((r) => toCard(r, openByClub.get(r.id) || null))
    .filter((c) => {
      if (!stage) return true;
      if (stage === 'open') return c.stage === 'open';
      if (stage === 'closed') return c.stage === 'closed' || c.stage === 'upcoming';
      return true;
    });

  const sorters = {
    applications: (a, b) => b.stats.applicationCount - a.stats.applicationCount,
    scale: (a, b) => (b.scale || 0) - (a.scale || 0),
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'),
  };
  cards = cards.sort(sorters[sort] || sorters.applications);

  const totals = cards.reduce(
    (acc, c) => ({
      clubs: acc.clubs + 1,
      openClubs: acc.openClubs + (c.stage === 'open' ? 1 : 0),
      positions: acc.positions + c.stats.positionCount,
      headcount: acc.headcount + c.stats.openHeadcount,
      applications: acc.applications + c.stats.applicationCount,
    }),
    { clubs: 0, openClubs: 0, positions: 0, headcount: 0, applications: 0 }
  );

  return { list: cards, total: cards.length, totals };
}

/** 广场上可选的社团分类（用于筛选下拉） */
export function listCategories() {
  return db
    .prepare(
      `SELECT category, COUNT(*) AS c FROM club
       WHERE is_visible = 1 AND category IS NOT NULL AND category != ''
       GROUP BY category ORDER BY c DESC`
    )
    .all()
    .map((r) => ({ value: r.category, count: r.c }));
}

/**
 * 单社团招新情况详情（点某个社团图标进来看到的）
 * 只读视角：任何人都能看别的社团招到了多少人，但改不了别人的数据。
 */
export function getSquareClub(clubId, { days = 30 } = {}) {
  const club = db.prepare('SELECT * FROM club WHERE id = ?').get(clubId);
  if (!club) throw notFound('社团不存在');

  const agg = db.prepare(`SELECT c.*, ${AGG_SELECT} FROM club c WHERE c.id = ?`).get(clubId);

  const recruitments = db
    .prepare('SELECT * FROM recruitment WHERE club_id = ? ORDER BY created_at DESC')
    .all(clubId)
    .map((rec) => {
      const positions = db
        .prepare(
          `SELECT p.*,
                  (SELECT COUNT(*) FROM application a WHERE a.position_id = p.id) AS application_count,
                  (SELECT COUNT(*) FROM application a WHERE a.position_id = p.id AND a.was_admitted = 1) AS admitted_count,
                  (SELECT COUNT(*) FROM application a WHERE a.position_id = p.id AND a.decision = 'waitlist') AS waitlist_count,
                  (SELECT COUNT(*) FROM application a WHERE a.position_id = p.id AND a.status = 'new') AS pending_count
           FROM position p WHERE p.recruitment_id = ?
           ORDER BY p.sort_order ASC, p.created_at ASC`
        )
        .all(rec.id);
      const need = positions.reduce((s, p) => s + (p.headcount || 0), 0);
      const filled = positions.reduce((s, p) => s + (p.filled_count || 0), 0);
      return {
        id: rec.id,
        title: rec.title,
        status: rec.status,
        startAt: rec.start_at || club.apply_start_at,
        endAt: rec.end_at || club.apply_end_at,
        remark: rec.remark,
        positions,
        stats: {
          positionCount: positions.length,
          headcount: need,
          filled,
          fillRate: need > 0 ? Math.round((filled / need) * 100) : 0,
          applicationCount: positions.reduce((s, p) => s + p.application_count, 0),
        },
      };
    });

  const openRec = recruitments.find((r) => r.status === 'open') || null;
  const { stage, label, startAt, endAt } = deriveStage(openRec, club);

  const statusCounts = db
    .prepare(
      `SELECT a.status, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ? GROUP BY a.status`
    )
    .all(clubId);
  const decisionCounts = db
    .prepare(
      `SELECT a.decision, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ? GROUP BY a.decision`
    )
    .all(clubId);

  // 近 N 天投递趋势（含 0 值补全，前端可直接画连续折线）
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const trendRows = db
    .prepare(
      `SELECT substr(a.created_at, 1, 10) AS d, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment r ON r.id = p.recruitment_id
       WHERE r.club_id = ? AND a.created_at >= ? GROUP BY d`
    )
    .all(clubId, since.toISOString());
  const trendMap = Object.fromEntries(trendRows.map((r) => [r.d, r.c]));
  const trend = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = dayKey(d);
    trend.push({ date: key, count: trendMap[key] || 0 });
  }

  return {
    club: {
      id: club.id,
      name: club.name,
      category: club.category,
      scale: club.scale,
      scaleLabel: club.scale_label,
      description: club.description,
      entryCriteria: club.entry_criteria || '',
      contactName: club.contact_name,
      applyStartAt: club.apply_start_at,
      applyEndAt: club.apply_end_at,
      createdAt: club.created_at,
    },
    stage,
    stageLabel: label,
    window: { startAt, endAt },
    recruitments,
    stats: {
      recruitmentCount: agg.recruitment_count,
      openRecruitmentCount: agg.open_recruitment_count,
      positionCount: agg.position_count,
      openHeadcount: agg.open_headcount,
      openFilled: agg.open_filled,
      applicationCount: agg.application_count,
      admittedCount: agg.admitted_count,
      pendingCount: agg.pending_count,
      waitlistCount: agg.waitlist_count,
      adjustCount: agg.adjust_count,
      statusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, r.c])),
      decisionCounts: Object.fromEntries(decisionCounts.map((r) => [r.decision || 'undecided', r.c])),
    },
    trend,
  };
}
