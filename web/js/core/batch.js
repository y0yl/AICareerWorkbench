// 本周 Batch：长期路线是学习率调度，每个 epoch 只喂一个 mini-batch——但每一条都要具体到某一天、可验收。
// 任务来源（按优先级）：梯度累积（上轮未完成）→ 实验 checkpoint → 计划任务切片 → 本学期课程 → 梯度微任务 → 验证 → 复盘。
import { MICRO_TASKS, SKILL, SKILLS, RESOURCES } from './data.js';
import * as M from './model.js';
import * as P from './plans.js';
import { uid } from './store.js';
import * as T from './testset.js';

export const DAY = 86400000;
export const WEEK = 7 * DAY;
export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const SOURCES = {
  run: { name: '实验', hint: '推进进行中的实验', cls: 'accent' },
  plan: { name: '计划', hint: '长期训练计划的一段', cls: 'target' },
  course: { name: '课程', hint: '本学期培养方案课程', cls: 'target' },
  grad: { name: '梯度', hint: '针对梯度最大的能力', cls: 'accent' },
  val: { name: '验证', hint: '模拟面试检验', cls: 'ai' },
  ritual: { name: '复盘', hint: '结束本轮 epoch', cls: '' },
  custom: { name: '自定', hint: '你自己添加的任务', cls: '' },
};

export const microGain = (h) => +(0.04 + 0.035 * h).toFixed(3);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const half = (v) => Math.round(v * 2) / 2;

export function mondayOf(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}
/** 今天是本 batch 周的第几天（0=周一；<0 未开始；>6 已过期）。 */
export const dayIndex = (batch, now = Date.now()) => Math.floor((now - batch.weekStart) / DAY);
export const dayDate = (batch, d) => new Date(batch.weekStart + d * DAY);

export function batchStats(batch) {
  const tasks = batch?.tasks || [];
  const done = tasks.filter((t) => t.done);
  return {
    total: tasks.length,
    done: done.length,
    hours: done.reduce((a, t) => a + (+t.hours || 0), 0),
    planned: tasks.reduce((a, t) => a + (+t.hours || 0), 0),
    rate: tasks.length ? done.length / tasks.length : 0,
  };
}

function pickMicro(skill, level, used) {
  const pool = MICRO_TASKS.filter((x) => x.skill === skill && !used.has(x.id));
  if (!pool.length) return null;
  const fit = pool.filter((x) => level >= x.lv[0] - 0.25 && level <= x.lv[1]);
  const list = fit.length ? fit : pool;
  // 选“略高于当前水平”的任务：区间中心最接近 level + 0.3
  return list.sort((a, b) => Math.abs((a.lv[0] + a.lv[1]) / 2 - level - 0.3) - Math.abs((b.lv[0] + b.lv[1]) / 2 - level - 0.3))[0];
}

