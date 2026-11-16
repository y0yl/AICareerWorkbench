// 培养方案 = 预训练语料。学期日历、计入能力的课程、建档预估、AI 上下文。
// 注意：本模块不依赖 model.js（model.js 会引用这里的 curriculumEvents）。
import { CURRICULA } from './curricula.data.js';
import { SKILL, SKILL_IDS } from './data.js';

export const PLANS = CURRICULA;
export const planById = (id) => CURRICULA.find((p) => p.id === id) || null;
export const userPlan = (state) => planById(state?.curriculum?.planId);

const YEARS = ['大一', '大二', '大三', '大四', '大五'];
export const semLabel = (s) => (s ? `${YEARS[Math.ceil(s / 2) - 1]}${s % 2 ? '秋' : '春'}` : '学期不定');

/** 学期起止（近似校历）：秋季 9/1–次年 1/15，春季 2/24–7/10。 */
export function semRange(plan, s) {
  const y = plan.grade + Math.floor((s - 1) / 2);
  return s % 2
    ? [new Date(y, 8, 1).getTime(), new Date(y + 1, 0, 15, 23, 59).getTime()]
    : [new Date(y + 1, 1, 24).getTime(), new Date(y + 1, 6, 10, 23, 59).getTime()];
}
export function semStatus(plan, s, now = Date.now()) {
  const [a, b] = semRange(plan, s);
  return now > b ? 'done' : now >= a ? 'now' : 'future';
}
/** 当前所处（或即将开始）的学期 1–8；毕业后为 9。 */
export function currentSem(plan, now = Date.now()) {
  for (let s = 1; s <= 8; s++) if (now <= semRange(plan, s)[1]) return s;
  return 9;
}
export const gradeFromPlan = (plan, now = Date.now()) => YEARS[Math.min(4, Math.ceil(Math.min(currentSem(plan, now), 8) / 2)) - 1];

/** 计入能力的课程：必修（未标记“未修”）+ 已选的选修。 */
export function countedCourses(state, plan = userPlan(state)) {
  if (!plan) return [];
  const cur = state.curriculum || {};
  const skip = new Set(cur.skip || []);
  const elec = new Set(cur.electives || []);
  return plan.courses.filter((c) => c.s && (c.k === 'req' ? !skip.has(c.c) : elec.has(c.c)));
}

/**
 * 成绩 → 课程增益系数：60 分 ×0.6，80 分 ×0.9，90 分 ×1.05，100 分 ×1.2。没有成绩时按 ×1。
 * 同一门课，学得好的人从中获得的能力确实更多——成绩单让“预训练”因人而异。
 */
export const gradeFactor = (score) => (score == null || !Number.isFinite(+score) ? 1 : Math.max(0.5, Math.min(1.2, 0.6 + (+score - 60) * 0.015)));
const scaled = (sk, f) => (f === 1 ? sk : Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, +(v * f).toFixed(3)])));
export const courseGain = (state, c) => scaled(c.sk, gradeFactor(state?.curriculum?.grades?.[c.c]));

