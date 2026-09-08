import { db } from '../db/connection.js';
import { notFound } from '../utils/errors.js';

/**
 * 数据看板聚合统计（只读）
 * 接口 /api/v1/dashboard 提供：核心指标 / 招新漏斗 / 岗位进度 / 类型与年级分布 / 投递趋势
 * clubId 可空 → 全局看板；指定则只看某社团
 */

/** 图表通用日期格式（YYYY-MM-DD） */
function dayKey(iso) {
  return (iso || '').slice(0, 10);
}

export function getDashboard({ clubId = '', days = 30 } = {}) {
  if (clubId) {
    db.prepare('SELECT id FROM club WHERE id = ?').get(clubId) ||
      (() => { throw notFound('社团不存在'); })();
  }

  const clubWhere = clubId ? 'AND rec.club_id = @clubId' : '';
  const posWhere = clubId ? 'AND p.club_id = @clubId' : '';
  const baseParams = { clubId: clubId || null, days: parseInt(days, 10) || 30 };

  /* 1. 核心指标 */
  const clubsCount = clubId
    ? 1
    : db.prepare('SELECT COUNT(*) AS c FROM club WHERE is_visible = 1').get().c;

  const core = {
    clubsCount,
    recruitmentsCount: db
      .prepare(
        `SELECT COUNT(*) AS c FROM recruitment rec ${clubId ? 'WHERE rec.club_id = @clubId' : ''}`
      )
      .get(baseParams).c,
    openPositionsCount: db
      .prepare(
        `SELECT COUNT(*) AS c FROM position p JOIN recruitment rec ON rec.id = p.recruitment_id
         WHERE rec.status = 'open' ${clubId ? 'AND rec.club_id = @clubId' : ''}`
      )
      .get(baseParams).c,
    applicationsCount: db
      .prepare(
        `SELECT COUNT(*) AS c FROM application a
         JOIN position p ON p.id = a.position_id
         JOIN recruitment rec ON rec.id = p.recruitment_id
         ${clubId ? 'WHERE rec.club_id = @clubId' : ''}`
      )
      .get(baseParams).c,
    admittedCount: db
      .prepare(
        `SELECT COUNT(*) AS c FROM application a
         JOIN position p ON p.id = a.position_id
         JOIN recruitment rec ON rec.id = p.recruitment_id
         WHERE a.was_admitted = 1 ${clubId ? 'AND rec.club_id = @clubId' : ''}`
      )
      .get(baseParams).c,
  };

  /* 2. 招新漏斗：各状态投递数（忽略已归档的沉淀历史，漏斗以 active 为准并单列 archived） */
  const funnelRows = db
    .prepare(
      `SELECT a.status, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment rec ON rec.id = p.recruitment_id
       ${clubId ? 'WHERE rec.club_id = @clubId' : ''}
       GROUP BY a.status`
    )
    .all(baseParams);
  const funnel = Object.fromEntries(funnelRows.map((r) => [r.status, r.c]));
  const ORDER = ['new', 'screening', 'interviewing', 'admitted', 'rejected', 'archived'];
  const funnelOrdered = ORDER.map((s) => ({ status: s, count: funnel[s] || 0 }));

  /* 3. 岗位招新进度：headcount vs 已录取(filled_count) */
  const progress = db
    .prepare(
      `SELECT rec.id AS recruitment_id, rec.title AS recruitment_title, rec.status AS recruitment_status,
              club.id AS club_id, club.name AS club_name,
              p.id AS position_id, p.title AS position_title,
              p.headcount, p.filled_count
       FROM position p
       JOIN recruitment rec ON rec.id = p.recruitment_id
       JOIN club ON club.id = rec.club_id
       ${clubId ? 'WHERE rec.club_id = @clubId' : ''}
       ORDER BY club.name ASC, rec.created_at DESC, p.sort_order ASC`
    )
    .all(baseParams);

  /* 4. 分布：类型 / 年级 */
  const typeDist = db
    .prepare(
      `SELECT a.type_tag AS tag, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment rec ON rec.id = p.recruitment_id
       ${clubId ? 'WHERE rec.club_id = @clubId' : ''}
       GROUP BY a.type_tag ORDER BY c DESC`
    )
    .all(baseParams);

  const gradeDist = db
    .prepare(
      `SELECT r.grade AS grade, COUNT(*) AS c FROM application a
       JOIN resume r ON r.id = a.resume_id
       JOIN position p ON p.id = a.position_id
       JOIN recruitment rec ON rec.id = p.recruitment_id
       ${clubId ? 'WHERE rec.club_id = @clubId' : ''}
       GROUP BY r.grade ORDER BY c DESC`
    )
    .all(baseParams);

  /* 5. 投递趋势：近 N 天逐日投递量 */
  const since = new Date();
  since.setDate(since.getDate() - (baseParams.days - 1));
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  const trendRows = db
    .prepare(
      `SELECT a.created_at AS created_at, COUNT(*) AS c FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment rec ON rec.id = p.recruitment_id
       WHERE a.created_at >= @since ${clubId ? 'AND rec.club_id = @clubId' : ''}
       GROUP BY substr(a.created_at, 1, 10)`
    )
    .all({ ...baseParams, since: sinceIso });

  const trendMap = Object.fromEntries(trendRows.map((r) => [dayKey(r.created_at), r.c]));
  const trend = [];
  for (let i = 0; i < baseParams.days; i += 1) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    trend.push({ date: key, count: trendMap[key] || 0 });
  }

  return {
    core,
    funnel: funnelOrdered,
    progress,
    distributions: {
      typeTag: typeDist.map((r) => ({ name: r.tag, value: r.c })),
      grade: gradeDist.map((r) => ({ name: r.grade || '未知', value: r.c })),
    },
    trend,
  };
}
