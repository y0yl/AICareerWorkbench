// 本周 Batch 组件：控制台用紧凑版（今天 + 一周概览），训练计划页用完整版（按天议程）。
import { store } from '../core/store.js';
import { SKILLS, SKILL } from '../core/data.js';
import * as M from '../core/model.js';
import * as B from '../core/batch.js';
import { icon, esc, $, toast, lossToast, modal, confirmBox } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';
import { logChange } from '../core/planlog.js';
import { batchToICS } from '../core/ics.js';

const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;

/** 没有 batch 时静默生成一个（建档后的第一周、旧数据升级）。 */
export function ensureBatch() {
  const s = store.state;
  if (s && !s.batch) store.update((st) => { st.batch = B.generateBatch(st); }, 'batch-auto');
}

function taskRow(b, t, today) {
  const src = B.SOURCES[t.src] || B.SOURCES.custom;
  const late = !t.done && t.day < today;
  return `<div class="bt-task ${t.done ? 'done' : ''} ${late ? 'late' : ''}">
    <button class="tk-check" data-bt="toggle" data-id="${esc(t.id)}" aria-pressed="${t.done}" aria-label="${t.done ? '标记未完成' : '标记完成'}">${t.done ? icon('check', 13) : ''}</button>
    <div class="bt-body">
      <div class="bt-t">${esc(t.title)}</div>
      ${t.criteria ? `<div class="bt-c"><span class="kicker">验收</span>${esc(t.criteria)}</div>` : ''}
      ${t.resource ? `<div class="bt-r">${icon('book', 12)}${esc(t.resource)}</div>` : ''}
    </div>
    <div class="bt-side">
      <div class="bt-m">
        <span class="chip ${src.cls}" title="${esc(src.hint)}">${src.name}</span>
        ${t.carried ? `<span class="chip warn" title="上一轮未完成，梯度累积到本轮">累积×${t.carried}</span>` : ''}
        ${late ? '<span class="chip loss">逾期</span>' : ''}
      </div>
      <div class="bt-m2"><span class="dim">${esc(SKILL[t.skill]?.name || '')}${t.gain > 0 ? ` <span class="num c-accent" title="完成后该能力增长">+${(+t.gain).toFixed(2)}</span>` : ''}</span><span class="num">${t.hours}h</span></div>
      <div class="bt-acts">
        <button class="icon-btn" data-bt="move" data-dir="-1" data-id="${esc(t.id)}" title="提前一天" ${t.day <= 0 ? 'disabled' : ''}>‹</button>
        <button class="icon-btn" data-bt="move" data-dir="1" data-id="${esc(t.id)}" title="推后一天" ${t.day >= 6 ? 'disabled' : ''}>›</button>
        <button class="icon-btn" data-bt="del" data-id="${esc(t.id)}" title="删除">${icon('close', 13)}</button>
      </div>
    </div>
  </div>`;
}

function weekStrip(b, today) {
  return `<div class="bt-strip">${B.WEEKDAYS.map((w, d) => {
    const ts = b.tasks.filter((t) => t.day === d);
    const h = ts.reduce((a, t) => a + t.hours, 0);
    const cls = d === today ? 'today' : d < today ? 'past' : '';
    return `<a class="bs-day ${cls}" href="#bt-day-${d}" data-bt="jump" data-day="${d}">
      <span class="bs-w">${w.slice(1)}</span><span class="bs-d num">${md(B.dayDate(b, d))}</span>
      <span class="bs-bars">${ts.map((t) => `<i class="${t.done ? 'on' : !t.done && d < today ? 'late' : ''}" style="height:${Math.max(4, t.hours * 7)}px" title="${esc(t.title)}"></i>`).join('')}</span>
      <span class="bs-h num">${h ? `${h}h` : '—'}</span>
    </a>`;
  }).join('')}</div>`;
}

