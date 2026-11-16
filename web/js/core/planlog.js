// 路径变更日志：像 git log 一样记录每一次“重排”——谁改的、为什么、改了什么。
// 树形图设计者的核心价值是不断重新规划；这里让每一次删减、缩小、改期、换方向都留下可追溯的记录。
import { uid } from './store.js';

const MAX = 150;
/** + 新增 · − 删除 · ~ 调整（工时 / 日期）· → 顺延 */
export const OPS = { '+': 'add', '-': 'del', '~': 'mod', '>': 'carry' };
export const AUTHORS = { ai: '树形图设计者', user: '你', system: 'Epoch' };

/**
 * 记一条变更（在 store.update 的 mutator 里调用）。
 * key：同一个 key 在 10 分钟内的连续操作合并为一条（例如连续点“推后一天”）。
 */
export function logChange(st, { by = 'user', kind = 'plan', title, reason = '', diff = [], key = null, merge = null, meta = null }) {
  const lines = diff.filter((d) => d && d.text).slice(0, 14).map((d) => ({ op: OPS[d.op] ? d.op : '~', text: String(d.text).slice(0, 120) }));
  if (!title || (!lines.length && !reason)) return null;
  const log = st.planLog || [];
  const last = log[0];
  if (key && last?.key === key && Date.now() - last.t < 10 * 60000) {
    const next = merge ? merge(last) : null;
    const entry = { ...last, ...(next || { title, reason, diff: lines }), t: Date.now() };
    if (next?.diff) entry.diff = next.diff.slice(0, 14);
    st.planLog = [entry, ...log.slice(1)];
    return entry;
  }
  const entry = { id: uid('c'), t: Date.now(), by, kind, title: String(title).slice(0, 80), reason: String(reason || '').slice(0, 160), diff: lines, ...(key ? { key } : {}), ...(meta ? { meta } : {}) };
  st.planLog = [entry, ...log].slice(0, MAX);
  return entry;
}

/** 7 位“提交号”（FNV-1a）。 */
export function shortHash(entry) {
  let h = 0x811c9dc5;
  const str = String(entry.id);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0').slice(0, 7);
}

/** 汇总：被重排了多少次、各类改动多少处。只统计“改变已有路径”的提交（新生成 batch 不算重排）。 */
export function logStats(log = []) {
  const s = { commits: 0, ai: 0, user: 0, add: 0, del: 0, mod: 0, carry: 0 };
  for (const e of log) {
    if (e.kind === 'epoch') { s.carry += e.diff.filter((d) => d.op === '>').length; continue; }
    s.commits++;
    if (e.by === 'ai') s.ai++; else if (e.by === 'user') s.user++;
    for (const d of e.diff) s[OPS[d.op]]++;
  }
  return s;
}

/** 给 AI 的上下文：最近几次路径调整。 */
export function logContext(log = [], n = 4) {
  const recent = log.filter((e) => e.kind !== 'epoch').slice(0, n);
  if (!recent.length) return '';
  const day = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
  return '最近的路径调整：' + recent.map((e) => `${day(e.t)} ${AUTHORS[e.by] || ''}「${e.title}」${e.reason ? `（${e.reason.slice(0, 40)}）` : ''}`).join('；');
}
