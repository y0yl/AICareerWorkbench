// 树形图设计者的“操作块”：导师在回复末尾附带 ```epoch-action JSON```，前端解析成可一键执行的卡片，
// 由用户确认后写入训练计划 / 本周 batch。AI 只能提出这里白名单内的操作，字段全部校验、截断。
import { store, uid } from './store.js';
import { SKILL, ENTRY_TYPE } from './data.js';
import * as M from './model.js';
import * as B from './batch.js';
import { logChange } from './planlog.js';

const FENCE = /```epoch-action\s*\n?([\s\S]*?)(?:```|$)/g;
const STAGES = ['warmup', 'train', 'finetune'];
const STAGE_CN = { warmup: '预热', train: '主训练', finetune: '微调' };
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, d, a, b) => Math.max(a, Math.min(b, Number.isFinite(+v) && +v > 0 ? +v : d));
const dayOf = (v) => {
  if (Number.isInteger(+v) && +v >= 0 && +v <= 6) return +v;
  const i = B.WEEKDAYS.indexOf(String(v || '').replace('星期', '周').replace('周天', '周日'));
  return i >= 0 ? i : null;
};

function fallbackSkill(s) {
  const role = M.roleById(s, s.target);
  return role ? M.gradient(M.skillsAt(s), role)[0]?.id || 'dl' : 'dl';
}

function planTask(t, fb) {
  const title = str(t?.title, 60);
  if (!title) return null;
  return {
    id: uid('t'), title, skill: SKILL[t.skill] ? t.skill : fb,
    hours: Math.round(num(t.hours, 8, 1, 80)), resource: str(t.resource, 80),
    deliverable: str(t.deliverable, 60), done: false, doneAt: null,
  };
}

/** 能力增益表：只留合法维度，限幅，最多 n 个。 */
function gains(obj, lo, hi, n) {
  return Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => SKILL[k] && +v > 0).slice(0, n).map(([k, v]) => [k, +Math.min(hi, Math.max(lo, +v)).toFixed(2)]));
}

/** 记忆类操作自动保存，不需要用户点“执行”。 */
export const AUTO = new Set(['remember']);