function history(s) {
  const rates = (s.reviews || []).map((r) => r.batch?.rate).filter((r) => r != null).slice(-8);
  if (!rates.length) return '';
  return `<div class="bt-hist" title="最近 ${rates.length} 轮 batch 完成率"><span class="kicker">完成率</span>${rates.map((r) => `<i style="height:${Math.max(2, r * 22)}px" class="${r < 0.5 ? 'low' : ''}" title="${Math.round(r * 100)}%"></i>`).join('')}</div>`;
}

/** 渲染面板。compact：控制台用。 */
export function batchPanel({ compact = false } = {}) {
  const s = store.state;
  const b = s.batch;
  if (!b) return '';
  const st = B.batchStats(b);
  const today = B.dayIndex(b);
  const stale = today > 6;
  const ws = B.dayDate(b, 0), we = B.dayDate(b, 6);
  const head = `
    <div class="panel-h"><span class="ph-idx">BATCH</span><span class="ph-title">本周任务</span>
      <span class="ph-en hide-sm">mini-batch · epoch ${String(b.epoch).padStart(3, '0')} · ${md(ws)}–${md(we)}${b.ai ? ' · refined by Tree Diagram' : ''}</span>
      <span class="ph-right">
        ${compact ? `<a class="btn ghost sm" href="#/schedule">完整一周 ${icon('arrow', 13)}</a>` : `<button class="btn ghost sm" data-bt="regen">${icon('refresh', 13)} 重排</button><button class="btn ghost sm" data-bt="ics" title="导出到手机 / 电脑日历">${icon('calendar', 13)}<span class="hide-sm"> 日历</span></button>`}
        <button class="btn sm" data-bt="add">${icon('plus', 13)} 添加</button>
        <button class="btn ai sm" data-bt="refine">${icon('spark', 13)} AI 细化</button>
      </span></div>`;
  const summary = `
    <div class="bt-sum">
      <div class="bt-prog">
        <div><b class="num">${st.done}<small>/${st.total}</small></b><span class="kicker">已完成</span></div>
        <div><b class="num">${today >= 0 ? `${st.hours}<small>/${b.budget}h</small>` : `${st.planned}<small>h</small>`}</b><span class="kicker">${today >= 0 ? '已投入 / 预算' : '本周计划'}</span>${b.adapt && b.adapt.factor !== 1 ? `<span class="chip ${b.adapt.factor < 1 ? 'warn' : 'accent'} bt-adapt" title="自适应 batch：按最近几轮的完成率（Adam 一阶 / 二阶矩估计）把每周 ${b.adapt.base}h 的预算调整为 ×${b.adapt.factor}。可在「设置」关闭。">Adam ×${b.adapt.factor}</span>` : ''}</div>
        <div class="grow"><div class="meter ticked"><i style="width:${st.rate * 100}%"></i></div>
          <p class="bt-tip">${esc(b.tip || '每条任务都能在一次坐下来的时间内完成，并有可客观判断的验收标准。没做完的，结束 epoch 时可以顺延（梯度累积）。')}</p></div>
        ${history(s)}
      </div>
    </div>`;
  const banner = stale
    ? `<div class="notice warn" style="margin:12px 16px 0">${icon('flag', 15)}<span>这个 batch 的一周已经过去。结束本轮 Epoch 复盘，就会自动生成下一周的任务。</span><button class="btn sm" data-bt="epoch" style="margin-left:auto">结束本轮 Epoch</button></div>`
    : today < 0 ? `<div class="notice" style="margin:12px 16px 0;background:var(--target-soft);color:var(--target)">${icon('flag', 15)}<span>这是下周（${md(ws)} 起）的 batch，周一开始执行。</span></div>` : '';
  const queue = s.batchQueue || [];
  const queued = queue.length && !compact
    ? `<div class="notice bt-queue" style="margin:12px 16px 0;background:var(--ai-soft);color:var(--ai)" title="${esc(queue.map((q) => `${B.WEEKDAYS[q.day] || ''} ${q.title}`).join('\n'))}">${icon('flag', 15)}<span>下周已预排 <b>${queue.length}</b> 个任务（${queue.reduce((a, q) => a + q.hours, 0)}h），结束本轮 Epoch 后自动进入新的 batch。</span><button class="btn ghost sm" data-bt="unqueue" style="margin-left:auto">清空</button></div>`
    : '';

  if (compact) {
    const focus = b.tasks.filter((t) => (t.day === today) || (!t.done && t.day < today));
    const next = b.tasks.filter((t) => t.day > today && !t.done);
    return `<section class="panel ticks batch-panel compact" id="batchPanel">${head}${summary}${banner}
      <div class="bt-compact">
        <div class="bt-today">
          <div class="bt-gh"><b>${today >= 0 && today <= 6 ? `今天 · ${B.WEEKDAYS[today]}` : '本周'}</b><span class="dim num">${focus.filter((t) => !t.done).length} 项待办</span></div>
          ${(today < 0 ? b.tasks.slice(0, 3) : focus).map((t) => taskRow(b, t, today)).join('') || `<div class="bt-empty">今天没有安排 🎯 ${next[0] ? `下一项：${B.WEEKDAYS[next[0].day]}「${esc(next[0].title)}」` : ''}</div>`}
        </div>
        ${weekStrip(b, today)}
      </div>
    </section>`;
  }
  const groups = [0, 1, 2, 3, 4, 5, 6].filter((d) => b.tasks.some((t) => t.day === d));
  return `<section class="panel ticks batch-panel" id="batchPanel">${head}${summary}${banner}${queued}
    ${weekStrip(b, today)}
    <div class="bt-agenda">${groups.map((d) => {
      const ts = b.tasks.filter((t) => t.day === d);
      return `<div class="bt-group ${d === today ? 'today' : d < today ? 'past' : ''}" id="bt-day-${d}">
        <div class="bt-gh"><b>${B.WEEKDAYS[d]}</b><span class="dim num">${md(B.dayDate(b, d))}</span>${d === today ? '<span class="chip accent">今天</span>' : ''}<span class="dim num" style="margin-left:auto">${ts.reduce((a, t) => a + t.hours, 0)}h</span></div>
        ${ts.map((t) => taskRow(b, t, today)).join('')}
      </div>`;
    }).join('')}</div>
  </section>`;
}

