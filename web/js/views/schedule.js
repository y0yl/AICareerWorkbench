// 训练计划：AI 生成的个性化学习路线，按 warmup → train → finetune 的学习率调度呈现。
import { store, uid } from '../core/store.js';
import { SKILLS, SKILL, RESOURCES } from '../core/data.js';
import * as M from '../core/model.js';
import { icon, esc, $, $$, toast, lossToast, modal, confirmBox, fmtDate } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';
import { batchPanel, bindBatch, ensureBatch } from './batch-ui.js';
import { logChange } from '../core/planlog.js';
import { logPanel, bindLog } from './planlog-ui.js';

const STAGES = {
  warmup: { name: 'Warmup', cn: '预热', desc: '补齐基础，逐步提高学习率' },
  train: { name: 'Train', cn: '主训练', desc: '项目驱动，高学习率稳定下降' },
  finetune: { name: 'Finetune', cn: '微调', desc: '面向目标，小步精调' },
};
const WEEK = 7 * 86400000;

export default {
  title: '训练计划',
  mount(root, ctx) {
    let busy = false;
    ensureBatch();
    const unbindBatch = bindBatch(root, ctx);

    function render() {
      const s = store.state;
      const role = M.roleById(s, s.target);
      root.innerHTML = `
      <div class="page ${ctx.again ? 'static' : ''}">
        <div class="page-head">
          <div class="page-title">
            <div class="path">~/epoch/<b>schedule</b> · lr scheduler</div>
            <h1>训练计划</h1>
            <p class="page-desc">长期路线是学习率调度（warmup → train → finetune），每一周则是一个 mini-batch：几条具体到某一天、能客观验收的任务。周任务会自动推进长期计划与实验的进度。</p>
          </div>
          <div class="page-actions">${s.plan ? `<button class="btn" data-act="add">${icon('plus', 15)} 添加任务</button><button class="btn ai" data-act="regen">${icon('refresh', 15)} 重新规划</button>` : ''}</div>
        </div>
        ${batchPanel()}
        <div class="sec-split"><div class="kicker">LONG-TERM · 长期训练路线</div></div>
        ${s.plan ? planView(s, role) : genView(s, role)}
        ${logPanel(s)}
      </div>`;
      bind();
      bindLog(root);
    }

    function genView(s, role) {
      return `
      <section class="panel ticks gen-panel">
        <div class="gen-art mono" aria-hidden="true">${lrArt()}</div>
        <div class="gen-form">
          <div class="kicker">GENERATE · AI 个性化路线</div>
          <h2 class="init-h" style="font-size:30px">生成你的训练计划</h2>
          <p class="muted">树形图设计者会读取你的能力向量、梯度方向与已有经历，生成一份分阶段、可验收的计划。${role ? `当前目标：<b class="c-accent">${esc(role.name)}</b>` : '<span class="c-warn">建议先设定目标函数。</span>'}</p>
          <div class="grid-2" style="margin-top:20px">
            <div class="field"><label>计划周期</label><div class="seg" data-seg="weeks">${[8, 12, 16, 24].map((w) => `<button type="button" data-v="${w}" class="${w === 12 ? 'on' : ''}">${w} 周</button>`).join('')}</div></div>
            <div class="field"><label>每周可投入（小时）</label><input class="input num" type="number" id="genHours" min="2" max="60" value="${s.profile.hoursPerWeek || 10}"></div>
          </div>
          <div class="field" style="margin-top:14px"><label>额外关注（可选）</label><input class="input" id="genFocus" placeholder="例：想在暑假前拿到大模型实习 / 这学期课很多 / 想准备读研" maxlength="120"></div>
          <div class="row" style="margin-top:20px">
            <button class="btn primary lg" data-act="gen" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span> 树形图设计者正在规划…' : `${icon('spark', 16)} 生成训练计划`}</button>
          </div>
        </div>
      </section>`;
    }

    function planView(s, role) {
      const plan = s.plan;
      const tasks = plan.phases.flatMap((p) => p.tasks);
      const done = tasks.filter((t) => t.done);
      const hDone = done.reduce((a, t) => a + (+t.hours || 0), 0);
      const hAll = tasks.reduce((a, t) => a + (+t.hours || 0), 0);
      const totalWeeks = plan.phases.reduce((a, p) => a + (+p.weeks || 0), 0) || plan.weeks || 12;
      const week = Math.min(totalWeeks, Math.max(0, (Date.now() - plan.generatedAt) / WEEK));
      const S = M.skillsAt(s);
      const planRole = M.roleById(s, plan.targetId);
      return `
      <div class="plan-top">
        <section class="panel ticks plan-summary">
          <div class="panel-h"><span class="ph-idx">CFG</span><span class="ph-title">计划概览</span><span class="ph-en">generated ${fmtDate(plan.generatedAt)}${plan.mock ? ' · demo' : ''}</span></div>
          <div class="panel-b">
            <p class="plan-sum">${esc(plan.summary || '')}</p>
            ${planRole && planRole.id !== s.target ? `<p class="c-warn" style="font-size:12.5px;margin-top:8px">⚠ 该计划针对「${esc(planRole.name)}」，与当前目标不一致，建议重新规划。</p>` : ''}
            <div class="plan-stats">
              <div><div class="kicker">任务</div><div class="num">${done.length}<small>/${tasks.length}</small></div></div>
              <div><div class="kicker">工时</div><div class="num">${Math.round(hDone)}<small>/${Math.round(hAll)}h</small></div></div>
              <div><div class="kicker">进度</div><div class="num">W${Math.floor(week) + 1}<small>/${totalWeeks}</small></div></div>
            </div>
            <div class="meter ticked" style="margin-top:12px"><i style="width:${tasks.length ? (done.length / tasks.length) * 100 : 0}%"></i></div>
          </div>
        </section>
        <section class="panel ticks lr-panel">
          <div class="panel-h"><span class="ph-idx">LR</span><span class="ph-title">学习率调度</span><span class="ph-en">warmup · constant · cosine decay</span></div>
          <div class="panel-b" id="lrChart">${lrChart(plan.phases, totalWeeks, week)}</div>
        </section>
      </div>
      <div class="phases">
        ${plan.phases.map((ph, pi) => {
          const st = STAGES[ph.stage] || STAGES.train;
          const pd = ph.tasks.filter((t) => t.done).length;
          return `
          <section class="phase panel ticks" data-stage="${ph.stage}">
            <div class="phase-h">
              <div class="row" style="justify-content:space-between"><span class="kicker">PHASE ${pi + 1} · ${st.name}</span><span class="num dim" style="font-size:11px">${ph.weeks} 周 · ${pd}/${ph.tasks.length}</span></div>
              <h3>${esc(ph.name || st.cn)}</h3>
              <p class="dim">${esc(ph.goal || st.desc)}</p>
              <div class="meter" style="margin-top:10px"><i style="width:${ph.tasks.length ? (pd / ph.tasks.length) * 100 : 0}%"></i></div>
            </div>
            <div class="tasks">
              ${ph.tasks.map((t) => {
                const role2 = M.roleById(s, s.target);
                const g = role2 && !t.done && SKILL[t.skill] ? M.lossOf(S, role2) - M.lossOf({ ...S, [t.skill]: Math.min(5, S[t.skill] + (5 - S[t.skill]) * (1 - Math.exp(-M.taskGain(t) / 2.5))) }, role2) : 0;
                return `
                <div class="task ${t.done ? 'done' : ''}">
                  <button class="tk-check" data-task="${esc(t.id)}" aria-label="${t.done ? '标记未完成' : '标记完成'}" aria-pressed="${t.done}">${t.done ? icon('check', 13) : ''}</button>
                  <div class="tk-body">
                    <div class="tk-title">${esc(t.title)}</div>
                    <div class="tk-meta"><span class="chip">${esc(SKILL[t.skill]?.name || t.skill)}</span><span class="num dim">${!t.done && t.progressH ? `${Math.round(t.progressH * 2) / 2}/` : ''}${t.hours}h</span>${g > 0.00005 ? `<span class="loss-delta">▼${g.toFixed(4)}</span>` : ''}${t.done && t.doneAt ? `<span class="dim num">✓ ${fmtDate(t.doneAt)}</span>` : ''}</div>
                    ${t.resource ? `<div class="tk-line"><span class="kicker">资源</span>${esc(t.resource)}</div>` : ''}
                    ${t.deliverable ? `<div class="tk-line"><span class="kicker">产出</span>${esc(t.deliverable)}</div>` : ''}
                  </div>
                  <button class="icon-btn tk-del" data-deltask="${esc(t.id)}" title="删除任务">${icon('close', 14)}</button>
                </div>`;
              }).join('')}
            </div>
          </section>`;
        }).join('')}
      </div>`;
    }

    function bind() {
      $$('[data-seg]', root).forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)))));
      $('[data-act="gen"]', root)?.addEventListener('click', generate);
      $('[data-act="regen"]', root)?.addEventListener('click', async () => {
        if (!(await confirmBox('重新规划？', '当前计划会被替换；已完成的任务会保留为历史记录，能力增益不会丢失。', { ok: '重新规划' }))) return;
        store.update((s) => {
          const pending = s.plan.phases.flatMap((p) => p.tasks.filter((t) => !t.done));
          logChange(s, { by: 'user', title: '清空长期计划，准备重新规划', diff: pending.length ? [{ op: '-', text: `${pending.length} 个未完成任务：${pending.slice(0, 4).map((t) => t.title).join('、')}${pending.length > 4 ? '…' : ''}` }] : [], reason: '已完成的任务保留为历史记录' });
          s.archivedTasks = [...(s.archivedTasks || []), ...s.plan.phases.flatMap((p) => p.tasks.filter((t) => t.done))];
          s.plan = null;
        }, 'plan-reset');
      });
      $('[data-act="add"]', root)?.addEventListener('click', addTask);
      $$('[data-task]', root).forEach((b) => (b.onclick = () => toggle(b.dataset.task)));
      $$('[data-deltask]', root).forEach((b) => (b.onclick = async () => {
        if (!(await confirmBox('删除这个任务？', '如果它已完成，对应的能力增益也会移除。', { ok: '删除', danger: true }))) return;
        store.update((s) => {
          const t = s.plan.phases.flatMap((p) => p.tasks).find((x) => x.id === b.dataset.deltask);
          if (t) logChange(s, { by: 'user', title: '删除长期计划任务', diff: [{ op: '-', text: `${t.title} · ${t.hours}h${t.done ? '（已完成）' : ''}` }] });
          s.plan.phases.forEach((p) => { p.tasks = p.tasks.filter((t) => t.id !== b.dataset.deltask); });
        }, 'task-del');
      }));
    }

    function toggle(id) {
      const s = store.state;
      const role = M.roleById(s, s.target);
      const before = role ? M.lossOf(M.skillsAt(s), role) : 0;
      let title = '';
      let nowDone = false;
      store.update((st) => {
        for (const p of st.plan.phases) for (const t of p.tasks) if (t.id === id) { t.done = !t.done; t.doneAt = t.done ? Date.now() : null; title = t.title; nowDone = t.done; }
      }, 'task');
      if (role && nowDone) lossToast(before, M.lossOf(M.skillsAt(store.state), role), title);
    }

    async function generate() {
      const s = store.state;
      const weeks = +($('[data-seg="weeks"] .on', root)?.dataset.v || 12);
      const hours = +($('#genHours', root)?.value || 10);
      const focus = $('#genFocus', root)?.value || '';
      busy = true;
      render();
      try {
        const { data, mock } = await aiJSON('roadmap', { weeks, hours, focus });
        const role = M.roleById(s, s.target);
        const fallbackSkill = role ? M.gradient(M.skillsAt(s), role)[0]?.id || 'dl' : 'dl';
        const phases = (data.phases || []).slice(0, 4).map((p, i) => ({
          id: uid('ph'),
          stage: STAGES[p.stage] ? p.stage : ['warmup', 'train', 'finetune'][Math.min(i, 2)],
          name: String(p.name || '').slice(0, 30),
          weeks: Math.max(1, Math.round(+p.weeks || weeks / 3)),
          goal: String(p.goal || '').slice(0, 80),
          tasks: (p.tasks || []).slice(0, 6).map((t) => ({
            id: uid('t'), title: String(t.title || '').slice(0, 60), skill: SKILL[t.skill] ? t.skill : fallbackSkill,
            hours: Math.max(1, Math.min(80, Math.round(+t.hours || 8))), resource: String(t.resource || '').slice(0, 80),
            deliverable: String(t.deliverable || '').slice(0, 60), done: false, doneAt: null,
          })).filter((t) => t.title),
        })).filter((p) => p.tasks.length);
        if (!phases.length) throw new Error('计划生成结果为空，请重试');
        store.update((st) => {
          logChange(st, { by: 'ai', title: `生成长期训练计划 · ${phases.length} 个阶段 / ${phases.reduce((a, p) => a + p.tasks.length, 0)} 个任务`, reason: String(data.summary || '').slice(0, 160) || (focus ? `关注：${focus}` : ''), diff: phases.map((p) => ({ op: '+', text: `${p.name}（${p.weeks} 周）：${p.tasks.map((t) => t.title).join('、')}` })) });
          st.plan = { generatedAt: Date.now(), targetId: st.target, weeks, hours, mock, summary: String(data.summary || '').slice(0, 200), phases };
        }, 'plan');
        toast(mock ? '已生成演示计划（接入 AI 服务后会更个性化）' : '训练计划已生成', { type: 'success' });
      } catch (e) {
        toast(e.message, { type: 'error' });
      } finally {
        busy = false;
        render();
      }
    }

    function addTask() {
      const s = store.state;
      const role = M.roleById(s, s.target);
      const g = role ? M.gradient(M.skillsAt(s), role)[0]?.id : 'code';
      modal({
        title: '添加任务',
        kicker: 'NEW TASK',
        body: `
          <form id="taskForm" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><label>任务</label><input class="input" name="title" required maxlength="60" placeholder="例：完成 CS231n 作业 2"></div>
            <div class="grid-2">
              <div class="field"><label>能力维度</label><select class="select" name="skill">${SKILLS.map((k) => `<option value="${k.id}" ${k.id === g ? 'selected' : ''}>${k.name}</option>`).join('')}</select></div>
              <div class="field"><label>预计小时</label><input class="input num" name="hours" type="number" min="1" max="80" value="8"></div>
            </div>
            <div class="field"><label>阶段</label><select class="select" name="phase">${s.plan.phases.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join('')}</select></div>
            <div class="field"><label>资源（可选）</label><input class="input" name="resource" maxlength="80" placeholder="${esc(RESOURCES[g]?.[0] || '')}"></div>
            <div class="field"><label>可验收产出（可选）</label><input class="input" name="deliverable" maxlength="60"></div>
            <div class="row-end"><button class="btn primary" type="submit">${icon('plus', 15)} 添加</button></div>
          </form>`,
        onMount(panel, close) {
          panel.querySelector('#taskForm').onsubmit = (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            store.update((st) => {
              const ph = st.plan.phases[+fd.get('phase')];
              logChange(st, { by: 'user', title: `向「${ph.name}」添加任务`, diff: [{ op: '+', text: `${String(fd.get('title')).trim()} · ${SKILL[String(fd.get('skill'))]?.name || ''} · ${+fd.get('hours') || 8}h` }] });
              st.plan.phases[+fd.get('phase')].tasks.push({ id: uid('t'), title: String(fd.get('title')).trim(), skill: String(fd.get('skill')), hours: +fd.get('hours') || 8, resource: String(fd.get('resource') || ''), deliverable: String(fd.get('deliverable') || ''), done: false, doneAt: null });
            }, 'task-add');
            close();
          };
        },
      });
    }

    render();
    return { update: render, destroy: unbindBatch };
  },
};