/** 课程名归一化（成绩单匹配用）：去空格、括号内容与标点，罗马数字 → 阿拉伯数字。 */
export function normCourse(n) {
  return String(n || '').replace(/[（(][^）)]*[）)]/g, '').replace(/[ⅠⅡⅢⅣ]/g, (c) => ({ 'Ⅰ': '1', 'Ⅱ': '2', 'Ⅲ': '3', 'Ⅳ': '4' }[c])).replace(/[\s·・\-—_:：，,、.。《》"“”]/g, '').replace(/[ⅰ]/g, '1').toLowerCase();
}
/** 把识别出的课程匹配到培养方案中的课程：完全一致优先，其次互相包含（较长者至少 4 个字）。 */
export function matchCourses(plan, rows) {
  const pool = plan.courses.map((c) => ({ c, k: normCourse(c.n) }));
  return rows.map((r) => {
    const k = normCourse(r.name);
    const hit = pool.find((p) => p.k === k) || (k.length >= 3 ? pool.find((p) => p.k.length >= 3 && (p.k.includes(k) || k.includes(p.k)) && Math.max(p.k.length, k.length) >= 4) : null);
    return { ...r, code: hit?.c.c || null, course: hit?.c || null };
  });
}

/**
 * 培养方案带来的增益事件：在学期结束时计入。
 * 只计入“设定方案之后”才结束的学期——之前修完的课已体现在初始权重里，避免重复计算。
 */
export function curriculumEvents(state) {
  const plan = userPlan(state);
  if (!plan) return [];
  const since = state.curriculum.since || 0;
  return countedCourses(state, plan)
    .map((c) => ({ t: semRange(plan, c.s)[1], skills: courseGain(state, c), hours: 0, kind: 'curriculum', ref: c }))
    .filter((e) => e.t > since);
}

/** 按已修完的必修课预估初始权重（入学水平 entry 起步）。 */
export function estimateBase(plan, now = Date.now(), entry = 0.5, grades = null) {
  const G = {};
  let n = 0;
  for (const c of plan.courses) {
    if (c.k !== 'req' || !c.s || semStatus(plan, c.s, now) !== 'done') continue;
    n++;
    const f = gradeFactor(grades?.[c.c]);
    for (const [k, v] of Object.entries(c.sk)) G[k] = (G[k] || 0) + v * f;
  }
  const base = {};
  for (const id of SKILL_IDS) base[id] = Math.round((entry + (5 - entry) * (1 - Math.exp(-(G[id] || 0) / 2.5))) * 2) / 2;
  return { base, n };
}

/** 未来会计入、且覆盖某项能力的课程（按学期排序）。 */
export function upcomingFor(state, skillId, now = Date.now()) {
  const plan = userPlan(state);
  if (!plan) return [];
  return countedCourses(state, plan)
    .filter((c) => (c.sk[skillId] || 0) >= 0.15 && semStatus(plan, c.s, now) !== 'done')
    .sort((a, b) => a.s - b.s || b.sk[skillId] - a.sk[skillId]);
}

export const primarySkill = (c) => Object.entries(c.sk).sort((a, b) => b[1] - a[1])[0][0];
export const courseGroup = (c) => SKILL[primarySkill(c)].group;

/** 给 AI 的培养方案上下文。 */
export function curriculumContext(state, now = Date.now()) {
  const plan = userPlan(state);
  if (!plan) return '';
  const cs = currentSem(plan, now);
  const counted = countedCourses(state, plan);
  const names = (list, n) => list.slice(0, n).map((c) => c.n).join('、');
  const done = counted.filter((c) => semStatus(plan, c.s, now) === 'done');
  const cur = counted.filter((c) => semStatus(plan, c.s, now) === 'now');
  const next = counted.filter((c) => semStatus(plan, c.s, now) === 'future');
  const lines = [`培养方案：${plan.school} ${plan.title}（${plan.college}），当前${cs > 8 ? '已完成全部学期' : `第 ${cs} 学期（${semLabel(cs)}）`}`];
  if (done.length) lines.push(`已修 AI 相关课程：${names(done, 16)}`);
  if (cur.length) lines.push(`本学期课程：${names(cur, 12)}`);
  const grades = state.curriculum?.grades || {};
  const graded = plan.courses.filter((c) => grades[c.c] != null).sort((a, b) => grades[b.c] - grades[a.c]);
  if (graded.length) lines.push(`成绩（成绩单识别，已用于缩放课程增益）：${graded.slice(0, 5).map((c) => `${c.n} ${grades[c.c]}`).join('、')}${graded.length > 5 ? `；偏低：${graded.slice(-3).map((c) => `${c.n} ${grades[c.c]}`).join('、')}` : ''}`);
  if (next.length) lines.push(`后续课程：${next.slice(0, 14).map((c) => `${c.n}（${semLabel(c.s)}）`).join('、')}`);
  return lines.join('\n');
}
