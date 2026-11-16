// 实验：像管理训练实验一样推进实践项目。里程碑 = checkpoint，完成后自动写入数据集。
import { store, uid } from '../core/store.js';
import { SKILL, COMPETITIONS } from '../core/data.js';
import * as M from '../core/model.js';
import { icon, esc, $, $$, toast, lossToast, confirmBox, relTime, debounce } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';

const STATUS = {
  running: { name: 'running', cn: '进行中', cls: 'accent' },
  planned: { name: 'queued', cn: '排队中', cls: 'target' },
  finished: { name: 'finished', cn: '已完成', cls: '' },
  crashed: { name: 'crashed', cn: '已中止', cls: 'loss' },
};
const LEVEL = ['', '入门', '进阶', '挑战'];

export default {
  title: '实验',
  mount(root, ctx) {
    let aiProjects = [];
    let aiBusy = false;
    let tab = 'active';

    root.innerHTML = `
    <div class="page ${ctx.again ? 'static' : ''}">
      <div class="page-head">
        <div class="page-title">
          <div class="path">~/epoch/<b>runs</b> · experiment tracking</div>
          <h1>实验</h1>
          <p class="page-desc">学习只是前向传播，实践才是反向传播。每个项目都是一次实验 run：设定里程碑（checkpoint），记录实验笔记，完成后自动成为数据集里的一个高价值样本。</p>
        </div>
      </div>
      <div class="tabs" id="runTabs"></div>
      <div id="runs"></div>
      <div class="sec-split">
        <div class="kicker">RECOMMENDED · 按“预期 loss 下降 × 难度匹配”排序</div>
        <button class="btn ai sm" data-act="ai">${icon('spark', 14)} 让树形图设计者推荐更多</button>
      </div>
      <div id="recs"></div>
      <div class="sec-split"><div class="kicker">OPPORTUNITIES · 适合 AI 专业学生的赛事（名称供参考，以官方通知为准）</div></div>
      <div class="comps">${COMPETITIONS.map((c) => `<div class="comp panel"><span class="chip chip-cn">${esc(c.tag)}</span><b>${esc(c.name)}</b><span class="dim">${c.skills.map((k) => SKILL[k].name).join(' · ')}</span></div>`).join('')}</div>
    </div>`;

    function renderTabs() {
      const runs = store.state.runs || [];
      const act = runs.filter((r) => r.status === 'running' || r.status === 'planned').length;
      const fin = runs.length - act;
      $('#runTabs', root).innerHTML = `<button class="${tab === 'active' ? 'on' : ''}" data-t="active">进行中 / 排队<span class="count">${act}</span></button><button class="${tab === 'done' ? 'on' : ''}" data-t="done">已结束<span class="count">${fin}</span></button>`;
      $$('[data-t]', root).forEach((b) => (b.onclick = () => { tab = b.dataset.t; renderTabs(); renderRuns(); }));
    }

    function renderRuns() {
      const runs = (store.state.runs || []).filter((r) => (tab === 'active' ? ['running', 'planned'].includes(r.status) : ['finished', 'crashed'].includes(r.status)));
      if (!runs.length) {
        $('#runs', root).innerHTML = `<div class="panel ticks empty"><div class="e-art">wandb.init(project="you")\n# no runs yet</div><h3>${tab === 'active' ? '还没有进行中的实验' : '还没有结束的实验'}</h3><p>从下方推荐中挑一个，开始你的第一次 run。</p></div>`;
        return;
      }
      $('#runs', root).innerHTML = `<div class="runs">${runs.map((r) => {
        const st = STATUS[r.status];
        const n = r.milestones.filter((m) => m.done).length;
        const p = r.milestones.length ? n / r.milestones.length : 0;
        return `<article class="run panel ticks" data-run="${esc(r.id)}">
          <div class="run-h">
            <span class="run-dot ${r.status}"></span>
            <div class="grow"><div class="run-name">${esc(r.title)}</div>
              <div class="run-sub mono">run/${esc(r.id.slice(-6))} · ${LEVEL[r.level] || ''} · ${r.weeks || '?'}w${r.startedAt ? ` · started ${esc(relTime(r.startedAt))}` : ''}</div></div>
            <span class="chip ${st.cls}">${st.name}</span>
          </div>
          <div class="run-prog"><div class="meter ticked"><i style="width:${p * 100}%"></i></div><span class="num">${n}/${r.milestones.length}</span></div>
          <div class="run-body">
            <ol class="ckpts">${r.milestones.map((m, i) => `<li class="${m.done ? 'done' : ''}"><button class="ck" data-ms="${i}" ${r.status === 'finished' || r.status === 'crashed' ? 'disabled' : ''} aria-label="切换里程碑">${m.done ? icon('check', 12) : ''}</button><span>${esc(m.text)}</span><span class="mono dim">ckpt-${i + 1}</span></li>`).join('')}</ol>
            <div class="run-side">
              <div class="kicker">配置 · config</div>
              <div class="run-cfg">${Object.entries(r.skills || {}).map(([k, v]) => `<span class="gain"><b>${esc(SKILL[k]?.name || k)}</b><span class="num">+${(+v).toFixed(2)}</span></span>`).join('')}</div>
              ${r.stack?.length ? `<div class="row" style="gap:5px;margin-top:8px">${r.stack.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
              <div class="kicker" style="margin-top:14px">实验笔记 · notes</div>
              <textarea class="textarea run-notes" data-notes placeholder="记录超参、失败尝试、关键发现……这些都是面试时的好素材。">${esc(r.notes || '')}</textarea>
            </div>
          </div>
          <div class="run-acts">
            ${r.status === 'planned' ? `<button class="btn primary sm" data-st="running">${icon('play', 12)} 开始 run</button>` : ''}
            ${r.status === 'running' ? `<button class="btn primary sm" data-st="finished">${icon('check', 13)} 完成并写入数据集</button><button class="btn sm ghost" data-st="crashed">中止</button>` : ''}
            ${r.status === 'crashed' ? `<button class="btn sm" data-st="running">${icon('refresh', 13)} 恢复</button>` : ''}
            <button class="btn sm ghost" data-ask>${icon('tree', 13)} 卡住了？问树形图设计者</button>
            <button class="icon-btn" data-delrun title="删除实验" style="margin-left:auto">${icon('trash', 15)}</button>
          </div>
        </article>`;
      }).join('')}</div>`;
      bindRuns();
    }

    function bindRuns() {
      $$('[data-run]', root).forEach((card) => {
        const id = card.dataset.run;
        const get = () => store.state.runs.find((r) => r.id === id);
        card.querySelectorAll('[data-ms]').forEach((b) => (b.onclick = () => {
          const s = store.state;
          const role = M.roleById(s, s.target);
          const before = role ? M.lossOf(M.skillsAt(s), role) : 0;
          let text = '';
          let nowDone = false;
          store.update((st) => {
            const r = st.runs.find((x) => x.id === id);
            const m = r.milestones[+b.dataset.ms];
            m.done = !m.done;
            m.doneAt = m.done ? Date.now() : null;
            if (m.done && r.status === 'planned') { r.status = 'running'; r.startedAt = Date.now(); }
            text = m.text; nowDone = m.done;
          }, 'milestone');
          if (role && nowDone) lossToast(before, M.lossOf(M.skillsAt(store.state), role), `ckpt · ${text}`);
        }));
        card.querySelector('[data-notes]').addEventListener('input', debounce((e) => {
          store.update((st) => { st.runs.find((x) => x.id === id).notes = e.target.value.slice(0, 3000); }, 'notes');
        }, 500));
        card.querySelectorAll('[data-st]').forEach((b) => (b.onclick = () => setStatus(get(), b.dataset.st)));
        card.querySelector('[data-ask]').onclick = () => {
          const r = get();
          ctx.openAdam(`我在做实验「${r.title}」，进度 ${r.milestones.filter((m) => m.done).length}/${r.milestones.length}，下一步是「${r.milestones.find((m) => !m.done)?.text || '收尾'}」。我的笔记：${r.notes || '（无）'}。请帮我分析下一步怎么推进，以及怎样把它写进简历。`);
        };
        card.querySelector('[data-delrun]').onclick = async () => {
          if (!(await confirmBox('删除这个实验？', '已完成里程碑带来的能力增益会一并移除（已写入数据集的记录会保留）。', { ok: '删除', danger: true }))) return;
          store.update((st) => { st.runs = st.runs.filter((x) => x.id !== id); }, 'run-del');
        };
      });
    }

    function setStatus(run, status) {
      store.update((st) => {
        const r = st.runs.find((x) => x.id === run.id);
        r.status = status;
        if (status === 'running' && !r.startedAt) r.startedAt = Date.now();
        if (status === 'finished') {
          r.finishedAt = Date.now();
          r.milestones.forEach((m) => { if (!m.done) { m.done = true; m.doneAt = Date.now(); } });
          // 写入数据集作为记录（增益已由里程碑计入，避免重复计算）
          st.entries.push({ id: uid('e'), type: 'project', title: r.title, date: M.today(), hours: (r.weeks || 2) * 6, desc: `实验完成。${r.notes ? `笔记：${r.notes.slice(0, 300)}` : ''}`, skills: {}, fromRun: r.id });
        }
      }, 'run-status');
      if (status === 'finished') toast('实验完成！已写入数据集，记得在简历里写上它', { type: 'success' });
    }

    function startRun(p) {
      store.update((st) => {
        st.runs.push({
          id: uid('run'), projectId: p.id || null, title: p.title, skills: p.skills, weeks: p.weeks, level: p.level, stack: p.stack || [],
          status: 'running', startedAt: Date.now(), notes: '', milestones: (p.milestones || []).map((m) => ({ text: m, done: false, doneAt: null })),
        });
      }, 'run-add');
      tab = 'active';
      renderTabs();
      renderRuns();
      toast(`run 已启动：${p.title}`, { type: 'success' });
      root.closest('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderRecs() {
      const s = store.state;
      const S = M.skillsAt(s);
      const role = M.roleById(s, s.target);
      const recs = M.recommendProjects(s, S).slice(0, 6).map((r) => ({ ...r.project, value: r.value, src: 'lib' }));
      const all = [...aiProjects.map((p) => ({ ...p, src: 'ai' })), ...recs];
      const delta = (p) => {
        if (!role) return 0;
        const T = { ...S };
        for (const [k, g] of Object.entries(p.skills || {})) if (SKILL[k]) T[k] = Math.min(5, T[k] + (5 - T[k]) * (1 - Math.exp(-g / 2.5)));
        return M.lossOf(S, role) - M.lossOf(T, role);
      };
      $('#recs', root).innerHTML = `<div class="recs">${all.map((p, i) => `
        <article class="rec panel ticks">
          <div class="row" style="justify-content:space-between">
            <span class="kicker">${p.src === 'ai' ? '<span class="c-ai">∇ ADAM</span>' : `#${String(i + 1 - aiProjects.length).padStart(2, '0')}`} · ${LEVEL[p.level] || '进阶'} · ${p.weeks || 3} 周</span>
            ${role ? `<span class="loss-delta">▼${delta(p).toFixed(4)}</span>` : ''}
          </div>
          <h3>${esc(p.title)}</h3>
          <p class="dim">${esc(p.desc || p.why || '')}</p>
          <div class="row" style="gap:5px">${Object.entries(p.skills || {}).map(([k, v]) => `<span class="gain sm"><b>${esc(SKILL[k]?.name || k)}</b><span class="num">+${(+v).toFixed(1)}</span></span>`).join('')}</div>
          <div class="rec-ms dim mono">${(p.milestones || []).length} checkpoints${p.stack?.length ? ` · ${esc(p.stack.slice(0, 3).join(' / '))}` : ''}</div>
          <button class="btn sm" data-start="${i}">${icon('play', 12)} 开始这个实验</button>
        </article>`).join('')}</div>`;
      $$('[data-start]', root).forEach((b) => (b.onclick = () => startRun(all[+b.dataset.start])));
    }

    $('[data-act="ai"]', root).onclick = async (e) => {
      if (aiBusy) return;
      aiBusy = true;
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> 推荐中…';
      try {
        const { data } = await aiJSON('projects', { count: 3 });
        aiProjects = (data.projects || []).slice(0, 5).map((p) => ({
          id: null, title: String(p.title || '').slice(0, 40), level: Math.max(1, Math.min(3, +p.level || 2)), weeks: Math.max(1, Math.min(12, +p.weeks || 3)),
          skills: Object.fromEntries(Object.entries(p.skills || {}).filter(([k]) => SKILL[k]).map(([k, v]) => [k, Math.max(0.1, Math.min(0.9, +v || 0.3))])),
          why: String(p.why || '').slice(0, 120), milestones: (p.milestones || []).slice(0, 6).map((m) => String(m).slice(0, 40)), stack: (p.stack || []).slice(0, 5).map(String),
        })).filter((p) => p.title && p.milestones.length);
        renderRecs();
      } catch (err) {
        toast(err.message, { type: 'error' });
      } finally {
        aiBusy = false;
        btn.disabled = false;
        btn.innerHTML = `${icon('spark', 14)} 再推荐一批`;
      }
    };

    renderTabs();
    renderRuns();
    renderRecs();
    return {
      update(reason) {
        if (reason === 'notes') return;
        renderTabs();
        renderRuns();
        renderRecs();
      },
    };
  },
};