function lrArt() {
  return ['lr', ' ↑', ' │      ┌──────────────┐', ' │     ╱                ╲', ' │    ╱                  ╲__', ' │   ╱  warmup   train   finetune', ' └──────────────────────────────→ week'].join('\n');
}

function lrChart(phases, total, week) {
  const W = 560, H = 150, m = { l: 30, r: 10, t: 14, b: 28 };
  const X = (w) => m.l + (w / total) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - v) * (H - m.t - m.b);
  let acc = 0;
  const segs = phases.map((p) => { const a = acc; acc += +p.weeks || 1; return { ...p, a, b: acc }; });
  const lr = (w) => {
    const seg = segs.find((g) => w <= g.b) || segs.at(-1);
    const k = (w - seg.a) / Math.max(0.001, seg.b - seg.a);
    if (seg.stage === 'warmup') return 0.15 + 0.85 * k;
    if (seg.stage === 'finetune') return 0.22 + 0.7 * (0.5 * (1 + Math.cos(Math.PI * k)));
    return 1 - 0.08 * k;
  };
  const pts = [];
  for (let i = 0; i <= 120; i++) { const w = (i / 120) * total; pts.push(`${X(w).toFixed(1)},${Y(lr(w)).toFixed(1)}`); }
  const area = `M${X(0)},${Y(0)}L${pts.join('L')}L${X(total)},${Y(0)}Z`;
  const shade = segs.map((g) => {
    const d = g.tasks.length ? g.tasks.filter((t) => t.done).length / g.tasks.length : 0;
    return `<rect x="${X(g.a)}" y="${m.t}" width="${X(g.b) - X(g.a)}" height="${H - m.t - m.b}" class="lr-seg" style="opacity:${0.04 + d * 0.16}"/>
      <line x1="${X(g.a)}" x2="${X(g.a)}" y1="${m.t}" y2="${H - m.b}" class="lr-div"/>
      <text x="${(X(g.a) + X(g.b)) / 2}" y="${H - 10}" class="lr-lbl" text-anchor="middle">${(STAGES[g.stage] || STAGES.train).name.toUpperCase()} · ${g.weeks}w</text>`;
  }).join('');
  const nx = X(week);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="lrchart" preserveAspectRatio="xMidYMid meet">
    ${shade}
    <path d="${area}" class="lr-area"/>
    <polyline points="${pts.join(' ')}" class="lr-line"/>
    <line x1="${nx}" x2="${nx}" y1="${m.t - 4}" y2="${H - m.b}" class="lr-now"/>
    <circle cx="${nx}" cy="${Y(lr(week))}" r="4" class="lr-dot"/>
    <text x="${nx + 6}" y="${Math.min(H - m.b - 6, Y(lr(week)) + 16)}" class="lr-now-t">NOW · W${Math.floor(week) + 1}</text>
    <text x="4" y="${Y(1) + 3}" class="lr-ax">1.0</text><text x="4" y="${Y(0) + 3}" class="lr-ax">0</text>
  </svg>`;
}
