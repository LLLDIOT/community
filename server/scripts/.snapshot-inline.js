
const DATA = {"generatedAt":"2026-11-05 00:16","ml":{"model":"Xenova/bge-small-zh-v1.5","dim":512,"matchMode":"semantic","calibration":{"min":0.46,"max":0.75},"weights":{"semantic":0.6,"tag":0.4}},"clubs":[{"id":"club_1f9a44302ff69511","name":"计算机协会","category":"technical","scale":150,"scale_label":"50-200"},{"id":"club_615722c1f58e5946","name":"话剧社","category":"artistic","scale":45,"scale_label":"<50"}],"recruitments":[{"id":"rec_49929d2176b8370a","club_id":"club_1f9a44302ff69511","title":"2026 秋季招新","status":"open"},{"id":"rec_4f6bdaccfe1fd312","club_id":"club_615722c1f58e5946","title":"2026 秋季招新","status":"open"}],"positions":[{"id":"pos_838e03bd5609f174","recruitment_id":"rec_49929d2176b8370a","title":"前端开发干事"},{"id":"pos_e93a7eca1cb4ca5f","recruitment_id":"rec_49929d2176b8370a","title":"活动策划干事"},{"id":"pos_d53f0a3f5ee7dc9e","recruitment_id":"rec_4f6bdaccfe1fd312","title":"宣传部干事"}],"resumes":[{"id":"res_56b5f77e3d2d3a67","student_name":"王小明","school":"示例大学","major":"软件工程","grade":"大二","skills":"Vue,Node.js,项目协作","skills_auto":"Vue,Node.js"},{"id":"res_103ad697bfec1a7f","student_name":"赵小红","school":"示例大学","major":"汉语言文学","grade":"大一","skills":"文案,活动组织,沟通","skills_auto":"活动组织,活动策划,文案写作"},{"id":"res_3e52c3229f0b3246","student_name":"钱多多","school":null,"major":null,"grade":"大三","skills":"AI,Python,数据分析","skills_auto":""},{"id":"res_9cb3ee80fba5b379","student_name":"孙小美","school":"示例大学","major":"视觉传达","grade":"大二","skills":"设计,海报,审美","skills_auto":"海报设计,排版,UI设计,UX设计"}],"applications":[{"id":"app_e45bad3a3311be1b","student_name":"王小明","phone":"13711112222","email":"wxm@stu.edu.cn","school":"示例大学","major":"软件工程","grade":"大二","content":"熟悉 Vue/Node，做过两个社团项目","skills":"Vue,Node.js,项目协作","skills_auto":"Vue,Node.js","club_name":"计算机协会","recruitment_title":"2026 秋季招新","position_title":"前端开发干事","status":"archived","decision":"","waitlist_rank":0,"score":5,"hitSkills":["vue"]},{"id":"app_832ca209b15e0e76","student_name":"孙小美","phone":"","email":"","school":"示例大学","major":"视觉传达","grade":"大二","content":"擅长海报设计与排版","skills":"设计,海报,审美","skills_auto":"海报设计,排版,UI设计,UX设计","club_name":"计算机协会","recruitment_title":"2026 秋季招新","position_title":"活动策划干事","status":"screening","decision":"","waitlist_rank":0,"score":25,"hitSkills":[]},{"id":"app_f1ef1955473f18fe","student_name":"赵小红","phone":"","email":"","school":"示例大学","major":"汉语言文学","grade":"大一","content":"擅长文案与活动组织","skills":"文案,活动组织,沟通","skills_auto":"活动组织,活动策划,文案写作","club_name":"计算机协会","recruitment_title":"2026 秋季招新","position_title":"前端开发干事","status":"new","decision":"","waitlist_rank":0,"score":18,"hitSkills":[]}],"match":[{"student_name":"王小明","skills":"Vue,Node.js,项目协作","method":"semantic+tags","recommendations":[{"positionTitle":"前端开发干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":58,"semantics":{"cosine":0.6908,"calibrated":80,"weight":0.6},"tags":{"score":25,"weight":0.4},"hitSkills":["vue"],"missingSkills":["html","css","javascript"]},{"positionTitle":"活动策划干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":33,"semantics":{"cosine":0.6209,"calibrated":55,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["活动组织","沟通","文案"]},{"positionTitle":"宣传部干事","clubName":"话剧社","recruitmentTitle":"2026 秋季招新","status":"open","score":14,"semantics":{"cosine":0.5263,"calibrated":23,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["设计","海报","排版"]}]},{"student_name":"赵小红","skills":"文案,活动组织,沟通","method":"semantic+tags","recommendations":[{"positionTitle":"活动策划干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":88,"semantics":{"cosine":0.6934,"calibrated":80,"weight":0.6},"tags":{"score":100,"weight":0.4},"hitSkills":["活动组织","沟通","文案"],"missingSkills":[]},{"positionTitle":"宣传部干事","clubName":"话剧社","recruitmentTitle":"2026 秋季招新","status":"open","score":23,"semantics":{"cosine":0.5739,"calibrated":39,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["设计","海报","排版"]},{"positionTitle":"前端开发干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":18,"semantics":{"cosine":0.5468,"calibrated":30,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["html","css","javascript","vue"]}]},{"student_name":"钱多多","skills":"AI,Python,数据分析","method":"semantic+tags","recommendations":[{"positionTitle":"前端开发干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":29,"semantics":{"cosine":0.6002,"calibrated":48,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["html","css","javascript","vue"]},{"positionTitle":"活动策划干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":18,"semantics":{"cosine":0.5459,"calibrated":30,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["活动组织","沟通","文案"]},{"positionTitle":"宣传部干事","clubName":"话剧社","recruitmentTitle":"2026 秋季招新","status":"open","score":5,"semantics":{"cosine":0.4848,"calibrated":9,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["设计","海报","排版"]}]},{"student_name":"孙小美","skills":"设计,海报,审美","method":"semantic+tags","recommendations":[{"positionTitle":"宣传部干事","clubName":"话剧社","recruitmentTitle":"2026 秋季招新","status":"open","score":79,"semantics":{"cosine":0.7166,"calibrated":88,"weight":0.6},"tags":{"score":67,"weight":0.4},"hitSkills":["设计","海报"],"missingSkills":["排版"]},{"positionTitle":"前端开发干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":25,"semantics":{"cosine":0.578,"calibrated":41,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["html","css","javascript","vue"]},{"positionTitle":"活动策划干事","clubName":"计算机协会","recruitmentTitle":"2026 秋季招新","status":"open","score":25,"semantics":{"cosine":0.5814,"calibrated":42,"weight":0.6},"tags":{"score":0,"weight":0.4},"hitSkills":[],"missingSkills":["活动组织","沟通","文案"]}]}],"clusters":[{"clubName":"计算机协会","available":true,"reason":"候选人数 3（<6）太少，聚类没有统计意义；建议直接人工筛选","k":0,"silhouette":0,"clusters":[]},{"clubName":"话剧社","available":true,"reason":"候选人数 0（<6）太少，聚类没有统计意义；建议直接人工筛选","k":0,"silhouette":0,"clusters":[]}]};

/* ---------- 工具 ---------- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const STATUS = {
  new:          { label: '新收到',   tone: 't-blue' },
  screening:    { label: '筛选中',   tone: 't-orange' },
  interviewing: { label: '面试中',   tone: 't-purple' },
  admitted:     { label: '已录用',   tone: 't-green' },
  rejected:     { label: '未通过',   tone: 't-red' },
  archived:     { label: '已归档',   tone: 't-gray' }
};
const DECISION = {
  hired:    { label: '录用', tone: 't-green' },
  waitlist: { label: '候补', tone: 't-orange' },
  adjust:   { label: '调剂', tone: 't-blue' },
  reject:   { label: '淘汰', tone: 't-red' }
};
const tag = (text, tone) => '<span class="tag ' + (tone || 't-gray') + '">' + esc(text) + '</span>';
const statusTag = (s) => STATUS[s] ? tag(STATUS[s].label, STATUS[s].tone) : tag(s || '—');
const decisionTag = (d) => DECISION[d] ? tag(DECISION[d].label, DECISION[d].tone) : tag('未决定', 't-gray');

const barColor = (v) => v >= 80 ? '#25a35a' : v >= 60 ? '#2f6fed' : v >= 40 ? '#e0902a' : '#b9c0cc';
const bar = (v) => '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, v)) + '%;background:' + barColor(v) + '"></i></div>';

const splitSkills = (s) => String(s || '').split(/[,，、;；]/).map(x => x.trim()).filter(Boolean);

/* ---------- 视图切换 ---------- */
const TITLES = {
  overview: '数据概览', interview: '面试与录用', library: '简历库 / 归档',
  match: '智能匹配推荐', clusters: '候选人分组'
};
function show(view) {
  if (!TITLES[view]) view = 'overview';
  document.querySelectorAll('#nav .item').forEach(el => el.classList.toggle('on', el.dataset.view === view));
  ['overview','interview','library','match','clusters'].forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.hidden = (v !== view);
  });
  $('#title').textContent = TITLES[view];
  $('#crumb').textContent = '社团端 / ' + TITLES[view];
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', (e) => {
  const it = e.target.closest('#nav .item');
  if (it) show(it.dataset.view);
});
window.addEventListener('hashchange', () => show(location.hash.slice(1)));

/* ---------- 概览 ---------- */
function renderOverview() {
  const d = DATA;
  const st = {};
  d.applications.forEach(a => { st[a.status] = (st[a.status] || 0) + 1; });
  const dc = {};
  d.applications.forEach(a => { const k = a.decision || 'none'; dc[k] = (dc[k] || 0) + 1; });

  const cards = [
    ['简历总数', d.resumes.length, ''],
    ['投递总数', d.applications.length, ''],
    ['待处理', (st.new || 0) + (st.screening || 0) + (st.interviewing || 0), '#2f6fed'],
    ['已录用', st.admitted || 0, '#25a35a'],
    ['招新岗位', d.positions.length, ''],
    ['社团数', d.clubs.length, '']
  ].map(c => '<div class="stat"><div class="n"' + (c[2] ? ' style="color:' + c[2] + '"' : '') + '>' + c[1] + '</div><div class="l">' + c[0] + '</div></div>').join('');

  const stRows = Object.keys(STATUS).map(k =>
    '<tr><td>' + statusTag(k) + '</td><td class="num">' + (st[k] || 0) + '</td></tr>').join('');
  const dcRows = ['hired','waitlist','adjust','reject','none'].map(k =>
    '<tr><td>' + (k === 'none' ? tag('未决定', 't-gray') : decisionTag(k)) + '</td><td class="num">' + (dc[k] || 0) + '</td></tr>').join('');

  const clubRows = d.clubs.map(c => {
    const recs = d.recruitments.filter(r => r.club_id === c.id);
    const apps = d.applications.filter(a => recs.some(r => r.id === a.recruitment_id));
    return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + esc(c.category || '—') + '</td>' +
      '<td>' + esc(c.scale_label || c.scale || '—') + '</td>' +
      '<td class="num">' + recs.length + '</td><td class="num">' + apps.length + '</td></tr>';
  }).join('');

  $('#view-overview').innerHTML =
    '<div class="stats">' + cards + '</div>' +
    '<div class="card"><h2>状态分布</h2><div class="sub">投递记录在流程状态机中的分布。</div>' +
      '<table><thead><tr><th>状态</th><th>数量</th></tr></thead><tbody>' + stRows + '</tbody></table></div>' +
    '<div class="card"><h2>面试结论分布</h2><div class="sub">决策字段独立于状态字段，用于记录面试结论。</div>' +
      '<table><thead><tr><th>结论</th><th>数量</th></tr></thead><tbody>' + dcRows + '</tbody></table></div>' +
    '<div class="card"><h2>社团与招新情况</h2><div class="sub">每个社团的招新批次数与收到的投递数。</div>' +
      '<table><thead><tr><th>社团</th><th>类别</th><th>规模</th><th>批次</th><th>投递</th></tr></thead><tbody>' +
      clubRows + '</tbody></table></div>' +
    '<div class="card"><h2>机器学习层状态</h2>' +
      '<div class="kv">' +
        '<div class="k">模型</div><div>' + esc(d.ml.model) + '</div>' +
        '<div class="k">向量维度</div><div class="num">' + d.ml.dim + '</div>' +
        '<div class="k">匹配模式</div><div>' + (d.ml.matchMode === 'semantic' ? tag('语义 + 标签融合', 't-green') : tag('规则匹配', 't-gray')) + '</div>' +
        '<div class="k">校准区间</div><div class="num">' + d.ml.calibration.min + ' ~ ' + d.ml.calibration.max + '</div>' +
        '<div class="k">融合权重</div><div class="num">语义 ' + d.ml.weights.semantic + ' / 标签 ' + d.ml.weights.tag + '</div>' +
      '</div>' +
      '<div class="hint">综合分数计算：' +
        '<div class="formula">score = 0.6 × 语义分 + 0.4 × 技能命中率</div><br>' +
        '语义分由余弦相似度按 0.46 ~ 0.75 线性映射到 0 ~ 100 得到；技能命中率是命中技能数与期望技能数之比。</div>' +
    '</div>';
}

/* ---------- 面试与录用 ---------- */
function renderInterview() {
  // 含已归档，保证每条投递都能在某一列中看到
  const cols = ['new','screening','interviewing','admitted','rejected','archived'];
  const html = cols.map(k => {
    const list = DATA.applications.filter(a => a.status === k);
    const body = list.length ? list.map(a => {
      const skills = splitSkills(a.skills).slice(0, 4);
      const skillHtml = skills.length
        ? '<div class="chips">' + skills.map(s => tag(s, a.hitSkills && a.hitSkills.indexOf(s) >= 0 ? 't-green' : 't-gray')).join('') + '</div>'
        : '<div class="muted" style="font-size:11.5px">未填写技能</div>';
      return '<div class="person">' +
        '<div class="nm">' + esc(a.student_name) + '</div>' +
        '<div class="mt">' + esc(a.position_title) + ' · ' + esc(a.grade || '年级未知') + '</div>' +
        '<div class="sc">' + bar(a.score || 0) + '<b class="num" style="color:' + barColor(a.score || 0) + '">' + (a.score || 0) + '</b></div>' +
        '<div style="margin-top:6px">' + decisionTag(a.decision) +
          (a.waitlist_rank ? ' ' + tag('候补 ' + a.waitlist_rank + ' 号', 't-orange') : '') + '</div>' +
        '<div style="margin-top:6px">' + skillHtml + '</div>' +
      '</div>';
    }).join('') : '<div class="empty">暂无记录</div>';
    return '<div class="col"><h3>' + STATUS[k].label + '<span>' + list.length + '</span></h3>' + body + '</div>';
  }).join('');

  $('#view-interview').innerHTML =
    '<div class="card"><h2>面试与录用工作台</h2>' +
      '<div class="sub">按流程状态分列。卡片上的数字是综合匹配度，由语义分与技能命中率加权得出；彩色标签是面试结论（录用 / 候补 / 调剂 / 淘汰）。</div>' +
      '<div class="kanban">' + html + '</div>' +
      '<div class="hint">状态机允许的流转：新收到 → 筛选中 → 面试中 → 已录用或未通过；已录用与未通过只能再转归档。新收到的投递不能直接录用。</div>' +
    '</div>';
}

/* ---------- 简历库 ---------- */
function renderLibrary() {
  const rows = DATA.applications.map((a, i) => {
    const auto = splitSkills(a.skills_auto);
    return '<tr data-idx="' + i + '">' +
      '<td><b>' + esc(a.student_name) + '</b></td>' +
      '<td>' + esc(a.school || '—') + '<br><span class="muted" style="font-size:11.5px">' +
        esc(a.major || '—') + ' · ' + esc(a.grade || '—') + '</span></td>' +
      '<td class="nowrap">' + esc(a.club_name) + '<br><span class="muted" style="font-size:11.5px">' +
        esc(a.position_title) + '</span></td>' +
      '<td><div class="chips">' + (splitSkills(a.skills).map(s => tag(s, 't-orange')).join('') || '<span class="muted">—</span>') + '</div></td>' +
      '<td><div class="chips">' + (auto.map((s, j) => tag(s, j < 0 ? 't-gray' : 't-gray')).join('') || '<span class="muted">未抽取</span>') + '</div></td>' +
      '<td>' + statusTag(a.status) + '</td>' +
      '<td>' + decisionTag(a.decision) + '</td>' +
      '<td class="right num">' + (a.score || 0) + '</td>' +
    '</tr>';
  }).join('');

  $('#view-library').innerHTML =
    '<div class="card"><h2>简历库</h2>' +
      '<div class="sub">点击任意一行展开该候选人的完整信息。橙色标签为学生本人填写的技能，灰色标签为模型从正文自动抽取的技能（来源分精确匹配与语义推断，导出时已合并展示）。</div>' +
      '<table><thead><tr><th>姓名</th><th>学校 / 专业</th><th>投递岗位</th><th>人工技能</th><th>自动抽取</th><th>状态</th><th>结论</th><th class="right">匹配度</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<div class="hint">表中只列出「投递记录」对应的候选人。未被投递的简历不会出现在此视图。</div>' +
    '</div>' +
    '<div id="detail"></div>';

  document.querySelectorAll('#view-library tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const a = DATA.applications[Number(tr.dataset.idx)];
      const auto = splitSkills(a.skills_auto);
      $('#detail').innerHTML =
        '<div class="card"><h2>' + esc(a.student_name) + ' · 详情</h2>' +
          '<div class="sub">以下内容来自导出时刻的数据库记录，静态快照不可修改。</div>' +
          '<div class="kv">' +
            '<div class="k">联系方式</div><div>' + esc(a.phone || '—') + '　' + esc(a.email || '—') + '</div>' +
            '<div class="k">学校 / 专业</div><div>' + esc(a.school || '—') + '　' + esc(a.major || '—') + '</div>' +
            '<div class="k">年级</div><div>' + esc(a.grade || '—') + '</div>' +
            '<div class="k">投递岗位</div><div>' + esc(a.club_name) + ' / ' + esc(a.recruitment_title) + ' / ' + esc(a.position_title) + '</div>' +
            '<div class="k">当前状态</div><div>' + statusTag(a.status) + '</div>' +
            '<div class="k">面试结论</div><div>' + decisionTag(a.decision) +
              (a.waitlist_rank ? ' ' + tag('候补 ' + a.waitlist_rank + ' 号', 't-orange') : '') + '</div>' +
            '<div class="k">综合匹配度</div><div>' + bar(a.score || 0) + ' <b class="num">' + (a.score || 0) + '</b></div>' +
            '<div class="k">人工技能</div><div><div class="chips">' +
              (splitSkills(a.skills).map(s => tag(s, 't-orange')).join('') || '<span class="muted">—</span>') + '</div></div>' +
            '<div class="k">自动抽取</div><div><div class="chips">' +
              (auto.map(s => tag(s, 't-gray')).join('') || '<span class="muted">未抽取</span>') + '</div></div>' +
          '</div>' +
          '<div class="body-text">' + esc(a.content || '（无在线简历内容）') + '</div>' +
        '</div>';
      $('#detail').scrollIntoView({behavior: 'smooth', block: 'nearest'});
    });
  });
}

/* ---------- 智能匹配 ---------- */
function renderMatch() {
  const blocks = DATA.match.map((m, i) => {
    const items = m.recommendations.map(r =>
      '<tr>' +
        '<td><b>' + esc(r.positionTitle) + '</b><br><span class="muted" style="font-size:11.5px">' +
          esc(r.clubName) + ' / ' + esc(r.recruitmentTitle) + '</span></td>' +
        '<td class="nowrap">' + (r.status === 'open' ? tag('招新中', 't-green') : tag('已结束', 't-gray')) + '</td>' +
        '<td>' + bar(r.score) + '<span class="num" style="margin-left:6px"><b>' + r.score + '</b></span></td>' +
        '<td class="num">' + (r.semantics ? r.semantics.calibrated : '—') + '</td>' +
        '<td class="num">' + (r.tags ? r.tags.score : '—') + '</td>' +
        '<td class="num">' + (r.semantics ? r.semantics.cosine.toFixed(4) : '—') + '</td>' +
        '<td><div class="chips">' +
          (r.hitSkills.map(s => tag(s, 't-green')).join('') || '<span class="muted">无命中</span>') +
          (r.missingSkills.length ? ' ' + r.missingSkills.map(s => tag(s, 't-gray')).join('') : '') +
        '</div></td>' +
      '</tr>').join('');

    return '<div class="card"><h2>' + esc(m.student_name) + ' 的推荐岗位</h2>' +
      '<div class="sub">人工技能：' + (splitSkills(m.skills).join('、') || '未填写') +
      '　｜　匹配方法：' + (m.method === 'semantic+tags' ? tag('语义 + 标签', 't-green') : tag('仅标签', 't-gray')) + '</div>' +
      (m.recommendations.length
        ? '<table><thead><tr><th>岗位</th><th>批次状态</th><th>综合分</th><th>语义分</th><th>标签分</th><th>余弦</th><th>技能命中（绿）与缺失（灰）</th></tr></thead><tbody>' + items + '</tbody></table>'
        : '<div class="empty">没有可匹配的岗位</div>') +
    '</div>';
  }).join('');

  $('#view-match').innerHTML =
    '<div class="card"><h2>匹配分数的构成</h2>' +
      '<div class="sub">每个岗位给出四个数值，便于核对总分来源。</div>' +
      '<div class="kv">' +
        '<div class="k">余弦</div><div>简历文本与岗位文本的向量夹角余弦，取值 -1 ~ 1</div>' +
        '<div class="k">语义分</div><div>余弦按 ' + DATA.ml.calibration.min + ' ~ ' + DATA.ml.calibration.max + ' 线性映射到 0 ~ 100</div>' +
        '<div class="k">标签分</div><div>期望技能中被简历命中的比例</div>' +
        '<div class="k">综合分</div><div>0.6 × 语义分 + 0.4 × 标签分（岗位未写期望技能时只用语义分）</div>' +
      '</div></div>' + blocks;
}

/* ---------- 候选人分组 ---------- */
function renderClusters() {
  const blocks = DATA.clusters.map(c => {
    if (!c.available) {
      return '<div class="card"><h2>' + esc(c.clubName) + '</h2>' +
        '<div class="empty">聚类不可用：' + esc(c.reason) + '</div></div>';
    }
    if (!c.clusters || !c.clusters.length) {
      return '<div class="card"><h2>' + esc(c.clubName) + '</h2>' +
        '<div class="empty">未产生分组：' + esc(c.reason || '数据量不足') + '</div>' +
        '<div class="hint">K-means 在样本很少时会退化出大量只含一人的组，此时轮廓系数会虚高，数值不可信。因此系统设定候选人数少于 6 时直接拒绝聚类，改为建议人工筛选。</div></div>';
    }
    const cards = c.clusters.map(cl =>
      '<div class="col"><h3>第 ' + (cl.index + 1) + ' 组<span>' + cl.size + ' 人</span></h3>' +
        '<div class="chips" style="margin-bottom:8px">' +
          (cl.profile.map(p => tag(p.skill + (p.count > 1 ? ' ×' + p.count : ''), p.count > 1 ? 't-green' : 't-gray')).join('') || '<span class="muted">技能较少</span>') +
        '</div>' +
        cl.members.map(mm => '<div class="person"><div class="nm">' + esc(mm.studentName) + '</div>' +
          '<div class="mt">' + esc(mm.positionTitle) + '</div>' +
          '<div>' + decisionTag(mm.decision) + '</div></div>').join('') +
      '</div>').join('');
    return '<div class="card"><h2>' + esc(c.clubName) + '</h2>' +
      '<div class="sub">分组数 k = ' + c.k + '　轮廓系数 = <b>' + c.silhouette + '</b>　' +
        '轮廓系数越接近 1 表示组内越紧密、组间越分离；接近 0 说明这批人本身比较同质。</div>' +
      '<div class="kanban">' + cards + '</div></div>';
  }).join('');

  $('#view-clusters').innerHTML = blocks +
    '<div class="card"><h2>关于该功能</h2>' +
      '<div class="sub">聚类是无监督方法，不需要任何标注数据。它只在向量的空间分布上寻找结构，因此输出的是「这些人可以分成几类」，而不是「某个人属于哪一类」。' +
      '分组结果只提供筛选视角，不参与任何录用决策。</div></div>';
}

/* ---------- 启动 ---------- */
(function boot() {
  if (!DATA) {
    document.querySelector('.content').innerHTML =
      '<div class="card"><h2>数据未注入</h2><div class="sub">该文件是模板，需要用生成脚本注入数据。</div></div>';
    return;
  }
  $('#meta').textContent = '导出时间 ' + DATA.generatedAt + '　｜　' + DATA.clubs.length + ' 个社团 · ' +
    DATA.applications.length + ' 条投递';
  $('#foot-gen').textContent = '快照 ' + DATA.generatedAt.slice(0, 10);
  renderOverview();
  renderInterview();
  renderLibrary();
  renderMatch();
  renderClusters();
  show(location.hash.slice(1) || 'overview');
})();