/** 把一条原始操作规范化；无效返回 null。 */
function normalize(a, s) {
  const fb = fallbackSkill(s);
  if (a?.type === 'create_plan') {
    const phases = (a.phases || []).slice(0, 4).map((p, i) => ({
      id: uid('ph'),
      stage: STAGES.includes(p.stage) ? p.stage : STAGES[Math.min(i, 2)],
      name: str(p.name, 30) || STAGE_CN[STAGES[Math.min(i, 2)]],
      weeks: Math.round(num(p.weeks, 4, 1, 52)),
      goal: str(p.goal, 80),
      tasks: (p.tasks || []).slice(0, 6).map((t) => planTask(t, fb)).filter(Boolean),
    })).filter((p) => p.tasks.length);
    return phases.length ? { type: 'create_plan', summary: str(a.summary, 200), phases } : null;
  }
  if (a?.type === 'add_plan_tasks') {
    const tasks = (a.tasks || []).slice(0, 8).map((t) => planTask(t, fb)).filter(Boolean);
    return tasks.length ? { type: 'add_plan_tasks', phase: str(a.phase, 30), tasks } : null;
  }
  if (a?.type === 'add_batch_tasks') {
    const tasks = (a.tasks || []).slice(0, 8).map((t) => {
      // 计划编号只该出现在 plan 字段，从标题里去掉（“（P7 首个模块）”→“（首个模块）”）
      const title = str(String(t?.title ?? '').replace(/\s*\bP\d+\b\s*/g, ' ').replace(/[（(]\s*[)）]/g, '').replace(/([（(])\s+|\s+([)）])/g, '$1$2').replace(/\s{2,}/g, ' '), 60);
      // “结束本轮 Epoch”由系统自动安排在周日，不重复添加
      if (!title || /结束本轮\s*epoch/i.test(title)) return null;
      const hours = Math.round(num(t.hours, 1.5, 0.5, 8) * 2) / 2;
      const wk = String(t.week ?? a.week ?? '');
      const week = /next|下/.test(wk) ? 'next' : /this|本/.test(wk) ? 'this' : null;
      // 引用长期计划任务（P3）：完成后累计到该计划任务的进度，而不是另算一份增益
      const pt = M.planTaskByRef(s, t.plan);
      const plan = pt && !pt.done ? { task: pt.id, title: pt.title } : null;
      return { title, skill: plan ? pt.skill : SKILL[t.skill] ? t.skill : fb, hours, day: dayOf(t.day), week, plan, criteria: str(t.criteria, 60), resource: str(t.resource, 60) };
    }).filter(Boolean);
    return tasks.length ? { type: 'add_batch_tasks', tasks } : null;
  }
  if (a?.type === 'log_entry') {
    const title = str(a.title, 40);
    const skills = gains(a.skills, 0.05, 0.9, 4);
    if (!title) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || '')) && new Date(`${a.date}T00:00:00`).getTime() <= Date.now() ? a.date : M.today();
    return { type: 'log_entry', title, kind: ENTRY_TYPE[a.kind ?? a.entryType] ? (a.kind ?? a.entryType) : 'other', date, hours: Math.round(num(a.hours, 4, 0.5, 400)), summary: str(a.summary, 80), skills };
  }
  if (a?.type === 'start_run') {
    const title = str(a.title, 40);
    const milestones = (a.milestones || []).slice(0, 6).map((m) => str(typeof m === 'string' ? m : m?.text, 50)).filter(Boolean);
    if (!title || milestones.length < 2) return null;
    return { type: 'start_run', title, weeks: Math.round(num(a.weeks, 3, 1, 26)), level: Math.round(num(a.level, 2, 1, 3)), skills: gains(a.skills, 0.1, 0.8, 4), milestones, stack: (a.stack || []).slice(0, 6).map((x) => str(x, 20)).filter(Boolean) };
  }
  if (a?.type === 'set_target') {
    const key = str(a.role ?? a.id, 40);
    const role = M.roleById(s, key) || M.allRoles(s).find((r) => r.name === key || r.name.includes(key) || (key.length >= 3 && key.includes(r.name)));
    return role && role.id !== s.target ? { type: 'set_target', role: role.id, name: role.name } : null;
  }
  if (a?.type === 'remember') {
    const have = new Set((s.memory || []).map((m) => m.text));
    const facts = (Array.isArray(a.facts) ? a.facts : [a.fact ?? a.text]).map((f) => str(f, 60)).filter((f) => f.length >= 4 && !have.has(f)).slice(0, 4);
    return facts.length ? { type: 'remember', facts } : null;
  }
  if (a?.type === 'adjust_tasks') {
    const changes = (a.changes || []).slice(0, 12).map((c) => resolveChange(c, s)).filter(Boolean);
    return changes.length ? { type: 'adjust_tasks', reason: str(a.reason, 80), changes } : null;
  }
  return null;
}

/** 调整类操作：把 P#/B# 引用解析成任务 id；已完成的任务、周日复盘不可调整。 */
function resolveChange(c, s) {
  const op = ['remove', 'move', 'resize'].includes(c?.op) ? c.op : null;
  const ref = String(c?.ref || '').trim().toUpperCase();
  if (!op) return null;
  if (ref.startsWith('P')) {
    const t = M.planTaskByRef(s, ref);
    if (!t || t.done || op === 'move') return null;
    return op === 'remove' ? { op, kind: 'plan', id: t.id, title: t.title }
      : { op, kind: 'plan', id: t.id, title: t.title, from: +t.hours || 0, hours: Math.round(num(c.hours, t.hours, Math.max(1, Math.ceil(+t.progressH || 0)), 80)) };
  }
  const m = /^B(\d+)$/.exec(ref);
  const t = m && s.batch?.tasks[+m[1] - 1];
  if (!t || t.done || t.src === 'ritual') return null;
  if (op === 'remove') return { op, kind: 'batch', id: t.id, title: t.title };
  if (op === 'resize') return { op, kind: 'batch', id: t.id, title: t.title, from: t.hours, hours: Math.round(num(c.hours, t.hours, 0.5, 8) * 2) / 2 };
  const wk = String(c.week ?? '');
  const day = dayOf(c.day);
  if (day == null && !/next|下/.test(wk)) return null;
  return { op, kind: 'batch', id: t.id, title: t.title, from: t.day, day: day ?? 0, week: /next|下/.test(wk) ? 'next' : null };
}