/** 绑定交互（事件委托）。onChange：需要局部重绘时调用。 */
export function bindBatch(root, ctx) {
  const handler = async (e) => {
    const el = e.target.closest('[data-bt]');
    if (!el || !root.contains(el)) return;
    const act = el.dataset.bt;
    if (act === 'jump') {
      e.preventDefault();
      const g = root.querySelector(`#bt-day-${el.dataset.day}`);
      if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else ctx.navigate('/schedule');
      return;
    }
    if (act === 'toggle') return toggle(el.dataset.id);
    if (act === 'move') {
      return store.update((st) => {
        const t = st.batch.tasks.find((x) => x.id === el.dataset.id);
        if (!t) return;
        const from = t.day;
        t.day = Math.max(0, Math.min(6, t.day + +el.dataset.dir));
        st.batch.tasks.sort((a, b) => a.day - b.day);
        if (from === t.day) return;
        // 连续点“提前 / 推后”合并成一条：记录最初的那一天
        const text = (f) => `「${t.title}」${B.WEEKDAYS[f]} → ${B.WEEKDAYS[t.day]}`;
        logChange(st, {
          by: 'user', kind: 'batch', title: '本周任务改期', key: `move:${t.id}`, meta: { from },
          diff: [{ op: '~', text: text(from) }],
          merge: (last) => ({ diff: last.meta.from === t.day ? [] : [{ op: '~', text: text(last.meta.from) }] }),
        });
        if (st.planLog?.[0]?.key === `move:${t.id}` && !st.planLog[0].diff.length) st.planLog = st.planLog.slice(1);
      }, 'batch');
    }
    if (act === 'del') {
      if (!(await confirmBox('删除这个任务？', '只从本周 batch 中移除，不影响长期计划。', { ok: '删除', danger: true }))) return;
      return store.update((st) => {
        const t = st.batch.tasks.find((x) => x.id === el.dataset.id);
        if (t) logChange(st, { by: 'user', kind: 'batch', title: '从本周 batch 删除任务', diff: [{ op: '-', text: `${B.WEEKDAYS[t.day] || ''} ${t.title} · ${t.hours}h` }] });
        st.batch.tasks = st.batch.tasks.filter((x) => x.id !== el.dataset.id);
      }, 'batch');
    }
    if (act === 'unqueue') {
      if (!(await confirmBox('清空预排任务？', '这些任务不会再进入下一个 batch。', { ok: '清空', danger: true }))) return;
      return store.update((st) => {
        const q = st.batchQueue || [];
        if (q.length) logChange(st, { by: 'user', kind: 'batch', title: '清空下周预排任务', diff: q.map((x) => ({ op: '-', text: `${B.WEEKDAYS[x.day] || ''} ${x.title} · ${x.hours}h` })) });
        st.batchQueue = [];
      }, 'batch');
    }
    if (act === 'add') return addTask();
    if (act === 'regen') return regen();
    if (act === 'refine') return refine(el);
    if (act === 'epoch') return ctx.endEpoch();
    if (act === 'ics') return exportCalendar();
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

function toggle(id) {
  const s = store.state;
  const role = M.roleById(s, s.target);
  const before = role ? M.lossOf(M.skillsAt(s), role) : 0;
  let res = null;
  store.update((st) => { res = B.toggleTask(st, id); }, 'batch');
  if (!res?.task?.done) return;
  const after = role ? M.lossOf(M.skillsAt(store.state), role) : 0;
  if (role && before - after > 0.00005) lossToast(before, after, res.task.title);
  if (res.note) toast(res.note, { type: 'success' });
  else if (!role || before - after <= 0.00005) toast(`✓ ${res.task.title.slice(0, 24)}${res.task.title.length > 24 ? '…' : ''}`, { type: 'success' });
}

async function regen() {
  if (!(await confirmBox('重排本周 batch？', '已完成的任务和你（或树形图设计者）添加的任务会保留；其余按你最新的梯度、计划与实验进度重新生成。', { ok: '重排' }))) return;
  store.update((st) => {
    // 已完成的、以及自己 / 树形图设计者添加的任务保留，其余重新生成
    const done = st.batch.tasks.filter((t) => t.done || t.src === 'custom' || t.by === 'ai');
    const nb = B.generateBatch(st, { weekStart: st.batch.weekStart });
    const keepRefs = new Set(done.map((t) => JSON.stringify(t.ref || t.id)));
    nb.tasks = [...done, ...nb.tasks.filter((t) => !keepRefs.has(JSON.stringify(t.ref || t.id)))];
    const before = new Set(st.batch.tasks.map((t) => t.title));
    const after = new Set(nb.tasks.map((t) => t.title));
    logChange(st, {
      by: 'user', kind: 'batch', title: '按最新梯度重排本周 batch',
      diff: [...st.batch.tasks.filter((t) => !after.has(t.title)).map((t) => ({ op: '-', text: `${t.title} · ${t.hours}h` })), ...nb.tasks.filter((t) => !before.has(t.title)).map((t) => ({ op: '+', text: `${B.WEEKDAYS[t.day]} ${t.title} · ${t.hours}h` }))],
    });
    nb.id = st.batch.id;
    nb.epoch = st.batch.epoch;
    st.batch = nb;
  }, 'batch');
  toast('已按最新状态重排本周任务', { type: 'success' });
}

function addTask() {
  const b = store.state.batch;
  const today = Math.max(0, Math.min(6, B.dayIndex(b)));
  const role = M.roleById(store.state, store.state.target);
  // 默认能力：当前梯度最大的那一项
  const defSkill = (role && M.gradient(M.skillsAt(store.state), role)[0]?.id) || 'code';
  modal({
    title: '添加本周任务',
    kicker: 'CUSTOM TASK',
    body: `<form id="btForm" style="display:flex;flex-direction:column;gap:12px">
      <div class="field"><label>任务（具体到可以一次完成）</label><input class="input" name="title" required maxlength="80" placeholder="例：完成 CS231n Assignment 2 的 BatchNorm 部分"></div>
      <div class="grid-3">
        <div class="field"><label>哪天</label><select class="select" name="day">${B.WEEKDAYS.map((w, d) => `<option value="${d}" ${d === today ? 'selected' : ''}>${w} ${md(B.dayDate(b, d))}</option>`).join('')}</select></div>
        <div class="field"><label>小时</label><input class="input num" type="number" name="hours" min="0.5" max="6" step="0.5" value="1.5"></div>
        <div class="field"><label>能力</label><select class="select" name="skill">${SKILLS.map((k) => `<option value="${k.id}" ${k.id === defSkill ? 'selected' : ''}>${k.name}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>验收标准</label><input class="input" name="criteria" maxlength="80" placeholder="例：notebook 中所有测试通过"></div>
      <div class="field"><label>技能增长 <span class="dim" data-g-mode>· 按时长自动估算</span></label>
        <div class="gain-row">
          <input class="input num" type="number" name="gain" min="0.01" max="0.4" step="0.01" value="${B.microGain(1.5).toFixed(2)}">
          <button class="btn ai" type="button" data-g-ai>${icon('tree', 14)} 让树形图设计者定</button>
        </div>
        <div class="gain-hint" data-g-hint></div>
      </div>
      <div class="row-end"><button class="btn primary" type="submit">${icon('plus', 14)} 加入本周</button></div>
    </form>`,
    onMount(panel, close) {
      const f = panel.querySelector('#btForm');
      const hint = panel.querySelector('[data-g-hint]');
      const mode = panel.querySelector('[data-g-mode]');
      let manual = false; // 手动填过或 AI 定过之后，改时长不再自动覆盖
      let reason = '';
      const hours = () => Math.max(0.5, Math.min(6, +f.hours.value || 1));
      const gain = () => Math.max(0.01, Math.min(0.4, +f.gain.value || 0));
      // 预览：把这个任务当作已完成，算出能力与 loss 的变化（含边际递减）
      const preview = () => {
        const st = store.state;
        const S0 = M.skillsAt(st);
        const draft = { ...st, batch: { ...st.batch, tasks: [...st.batch.tasks, { skill: f.skill.value, gain: gain(), hours: hours(), done: true, doneAt: Date.now() }] } };
        const S1 = M.skillsAt(draft);
        const k = f.skill.value;
        const dl = role ? M.lossOf(S0, role) - M.lossOf(S1, role) : 0;
        hint.innerHTML = `完成后 <b>${esc(SKILL[k].name)}</b> <span class="num">${S0[k].toFixed(2)} → ${S1[k].toFixed(2)}</span>`
          + (role ? ` · <span class="num ${dl > 0 ? 'c-accent' : 'dim'}">loss ▼${dl.toFixed(4)}</span>` : '')
          + (reason ? `<div class="gain-why">${icon('tree', 12)}<span>${esc(reason)}</span></div>` : '');
      };
      f.hours.addEventListener('input', () => { if (!manual) f.gain.value = B.microGain(hours()).toFixed(2); preview(); });
      f.gain.addEventListener('input', () => { manual = true; reason = ''; mode.textContent = '· 手动设定'; preview(); });
      f.skill.addEventListener('change', preview);
      panel.querySelector('[data-g-ai]').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!f.title.value.trim()) { f.title.focus(); return toast('先写下任务内容，树形图设计者才好判断'); }
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> 演算中…';
        try {
          const { data, mock } = await aiJSON('task_gain', { title: f.title.value.trim(), hours: hours(), skill: SKILL[f.skill.value].name, skill_id: f.skill.value, criteria: f.criteria.value.trim() });
          if (SKILL[data.skill]) f.skill.value = data.skill;
          if (+data.hours) f.hours.value = Math.max(0.5, Math.min(6, Math.round(+data.hours * 2) / 2));
          if (+data.gain) f.gain.value = Math.max(0.01, Math.min(0.4, +data.gain)).toFixed(2);
          if (data.criteria && !f.criteria.value.trim()) f.criteria.value = String(data.criteria).slice(0, 80);
          manual = true;
          reason = String(data.reason || '').slice(0, 80);
          mode.textContent = mock ? '· 演示模式估算' : '· 树形图设计者设定';
          preview();
        } catch (err) {
          toast(err.message, { type: 'error' });
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icon('tree', 14)} 让树形图设计者定`;
        }
      };
      preview();
      f.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(f);
        const h = hours();
        store.update((st) => {
          logChange(st, { by: 'user', kind: 'batch', title: '向本周 batch 添加任务', diff: [{ op: '+', text: `${B.WEEKDAYS[+fd.get('day')]} ${String(fd.get('title')).trim()} · ${h}h` }] });
          st.batch.tasks.push({ id: `b_${Date.now().toString(36)}`, src: 'custom', title: String(fd.get('title')).trim(), day: +fd.get('day'), hours: h, skill: String(fd.get('skill')), gain: +gain().toFixed(2), criteria: String(fd.get('criteria') || ''), resource: '', done: false, doneAt: null });
          st.batch.tasks.sort((a, c) => a.day - c.day);
        }, 'batch');
        close();
      };
    },
  });
}