/** 生成一周的 batch。会消费 state.batchQueue 中属于这一周的预排任务（需在 store.update 中调用）。 */
export function generateBatch(state, { carry = [], now = Date.now(), weekStart } = {}) {
  const wd = (new Date(now).getDay() + 6) % 7;
  const ws = weekStart ?? (wd >= 5 ? mondayOf(now) + 7 * DAY : mondayOf(now)); // 周末生成 → 规划下一周
  const firstDay = clamp(Math.floor((now - ws) / DAY), 0, 6);
  // 自适应 batch：工作量预算 = 每周可投入 × Adam 按历史完成率算出的系数
  const adapt = M.adaptiveBatch(state);
  const budget = adapt.hours;
  // 梯度与微任务难度按“验证集校准后”的能力向量来定：面试暴露的短板优先
  const S = M.planningSkills(state, M.skillsAt(state, now));
  const role = M.roleById(state, state.target);
  const tasks = [];
  let used = 0;
  const add = (t) => {
    tasks.push({ id: uid('b'), done: false, doneAt: null, day: null, gain: 0, resource: '', criteria: '', ...t });
    used += t.hours;
  };

  // 1) 梯度累积：上一轮没做完的（最多 3 条）
  for (const t of carry.slice(0, 3)) add({ ...t, id: uid('b'), done: false, doneAt: null, day: null, carried: (t.carried || 0) + 1 });

  // 1.5) 预排任务：Adam 提前排到这一周（或更早、但没来得及进入 batch）的任务，取出后从队列移除
  const queued = (state.batchQueue || []).filter((q) => q.weekStart <= ws);
  for (const { weekStart: _, ...q } of queued) add({ ...q, id: uid('b'), day: q.weekStart === ws ? q.day : null });
  if (queued.length) state.batchQueue = state.batchQueue.filter((q) => q.weekStart > ws);
  // 预排已占满大半预算：这一周 Adam 已经排好了，只补实验 checkpoint、验证与复盘
  const prefilled = used >= budget * 0.6;

  // 2) 实验：进行中实验的下一个 checkpoint
  for (const run of (state.runs || []).filter((r) => r.status === 'running')) {
    const mi = run.milestones.findIndex((m) => !m.done);
    if (mi < 0 || tasks.some((t) => t.src === 'run' && t.ref?.run === run.id)) continue;
    const top = Object.entries(run.skills || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || 'code';
    add({
      src: 'run', ref: { run: run.id, m: mi }, skill: top,
      hours: clamp(half(((run.weeks || 3) * 6) / run.milestones.length), 1.5, 4),
      title: `实验「${run.title}」：完成 checkpoint ${mi + 1}「${run.milestones[mi].text}」`,
      criteria: '勾选该里程碑，并在实验笔记中写下结果、数据与遇到的问题',
      resource: (run.stack || []).join(' / '),
    });
    break;
  }

  // 3) 计划：当前阶段未完成任务，切成 ≤ 3 小时的一段
  const pending = (state.plan?.phases || []).flatMap((ph) => ph.tasks.filter((t) => !t.done));
  for (const t of prefilled ? [] : pending.slice(0, budget >= 16 ? 2 : 1)) {
    if (used >= budget * 0.5 || tasks.some((x) => x.src === 'plan' && x.ref?.task === t.id)) continue;
    const total = +t.hours || 6;
    const n = Math.max(1, Math.ceil(total / 3));
    const done = +t.progressH || 0;
    const k = Math.min(n, Math.floor(done / 3) + 1);
    const chunk = clamp(half(Math.min(3, total - done)), 0.5, 3);
    add({
      src: 'plan', ref: { task: t.id }, skill: t.skill, hours: chunk,
      title: n > 1 ? `${t.title} · 第 ${k}/${n} 段` : t.title,
      criteria: k >= n ? `完成并交付：${t.deliverable || '可展示的产出'}` : `推进到 ${k}/${n}，留下可检查的中间产物（代码提交 / 笔记），最终交付「${t.deliverable || '产出'}」`,
      resource: t.resource || '',
    });
  }

  // 4) 课程：本学期与目标最相关的一门培养方案课程
  const plan = P.userPlan(state);
  if (plan && !prefilled) {
    const cur = P.countedCourses(state, plan).filter((c) => P.semStatus(plan, c.s, now) === 'now');
    const score = (c) => Object.entries(c.sk).reduce((a, [k, v]) => a + v * (role ? (role.req[k] || 0) + 0.5 : 1), 0);
    const c = cur.sort((a, b) => score(b) - score(a))[0];
    if (c) {
      const sk = P.primarySkill(c);
      add({
        src: 'course', ref: { course: c.c }, skill: sk, hours: 2, gain: +(microGain(2) / 2).toFixed(3),
        title: `《${c.n}》：复习本周课堂内容，完成作业 / 实验，整理 1 页笔记`,
        criteria: '作业按时提交；笔记写清本周 3 个核心概念及其联系', resource: '课程讲义与教材',
      });
    }
  }

  // 5) 梯度：按 loss 下降最大的能力挑微任务，轮流填充到预算
  const order = role ? M.gradient(S, role).map((g) => g.id) : [...SKILLS].sort((a, b) => S[a.id] - S[b.id]).map((s) => s.id);
  const usedMicro = new Set([...(state.microHistory || []), ...tasks.map((t) => t.ref?.micro).filter(Boolean)]);
  let guard = 0;
  const nGrad = () => tasks.filter((t) => t.src === 'grad').length;
  while (!prefilled && order.length && nGrad() < 5 && guard++ < 20) {
    const sk = order[(guard - 1) % Math.min(order.length, 3)];
    const mt = pickMicro(sk, S[sk], usedMicro);
    if (!mt) continue;
    if (nGrad() >= 2 && used + mt.h > budget + 0.5) break; // 至少 2 条梯度微任务，其余不超预算
    usedMicro.add(mt.id);
    add({ src: 'grad', ref: { micro: mt.id }, skill: sk, hours: mt.h, gain: microGain(mt.h), title: mt.t, criteria: mt.c, resource: mt.r });
  }
  if (!prefilled && !tasks.some((t) => t.src === 'grad') && order[0]) {
    add({ src: 'grad', skill: order[0], hours: 1.5, gain: microGain(1.5), title: `专项练习：${SKILL[order[0]].name}`, criteria: '留下一份可检查的笔记或代码', resource: RESOURCES[order[0]][0] });
  }

  // 6) 验证：两周没做模拟面试 → 一场 20 分钟的验证
  const lastIv = (state.interviews || []).filter((i) => i.report).at(-1);
  if (role && M.fitOf(M.lossOf(S, role)) > 0.35 && (!lastIv || now - lastIv.t > 14 * DAY)) {
    add({ src: 'val', skill: 'comm', hours: 0.5, gain: 0.03, title: `完成 1 场「${role.name}」模拟面试（5 题），复盘得分最低的一题`, criteria: '验证集记录中出现本次成绩', resource: 'Epoch · 验证集' });
  }

  // 6.5) 难例挖掘：错题本里本周到期的题 ≥ 2 道 → 一次 20 分钟的错题复测
  const dueN = T.dueHard(state, now, 6 * DAY).length;
  if (dueN >= 2) {
    add({ src: 'val', ref: { hard: true }, skill: 'comm', hours: 0.5, gain: 0.03, title: `错题复测：重答错题本里 ${Math.min(dueN, 5)} 道到期的面试题`, criteria: '每题复测得分 ≥ 7，或写下仍卡住的点', resource: 'Epoch · 验证集 → 错题复测' });
  }

  // 7) 仪式：周日结束 epoch
  add({ src: 'ritual', skill: 'comm', hours: 0.25, title: '结束本轮 Epoch：复盘本周、生成下一个 batch', criteria: '提交本轮复盘', resource: 'Epoch · 结束本轮 Epoch' });

  schedule(tasks, firstDay, budget);
  return { id: uid('batch'), epoch: M.epochInfo(state).epoch, weekStart: ws, createdAt: now, budget, adapt: adapt.on && adapt.rates.length ? { factor: +adapt.factor.toFixed(2), base: adapt.budget } : null, ai: false, tasks };
}

/** 排期：复盘固定周日，其余按“负载 / 容量”贪心分配（周末容量更大），已有 day 的保留。 */
export function schedule(tasks, firstDay = 0, budget = 10) {
  const days = [];
  for (let d = firstDay; d <= 6; d++) days.push(d);
  const cap = (d) => (d === 5 ? 1.5 : d === 6 ? 1.1 : 1);
  const load = Object.fromEntries(days.map((d) => [d, 0]));
  for (const t of tasks) if (t.day != null && t.day >= firstDay) load[t.day] += t.hours;
  for (const t of tasks) {
    if (t.day != null && t.day >= firstDay) continue;
    if (t.src === 'ritual') { t.day = 6; continue; }
    const pool = t.src === 'val' ? days.filter((d) => d <= 4) : days;
    const cand = (pool.length ? pool : days).filter((d) => d !== 6 || days.length <= 2 || load[d] + t.hours <= budget * 0.2);
    t.day = (cand.length ? cand : days).reduce((best, d) => (load[d] / cap(d) < load[best] / cap(best) ? d : best));
    load[t.day] += t.hours;
  }
  tasks.sort((a, b) => a.day - b.day);
  return tasks;
}

/** 勾选 / 取消任务（在 store.update 中调用）。返回反馈文案。 */
export function toggleTask(st, id, now = Date.now()) {
  const t = st.batch?.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.done = !t.done;
  t.doneAt = t.done ? now : null;
  let note = '';
  if (t.ref?.micro && t.done) st.microHistory = [...new Set([...(st.microHistory || []), t.ref.micro])].slice(-80);
  if (t.src === 'plan' && t.ref?.task) {
    const pt = (st.plan?.phases || []).flatMap((ph) => ph.tasks).find((x) => x.id === t.ref.task);
    if (pt) {
      pt.progressH = Math.max(0, (+pt.progressH || 0) + (t.done ? t.hours : -t.hours));
      if (pt.progressH >= (+pt.hours || 0) - 0.01 && !pt.done) { pt.done = true; pt.doneAt = now; pt.viaBatch = true; note = `计划任务「${pt.title}」已完成`; }
      else if (pt.done && pt.viaBatch && pt.progressH < (+pt.hours || 0) - 0.01) { pt.done = false; pt.doneAt = null; }
      if (!note && t.done) note = `「${pt.title}」进度 ${half(pt.progressH)}/${pt.hours}h`;
    }
  }
  if (t.src === 'run' && t.ref?.run) {
    const run = (st.runs || []).find((r) => r.id === t.ref.run);
    const m = run?.milestones[t.ref.m];
    if (m) {
      if (t.done && !m.done) { m.done = true; m.doneAt = now; m.viaBatch = true; note = `checkpoint ${t.ref.m + 1} 已完成`; }
      else if (!t.done && m.viaBatch) { m.done = false; m.doneAt = null; }
    }
  }
  return { task: t, note };
}

/** 结束本轮：完成的任务入日志，未完成的按选择顺延（梯度累积），生成下一个 batch。 */
export function rollover(st, carryIds = [], now = Date.now()) {
  const stats = batchStats(st.batch);
  const done = (st.batch?.tasks || []).filter((t) => t.done);
  st.batchLog = [...(st.batchLog || []), ...done.map(({ id, skill, gain, hours, doneAt, src, title }) => ({ id, skill, gain, hours, doneAt, src, title }))].slice(-400);
  const carry = (st.batch?.tasks || []).filter((t) => !t.done && carryIds.includes(t.id) && t.src !== 'ritual' && t.src !== 'val');
  // 计划 / 实验类任务不直接顺延：重新生成时会按最新进度重新切片
  const carryPlain = carry.filter((t) => !['plan', 'run', 'course'].includes(t.src));
  st.batch = generateBatch(st, { carry: carryPlain, now });
  return stats;
}
