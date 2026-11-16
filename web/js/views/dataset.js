// 数据集：经历档案。每段经历是一个训练样本，AI 自动标注能力增益。
import { store, uid } from '../core/store.js';
import { SKILLS, SKILL, ENTRY_TYPES, ENTRY_TYPE } from '../core/data.js';
import * as M from '../core/model.js';
import { icon, esc, $, $$, toast, lossToast, confirmBox, fmtDate } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';

export default {
  title: '数据集',
  mount(root, ctx) {
    let filter = 'all';
    let editing = null; // 正在编辑的样本草稿
    let tagging = false;

    root.innerHTML = `
    <div class="page ${ctx.again ? 'static' : ''}">
      <div class="page-head">
        <div class="page-title">
          <div class="path">~/epoch/<b>dataset</b> · training samples</div>
          <h1>数据集</h1>
          <p class="page-desc">课程、项目、竞赛、实习、论文、阅读……每一段经历都是一个训练样本。描述它，AI 会自动标注它让哪些能力增长了多少。</p>
        </div>
        <div class="page-actions"><button class="btn primary" data-act="new">${icon('plus', 15)} 新样本</button></div>
      </div>
      <div id="stats"></div>
      <div id="composer"></div>
      <div class="tabs" id="filters"></div>
      <div id="list"></div>
    </div>`;

    const blank = () => ({ id: null, type: 'project', title: '', date: M.today(), hours: 10, desc: '', skills: {}, reason: '' });

    function renderStats() {
      const s = store.state;
      const entries = s.entries || [];
      const hours = entries.reduce((a, e) => a + (+e.hours || 0), 0);
      const practice = entries.filter((e) => ENTRY_TYPE[e.type]?.practice).length;
      const counts = ENTRY_TYPES.map((t) => ({ t, n: entries.filter((e) => e.type === t.id).length })).filter((x) => x.n);
      const ratio = entries.length ? practice / entries.length : 0;
      $('#stats', root).innerHTML = `
        <div class="ds-stats panel ticks">
          <div class="ds-stat"><div class="kicker">样本数 · N</div><div class="num ds-big">${entries.length}</div></div>
          <div class="ds-stat"><div class="kicker">累计投入</div><div class="num ds-big">${Math.round(hours)}<small>h</small></div></div>
          <div class="ds-stat grow">
            <div class="row" style="justify-content:space-between"><span class="kicker">类别分布 · 理论 / 实践</span><span class="num dim" style="font-size:11px">实践占比 ${Math.round(ratio * 100)}%</span></div>
            <div class="ds-dist">${counts.map(({ t, n }) => `<i class="${t.practice ? 'p' : 't'}" style="flex:${n}" title="${t.name} ${n}"></i>`).join('') || '<i style="flex:1;background:var(--line)"></i>'}</div>
            <div class="row" style="gap:6px;margin-top:8px">${counts.map(({ t, n }) => `<span class="chip chip-cn"><i class="sw ${t.practice ? 'p' : 't'}"></i>${t.name} ${n}</span>`).join('')}</div>
          </div>
          <div class="ds-stat ds-hint">${ratio < 0.3 && entries.length >= 4 ? `<span class="lv warn">[WARN]</span> 实践样本偏少，有“过拟合于课本”的风险` : entries.length < 3 ? '<span class="lv info">[INFO]</span> 样本太少，模型欠拟合——多记录一些吧' : '<span class="lv ok">[ OK ]</span> 样本分布健康'}</div>
        </div>`;
    }

    function renderFilters() {
      const entries = store.state.entries || [];
      const tabs = [{ id: 'all', name: '全部' }, ...ENTRY_TYPES];
      $('#filters', root).innerHTML = tabs.map((t) => {
        const n = t.id === 'all' ? entries.length : entries.filter((e) => e.type === t.id).length;
        return `<button class="${filter === t.id ? 'on' : ''}" data-f="${t.id}">${t.name}<span class="count">${n}</span></button>`;
      }).join('');
      $$('[data-f]', root).forEach((b) => (b.onclick = () => { filter = b.dataset.f; renderFilters(); renderList(); }));
    }

    function contribution(entry) {
      const s = store.state;
      const role = M.roleById(s, s.target);
      if (!role) return null;
      const without = { ...s, entries: s.entries.filter((e) => e.id !== entry.id) };
      return M.lossOf(M.skillsAt(without), role) - M.lossOf(M.skillsAt(s), role);
    }

    function renderList() {
      const s = store.state;
      const entries = [...(s.entries || [])].filter((e) => filter === 'all' || e.type === filter).sort((a, b) => M.toTime(b.date) - M.toTime(a.date));
      if (!entries.length) {
        $('#list', root).innerHTML = `<div class="panel ticks empty"><div class="e-art">dataset = []\nlen(dataset) == 0</div><h3>${filter === 'all' ? '数据集还是空的' : '这个类别还没有样本'}</h3><p>记录一段经历，让模型开始学习。</p><button class="btn primary" data-act="new2">${icon('plus', 15)} 记录第一个样本</button></div>`;
        $('[data-act="new2"]', root).onclick = () => openComposer(blank());
        return;
      }
      $('#list', root).innerHTML = `<div class="samples">${entries.map((e) => {
        const c = contribution(e);
        return `<article class="sample panel" data-id="${esc(e.id)}">
          <div class="sm-date num">${fmtDate(M.toTime(e.date), true).replace('年', '.').replace('月', '.').replace('日', '')}</div>
          <div class="sm-main">
            <div class="sm-top"><span class="chip chip-cn ${ENTRY_TYPE[e.type]?.practice ? 'accent' : ''}">${ENTRY_TYPE[e.type]?.name || '其他'}</span><h3>${esc(e.title)}</h3></div>
            ${e.desc ? `<p class="sm-desc">${esc(e.desc)}</p>` : ''}
            <div class="sm-gains">${Object.entries(e.skills || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="gain"><b>${esc(SKILL[k]?.name || k)}</b><span class="num">+${(+v).toFixed(2)}</span></span>`).join('') || '<span class="dim" style="font-size:12px">（记录型样本，无能力增益）</span>'}</div>
          </div>
          <div class="sm-side">
            <div class="num dim" style="font-size:11px">${e.hours || 0}h</div>
            ${c != null && c > 0.00005 ? `<div class="loss-delta" title="移除该样本 loss 将上升的量">▼${c.toFixed(4)}</div>` : ''}
            <div class="sm-acts"><button class="icon-btn" data-edit="${esc(e.id)}" title="编辑">${icon('edit', 15)}</button><button class="icon-btn" data-del="${esc(e.id)}" title="删除">${icon('trash', 15)}</button></div>
          </div>
        </article>`;
      }).join('')}</div>`;
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => {
        const e = store.state.entries.find((x) => x.id === b.dataset.edit);
        openComposer(JSON.parse(JSON.stringify(e)));
      }));
      $$('[data-del]', root).forEach((b) => (b.onclick = async () => {
        if (!(await confirmBox('删除这个样本？', '删除后，它带来的能力增益也会一并移除。', { ok: '删除', danger: true }))) return;
        store.update((st) => { st.entries = st.entries.filter((x) => x.id !== b.dataset.del); }, 'entry-del');
        toast('样本已删除');
      }));
    }

    function predicted() {
      const s = store.state;
      const role = M.roleById(s, s.target);
      if (!role || !editing) return null;
      const others = s.entries.filter((e) => e.id !== editing.id);
      const before = M.lossOf(M.skillsAt({ ...s, entries: others }), role);
      const after = M.lossOf(M.skillsAt({ ...s, entries: [...others, { ...editing, date: editing.date || M.today() }] }), role);
      return before - after;
    }

    function renderComposer() {
      const box = $('#composer', root);
      if (!editing) { box.innerHTML = ''; return; }
      const e = editing;
      const d = predicted();
      box.innerHTML = `
        <section class="panel ticks composer-panel">
          <div class="panel-h"><span class="ph-idx">${e.id ? 'EDIT' : 'NEW'}</span><span class="ph-title">${e.id ? '编辑样本' : '记录新样本'}</span><span class="ph-en">x → f(x)</span>
            <span class="ph-right"><button class="icon-btn" data-act="cancel" title="关闭">${icon('close', 16)}</button></span></div>
          <div class="panel-b cp-body">
            <div class="cp-left">
              <div class="field"><label>用一两句话描述这段经历（越具体，标注越准）</label>
                <textarea class="textarea" data-k="desc" placeholder="例：和 3 个同学参加了天池的新闻推荐比赛，我负责召回模块，用双塔模型 + Faiss，最终排名前 8%，花了大约 40 小时。">${esc(e.desc)}</textarea></div>
              <div class="row" style="justify-content:space-between">
                <span class="dim" style="font-size:12px">${icon('spark', 13)} 自动识别标题、类型、时长与能力增益</span>
                <button class="btn ai sm" data-act="tag" ${tagging ? 'disabled' : ''}>${tagging ? '<span class="spinner"></span> 标注中…' : `${icon('spark', 14)} AI 自动标注`}</button>
              </div>
              ${e.reason ? `<div class="cp-reason"><span class="kicker c-ai">∇ 标注理由</span> ${esc(e.reason)}</div>` : ''}
              <div class="grid-3" style="margin-top:4px">
                <div class="field" style="grid-column:span 3"><label>标题</label><input class="input" data-k="title" value="${esc(e.title)}" maxlength="40" placeholder="例：天池新闻推荐比赛 Top 8%"></div>
                <div class="field"><label>日期</label><input class="input num" type="date" data-k="date" value="${esc(e.date)}"></div>
                <div class="field"><label>投入（小时）</label><input class="input num" type="number" min="0" max="2000" data-k="hours" value="${e.hours}"></div>
                <div class="field"><label>类型</label><select class="select" data-k="type">${ENTRY_TYPES.map((t) => `<option value="${t.id}" ${t.id === e.type ? 'selected' : ''}>${t.name}${t.practice ? '（实践）' : ''}</option>`).join('')}</select></div>
              </div>
            </div>
            <div class="cp-right">
              <div class="row" style="justify-content:space-between"><span class="kicker">能力增益 · Δw</span><span class="kicker">0.1 轻度 · 0.5 系统 · 0.8 显著</span></div>
              <div class="gain-editor">
                ${SKILLS.map((k) => {
                  const v = +(e.skills[k.id] || 0);
                  return `<div class="ge-row ${v > 0 ? 'on' : ''}"><span class="ge-name">${k.name}</span><input type="range" class="range" min="0" max="1" step="0.05" value="${v}" data-g="${k.id}"><span class="num ge-v">${v > 0 ? `+${v.toFixed(2)}` : '—'}</span></div>`;
                }).join('')}
              </div>
              <div class="cp-pred">
                ${d != null ? `<span class="kicker">预计效果</span><span class="num ${d >= 0 ? 'c-accent' : 'c-loss'}" id="pred">loss ${d >= 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(4)}</span>` : '<span class="dim">设定目标后可预估 loss 变化</span>'}
              </div>
              <div class="row-end" style="margin-top:12px"><button class="btn ghost" data-act="cancel">取消</button><button class="btn primary" data-act="save">${icon('check', 15)} ${e.id ? '保存修改' : '加入数据集'}</button></div>
            </div>
          </div>
        </section>`;
      bindComposer();
    }

    function refreshPred() {
      const d = predicted();
      const el = $('#pred', root);
      if (el && d != null) { el.textContent = `loss ${d >= 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(4)}`; el.className = `num ${d >= 0 ? 'c-accent' : 'c-loss'}`; }
    }

    function bindComposer() {
      const box = $('#composer', root);
      $$('[data-k]', box).forEach((el) => el.addEventListener('input', () => {
        const k = el.dataset.k;
        editing[k] = k === 'hours' ? Math.max(0, +el.value || 0) : el.value;
        if (k === 'date') refreshPred();
      }));
      $$('[data-g]', box).forEach((el) => el.addEventListener('input', () => {
        const v = +el.value;
        if (v > 0) editing.skills[el.dataset.g] = v; else delete editing.skills[el.dataset.g];
        const row = el.closest('.ge-row');
        row.classList.toggle('on', v > 0);
        row.querySelector('.ge-v').textContent = v > 0 ? `+${v.toFixed(2)}` : '—';
        refreshPred();
      }));
      $$('[data-act="cancel"]', box).forEach((b) => (b.onclick = () => { editing = null; renderComposer(); }));
      $('[data-act="tag"]', box).onclick = autoTag;
      $('[data-act="save"]', box).onclick = save;
    }

    async function autoTag() {
      const text = (editing.desc || editing.title || '').trim();
      if (text.length < 6) { toast('先写一两句描述，AI 才能标注哦', { type: 'error' }); return; }
      tagging = true;
      renderComposer();
      try {
        const { data, mock } = await aiJSON('tag_entry', { text, type: editing.type });
        const skills = {};
        for (const [k, v] of Object.entries(data.skills || {})) if (SKILL[k]) skills[k] = Math.max(0.05, Math.min(1, Math.round((+v || 0) * 20) / 20));
        editing = {
          ...editing,
          title: editing.title || data.title || '',
          type: ENTRY_TYPE[data.type] ? data.type : editing.type,
          hours: data.hours ? Math.max(1, Math.round(+data.hours)) : editing.hours,
          skills,
          reason: `${mock ? '（演示模式）' : ''}${data.reason || data.summary || ''}`,
        };
        if (!editing.title) editing.title = data.title || '';
      } catch (e) {
        toast(e.message, { type: 'error' });
      } finally {
        tagging = false;
        renderComposer();
      }
    }

    function save() {
      const e = editing;
      if (!e.title.trim()) { toast('给样本起个标题吧', { type: 'error' }); return; }
      const s = store.state;
      const role = M.roleById(s, s.target);
      const before = role ? M.lossOf(M.skillsAt(s), role) : null;
      const isNew = !e.id;
      const entry = { id: e.id || uid('e'), type: e.type, title: e.title.trim(), date: e.date || M.today(), hours: +e.hours || 0, desc: e.desc.trim(), skills: e.skills };
      editing = null;
      renderComposer();
      store.update((st) => {
        st.entries = isNew ? [...st.entries, entry] : st.entries.map((x) => (x.id === entry.id ? entry : x));
      }, 'entry');
      if (role) lossToast(before, M.lossOf(M.skillsAt(store.state), role), entry.title);
      else toast('样本已加入数据集', { type: 'success' });
    }

    function openComposer(e) {
      editing = { reason: '', ...e, skills: { ...(e.skills || {}) } };
      renderComposer();
      setTimeout(() => $('#composer textarea', root)?.focus(), 50);
      root.closest('.main')?.scrollTo({ top: 0, behavior: 'smooth' });
    }

    $('[data-act="new"]', root).onclick = () => openComposer(blank());
    renderStats();
    renderFilters();
    renderList();
    if (ctx.params.get('new')) openComposer(blank());

    return {
      update() { renderStats(); renderFilters(); renderList(); },
    };
  },
};
