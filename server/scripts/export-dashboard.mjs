/**
 * 导出数据看板静态快照 —— 单独成文件，与社团端快照互不依赖
 *
 * 用法：node scripts/export-dashboard.mjs [输出路径] [--days=30] [--club=club_xxx]
 *
 * 特点：
 *   · 直接调用后端 dashboardService.getDashboard()，统计口径与实时看板完全一致
 *   · 输出单个自包含 HTML，无外部资源，双击即可打开
 *   · 图表用内联 SVG 绘制，不引入任何图表库
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../src/db/connection.js';
import { getDashboard } from '../src/services/dashboardService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE = path.join(ROOT, 'tools/dashboard.template.html');

/* ── 参数 ── */
const args = process.argv.slice(2);
const daysArg = args.find((a) => a.startsWith('--days='));
const clubArg = args.find((a) => a.startsWith('--club='));
const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;
const clubId = clubArg ? clubArg.split('=')[1] : '';
const positional = args.filter((a) => !a.startsWith('--'));
const OUT = positional[0] || path.join(ROOT, 'docs/club-dashboard.html');

const p2 = (n) => String(n).padStart(2, '0');
const t = new Date();
const stamp =
  `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())} ` +
  `${p2(t.getHours())}:${p2(t.getMinutes())}`;

/* ── 取数据 ── */
if (clubId) {
  const c = db.prepare('SELECT name FROM club WHERE id = ?').get(clubId);
  if (!c) {
    console.error(`社团不存在：${clubId}`);
    process.exit(1);
  }
  console.log(`统计范围：${c.name}（${clubId}）`);
} else {
  console.log('统计范围：全校');
}

let effectiveDays = days;
let windowAuto = false;
let dash = getDashboard({ clubId, days: effectiveDays });

/*
 * 趋势窗口自适应：
 *   实时看板默认看近 30 天。但如果库里的投递都早于这个窗口，快照的趋势图会是空的，
 *   看起来像"数据有问题"。所以当窗口内总数为 0 而库里确实有投递时，
 *   按最早一条投递的日期重新取一次，把窗口扩到能覆盖历史数据（上限 365 天）。
 */
const trendSum = dash.trend.reduce((s, d) => s + d.count, 0);
if (trendSum === 0 && dash.core.applicationsCount > 0) {
  const row = db
    .prepare(
      `SELECT MIN(a.created_at) AS first FROM application a
       JOIN position p ON p.id = a.position_id
       JOIN recruitment rec ON rec.id = p.recruitment_id
       ${clubId ? 'WHERE rec.club_id = @clubId' : ''}`
    )
    .get(clubId ? { clubId } : {});
  if (row && row.first) {
    const firstDay = new Date(row.first);
    const today = new Date();
    const need = Math.min(
      365,
      Math.max(1, Math.ceil((today - firstDay) / 86400000) + 2)
    );
    if (need > effectiveDays) {
      effectiveDays = need;
      windowAuto = true;
      dash = getDashboard({ clubId, days: effectiveDays });
      console.log(`近 ${days} 天窗口内无投递，已自动扩展到 ${effectiveDays} 天以覆盖历史数据`);
    }
  }
}

const DATA = {
  generatedAt: stamp,
  days: effectiveDays,
  windowAuto,
  demo: /demo/i.test(process.env.DB_PATH || ''),
  scope: clubId || 'all',
  core: dash.core,
  funnel: dash.funnel,
  progress: dash.progress.map((p) => ({
    recruitment_id: p.recruitment_id,
    recruitment_title: p.recruitment_title,
    recruitment_status: p.recruitment_status,
    club_id: p.club_id,
    club_name: p.club_name,
    position_id: p.position_id,
    position_title: p.position_title,
    headcount: p.headcount,
    filled_count: p.filled_count,
  })),
  distributions: dash.distributions,
  trend: dash.trend,
};

/* ── 注入模板 ── */
let html = fs.readFileSync(TEMPLATE, 'utf8');
if (!html.includes('/*__DATA__*/')) throw new Error('模板中缺少 /*__DATA__*/ 占位符');
html = html.replace('/*__DATA__*/ null', JSON.stringify(DATA).replace(/<\//g, '<\\/'));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n已生成：${path.relative(ROOT, OUT)}（${kb} KB）`);
console.log(`  核心：社团 ${DATA.core.clubsCount} · 批次 ${DATA.core.recruitmentsCount} · 在招岗位 ${DATA.core.openPositionsCount} · 投递 ${DATA.core.applicationsCount} · 已录 ${DATA.core.admittedCount}`);
console.log(`  漏斗：${DATA.funnel.map((f) => f.status + '=' + f.count).join(', ')}`);
console.log(`  岗位：${DATA.progress.length} 个　分布：类型 ${DATA.distributions.typeTag.length} / 年级 ${DATA.distributions.grade.length}　趋势：${DATA.trend.length} 天`);
