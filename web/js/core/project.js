// 分支推演：从此刻出发，把“方向 × 投入”的每个组合交给同一套训练引擎逐周推演，看每条分支通向哪里。
// 推演只用真实数据：已有的增益事件、培养方案里未来学期的课程、你最近几轮 batch 的真实完成率。
import { SKILL_IDS, GOALS } from './data.js';
import * as M from './model.js';
import * as P from './plans.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
/** 没有足够历史时，每个“有效小时”（计划投入 × 完成率）带来的累计增益。 */
export const K_HOUR = 0.015;
/** 收敛线：与诊断里的 early_stop、loss 曲线的收敛线一致。 */
export const CONVERGE_FIT = 0.82;
export const MODES = {
  grad: { name: '梯度优先', desc: '每周把时间投给 loss 下降最快的 3 项能力' },
  even: { name: '均衡补短', desc: '按差距大小把时间分给所有短板' },
  none: { name: '只靠课程', desc: '不做额外训练，只有培养方案里的课程计入' },
};

/** 最近 3 轮 batch 的平均完成率；没有记录时按 0.75 估计。 */
export function historicalRate(state) {
  const rates = (state.reviews || []).map((r) => r.batch?.rate).filter((r) => r != null).slice(-3);
  return { rate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0.75, n: rates.length };
}

/**
 * 你的“学习效率”：历史上每投入 1 小时换来的累计增益（经历、计划任务、实验、batch，不含课程）。
 * 至少 40 小时的记录才采用；上限取 0.015（保守）：早期样本往往起点低、增益大，直接外推会让推演过于乐观。
 */
export function efficiency(state, events = M.gainEvents(state), now = Date.now()) {
  let g = 0, h = 0;
  for (const e of events) {
    if (e.kind === 'curriculum' || e.t > now) continue;
    g += Object.values(e.skills).reduce((a, v) => a + (Number(v) || 0), 0);
    h += e.hours || 0;
  }
  return h >= 40 ? { k: M.clamp(g / h, 0.006, K_HOUR), hours: h } : { k: K_HOUR, hours: h };
}

/** 推演终点：半年 / 一年 / 毕业（有培养方案时取第 8 学期结束）。 */
export function horizons(state, now = Date.now()) {
  const list = [
    { id: '6m', name: '半年', end: now + 26 * WEEK },
    { id: '1y', name: '一年', end: now + 52 * WEEK },
  ];
  const plan = P.userPlan(state);
  const grad = plan && P.semRange(plan, 8)[1];
  if (grad && grad > now + 8 * WEEK) list.push({ id: 'grad', name: '到毕业', end: Math.min(grad, now + 156 * WEEK) });
  return list;
}

function vecG(state, events, t) {
  const G = Object.fromEntries(SKILL_IDS.map((id) => [id, 0]));
  for (const e of events) {
    if (e.t > t) break;
    for (const [k, v] of Object.entries(e.skills)) if (k in G) G[k] += Number(v) || 0;
  }
  return G;
}
function toS(state, G) {
  const S = {};
  for (const id of SKILL_IDS) {
    const b = M.clamp(Number(state.baseSkills?.[id]) || 0, 0, 5);
    S[id] = b + (5 - b) * (1 - Math.exp(-G[id] / 2.5));
  }
  return S;
}

/** 把本周的有效增益分配到各项能力。 */
function allocate(S, role, mode, amount) {
  if (mode === 'none' || amount <= 0) return {};
  if (mode === 'even') {
    const gaps = SKILL_IDS.map((id) => [id, Math.max(0, (role.req[id] || 0) - S[id]) * ((role.req[id] || 0) / 5)]).filter(([, g]) => g > 0.01);
    const z = gaps.reduce((a, [, g]) => a + g, 0);
    return z ? Object.fromEntries(gaps.map(([id, g]) => [id, (amount * g) / z])) : {};
  }
  const top = M.gradient(S, role).slice(0, 3);
  const z = top.reduce((a, g) => a + g.delta, 0);
  return z ? Object.fromEntries(top.map((g) => [g.id, (amount * g.delta) / z])) : {};
}

/**
 * 推演一条分支。branch: { roleId, hours, rate, mode }。
 * 返回逐周的 { t, loss, fit }、终点能力向量、首次达到收敛线的时间 eta。
 */
