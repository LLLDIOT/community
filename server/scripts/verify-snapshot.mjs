/** 校验快照 HTML：自包含性、内嵌数据可解析、与数据库一致。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(__dirname, '../../docs/club-console-snapshot.html');
const html = fs.readFileSync(HTML, 'utf8');

console.log('文件大小:', (fs.statSync(HTML).size / 1024).toFixed(1), 'KB');

const extScript = (html.match(/<script[^>]+src=/g) || []).length;
const extLink = (html.match(/<link[^>]+href=/g) || []).length;
console.log('外部 script 引用:', extScript, ' 外部 link 引用:', extLink);
console.log('内联 <style>:', (html.match(/<style/g) || []).length,
            ' 内联 <script>:', (html.match(/<script/g) || []).length);

const m = html.match(/const DATA = (\{[\s\S]*?\});\n/);
if (!m) { console.error('未找到 DATA'); process.exit(1); }
const d = JSON.parse(m[1]);
console.log('\n内嵌数据解析成功');
console.log('  社团', d.clubs.length, '岗位', d.positions.length, '简历', d.resumes.length, '投递', d.applications.length);
console.log('  匹配', d.match.length, '份  聚类', d.clusters.length, '个社团');
console.log('  模型', d.ml.model, ' dim', d.ml.dim, ' 模式', d.ml.matchMode);
console.log('  校准', d.ml.calibration.min, '~', d.ml.calibration.max,
            ' 权重', d.ml.weights.semantic, '/', d.ml.weights.tag);
console.log('  导出时间', d.generatedAt);

const dbStMap = {};
db.prepare('SELECT status, COUNT(*) c FROM application GROUP BY status').all()
  .forEach((x) => { dbStMap[x.status] = x.c; });
const dbSt = Object.keys(dbStMap).sort().map((k) => k + '=' + dbStMap[k]).join(', ');
const dbDc = db.prepare("SELECT COALESCE(NULLIF(decision,''),'none') d, COUNT(*) c FROM application GROUP BY d").all()
  .map((x) => x.d + '=' + x.c).sort().join(', ');
console.log('\n数据库状态分布:', dbSt);
console.log('数据库决策分布:', dbDc);

const htmlSt = {};
d.applications.forEach((a) => { htmlSt[a.status] = (htmlSt[a.status] || 0) + 1; });
const htmlStStr = Object.keys(htmlSt).sort().map((k) => k + '=' + htmlSt[k]).join(', ');
console.log('快照状态分布:', htmlStStr);
console.log('状态与库一致:', dbSt === htmlStStr ? '是' : '否');

/* 内联脚本语法检查：写临时文件后用 node --check 解析 */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
console.log('\n内联脚本块:', scripts.length, ' 总字符:', scripts.reduce((s, x) => s + x.length, 0));
const tmp = path.join(__dirname, '.snapshot-inline.js');
fs.writeFileSync(tmp, scripts.join('\n;\n'), 'utf8');
console.log('  已写出临时文件供语法检查:', path.basename(tmp));

console.log('\n匹配结果抽样（分数由 ML 层在导出时真实计算）:');
for (const mm of d.match) {
  const top = mm.recommendations[0];
  console.log('  ' + mm.student_name + ' → ' + (top
    ? top.positionTitle + ' 综合 ' + top.score +
      '（语义 ' + top.semantics.calibrated + ' / 标签 ' + top.tags.score + ' / 余弦 ' + top.semantics.cosine + '）'
    : '无推荐'));
}

console.log('\n聚类结果:');
for (const c of d.clusters) {
  console.log('  ' + c.clubName + ': available=' + c.available + ' k=' + c.k +
    (c.reason ? '  原因=' + c.reason : ''));
}
