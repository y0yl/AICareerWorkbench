// 难例挖掘（错题本）与测试集（真实投递）。
// 错题本：模拟面试 / 真实面试中得分低的题自动入库，按 Leitner 间隔重复（1/3/7/14/30 天）复测，答好一次升一档，答砸回到第一档。
// 测试集：训练集 = 经历，验证集 = 模拟面试，测试集 = 真实投递。被拒原因是真实世界给出的梯度。
// 注意：本模块不依赖 model.js（model.js 会引用这里）。
import { uid } from './store.js';

const DAY = 86400000;
export const BOXES = [1, 3, 7, 14, 30];
export const HARD_BAR = 6; // 低于 6 分（不合格）入库
export const PASS = 7; // 复测 ≥ 7 分算答好

const norm = (q) => String(q || '').replace(/\s+/g, '').replace(/[，。？！、,.?!：:；;“”"'（）()]/g, '').slice(0, 60);

/** 收录一道题（在 store.update 中调用）。同一道题再次答砸只更新记录。 */
export function addHard(st, { q, focus = '', skill = null, roleId = null, roleName = '', score = 0, reference = '', from = 'val', now = Date.now() }) {
  if (!q) return null;
  st.hardQs = st.hardQs || [];
  const k = norm(q);
  let h = st.hardQs.find((x) => norm(x.q) === k);
  if (h) {
    h.box = 0; h.due = now + BOXES[0] * DAY; h.mastered = false;
    h.history = [...(h.history || []), { t: now, score, from }].slice(-10);
    if (reference) h.reference = reference;
    return h;
  }
  h = { id: uid('hq'), q: String(q).slice(0, 300), focus: String(focus).slice(0, 30), skill, roleId, roleName, reference: String(reference || '').slice(0, 400), from, box: 0, due: now + BOXES[0] * DAY, addedAt: now, mastered: false, history: [{ t: now, score, from }] };
  st.hardQs.push(h);
  st.hardQs = st.hardQs.slice(-200);
  return h;
}

/** 复测打分（在 store.update 中调用）：≥7 升一档，<6 回到第一档，6–7 原档再来。 */
export function reviewHard(st, id, score, now = Date.now()) {
  const h = (st.hardQs || []).find((x) => x.id === id);
  if (!h) return null;
  h.history = [...(h.history || []), { t: now, score, from: 'review' }].slice(-10);
  if (score >= PASS) h.box += 1;
  else if (score < HARD_BAR) h.box = 0;
  if (h.box >= BOXES.length) { h.mastered = true; h.masteredAt = now; h.due = null; }
  else h.due = now + BOXES[h.box] * DAY;
  return h;
}

export function dueHard(state, now = Date.now(), within = 0) {
  return (state.hardQs || []).filter((h) => !h.mastered && h.due != null && h.due <= now + within).sort((a, b) => a.due - b.due);
}

export function hardStats(state) {
  const all = state.hardQs || [];
  return { total: all.length, mastered: all.filter((h) => h.mastered).length, due: dueHard(state).length, active: all.filter((h) => !h.mastered).length };
}

// ---------- 测试集：真实投递 ----------
export const STAGES = [
  { id: 'applied', name: '已投递', step: 0 },
  { id: 'test', name: '笔试 / 测评', step: 1 },
  { id: 'iv1', name: '一面', step: 2 },
  { id: 'iv2', name: '二面及以后', step: 3 },
  { id: 'hr', name: 'HR 面', step: 4 },
  { id: 'offer', name: 'Offer', step: 5, end: 'win' },
  { id: 'rejected', name: '未通过', step: -1, end: 'lose' },
  { id: 'withdrawn', name: '已放弃', step: -1, end: 'skip' },
];
export const STAGE = Object.fromEntries(STAGES.map((s) => [s.id, s]));
export const REASONS = [
  { id: 'algo', name: '算法题 / 笔试', skill: 'code' },
  { id: 'basics', name: '专业基础', skill: 'ml' },
  { id: 'depth', name: '技术深度', skill: 'dl' },
  { id: 'project', name: '项目经历', skill: 'research' },
  { id: 'system', name: '工程 / 系统能力', skill: 'infra' },
  { id: 'comm', name: '表达与沟通', skill: 'comm' },
  { id: 'fit', name: '岗位匹配 / 方向不符', skill: null },
  { id: 'hc', name: '名额 / 学历等硬条件', skill: null },
  { id: 'unknown', name: '原因不明', skill: null },
];
export const REASON = Object.fromEntries(REASONS.map((r) => [r.id, r]));

export function newApplication(fields = {}, now = Date.now()) {
  return { id: uid('ap'), company: '', role: '', roleId: null, channel: '', stage: 'applied', appliedAt: now, updatedAt: now, notes: '', reasons: [], timeline: [{ t: now, stage: 'applied' }], ...fields };
}

/** 漏斗：到达过每个阶段的投递数（按最远到达的阶段计）。 */
export function funnel(state) {
  const apps = state.applications || [];
  const reach = (a) => Math.max(0, ...(a.timeline || []).map((x) => STAGE[x.stage]?.step ?? 0));
  const levels = [
    { name: '投递', n: apps.length },
    { name: '笔试', n: apps.filter((a) => reach(a) >= 1).length },
    { name: '面试', n: apps.filter((a) => reach(a) >= 2).length },
    { name: 'HR', n: apps.filter((a) => reach(a) >= 4).length },
    { name: 'Offer', n: apps.filter((a) => a.stage === 'offer').length },
  ];
  const closed = apps.filter((a) => STAGE[a.stage]?.end && a.stage !== 'withdrawn');
  return { levels, total: apps.length, active: apps.filter((a) => !STAGE[a.stage]?.end).length, offers: levels[4].n, acc: closed.length ? levels[4].n / closed.length : null };
}

export function rejectionStats(state) {
  const count = {};
  for (const a of state.applications || []) if (a.stage === 'rejected') for (const r of a.reasons || []) if (REASON[r]?.skill || r === 'fit') count[r] = (count[r] || 0) + 1;
  const list = Object.entries(count).map(([id, n]) => ({ id, n, name: REASON[id].name, skill: REASON[id].skill })).sort((a, b) => b.n - a.n);
  return { list, top: list[0] || null };
}

export function testContext(state) {
  const apps = state.applications || [];
  if (!apps.length) return '';
  const f = funnel(state);
  const rej = rejectionStats(state);
  const recent = [...apps].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5).map((a) => `${a.company}·${a.role}（${STAGE[a.stage]?.name || a.stage}）`).join('；');
  return `测试集（真实投递）：共 ${f.total} 家，进行中 ${f.active}，进入面试 ${f.levels[2].n}，Offer ${f.offers}；近期：${recent}${rej.list.length ? `；被拒原因：${rej.list.map((r) => `${r.name}×${r.n}`).join('、')}` : ''}`;
}