async function refine(btn) {
  const b = store.state.batch;
  const today = Math.max(0, B.dayIndex(b));
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 细化中…';
  try {
    const { data, mock } = await aiJSON('weekly_batch', {
      budget: b.budget,
      today: B.WEEKDAYS[Math.min(6, today)],
      tasks: b.tasks.filter((t) => !t.done).map((t) => ({ id: t.id, title: t.title, hours: t.hours, day: B.WEEKDAYS[t.day], skill: SKILL[t.skill]?.name, source: B.SOURCES[t.src]?.name, criteria: t.criteria, resource: t.resource })),
    });
    const byId = new Map((data.tasks || []).map((x) => [String(x.id), x]));
    store.update((st) => {
      const diff = [];
      for (const t of st.batch.tasks) {
        const x = byId.get(t.id);
        if (!x || t.done) continue;
        const was = { title: t.title, hours: t.hours, day: t.day };
        if (x.title) t.title = String(x.title).slice(0, 90);
        if (x.criteria) t.criteria = String(x.criteria).slice(0, 90);
        if (x.resource) t.resource = String(x.resource).slice(0, 60);
        if (+x.hours) t.hours = Math.max(0.5, Math.min(4, Math.round(+x.hours * 2) / 2));
        const d = typeof x.day === 'number' ? x.day : B.WEEKDAYS.indexOf(String(x.day));
        if (d >= today && d <= 6 && t.src !== 'ritual') t.day = d;
        const ch = [was.title !== t.title && `「${was.title.slice(0, 24)}${was.title.length > 24 ? '…' : ''}」→「${t.title}」`, was.hours !== t.hours && `${was.hours}h → ${t.hours}h`, was.day !== t.day && `${B.WEEKDAYS[was.day]} → ${B.WEEKDAYS[t.day]}`].filter(Boolean);
        if (ch.length) diff.push({ op: '~', text: was.title !== t.title ? ch.join(' · ') : `「${t.title}」${ch.join(' · ')}` });
      }
      if (!mock) logChange(st, { by: 'ai', kind: 'batch', title: '把本周任务细化到可执行的粒度', reason: data.tip ? String(data.tip).slice(0, 120) : '', diff });
      st.batch.tasks.sort((a, c) => a.day - c.day);
      if (data.tip) st.batch.tip = String(data.tip).slice(0, 120);
      st.batch.ai = !mock;
    }, 'batch');
    toast(mock ? '演示模式：已补充验收细节（接入 AI 服务后会改写得更具体）' : '树形图设计者已把本周任务细化到可执行的粒度', { type: 'success' });
  } catch (e) {
    toast(e.message, { type: 'error' });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('spark', 13)} AI 细化`;
  }
}

/** 导出到日历：选择每天开始的时间与提醒，下载 .ics。 */
export function exportCalendar() {
  const s = store.state;
  if (!s?.batch) return;
  const pref = store.prefs.get('ics', { weekday: '19:30', weekend: '10:00', alarm: 15, includeQueue: true });
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const upcoming = s.batch.tasks.filter((t) => !t.done && s.batch.weekStart + t.day * B.DAY >= todayStart);
  const open = upcoming.length;
  const queued = (s.batchQueue || []).length;
  modal({
    title: '导出到日历',
    kicker: 'ICS · 手机 / 电脑日历',
    body: `<form id="icsForm" style="display:flex;flex-direction:column;gap:14px">
      <p class="muted" style="font-size:13px">把本周接下来 <b>${open}</b> 个未完成任务${queued ? `和下周预排的 <b>${queued}</b> 个任务` : ''}导出为 .ics 文件。iPhone / 安卓 / Outlook / 飞书 / 钉钉日历都能直接导入；同一天的任务依次排开，中间留 10 分钟。</p>
      <div class="grid-3">
        <div class="field"><label>工作日开始</label><input class="input num" type="time" name="weekday" value="${esc(pref.weekday)}"></div>
        <div class="field"><label>周末开始</label><input class="input num" type="time" name="weekend" value="${esc(pref.weekend)}"></div>
        <div class="field"><label>提前提醒</label><select class="select" name="alarm">${[0, 5, 15, 30, 60].map((m) => `<option value="${m}" ${+pref.alarm === m ? 'selected' : ''}>${m ? `${m} 分钟` : '不提醒'}</option>`).join('')}</select></div>
      </div>
      ${queued ? `<label class="check-row"><input type="checkbox" name="queue" ${pref.includeQueue ? 'checked' : ''}> 包含下周预排的任务</label>` : ''}
      <div class="ics-prev" data-prev></div>
      <div class="row-end"><button class="btn primary" type="submit">${icon('download', 14)} 下载 .ics</button></div>
    </form>`,
    onMount(panel, close) {
      const f = panel.querySelector('#icsForm');
      const read = () => ({ weekday: f.weekday.value || '19:30', weekend: f.weekend.value || '10:00', alarm: +f.alarm.value, includeQueue: f.queue ? f.queue.checked : false });
      const prev = () => {
        const o = read();
        const items = upcoming.slice(0, 4);
        const at = new Map();
        panel.querySelector('[data-prev]').innerHTML = items.map((t) => {
          const k = t.day;
          const base = at.get(k) ?? (() => { const [h, m] = (t.day >= 5 ? o.weekend : o.weekday).split(':').map(Number); return h * 60 + m; })();
          at.set(k, base + Math.round(t.hours * 60) + 10);
          const hm = (x) => `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
          return `<div class="ics-row"><span class="num dim">${B.WEEKDAYS[t.day]} ${hm(base)}–${hm(base + Math.round(t.hours * 60))}</span><span>${esc(t.title)}</span></div>`;
        }).join('') + (open > 4 ? `<div class="ics-row dim">…还有 ${open - 4} 个</div>` : '');
      };
      f.addEventListener('input', prev);
      prev();
      f.onsubmit = (e) => {
        e.preventDefault();
        const o = read();
        store.prefs.set('ics', o);
        const { ics, count } = batchToICS(store.state, o);
        if (!count) return toast('没有需要导出的任务');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
        const d = B.dayDate(s.batch, 0);
        a.download = `epoch-week-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.ics`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(`已导出 ${count} 个日程`, { type: 'success' });
        close();
      };
    },
  });
}