/** 从回复中拆出正文与操作；未闭合（仍在流式输出）的操作块从正文中隐藏，pending=true。 */
export function extractActions(text, s = store.state) {
  const actions = [];
  let pending = false;
  const body = String(text || '').replace(FENCE, (whole, json) => {
    if (!whole.trimEnd().endsWith('```')) { pending = true; return ''; }
    try {
      const raw = JSON.parse(json.trim());
      for (const a of Array.isArray(raw) ? raw : raw.actions || [raw]) {
        const n = normalize(a, s);
        if (n) actions.push(n);
      }
    } catch { /* 格式错误的块直接丢弃 */ }
    return '';
  })
    // 流式输出中刚露出半截的围栏（```epoch-ac…）也先隐藏
    .replace(/(^|\n)(`{1,3}(e[a-z-]*)?)$/, (m, nl, f) => ('```epoch-action'.startsWith(f) ? nl : m))
    .replace(/\n{3,}/g, '\n\n').trim();
  return { body, actions, pending };
}

/** 操作的人类可读说明：{ title, items: [文本] } */
export function describe(a, s = store.state) {
  const h = (t) => `${t.hours}h`;
  if (a.type === 'create_plan') {
    const n = a.phases.reduce((x, p) => x + p.tasks.length, 0);
    return {
      title: `${s.plan ? '替换' : '创建'}长期训练计划 · ${a.phases.length} 个阶段 / ${n} 个任务`,
      items: a.phases.map((p) => `${p.name}（${p.weeks} 周）：${p.tasks.map((t) => t.title).join('、')}`),
    };
  }
  if (a.type === 'add_plan_tasks') {
    return {
      title: s.plan ? `向训练计划「${findPhase(s.plan, a.phase).name}」添加 ${a.tasks.length} 个任务` : `新建训练计划并添加 ${a.tasks.length} 个任务`,
      items: a.tasks.map((t) => `${t.title} · ${SKILL[t.skill]?.name || t.skill} · ${h(t)}`),
    };
  }
  const gl = (g) => Object.entries(g || {}).map(([k, v]) => `${SKILL[k]?.name || k} +${v}`).join('、');
  if (a.type === 'log_entry') {
    return { title: `记录训练样本：${a.title}`, items: [`${ENTRY_TYPE[a.kind]?.name || '其他'} · ${a.date} · 约 ${a.hours}h`, ...(a.summary ? [a.summary] : []), `能力增益：${gl(a.skills) || '（无）'}`] };
  }
  if (a.type === 'start_run') {
    return { title: `开始实验：${a.title}（${a.weeks} 周）`, items: [...a.milestones.map((m, i) => `checkpoint ${i + 1}：${m}`), ...(Object.keys(a.skills).length ? [`完成后增益：${gl(a.skills)}`] : [])] };
  }
  if (a.type === 'set_target') {
    const cur = M.roleById(s, s.target);
    return { title: `切换目标函数 → ${a.name}`, items: [`${cur ? cur.name : '未设定'} → ${a.name}`, '梯度、batch 与地形图会按新目标重算；历史数据全部保留'] };
  }
  if (a.type === 'remember') return { title: '记住', items: a.facts };
  if (a.type === 'adjust_tasks') {
    const n = (op) => a.changes.filter((c) => c.op === op).length;
    const head = [n('remove') && `删减 ${n('remove')}`, n('move') && `改期 ${n('move')}`, n('resize') && `调整工时 ${n('resize')}`].filter(Boolean).join(' · ');
    return {
      title: `调整路径：${head}${a.reason ? `（${a.reason}）` : ''}`,
      items: a.changes.map((c) => {
        const where = c.kind === 'plan' ? '长期计划' : '本周';
        if (c.op === 'remove') return `删除${where}任务「${c.title}」`;
        if (c.op === 'resize') return `「${c.title}」${c.from}h → ${c.hours}h`;
        const p = placeBatchTask({ day: c.day, week: c.week || 'this' }, s);
        return `「${c.title}」${B.WEEKDAYS[c.from] || ''} → ${p.next ? '下' : ''}${B.WEEKDAYS[p.day]}`;
      }),
    };
  }
  const places = a.tasks.map((t) => placeBatchTask(t, s));
  const nNext = places.filter((p) => p.next).length;
  const nThis = places.length - nNext;
  return {
    title: !nNext ? `向本周 batch 添加 ${nThis} 个任务` : !nThis ? `预排下周 ${nNext} 个任务` : `添加任务：本周 ${nThis} 个 · 下周 ${nNext} 个`,
    items: a.tasks.map((t, i) => {
      const p = places[i];
      const date = new Date(p.weekStart + p.day * B.DAY);
      return `${p.next ? '下' : ''}${B.WEEKDAYS[p.day]} ${date.getMonth() + 1}/${date.getDate()} · ${t.title} · ${h(t)}${t.plan ? ` · 推进计划「${t.plan.title}」` : ''}`;
    }),
  };
}

/**
 * 决定一条周任务放在哪：本周 batch 的某天，还是预排到下周（进入 batchQueue，生成下周 batch 时取出）。
 * “本周”指当前 batch 覆盖的那一周；batch 已过期时指日历上的这一周。
 * 没写 week、但 day 早于今天的，按下周处理——而不是挤到今天。
 */
export function placeBatchTask(t, s = store.state, now = Date.now()) {
  const b = s?.batch;
  const stale = !b || B.dayIndex(b, now) > 6;
  const base = stale ? B.mondayOf(now) : b.weekStart;
  const today = Math.max(0, Math.min(6, Math.floor((now - base) / B.DAY)));
  const next = t.week === 'next' || (t.week !== 'this' && t.day != null && t.day < today);
  if (next) return { queue: true, next: true, weekStart: base + B.WEEK, day: t.day ?? 0 };
  return { queue: stale, next: false, weekStart: base, day: Math.max(today, t.day ?? today) };
}

function findPhase(plan, key) {
  if (!key) return plan.phases.find((p) => p.tasks.some((t) => !t.done)) || plan.phases.at(-1);
  return plan.phases.find((p) => p.stage === key || p.name === key)
    || plan.phases.find((p) => p.name.includes(key) || key.includes(p.name) || STAGE_CN[p.stage] === key)
    || plan.phases.find((p) => p.tasks.some((t) => !t.done)) || plan.phases.at(-1);
}

/** 变更日志里的一条：操作说明 + 逐行 diff。 */
function commitOf(a, s, note) {
  const d = describe(a, s);
  let diff;
  if (a.type === 'create_plan') {
    const pending = (s.plan?.phases || []).flatMap((p) => p.tasks.filter((t) => !t.done));
    diff = [...(pending.length ? [{ op: '-', text: `旧计划中 ${pending.length} 个未完成任务：${pending.slice(0, 4).map((t) => t.title).join('、')}${pending.length > 4 ? '…' : ''}` }] : []), ...d.items.map((text) => ({ op: '+', text }))];
  } else if (a.type === 'adjust_tasks') {
    diff = d.items.map((text, i) => ({ op: a.changes[i].op === 'remove' ? '-' : '~', text }));
  } else if (a.type === 'set_target') {
    diff = [{ op: '~', text: d.items[0] }];
  } else diff = d.items.map((text) => ({ op: '+', text }));
  const reason = a.type === 'adjust_tasks' ? a.reason : a.type === 'create_plan' ? a.summary : '';
  // 理由单独成行，标题里就不再重复
  const title = a.type === 'adjust_tasks' && a.reason ? d.title.replace(`（${a.reason}）`, '') : d.title;
  return { by: 'ai', kind: a.type === 'add_batch_tasks' || (a.type === 'adjust_tasks' && a.changes.every((c) => c.kind === 'batch')) ? 'batch' : 'plan', title, reason: reason || note || '', diff };
}

/** 执行操作，返回一句结果说明。note：导师回复的第一句，作为变更理由。 */
export function apply(a, { note = '' } = {}) {
  const s = store.state;
  if (!s) throw new Error('还没有训练档案');
  const commit = commitOf(a, s, note);
  if (a.type === 'create_plan') {
    store.update((st) => {
      logChange(st, commit);
      if (st.plan) st.archivedTasks = [...(st.archivedTasks || []), ...st.plan.phases.flatMap((p) => p.tasks.filter((t) => t.done))];
      const weeks = a.phases.reduce((x, p) => x + p.weeks, 0);
      // 每次执行都生成新 id，避免同一张卡片重复执行时 id 冲突
      const phases = a.phases.map((p) => ({ ...p, id: uid('ph'), tasks: p.tasks.map((t) => ({ ...t, id: uid('t') })) }));
      st.plan = { generatedAt: Date.now(), targetId: st.target, weeks, hours: +st.profile.hoursPerWeek || 10, by: 'adam', summary: a.summary, phases };
    }, 'plan');
    return '训练计划已写入';
  }
  if (a.type === 'add_plan_tasks') {
    store.update((st) => {
      logChange(st, commit);
      if (!st.plan) {
        st.plan = { generatedAt: Date.now(), targetId: st.target, weeks: 12, hours: +st.profile.hoursPerWeek || 10, by: 'adam', summary: '由树形图设计者在对话中创建的训练计划。', phases: [{ id: uid('ph'), stage: 'train', name: '主训练', weeks: 12, goal: '', tasks: [] }] };
      }
      findPhase(st.plan, a.phase).tasks.push(...a.tasks.map((t) => ({ ...t, id: uid('t') })));
    }, 'task-add');
    return `已添加 ${a.tasks.length} 个计划任务`;
  }
  if (a.type === 'add_batch_tasks') {
    let nThis = 0, nNext = 0;
    store.update((st) => {
      logChange(st, commit);
      if (!st.batch) st.batch = B.generateBatch(st);
      for (const t of a.tasks) {
        const p = placeBatchTask(t, st);
        const linked = t.plan && (st.plan?.phases || []).some((ph) => ph.tasks.some((x) => x.id === t.plan.task && !x.done));
        const task = linked
          ? { src: 'plan', ref: { task: t.plan.task }, by: 'ai', title: t.title, day: p.day, hours: t.hours, skill: t.skill, gain: 0, criteria: t.criteria, resource: t.resource, done: false, doneAt: null }
          : { src: 'custom', by: 'ai', title: t.title, day: p.day, hours: t.hours, skill: t.skill, gain: B.microGain(t.hours), criteria: t.criteria, resource: t.resource, done: false, doneAt: null };
        // batch 已过期时，本周任务也先排队，结束本轮 Epoch 生成新 batch 时取出
        if (p.queue) { st.batchQueue = [...(st.batchQueue || []), { ...task, weekStart: p.weekStart }]; nNext++; }
        else { st.batch.tasks.push({ ...task, id: uid('b') }); nThis++; }
      }
      st.batch.tasks.sort((x, y) => x.day - y.day);
    }, 'batch');
    return [nThis && `已加入本周 ${nThis} 个任务`, nNext && `已预排 ${nNext} 个任务到下一个 batch（结束本轮 Epoch 后出现）`].filter(Boolean).join('，');
  }
  if (a.type === 'log_entry') {
    const role = M.roleById(s, s.target);
    const before = role ? M.lossOf(M.skillsAt(s), role) : null;
    store.update((st) => {
      st.entries = [...(st.entries || []), { id: uid('e'), type: a.kind, title: a.title, date: a.date, hours: a.hours, desc: a.summary, skills: a.skills, by: 'ai' }];
    }, 'entry');
    const after = role ? M.lossOf(M.skillsAt(store.state), role) : null;
    return role ? `样本已记入数据集 · loss ${before - after >= 0 ? '▼' : '▲'}${Math.abs(before - after).toFixed(4)}` : '样本已记入数据集';
  }
  if (a.type === 'start_run') {
    store.update((st) => {
      logChange(st, { ...commit, kind: 'plan' });
      st.runs = [...(st.runs || []), { id: uid('run'), projectId: null, title: a.title, skills: a.skills, weeks: a.weeks, level: a.level, stack: a.stack, status: 'running', startedAt: Date.now(), notes: '', milestones: a.milestones.map((m) => ({ text: m, done: false, doneAt: null })), by: 'ai' }];
    }, 'run-add');
    return `实验「${a.title}」已启动，下个 batch 会自动排入第一个 checkpoint`;
  }
  if (a.type === 'set_target') {
    store.update((st) => { logChange(st, { ...commit, kind: 'plan' }); st.target = a.role; }, 'target');
    return `目标函数已切换为「${a.name}」`;
  }
  if (a.type === 'remember') {
    store.update((st) => {
      st.memory = [...(st.memory || []), ...a.facts.map((text) => ({ id: uid('mem'), text, t: Date.now() }))].slice(-30);
    }, 'memory');
    return `已记住 ${a.facts.length} 条`;
  }
  if (a.type === 'adjust_tasks') {
    let n = 0;
    store.update((st) => {
      const planTasks = (st.plan?.phases || []).flatMap((ph) => ph.tasks);
      for (const c of a.changes) {
        if (c.kind === 'plan') {
          const t = planTasks.find((x) => x.id === c.id && !x.done);
          if (!t) continue;
          if (c.op === 'resize') t.hours = c.hours;
          else {
            st.plan.phases.forEach((ph) => { ph.tasks = ph.tasks.filter((x) => x.id !== c.id); });
            // 挂在它上面、还没做的周任务一起移除
            if (st.batch) st.batch.tasks = st.batch.tasks.filter((x) => x.done || !(x.src === 'plan' && x.ref?.task === c.id));
          }
          n++;
          continue;
        }
        const t = st.batch?.tasks.find((x) => x.id === c.id && !x.done);
        if (!t) continue;
        if (c.op === 'remove') st.batch.tasks = st.batch.tasks.filter((x) => x !== t);
        else if (c.op === 'resize') { t.hours = c.hours; if (t.gain > 0) t.gain = B.microGain(c.hours); }
        else {
          const p = placeBatchTask({ day: c.day, week: c.week || 'this' }, st);
          if (p.queue) {
            const { id, ...rest } = t;
            st.batchQueue = [...(st.batchQueue || []), { ...rest, day: p.day, weekStart: p.weekStart }];
            st.batch.tasks = st.batch.tasks.filter((x) => x !== t);
          } else t.day = p.day;
        }
        n++;
      }
      st.batch?.tasks.sort((x, y) => x.day - y.day);
      if (n) logChange(st, commit);
    }, 'plan');
    return n ? `已调整 ${n} 处` : '这些任务已经变化，没有可调整的内容';
  }
  throw new Error('不支持的操作');
}
