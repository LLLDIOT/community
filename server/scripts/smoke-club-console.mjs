/**
 * 社团端改造 · 端到端冒烟测试
 *
 * 覆盖：
 *   ① 招新广场（全校社团总览 + 单社团招新情况/投递人数）
 *   ② 社团账号登录 / 会话 / 角色能力
 *   ③ 录入标准与投递时间窗修改（含越权拒绝）
 *   ④ 面试决策：录用 / 候补序号 / 调剂 / 淘汰
 *   ⑤ 候补递补招满员
 *   ⑥ 权限矩阵：viewer 不能决策、别社团不能碰我的数据
 *
 * 测试会自建临时简历与投递，跑完自动清理，不动用既有业务数据。
 *
 * 用法：node scripts/smoke-club-console.mjs
 */
const BASE = process.env.SMOKE_BASE || 'http://localhost:3000/api/v1';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: json, ok: res.ok };
}

/** 期望失败：返回 { status, code, message } */
async function expectFail(path, opts) {
  const r = await api(path, opts);
  return r;
}

const cleanup = { applicationIds: [], resumeIds: [], accountIds: [] };

(async () => {
  console.log('\n═══ 社团端改造 端到端冒烟测试 ═══\n');

  /* ---------- ① 招新广场 ---------- */
  console.log('① 招新广场（全校社团总览）');
  const square = await api('/square/clubs');
  check('GET /square/clubs 200', square.status === 200, JSON.stringify(square.body).slice(0, 200));
  const clubs = square.body?.data?.list || [];
  check('返回社团卡片列表', clubs.length > 0, `count=${clubs.length}`);
  const first = clubs[0];
  check(
    '卡片含招新情况与投递人数',
    first && 'stats' in first && 'applicationCount' in first.stats && 'stageLabel' in first,
    JSON.stringify(first?.stats)
  );
  check('卡片含录入标准字段', first && 'entryCriteria' in first);
  console.log(
    `     → ${clubs.map((c) => `${c.name}[${c.stageLabel}] 投递${c.stats.applicationCount}/录取${c.stats.admittedCount}`).join('  ')}`
  );

  const cats = await api('/square/categories');
  check('GET /square/categories 200', cats.status === 200);

  const clubId = first.id;
  const detail = await api(`/square/clubs/${clubId}`);
  check('GET /square/clubs/:id 200', detail.status === 200);
  check(
    '详情含批次+岗位招新情况',
    Array.isArray(detail.body?.data?.recruitments) && 'stats' in (detail.body?.data || {}),
    JSON.stringify(detail.body?.data?.stats)?.slice(0, 160)
  );
  check('详情含投递趋势', Array.isArray(detail.body?.data?.trend));

  /* ---------- ② 登录 ---------- */
  console.log('\n② 社团账号登录（按人权限）');
  const accountsFile = await import('node:fs').then((fs) =>
    fs.existsSync(new URL('../data/initial-accounts.txt', import.meta.url))
      ? fs.readFileSync(new URL('../data/initial-accounts.txt', import.meta.url), 'utf8')
      : ''
  );
  const firstLine = accountsFile
    .split(/\r?\n/)
    .find((l) => l && !l.startsWith('#'));
  if (!firstLine) {
    console.log('  ⚠️ 未找到 data/initial-accounts.txt，跳过登录相关用例');
  }
  const [, userPart, passPart] = firstLine?.split('\t') || [];
  const seededUser = (userPart || '').replace('账号=', '');
  const seededPass = (passPart || '').replace('密码=', '');
  check('读到初始社长账号', Boolean(seededUser && seededPass), firstLine);

  const login = await api('/auth/login', { method: 'POST', body: { username: seededUser, password: seededPass } });
  check('POST /auth/login 200', login.status === 200, JSON.stringify(login.body).slice(0, 200));
  const token = login.body?.data?.token;
  const me = login.body?.data?.account;
  check('登录返回 token', Boolean(token));
  check('登录返回角色与能力清单', me?.role === 'owner' && Array.isArray(me?.capabilities), JSON.stringify(me));
  check('owner 具备 club:edit 与 application:decide',
    me?.capabilities?.includes('club:edit') && me?.capabilities?.includes('application:decide'));

  const meRes = await api('/auth/me', { token });
  check('GET /auth/me 带 token 200', meRes.status === 200 && meRes.body?.data?.username === seededUser);

  const badLogin = await expectFail('/auth/login', { method: 'POST', body: { username: seededUser, password: 'wrong-pass' } });
  check('错误密码返回 401', badLogin.status === 401, `status=${badLogin.status}`);

  const noToken = await expectFail('/auth/me');
  check('无 token 访问 /auth/me 返回 401', noToken.status === 401, `status=${noToken.status}`);

  const ownerClubId = me?.clubId;

  /* ---------- ③ 录入标准与投递时间窗 ---------- */
  console.log('\n③ 信息录入标准 + 投递时间窗（需 club:edit）');
  // 先记下原始值，跑完原样恢复（这是真实社团的数据，不能留下测试残留）
  const originalClub = (await api(`/clubs/${ownerClubId}`)).body?.data || {};
  const originalStandard = {
    entryCriteria: originalClub.entry_criteria ?? '',
    applyStartAt: originalClub.apply_start_at ?? null,
    applyEndAt: originalClub.apply_end_at ?? null,
  };
  const std = await api(`/clubs/${ownerClubId}/standard`, {
    method: 'PUT',
    token,
    body: {
      entryCriteria: '【冒烟测试】需提交：个人简历 + 作品集链接；GPA 3.0 以上；每周可投入 4 小时。',
      applyStartAt: '2026-09-01T00:00:00.000Z',
      applyEndAt: '2026-10-31T23:59:59.000Z',
    },
  });
  check('PUT /clubs/:id/standard 200', std.status === 200, JSON.stringify(std.body).slice(0, 200));
  check('录入标准已保存', String(std.body?.data?.entry_criteria || '').includes('冒烟测试'),
    JSON.stringify(std.body?.data?.entry_criteria));
  check('投递时间窗已保存', std.body?.data?.apply_end_at?.startsWith('2026-10-31'));

  const stdNoAuth = await expectFail(`/clubs/${ownerClubId}/standard`, { method: 'PUT', body: { entryCriteria: 'x' } });
  check('未登录改标准被拒（401）', stdNoAuth.status === 401, `status=${stdNoAuth.status}`);

  const badWindow = await expectFail(`/clubs/${ownerClubId}/standard`, {
    method: 'PUT',
    token,
    body: { applyStartAt: '2026-12-01T00:00:00.000Z', applyEndAt: '2026-11-01T00:00:00.000Z' },
  });
  check('开始晚于结束被拒（400）', badWindow.status === 400, `status=${badWindow.status}`);

  /* ---------- 准备测试数据 ---------- */
  console.log('\n④ 准备临时测试数据（简历 + 投递）');
  const positions = (detail.body?.data?.recruitments || []).flatMap((r) => r.positions || []);
  check('目标社团有岗位可用于测试', positions.length > 0, `positions=${positions.length}`);
  const posA = positions[0];
  const posB = positions[1] || positions[0];

  const resume = await api('/resumes', {
    method: 'POST',
    body: {
      studentName: '冒烟测试·候选人',
      phone: '13800000000',
      school: '测试大学',
      major: '软件工程',
      grade: '大二',
      skills: 'Vue,Node.js,沟通',
      content: '【冒烟测试】本记录由自动化测试创建，跑完即删。',
    },
  });
  check('创建测试简历 201/200', resume.status === 200 || resume.status === 201, JSON.stringify(resume.body).slice(0, 200));
  const resumeId = resume.body?.data?.id;
  if (resumeId) cleanup.resumeIds.push(resumeId);

  const app1 = await api(`/positions/${posA.id}/applications`, {
    method: 'POST',
    body: { resumeId, typeTag: 'technical' },
  });
  check('投递到岗位A', app1.status === 200 || app1.status === 201, JSON.stringify(app1.body).slice(0, 200));
  const appId = app1.body?.data?.id;
  if (appId) cleanup.applicationIds.push(appId);

  /* ---------- ⑤ 面试工作台 ---------- */
  console.log('\n⑤ 面试与录用工作台');
  const board = await api(`/clubs/${ownerClubId}/interview-board`, { token });
  check('GET /clubs/:id/interview-board 200', board.status === 200, JSON.stringify(board.body).slice(0, 200));
  const bd = board.body?.data || {};
  check('工作台含分列数据', bd.columns && Array.isArray(bd.columns.new));
  check('工作台含汇总（需求/已录/剩余）',
    bd.summary && 'needTotal' in bd.summary && 'filledTotal' in bd.summary && 'remainingTotal' in bd.summary,
    JSON.stringify(bd.summary));
  check('工作台含岗位招满进度', Array.isArray(bd.progress) && bd.progress.length > 0);
  check('候选人在 new 列', bd.columns?.new?.some((c) => c.id === appId));
  check('候选人带技能匹配度', typeof bd.columns?.new?.find((c) => c.id === appId)?.matchScore === 'number');

  const boardNoAuth = await expectFail(`/clubs/${ownerClubId}/interview-board`);
  check('未登录看工作台被拒（401）', boardNoAuth.status === 401, `status=${boardNoAuth.status}`);

  /* ---------- ⑥ 决策：先推进到待筛选，再录用 ---------- */
  console.log('\n⑥ 面试决策：录用 / 候补 / 调剂 / 淘汰');
  const newToAdmitted = await expectFail(`/applications/${appId}/decision`, {
    method: 'PATCH', token, body: { decision: 'hired' },
  });
  check('新收到不能直接录用（状态机拦截 400）', newToAdmitted.status === 400, `status=${newToAdmitted.status}`);

  const toScreening = await api(`/applications/${appId}/status`, {
    method: 'PATCH', token, body: { status: 'screening' },
  });
  check('推进到待筛选', toScreening.status === 200, JSON.stringify(toScreening.body).slice(0, 160));

  const wl = await api(`/applications/${appId}/decision`, {
    method: 'PATCH', token, body: { decision: 'waitlist', waitlistRank: 1, score: 4, note: '冒烟测试：候补1号' },
  });
  check('标注候补 1 号', wl.status === 200 && wl.body?.data?.waitlistRank === 1, JSON.stringify(wl.body?.data)?.slice(0, 200));
  check('候补不改变流程状态', wl.body?.data?.status === 'screening', `status=${wl.body?.data?.status}`);
  check('候补不占用岗位名额', wl.body?.data?.position?.filledCount === posA.filled_count,
    `filled=${wl.body?.data?.position?.filledCount}`);

  const queue = await api(`/positions/${posA.id}/waitlist`, { token });
  check('候补队列可查', queue.status === 200 && queue.body?.data?.some((q) => q.id === appId),
    JSON.stringify(queue.body?.data)?.slice(0, 200));

  const hired = await api(`/applications/${appId}/decision`, {
    method: 'PATCH', token, body: { decision: 'hired' },
  });
  check('标注录用', hired.status === 200 && hired.body?.data?.decision === 'hired');
  check('录用后流程状态为已录取', hired.body?.data?.status === 'admitted', `status=${hired.body?.data?.status}`);
  check('录用后岗位已录数 +1', hired.body?.data?.position?.filledCount === (posA.filled_count || 0) + 1,
    `filled=${hired.body?.data?.position?.filledCount} before=${posA.filled_count}`);
  check('录用后候补序号被清空', hired.body?.data?.waitlistRank === null);

  const undo = await api(`/applications/${appId}/decision`, { method: 'PATCH', token, body: { decision: '' } });
  check('撤销录用结论', undo.status === 200 && undo.body?.data?.decision === '');
  check('撤销后已录数回落', undo.body?.data?.position?.filledCount === (posA.filled_count || 0),
    `filled=${undo.body?.data?.position?.filledCount}`);

  /* ---------- ⑦ 调剂 ---------- */
  console.log('\n⑦ 调剂（含技能匹配建议）');
  const sug = await api(`/applications/${appId}/adjust-suggestions`, { token });
  check('GET 调剂建议 200', sug.status === 200, JSON.stringify(sug.body).slice(0, 160));
  check('建议列表返回（排除当前岗位）',
    Array.isArray(sug.body?.data?.suggestions) &&
      !sug.body.data.suggestions.some((s) => s.positionId === posA.id),
    JSON.stringify(sug.body?.data?.suggestions)?.slice(0, 200));

  const selfAdjust = await expectFail(`/applications/${appId}/decision`, {
    method: 'PATCH', token, body: { decision: 'adjust', adjustPositionId: posA.id },
  });
  check('调剂到当前岗位被拒（400）', selfAdjust.status === 400, `status=${selfAdjust.status}`);

  if (posB.id !== posA.id) {
    const adj = await api(`/applications/${appId}/adjust`, {
      method: 'POST', token, body: { adjustPositionId: posB.id },
    });
    check('执行调剂 200', adj.status === 200, JSON.stringify(adj.body).slice(0, 200));
    check('原投递标注为调剂', adj.body?.data?.adjusted?.decision === 'adjust');
    check('原投递记录调剂去向', adj.body?.data?.adjusted?.adjustPositionId === posB.id);
    // 就近验证「调剂」筛选（此时该记录确实处于 adjust 状态）
    const adjFilter = await api(`/clubs/${ownerClubId}/applications?decision=adjust&pageSize=100`, { token });
    check('按「调剂」筛选命中该投递',
      (adjFilter.body?.data?.list || []).some((r) => r.id === appId),
      JSON.stringify((adjFilter.body?.data?.list || []).map((r) => r.id)));
    check('调剂记录带去向岗位名',
      (adjFilter.body?.data?.list || []).every((r) => r.decision !== 'adjust' || Boolean(r.adjust_position_title)));
    const createdId = adj.body?.data?.createdApplication?.id;
    check('目标岗位生成新投递', Boolean(createdId), JSON.stringify(adj.body?.data?.createdApplication)?.slice(0, 160));
    if (createdId) {
      cleanup.applicationIds.push(createdId);
      const dup = await expectFail(`/applications/${appId}/adjust`, {
        method: 'POST', token, body: { adjustPositionId: posB.id },
      });
      check('重复调剂同岗位被识别（不再新建）',
        dup.status === 200 && dup.body?.data?.alreadyApplied === true,
        `status=${dup.status} alreadyApplied=${dup.body?.data?.alreadyApplied}`);
    }
  } else {
    console.log('  ⏭ 该社团只有一个岗位，跳过调剂用例');
  }

  /* ---------- ⑧ 候补序号 + 递补招满 ---------- */
  console.log('\n⑧ 候补序号（1号/2号）+ 递补招满员');
  // 造两个候选人，标成候补 1 号 / 2 号，验证"按序号递补"与递补后的序号前移
  const resume2 = await api('/resumes', {
    method: 'POST',
    body: {
      studentName: '冒烟测试·候补二号',
      school: '测试大学', major: '数字媒体', grade: '大一',
      skills: '设计,海报', content: '【冒烟测试】跑完即删。',
    },
  });
  const resumeId2 = resume2.body?.data?.id;
  if (resumeId2) cleanup.resumeIds.push(resumeId2);
  const app2 = await api(`/positions/${posA.id}/applications`, {
    method: 'POST', body: { resumeId: resumeId2, typeTag: 'artistic' },
  });
  const appId2 = app2.body?.data?.id;
  if (appId2) cleanup.applicationIds.push(appId2);
  check('第二个候选人投递成功', Boolean(appId2), JSON.stringify(app2.body).slice(0, 160));

  // 两个都推进到待筛选（候补通常发生在面试/筛选之后）
  await api(`/applications/${appId}/status`, { method: 'PATCH', token, body: { status: 'screening' } });
  await api(`/applications/${appId2}/status`, { method: 'PATCH', token, body: { status: 'screening' } });

  const r1 = await api(`/applications/${appId}/decision`, {
    method: 'PATCH', token, body: { decision: 'waitlist', waitlistRank: 1 },
  });
  const r2 = await api(`/applications/${appId2}/decision`, {
    method: 'PATCH', token, body: { decision: 'waitlist', waitlistRank: 2 },
  });
  check('标注候补 1 号', r1.body?.data?.waitlistRank === 1, JSON.stringify(r1.body?.data)?.slice(0, 160));
  check('标注候补 2 号', r2.body?.data?.waitlistRank === 2, JSON.stringify(r2.body?.data)?.slice(0, 160));

  const dupRank = await expectFail(`/applications/${appId2}/decision`, {
    method: 'PATCH', token, body: { decision: 'waitlist', waitlistRank: 1 },
  });
  check('候补序号冲突被拒（不出现两个1号）', dupRank.status === 400, `status=${dupRank.status}`);

  const qBefore = await api(`/positions/${posA.id}/waitlist`, { token });
  const ranksBefore = (qBefore.body?.data || []).map((q) => q.waitlistRank);
  check('候补队列按序号排序', JSON.stringify(ranksBefore) === JSON.stringify([1, 2]),
    JSON.stringify(ranksBefore));
  const filledBefore = r1.body?.data?.position?.filledCount ?? 0;

  const promote = await api(`/positions/${posA.id}/promote-waitlist`, { method: 'POST', token, body: {} });
  check('递补接口可用', promote.status === 200, JSON.stringify(promote.body).slice(0, 200));
  check('递补者 = 候补 1 号（队首）', promote.body?.data?.promoted?.id === appId,
    `promoted=${promote.body?.data?.promoted?.id} expect=${appId}`);
  check('递补者被提升为录用', promote.body?.data?.promoted?.decision === 'hired');
  check('递补者流程状态为已录取', promote.body?.data?.promoted?.status === 'admitted');
  check('递补后岗位已录数 +1', promote.body?.data?.position?.filled === filledBefore + 1,
    `filled=${promote.body?.data?.position?.filled} before=${filledBefore}`);

  const rest = promote.body?.data?.remaining || [];
  check('递补后队列余 1 人', rest.length === 1, JSON.stringify(rest));
  check('剩余候补序号前移为 1 号', rest[0]?.waitlistRank === 1,
    `rank=${rest[0]?.waitlistRank}`);

  const promote2 = await api(`/positions/${posA.id}/promote-waitlist`, { method: 'POST', token, body: {} });
  check('二次递补把 2 号补上', promote2.body?.data?.promoted?.id === appId2,
    `promoted=${promote2.body?.data?.promoted?.id} expect=${appId2}`);
  check('二次递补后队列清空', (promote2.body?.data?.remaining?.length || 0) === 0);

  const emptyPromote = await api(`/positions/${posA.id}/promote-waitlist`, { method: 'POST', token, body: {} });
  check('空候补队列递补返回 400', emptyPromote.status === 400, `status=${emptyPromote.status}`);

  const progress = await api(`/positions/${posA.id}/progress`, { token });
  check('岗位进度可查（含候补数与是否招满）',
    progress.status === 200 && 'isFull' in (progress.body?.data || {}) && 'waitlistCount' in (progress.body?.data || {}),
    JSON.stringify(progress.body?.data));

  /* ---------- ⑨ 权限矩阵 ---------- */
  console.log('\n⑨ 按人权限（角色矩阵 + 跨社团隔离）');
  const mkViewer = await api(`/clubs/${ownerClubId}/accounts`, {
    method: 'POST',
    token,
    body: { username: `smoke_viewer_${Date.now()}`, password: 'viewer123', role: 'viewer', displayName: '冒烟·观察员' },
  });
  check('owner 可创建 viewer 账号', mkViewer.status === 200 || mkViewer.status === 201,
    JSON.stringify(mkViewer.body).slice(0, 200));
  const viewerId = mkViewer.body?.data?.id;
  if (viewerId) cleanup.accountIds.push(viewerId);
  const viewerUser = mkViewer.body?.data?.username;

  const viewerLogin = await api('/auth/login', { method: 'POST', body: { username: viewerUser, password: 'viewer123' } });
  const viewerToken = viewerLogin.body?.data?.token;
  check('viewer 能登录', Boolean(viewerToken));
  check('viewer 能力清单不含 decide',
    viewerLogin.body?.data?.account?.capabilities?.includes('application:decide') === false,
    JSON.stringify(viewerLogin.body?.data?.account?.capabilities));

  const viewerDecide = await expectFail(`/applications/${appId}/decision`, {
    method: 'PATCH', token: viewerToken, body: { decision: 'reject' },
  });
  check('viewer 决策被拒（403）', viewerDecide.status === 403, `status=${viewerDecide.status}`);

  const viewerEditClub = await expectFail(`/clubs/${ownerClubId}/standard`, {
    method: 'PUT', token: viewerToken, body: { entryCriteria: 'viewer 不应能改' },
  });
  check('viewer 改录入标准被拒（403）', viewerEditClub.status === 403, `status=${viewerEditClub.status}`);

  const viewerRead = await api(`/clubs/${ownerClubId}/interview-board`, { token: viewerToken });
  check('viewer 仍可只读工作台', viewerRead.status === 200, `status=${viewerRead.status}`);

  const viewerStatus = await expectFail(`/applications/${appId}/status`, {
    method: 'PATCH', token: viewerToken, body: { status: 'interviewing' },
  });
  check('viewer 改流程状态被拒（403）', viewerStatus.status === 403, `status=${viewerStatus.status}`);

  const viewerArchive = await expectFail(`/applications/${appId}/archive`, {
    method: 'PATCH', token: viewerToken, body: { archived: true },
  });
  check('viewer 归档被拒（403）', viewerArchive.status === 403, `status=${viewerArchive.status}`);

  const viewerScore = await expectFail(`/applications/${appId}`, {
    method: 'PUT', token: viewerToken, body: { score: 5 },
  });
  check('viewer 评分被拒（403）', viewerScore.status === 403, `status=${viewerScore.status}`);

  const viewerDelete = await expectFail(`/applications/${appId}`, { method: 'DELETE', token: viewerToken });
  check('viewer 删除投递被拒（403）', viewerDelete.status === 403, `status=${viewerDelete.status}`);

  const anonStatus = await expectFail(`/applications/${appId}/status`, {
    method: 'PATCH', body: { status: 'interviewing' },
  });
  check('未登录改流程状态被拒（401）', anonStatus.status === 401, `status=${anonStatus.status}`);

  const anonArchive = await expectFail(`/applications/${appId}/archive`, {
    method: 'PATCH', body: { archived: true },
  });
  check('未登录归档被拒（401）', anonArchive.status === 401, `status=${anonArchive.status}`);

  // 学生端自助投递必须保持开放（否则学生无法投简历）
  const anonResume = await api('/resumes', {
    method: 'POST',
    body: { studentName: '冒烟测试·匿名投递', skills: '测试', content: 'x' },
  });
  check('学生端匿名建简历保持开放', anonResume.status === 200 || anonResume.status === 201,
    `status=${anonResume.status}`);
  const anonResumeId = anonResume.body?.data?.id;
  if (anonResumeId) cleanup.resumeIds.push(anonResumeId);
  const anonApply = await api(`/positions/${posA.id}/applications`, {
    method: 'POST', body: { resumeId: anonResumeId, typeTag: 'other' },
  });
  check('学生端匿名投递保持开放', anonApply.status === 200 || anonApply.status === 201,
    `status=${anonApply.status}`);
  if (anonApply.body?.data?.id) cleanup.applicationIds.push(anonApply.body.data.id);

  // 跨社团：用别的社团账号操作本社团数据
  if (clubs.length > 1) {
    const otherClub = clubs.find((c) => c.id !== ownerClubId);
   	const otherAccounts = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../data/initial-accounts.txt', import.meta.url), 'utf8')
    );
    const line = otherAccounts.split(/\r?\n/).find((l) => l.includes(otherClub?.name) && !l.startsWith('#'));
    const oUser = (line?.split('\t')[1] || '').replace('账号=', '');
    const oPass = (line?.split('\t')[2] || '').replace('密码=', '');
    if (oUser && oPass) {
      const oLogin = await api('/auth/login', { method: 'POST', body: { username: oUser, password: oPass } });
      const oToken = oLogin.body?.data?.token;
      const crossDecide = await expectFail(`/applications/${appId}/decision`, {
        method: 'PATCH', token: oToken, body: { decision: 'reject' },
      });
      check('别的社团账号不能决策我的投递（403）', crossDecide.status === 403, `status=${crossDecide.status}`);

      const crossStd = await expectFail(`/clubs/${ownerClubId}/standard`, {
        method: 'PUT', token: oToken, body: { entryCriteria: '越权' },
      });
      check('别的社团账号不能改我的录入标准（403）', crossStd.status === 403, `status=${crossStd.status}`);
    }
  }

  /* ---------- ⑩ 字典 ---------- */
  console.log('\n⑩ 字典下发（前端据此隐藏越权按钮）');
  const dict = await api('/dict');
  check('GET /dict 含 decisions', Boolean(dict.body?.data?.decisions?.labels), JSON.stringify(dict.body?.data?.decisions)?.slice(0, 200));
  check('GET /dict 含 roleCapabilities', Boolean(dict.body?.data?.roleCapabilities?.owner));
  check('字典含候补/调剂标签',
    dict.body?.data?.decisions?.labels?.waitlist === '候补' &&
      dict.body?.data?.decisions?.labels?.adjust === '调剂');

  /* ---------- ⑪ 简历库：面试结论筛选与导出 ---------- */
  console.log('\n⑪ 简历库：面试结论筛选 / 统计 / 导出');
  // 注：简历库现在含 PII，必须带 token（未登录被拒已在 ⑫ 覆盖）
  const all = await api(`/clubs/${ownerClubId}/applications?pageSize=100`, { token });
  check('简历库返回 decisionCounts', Boolean(all.body?.data?.decisionCounts),
    JSON.stringify(all.body?.data?.decisionCounts));
  check('列表带面试结论字段',
    all.body?.data?.list?.every((r) => 'decision' in r && 'waitlist_rank' in r));

  const hiredList = await api(`/clubs/${ownerClubId}/applications?decision=hired&pageSize=100`, { token });
  check('按「录用」筛选可用', hiredList.status === 200, `status=${hiredList.status}`);
  check('录用筛选结果都带 decision=hired',
    (hiredList.body?.data?.list || []).every((r) => r.decision === 'hired'),
    JSON.stringify((hiredList.body?.data?.list || []).map((r) => r.decision)));
  check('录用筛选命中本次递补的候选人',
    (hiredList.body?.data?.list || []).some((r) => r.id === appId2));

  // 注：前面的用例已把该投递从 adjust 改成了其他结论，这里只校验筛选器本身的正确性
  const adjustList = await api(`/clubs/${ownerClubId}/applications?decision=adjust&pageSize=100`, { token });
  check('「调剂」筛选只返回调剂记录',
    (adjustList.body?.data?.list || []).every((r) => r.decision === 'adjust'),
    JSON.stringify((adjustList.body?.data?.list || []).map((r) => r.decision)));

  const undecided = await api(`/clubs/${ownerClubId}/applications?decision=__undecided__&pageSize=100`, { token });
  check('「未决定」筛选排除已决策记录',
    (undecided.body?.data?.list || []).every((r) => r.decision === ''),
    JSON.stringify((undecided.body?.data?.list || []).map((r) => r.decision)));

  const csvRes = await fetch(`${BASE}/clubs/${ownerClubId}/applications/export?decision=hired`, {
    headers: { 'X-Club-Token': token },
  });
  const csvText = await csvRes.text();
  check('CSV 导出包含面试结论列', csvText.includes('面试结论'), csvText.slice(0, 120));
  check('CSV 导出包含候补序号列', csvText.includes('候补序号'));
  check('CSV 导出包含调剂去向列', csvText.includes('调剂去向'));
  check('CSV 中录用人显示为「录用」', csvText.includes('录用'), csvText.split('\r\n').slice(0, 2).join(' | '));

  /* ---------- ⑫ 公网部署安全：简历 PII 不可匿名读取 / 破坏性操作需鉴权 ---------- */
  console.log('\n⑫ 公网部署安全（PII 与破坏性操作）');

  // 社团 id / 岗位 id 在公开广场里是明摆着的，不能当访问凭据
  const pubClubId = (await api('/square/clubs')).body?.data?.list?.[0]?.id;
  const pubDetail = await api(`/square/clubs/${pubClubId}`);
  const pubPosId = (pubDetail.body?.data?.recruitments || [])[0]?.positions?.[0]?.id;
  check('广场公开提供社团/岗位 id（因此不能当凭据）', Boolean(pubClubId && pubPosId));

  const anonList = await expectFail(`/clubs/${ownerClubId}/applications?pageSize=5`);
  check('未登录读简历库被拒（401，防遍历 id 拉 PII）', anonList.status === 401, `status=${anonList.status}`);

  const anonPosApps = await expectFail(`/positions/${pubPosId}/applications`);
  check('未登录读岗位投递列表被拒（401）', anonPosApps.status === 401, `status=${anonPosApps.status}`);

  const anonExport = await expectFail(`/clubs/${ownerClubId}/applications/export`);
  check('未登录导出简历 CSV 被拒（401）', anonExport.status === 401, `status=${anonExport.status}`);

  const anonResumeRead = await expectFail(`/resumes/${resumeId}`, {});
  check('未登录读简历详情被拒（401）', anonResumeRead.status === 401, `status=${anonResumeRead.status}`);

  const anonBoard = await expectFail(`/clubs/${ownerClubId}/interview-board`);
  check('未登录读面试工作台被拒（401）', anonBoard.status === 401, `status=${anonBoard.status}`);

  const anonMatch = await expectFail(`/clubs/${ownerClubId}/match-applicants`);
  check('未登录读转岗建议被拒（401）', anonMatch.status === 401, `status=${anonMatch.status}`);

  const anonClubUpdate = await expectFail(`/clubs/${ownerClubId}`, { method: 'PUT', body: { description: 'x' } });
  check('未登录改社团资料被拒（401）', anonClubUpdate.status === 401, `status=${anonClubUpdate.status}`);

  const anonClubDelete = await expectFail(`/clubs/${ownerClubId}`, { method: 'DELETE' });
  check('未登录删社团被拒（401，否则可级联清空整个社团数据）', anonClubDelete.status === 401,
    `status=${anonClubDelete.status}`);

  const anonRecCreate = await expectFail(`/clubs/${ownerClubId}/recruitments`, {
    method: 'POST', body: { title: '匿名批次' },
  });
  check('未登录建招新批次被拒（401）', anonRecCreate.status === 401, `status=${anonRecCreate.status}`);

  const anonPosCreate = await expectFail(`/recruitments/${pubDetail.body.data.recruitments[0].id}/positions`, {
    method: 'POST', body: { title: '匿名岗位', headcount: 1 },
  });
  check('未登录建岗位被拒（401）', anonPosCreate.status === 401, `status=${anonPosCreate.status}`);

  // 学生端查自己投递进度必须仍然可用（无身份体系，靠随机 id 作能力凭据）
  const anonAppDetail = await api(`/applications/${appId}`);
  check('学生端查投递进度保持开放（能力 URL）', anonAppDetail.status === 200, `status=${anonAppDetail.status}`);

  // 跨社团读（用别社团 token 读我的简历库）
  if (clubs.length > 1) {
    const otherClub = clubs.find((c) => c.id !== ownerClubId);
    const otherAccounts2 = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../data/initial-accounts.txt', import.meta.url), 'utf8')
    );
    const line2 = otherAccounts2.split(/\r?\n/).filter((l) => l.includes(otherClub?.name) && !l.startsWith('#')).pop();
    const oUser2 = (line2?.split('\t')[1] || '').replace('账号=', '');
    const oPass2 = (line2?.split('\t')[2] || '').replace('密码=', '');
    if (oUser2 && oPass2) {
      const oTok = (await api('/auth/login', { method: 'POST', body: { username: oUser2, password: oPass2 } }))
        .body?.data?.token;
      const crossRead = await expectFail(`/clubs/${ownerClubId}/applications?pageSize=5`, { token: oTok });
      check('别社团账号读我的简历库被拒（403）', crossRead.status === 403, `status=${crossRead.status}`);

      const crossExport = await expectFail(`/clubs/${ownerClubId}/applications/export`, { token: oTok });
      check('别社团账号导出我的简历 CSV 被拒（403）', crossExport.status === 403, `status=${crossExport.status}`);

      const crossDelete = await expectFail(`/clubs/${ownerClubId}`, { method: 'DELETE', token: oTok });
      check('别社团账号删我的社团被拒（403）', crossDelete.status === 403, `status=${crossDelete.status}`);

      const crossResume = await expectFail(`/resumes/${resumeId}`, { token: oTok });
      check('别社团账号读我收到的简历被拒（403）', crossResume.status === 403, `status=${crossResume.status}`);
    }
  }

  // 本人读自己的简历库应当正常（不能一刀切全拒）
  const ownerRead = await api(`/clubs/${ownerClubId}/applications?pageSize=5`, { token });
  check('本社团账号读自己的简历库正常', ownerRead.status === 200, `status=${ownerRead.status}`);

  /* ---------- ⑬ 首次开通：新建社团自动获得社长账号 ---------- */
  console.log('\n⑬ 首次开通引导（云端空库场景）');
  const freshName = `冒烟测试·云开通社团_${Date.now()}`;
  const createRes = await api('/clubs', {
    method: 'POST',
    body: { name: freshName, scale: 50, scaleLabel: '20-50', category: 'academic', description: '冒烟测试' },
  });
  check('未登录可创建社团（自服务开通）', createRes.status === 200 || createRes.status === 201,
    JSON.stringify(createRes.body).slice(0, 200));
  const freshClubId = createRes.body?.data?.id;
  const ownerAcc = createRes.body?.data?.ownerAccount;
  check('创建社团时自动开通社长账号', Boolean(ownerAcc?.username && ownerAcc?.password),
    JSON.stringify({ username: ownerAcc?.username, hasPassword: Boolean(ownerAcc?.password) }));
  let freshToken = '';
  if (ownerAcc?.username) {
    const freshLogin = await api('/auth/login', {
      method: 'POST',
      body: { username: ownerAcc.username, password: ownerAcc.password },
    });
    check('用返回的凭据可立即登录（不会第一次就卡死）', freshLogin.status === 200,
      JSON.stringify(freshLogin.body).slice(0, 160));
    freshToken = freshLogin.body?.data?.token || '';
    if (freshLogin.body?.data?.account) {
      check('新账号角色为社长且绑定到该社团',
        freshLogin.body.data.account.role === 'owner' &&
          freshLogin.body.data.account.clubId === freshClubId);
    }
  }
  if (freshClubId && freshToken) {
    // 用"别社团"的 token 删它应当被拒
    const crossDel = await expectFail(`/clubs/${freshClubId}`, { method: 'DELETE', token });
    check('别社团账号不能删我的新社团（403）', crossDel.status === 403, `status=${crossDel.status}`);
    // 用自己的 token 才能删
    const delFresh = await api(`/clubs/${freshClubId}`, { method: 'DELETE', token: freshToken });
    check('清理：本社团账号可删除该测试社团', delFresh.status === 200, `status=${delFresh.status}`);
  }

  /* ---------- ⑭ 两个独立站点：学生端（无密码）vs 社团端（有密码） ---------- */
  console.log('\n⑭ 站点拆分（学生端 / 社团端）');
  const STUDENT = process.env.SMOKE_STUDENT_BASE || 'http://localhost:3001';

  const rawFetch = async (url, opts = {}) => {
    const res = await fetch(url, opts);
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  };

  const studentHealth = await rawFetch(`${STUDENT}/healthz`);
  check('学生端独立监听并探活', studentHealth.status === 200 && studentHealth.text.includes('student'),
    `status=${studentHealth.status} body=${studentHealth.text.slice(0, 80)}`);

  const clubHealth = await rawFetch('http://localhost:3000/healthz');
  check('社团端探活标识为 club', clubHealth.status === 200 && clubHealth.text.includes('club'));

  const studentRoot = await rawFetch(`${STUDENT}/`);
  check('学生端根路径就是投递页（不是某个子路径）', studentRoot.status === 200,
    `status=${studentRoot.status}`);
  check('学生端首页引用适配层', studentRoot.text.includes('portal-adapter.js'));
  check('学生端首页不含 Vue SPA 挂载点（两站未混在一起）',
    !studentRoot.text.includes('<div id="app">'),
    '意外出现了 SPA 挂载点');

  const adapter = await rawFetch(`${STUDENT}/portal-adapter.js`);
  check('学生端适配层可访问', adapter.status === 200 && adapter.text.includes('PortalAPI'),
    `status=${adapter.status}`);

  // 学生端白名单接口
  const sClubs = await rawFetch(`${STUDENT}/api/v1/clubs?page=1&pageSize=100`);
  check('学生端可读社团列表（白名单）', sClubs.status === 200, `status=${sClubs.status}`);
  const sClubList = JSON.parse(sClubs.text).data.list;
  const sClubId = sClubList[0].id;
  const sDetail = await rawFetch(`${STUDENT}/api/v1/clubs/${sClubId}`);
  check('学生端可读社团详情与岗位（白名单）', sDetail.status === 200, `status=${sDetail.status}`);
  const sPosId = JSON.parse(sDetail.text).data.recruitments?.[0]?.positions?.[0]?.id;
  check('学生端能拿到可投递的岗位', Boolean(sPosId));

  // 学生端完整投递链路（无任何登录态）
  const sResume = await rawFetch(`${STUDENT}/api/v1/resumes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentName: '冒烟测试·学生端投递', grade: '大一', major: '测试', skills: 'Vue', content: 'x' }),
  });
  check('学生端无需登录即可建简历', sResume.status === 200 || sResume.status === 201,
    `status=${sResume.status}`);
  const sResumeId = JSON.parse(sResume.text).data?.id;
  if (sResumeId) cleanup.resumeIds.push(sResumeId);

  const sApply = await rawFetch(`${STUDENT}/api/v1/positions/${sPosId}/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId: sResumeId, typeTag: 'other' }),
  });
  check('学生端无需登录即可投递', sApply.status === 200 || sApply.status === 201, `status=${sApply.status}`);
  const sAppId = JSON.parse(sApply.text).data?.id;
  if (sAppId) cleanup.applicationIds.push(sAppId);

  const sProgress = await rawFetch(`${STUDENT}/api/v1/applications/${sAppId}`);
  check('学生端可查自己那条投递的进度', sProgress.status === 200, `status=${sProgress.status}`);

  // 学生端绝不能暴露的接口（防"公开站点泄漏整库简历"）
  for (const [desc, path] of [
    ['登录接口', '/api/v1/auth/login'],
    ['账号管理', '/api/v1/clubs/x/accounts'],
    ['数据看板', '/api/v1/dashboard'],
    ['招新广场聚合', '/api/v1/square/clubs'],
    ['社团简历库', `/api/v1/clubs/${sClubId}/applications`],
    ['岗位投递列表', `/api/v1/positions/${sPosId}/applications`],
    ['CSV 导出', `/api/v1/clubs/${sClubId}/applications/export`],
    ['简历附件目录', '/uploads/anything.pdf'],
    ['面试工作台', `/api/v1/clubs/${sClubId}/interview-board`],
  ]) {
    const r = await rawFetch(`${STUDENT}${path}`);
    check(`学生端拒绝「${desc}」（404）`, r.status === 404, `status=${r.status}`);
  }

  // 社团端的 /portal.html 应重定向到学生端
  const redirectRes = await fetch('http://localhost:3000/portal.html', { redirect: 'manual' });
  check('社团端 /portal.html 重定向到学生端',
    redirectRes.status === 302 && (redirectRes.headers.get('location') || '').includes(':3001'),
    `status=${redirectRes.status} location=${redirectRes.headers.get('location')}`);

  // 字典下发学生端地址，供侧边栏入口使用
  const dictForSite = await api('/dict');
  check('字典下发学生端地址', Boolean(dictForSite.body?.data?.studentSiteUrl),
    JSON.stringify(dictForSite.body?.data?.studentSiteUrl));
  check('字典标记学生端为独立站点', dictForSite.body?.data?.studentSiteEnabled === true);

  /* ---------- 清理 ---------- */
  console.log('\n⑮ 清理测试数据');
  // 恢复被测试改动的真实社团字段
  await api(`/clubs/${ownerClubId}/standard`, { method: 'PUT', token, body: originalStandard });
  const restored = (await api(`/clubs/${ownerClubId}`)).body?.data || {};
  check('录入标准/投递时间已还原',
    (restored.entry_criteria ?? '') === originalStandard.entryCriteria &&
      (restored.apply_end_at ?? null) === originalStandard.applyEndAt,
    JSON.stringify({ now: restored.entry_criteria, was: originalStandard.entryCriteria }));

  for (const id of new Set(cleanup.applicationIds)) {
    if (id) await api(`/applications/${id}`, { method: 'DELETE', token });
  }
  let resumeDeleteFailures = 0;
  for (const id of new Set(cleanup.resumeIds)) {
    if (!id) continue;
    const d = await api(`/resumes/${id}`, { method: 'DELETE', token });
    if (d.status !== 200) resumeDeleteFailures += 1;
  }
  check('测试简历已全部删除（无残留）', resumeDeleteFailures === 0, `failures=${resumeDeleteFailures}`);

  for (const id of new Set(cleanup.accountIds)) {
    if (id) await api(`/accounts/${id}`, { method: 'DELETE', token });
  }
  console.log(`  已清理 ${new Set(cleanup.applicationIds).size} 投递 / ${new Set(cleanup.resumeIds).size} 简历 / ${new Set(cleanup.accountIds).size} 账号`);

  console.log(`\n═══ 结果：通过 ${pass} / 失败 ${fail} ═══`);
  if (fail > 0) {
    console.log('失败用例：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
})();