export function simulate(state, branch, end, { now = Date.now(), events = M.gainEvents(state), k = efficiency(state, events, now).k } = {}) {
  const role = M.roleById(state, branch.roleId);
  if (!role) return null;
  const G = vecG(state, events, now);
  const future = events.filter((e) => e.t > now && e.t <= end);
  const perWeek = branch.mode === 'none' ? 0 : Math.max(0, +branch.hours || 0) * M.clamp(+branch.rate || 0, 0, 1);
  let S = toS(state, G);
  let loss = M.lossOf(S, role);
  const points = [{ t: now, loss, fit: M.fitOf(loss) }];
  let eta = M.fitOf(loss) >= CONVERGE_FIT ? now : null;
  let fi = 0;
  let hours = 0;
  for (let t = now + WEEK; t < end + WEEK; t += WEEK) {
    const tt = Math.min(t, end);
    while (fi < future.length && future[fi].t <= tt) {
      for (const [k, v] of Object.entries(future[fi].skills)) if (k in G) G[k] += Number(v) || 0;
      fi++;
    }
    const wk = perWeek * ((tt - points.at(-1).t) / WEEK);
    for (const [id, v] of Object.entries(allocate(S, role, branch.mode, wk * k))) G[id] += v;
    hours += wk;
    S = toS(state, G);
    loss = M.lossOf(S, role);
    const fit = M.fitOf(loss);
    points.push({ t: tt, loss, fit });
    if (eta == null && fit >= CONVERGE_FIT) eta = tt;
    if (tt >= end) break;
  }
  return { role, points, S, loss, fit: M.fitOf(loss), eta, hours };
}

/** 默认的树：当前目标 + 拟合度最高的另外两个方向，每个方向三种投入。 */
export function buildTree(state, end, now = Date.now()) {
  const S = M.skillsAt(state, now);
  const { rate, n } = historicalRate(state);
  const h = Math.max(2, +state.profile?.hoursPerWeek || 10);
  const plan = P.userPlan(state);
  const events = M.gainEvents(state);
  const eff = efficiency(state, events, now);
  const ranked = M.rankRoles(state, S);
  const target = M.roleById(state, state.target);
  const roles = [...(target ? [target] : []), ...ranked.map((r) => r.role).filter((r) => r.id !== target?.id).slice(0, target ? 2 : 3)];
  const efforts = [
    { id: 'keep', name: '保持节奏', hours: h, rate, mode: 'grad', note: `${h}h/周 × 完成率 ${Math.round(rate * 100)}%` },
    { id: 'boost', name: '加大投入', hours: Math.round(h * 1.5), rate: rate * 0.85, mode: 'grad', note: `${Math.round(h * 1.5)}h/周 × 完成率 ${Math.round(rate * 85)}%` },
    { id: 'none', name: plan ? '只靠课程' : '停止训练', hours: 0, rate: 0, mode: 'none', note: plan ? '只有培养方案课程计入' : '不再投入，能力保持不变' },
  ];
  const custom = (state.whatIf || []).filter((b) => M.roleById(state, b.roleId));
  for (const c of custom) if (!roles.some((r) => r.id === c.roleId)) roles.push(M.roleById(state, c.roleId));

  const groups = roles.map((role, gi) => {
    const fitNow = M.fitOf(M.lossOf(S, role));
    const leaves = efforts.map((e) => ({ ...e, key: `${role.id}:${e.id}`, roleId: role.id }));
    for (const c of custom.filter((x) => x.roleId === role.id)) {
      leaves.push({ ...c, key: c.id, custom: true, name: c.name || '自定义', note: c.mode === 'none' ? MODES.none.desc : `${c.hours}h/周 × 完成率 ${Math.round(c.rate * 100)}% · ${MODES[c.mode]?.name || ''}` });
    }
    for (const l of leaves) l.sim = simulate(state, l, end, { now, events, k: eff.k });
    const base = leaves.find((l) => l.mode === 'none' && !l.custom)?.sim;
    return { role, gi, current: role.id === state.target, fitNow, leaves, base };
  });
  const all = groups.flatMap((g) => g.leaves);
  const best = all.filter((l) => l.mode !== 'none').sort((a, b) => b.sim.fit - a.sim.fit || (a.sim.eta ?? Infinity) - (b.sim.eta ?? Infinity))[0];
  return { groups, best: best?.key, rate, nRate: n, hours: h, k: eff.k, kHours: eff.hours, now, end, goal: GOALS.find((g) => g.id === state.profile?.goal)?.name };
}

/** 培养方案的学期边界（用于推演曲线上的刻度）。 */
export function semesterMarks(state, from, to) {
  const plan = P.userPlan(state);
  if (!plan) return [];
  const out = [];
  for (let s = 1; s <= 8; s++) {
    const t = P.semRange(plan, s)[1];
    if (t > from && t < to) out.push({ t, label: `${P.semLabel(s)}末` });
  }
  return out;
}
