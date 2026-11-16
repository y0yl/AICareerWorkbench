// 分支推演：树形图设计者把“换方向 / 加投入 / 只靠课程”等选择展开成一棵树，逐周推演每条分支通向哪里。
import { store, uid } from '../core/store.js';
import { SKILLS } from '../core/data.js';
import * as M from '../core/model.js';
import * as PR from '../core/project.js';
import { icon, esc, $, $$, modal, toast, confirmBox, fmtDate, reducedMotion, debounce } from '../core/ui.js';
import { showTip, hideTip, weightBars } from '../viz/charts.js';

const COLORS = ['var(--accent-line)', 'var(--target)', 'var(--ai)', 'var(--warn)', 'var(--loss)'];
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const ym = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default {
  title: '分支推演',
  mount(root, ctx) {
    let hz = store.prefs.get('branchHorizon', '6m');
    let selected = null;
    let tree = null;
    let drawn = false;

    function compute() {
      const s = store.state;
      const list = PR.horizons(s);
      if (!list.some((h) => h.id === hz)) hz = list.at(-1).id;
      tree = PR.buildTree(s, list.find((h) => h.id === hz).end);
      const keys = tree.groups.flatMap((g) => g.leaves.map((l) => l.key));
      if (!keys.includes(selected)) selected = tree.groups.find((g) => g.current)?.leaves[0].key || tree.best || keys[0];
      return list;
    }
    const leafOf = (key) => {
      for (const g of tree.groups) for (const l of g.leaves) if (l.key === key) return { g, l };
      return null;
    };

    function render() {
      const s = store.state;
      const list = compute();
      if (!tree.groups.length) {
        root.innerHTML = `<div class="page"><div class="empty"><h3>还没有可推演的方向</h3><a class="btn primary" href="#/objective">先设定目标函数</a></div></div>`;
        return;
      }
      const end = list.find((h) => h.id === hz).end;
      const n = tree.groups.reduce((a, g) => a + g.leaves.length, 0);
      root.innerHTML = `
      <div class="page ${ctx.again ? 'static' : ''}">
        <div class="page-head">
          <div class="page-title">
            <div class="path">~/epoch/<b>branches</b> · tree.expand(now)</div>
            <h1>分支推演</h1>
            <p class="page-desc">树形图设计者把你面前的选择展开成一棵树：换一个方向、加大投入、或者只靠课程。每条分支都交给同一套训练引擎逐周推演到 ${fmtDate(end, true)}——用的是你真实的能力向量、培养方案里还没上的课，以及你最近 ${tree.nRate || ''}${tree.nRate ? ' 轮' : ''} batch 的完成率${tree.nRate ? `（${Math.round(tree.rate * 100)}%）` : '（暂无记录，按 75% 估计）'}。</p>
          </div>
          <div class="page-actions">
            <div class="seg" data-hz>${list.map((h) => `<button type="button" data-v="${h.id}" class="${h.id === hz ? 'on' : ''}">${h.name}</button>`).join('')}</div>
            <button class="btn" data-act="add">${icon('plus', 15)} 自定义分支</button>
            <button class="btn ai" data-act="ask">${icon('tree', 15)} 让树形图设计者评估</button>
          </div>
        </div>

        <section class="panel ticks tree-panel">
          <div class="panel-h"><span class="ph-idx">TREE</span><span class="ph-title">决策树</span><span class="ph-en hide-sm">${n} branches · horizon ${ym(end)} · converge @ fit ${Math.round(PR.CONVERGE_FIT * 100)}%</span>
            <span class="ph-right kicker hide-sm">点击叶子查看推演</span></div>
          <div class="tree" id="tree">
            <svg class="tr-edges" aria-hidden="true"></svg>
            <div class="tr-root">
              <div class="kicker">ROOT · NOW</div>
              <b>${esc(s.profile.name || '你')}</b>
              <span class="dim num">${fmtDate(tree.now, true)}</span>
              <span class="tr-root-meta num">${tree.hours}h/周 · 完成率 ${Math.round(tree.rate * 100)}%</span>
            </div>
            <div class="tr-groups">
              ${tree.groups.map((g) => groupHTML(g)).join('')}
            </div>
          </div>
        </section>

        <div class="br-grid">
          <section class="panel ticks br-chart-panel">
            <div class="panel-h"><span class="ph-idx">PROJ</span><span class="ph-title">推演曲线</span><span class="ph-en hide-sm" id="chartSub"></span>
              <span class="ph-right br-legend" id="chartLegend"></span></div>
            <div class="panel-b" id="brChart"></div>
          </section>
          <section class="panel ticks br-detail" id="brDetail"></section>
        </div>
      </div>`;
      bind();
      renderSelection();
      drawEdges(!drawn && !ctx.again && !reducedMotion());
      drawn = true;
    }

    function groupHTML(g) {
      const c = COLORS[g.gi % COLORS.length];
      const bestFit = Math.max(...g.leaves.map((l) => l.sim.fit));
      return `<div class="tr-group" style="--c:${c}" data-g="${g.gi}">
        <div class="tr-l1" data-l1="${g.gi}">
          <div class="kicker">${g.current ? 'TARGET · 当前目标' : `BRANCH ${String.fromCharCode(65 + g.gi)}`}</div>
          <b>${esc(g.role.name)}</b>
          <span class="num tr-l1-fit">${pc(g.fitNow)} <span class="dim">→ 最高 ${pc(bestFit)}</span></span>
        </div>
        <div class="tr-leaves">${g.leaves.map((l) => leafHTML(g, l)).join('')}</div>
      </div>`;
    }

    function leafHTML(g, l) {
      const d = l.sim.fit - g.fitNow;
      const pts = l.sim.points.map((p) => p.fit);
      const spark = pts.length > 1 ? (() => {
        const w = 64, h = 20, lo = Math.min(g.fitNow, ...pts) - 0.01, hi = Math.max(PR.CONVERGE_FIT, ...pts);
        const y = (v) => (h - 1 - ((v - lo) / (hi - lo || 1)) * (h - 2)).toFixed(1);
        return `<svg class="tr-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(PR.CONVERGE_FIT)}" y2="${y(PR.CONVERGE_FIT)}" class="tr-spark-conv"/><polyline points="${pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${y(v)}`).join(' ')}"/></svg>`;
      })() : '';
      return `<button class="tr-leaf ${l.key === selected ? 'on' : ''} ${l.mode === 'none' ? 'base' : ''}" data-leaf="${esc(l.key)}">
        <span class="tr-leaf-main">
          <span class="tr-leaf-name">${esc(l.name)}${l.key === tree.best ? '<span class="chip accent">最优路径</span>' : ''}${l.custom ? '<span class="chip">自定义</span>' : ''}</span>
          <span class="tr-leaf-note dim">${esc(l.note)}</span>
        </span>
        ${spark}
        <span class="tr-leaf-out">
          <b class="num">${pc(l.sim.fit)}</b>
          <span class="num ${d > 0.0005 ? 'c-accent' : 'dim'}">${d > 0.0005 ? '▲' : '·'}${(Math.abs(d) * 100).toFixed(1)}</span>
        </span>
        <span class="tr-eta num ${l.sim.eta ? 'ok' : ''}" title="首次达到收敛线（拟合度 ${Math.round(PR.CONVERGE_FIT * 100)}%）的时间">${l.sim.eta ? (l.sim.eta <= tree.now ? '已收敛' : `${ym(l.sim.eta)} 收敛`) : '未收敛'}</span>
      </button>`;
    }

    // —— 连线：根 → 方向 → 叶子，三次贝塞尔；粗细随叶子终点拟合度变化 ——
    function drawEdges(animate = false) {
      const wrap = $('#tree', root);
      const svg = $('.tr-edges', root);
      if (!wrap || !svg) return;
      const box = wrap.getBoundingClientRect();
      if (getComputedStyle(svg).display === 'none' || !box.width) { svg.innerHTML = ''; return; }
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      svg.setAttribute('width', box.width);
      svg.setAttribute('height', box.height);
      const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, y: r.top - box.top + r.height / 2 }; };
      const curve = (a, b) => { const mx = (a[0] + b[0]) / 2; return `M${a[0]},${a[1]}C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`; };
      const rootEl = rel($('.tr-root', root));
      const sel = leafOf(selected);
      let out = '';
      for (const g of tree.groups) {
        const l1 = rel($(`[data-l1="${g.gi}"]`, root));
        const on = sel?.g === g;
        out += `<path d="${curve([rootEl.r, rootEl.y], [l1.l, l1.y])}" class="tr-edge ${on ? 'on' : ''}" style="--c:${COLORS[g.gi % COLORS.length]};stroke-width:${on ? 2 : 1.2}"/>`;
        for (const l of g.leaves) {
          const lf = rel($(`[data-leaf="${CSS.escape(l.key)}"]`, root));
          const w = 0.8 + Math.max(0, l.sim.fit - 0.2) * 3.2;
          out += `<path d="${curve([l1.r, l1.y], [lf.l, lf.y])}" class="tr-edge ${l.key === selected ? 'on' : ''} ${l.mode === 'none' ? 'base' : ''}" style="--c:${COLORS[g.gi % COLORS.length]};stroke-width:${w.toFixed(2)}"/>`;
        }
      }
      out += `<circle cx="${rootEl.r}" cy="${rootEl.y}" r="3.5" class="tr-knot"/>`;
      svg.innerHTML = out;
      if (animate) {
        $$('.tr-edge', svg).forEach((p, i) => {
          const len = p.getTotalLength();
          p.style.strokeDasharray = `${len}`;
          p.style.strokeDashoffset = `${len}`;
          p.getBoundingClientRect();
          p.style.transition = `stroke-dashoffset .7s cubic-bezier(.2,.7,.1,1) ${0.05 + i * 0.035}s`;
          p.style.strokeDashoffset = '0';
          p.addEventListener('transitionend', () => { p.style.strokeDasharray = ''; p.style.transition = ''; }, { once: true });
        });
      }
    }

    function renderSelection() {
      const hit = leafOf(selected);
      if (!hit) return;
      $$('.tr-leaf', root).forEach((b) => b.classList.toggle('on', b.dataset.leaf === selected));
      $$('.tr-group', root).forEach((el) => el.classList.toggle('on', +el.dataset.g === hit.g.gi));
      drawChart(hit.g, hit.l);
      renderDetail(hit.g, hit.l);
    }

    // —— 推演曲线：实线是走过的路（按该方向计算的历史拟合度），虚线是各条分支 ——
    function drawChart(g, sel) {
      const el = $('#brChart', root);
      const s = store.state;
      const W = Math.max(320, el.clientWidth || 640);
      const H = 280;
      const m = { l: 40, r: 18, t: 16, b: 28 };
      const hist = M.lossHistory(s, g.role.id).map((p) => ({ t: p.live ? tree.now : p.t, fit: M.fitOf(p.loss) }));
      const t0 = Math.min(hist[0]?.t ?? tree.now, tree.now - 4 * 7 * 86400000);
      const t1 = tree.end;
      const all = [...hist.map((p) => p.fit), ...g.leaves.flatMap((l) => l.sim.points.map((p) => p.fit)), PR.CONVERGE_FIT];
      const lo = Math.max(0, Math.floor(Math.min(...all) * 10 - 0.5) / 10);
      const hi = Math.min(1, Math.ceil(Math.max(...all) * 10 + 0.3) / 10);
      const X = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
      const Y = (v) => m.t + (1 - (v - lo) / (hi - lo || 1)) * (H - m.t - m.b);
      const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.fit).toFixed(1)}`).join('');
      const grid = [];
      for (let v = lo; v <= hi + 1e-9; v += 0.1) grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="lc-grid"/><text x="${m.l - 8}" y="${Y(v) + 3}" class="lc-ax" text-anchor="end">${Math.round(v * 100)}%</text>`);
      const months = [];
      const d = new Date(t0); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() + 1);
      const span = (t1 - t0) / (30 * 86400000);
      const every = span > 24 ? 6 : span > 12 ? 3 : span > 6 ? 2 : 1;
      for (; d.getTime() < t1; d.setMonth(d.getMonth() + 1)) {
        if (d.getMonth() % every) continue;
        months.push(`<text x="${X(d.getTime())}" y="${H - 8}" class="lc-ax" text-anchor="middle">${d.getMonth() === 0 ? d.getFullYear() : `${d.getMonth() + 1}月`}</text>`);
      }
      const sems = PR.semesterMarks(s, tree.now, t1).map((x) => `<line x1="${X(x.t)}" x2="${X(x.t)}" y1="${m.t}" y2="${H - m.b}" class="br-sem"/><text x="${X(x.t) + 4}" y="${m.t + 9}" class="br-sem-t">${esc(x.label)}</text>`).join('');
      const c = COLORS[g.gi % COLORS.length];
      const curves = g.leaves.map((l) => `<path d="${path(l.sim.points)}" class="br-proj ${l.key === sel.key ? 'on' : ''} ${l.mode === 'none' ? 'base' : ''}" style="--c:${c}"/>`).join('');
      const endDot = sel.sim.points.at(-1);
      const eta = sel.sim.eta && sel.sim.eta > tree.now ? `<circle cx="${X(sel.sim.eta)}" cy="${Y(PR.CONVERGE_FIT)}" r="4" class="br-eta"/><text x="${X(sel.sim.eta)}" y="${Y(PR.CONVERGE_FIT) - 9}" class="br-eta-t" text-anchor="middle">${ym(sel.sim.eta)}</text>` : '';
      el.innerHTML = `<svg class="br-chart" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="分支推演曲线">
        <rect x="${X(tree.now)}" y="${m.t}" width="${Math.max(0, W - m.r - X(tree.now))}" height="${H - m.t - m.b}" class="br-future"/>
        ${grid.join('')}${months.join('')}${sems}
        <line x1="${m.l}" x2="${W - m.r}" y1="${Y(PR.CONVERGE_FIT)}" y2="${Y(PR.CONVERGE_FIT)}" class="lc-conv"/>
        <text x="${m.l + 6}" y="${Y(PR.CONVERGE_FIT) - 5}" class="lc-conv-t">收敛线 · ${Math.round(PR.CONVERGE_FIT * 100)}%</text>
        <path d="${path(hist)}" class="br-hist"/>
        ${curves}
        <line x1="${X(tree.now)}" x2="${X(tree.now)}" y1="${m.t - 4}" y2="${H - m.b}" class="lr-now"/>
        <text x="${X(tree.now) + 5}" y="${H - m.b - 6}" class="lr-now-t">NOW</text>
        <circle cx="${X(tree.now)}" cy="${Y(hist.at(-1)?.fit ?? g.fitNow)}" r="3.5" class="br-now-dot"/>
        ${eta}
        <circle cx="${X(endDot.t)}" cy="${Y(endDot.fit)}" r="4.5" class="br-end" style="--c:${c}"/>
        <line class="lc-cross" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"/>
        <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="br-hit"/>
      </svg>`;
      $('#chartSub', root).textContent = `${g.role.en || g.role.name} · fit / time`;
      $('#chartLegend', root).innerHTML = `<span><i class="lg-hist"></i>走过的路</span><span><i class="lg-proj" style="--c:${c}"></i>${esc(sel.name)}</span><span><i class="lg-other"></i>同方向其他分支</span>`;

      const svg = $('svg', el);
      const cross = $('.lc-cross', svg);
      $('.br-hit', svg).addEventListener('mousemove', (ev) => {
        const r = svg.getBoundingClientRect();
        const t = t0 + (((ev.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r) * (t1 - t0);
        cross.setAttribute('x1', X(t)); cross.setAttribute('x2', X(t)); cross.setAttribute('visibility', 'visible');
        const at = (pts) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), pts[0]);
        const rows = t <= tree.now
          ? [`<div class="num">走过的路 <b>${pc(at(hist).fit)}</b></div>`]
          : g.leaves.map((l) => `<div class="num ${l.key === sel.key ? '' : 'dim'}">${esc(l.name)} <b>${pc(at(l.sim.points).fit)}</b></div>`);
        showTip(`<div class="tt-k">${esc(fmtDate(t, true))} · ${esc(g.role.name)}</div>${rows.join('')}`, ev.clientX, ev.clientY);
      });
      $('.br-hit', svg).addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
    }

    function renderDetail(g, l) {
      const s = store.state;
      const base = g.base;
      const courseGain = base ? base.fit - g.fitNow : 0;
      const selfGain = l.sim.fit - (base ? base.fit : g.fitNow);
      const gaps = SKILLS.map((k) => ({ k, gap: (g.role.req[k.id] || 0) - l.sim.S[k.id] })).filter((x) => x.gap > 0.05).sort((a, b) => b.gap - a.gap).slice(0, 3);
      const weeks = Math.round((tree.end - tree.now) / (7 * 86400000));
      $('#brDetail', root).innerHTML = `
        <div class="panel-h"><span class="ph-idx">LEAF</span><span class="ph-title">${esc(g.role.name)} · ${esc(l.name)}</span>
          ${l.custom ? `<span class="ph-right"><button class="icon-btn" data-act="del" title="删除这条自定义分支">${icon('trash', 15)}</button></span>` : ''}</div>
        <div class="panel-b">
          <div class="br-out">
            <div><div class="kicker">现在</div><div class="num">${pc(g.fitNow)}</div></div>
            <span class="br-arrow">${icon('arrow', 16)}</span>
            <div><div class="kicker">${ym(tree.end)}</div><div class="num big" style="color:${COLORS[g.gi % COLORS.length]}">${pc(l.sim.fit)}</div></div>
            <div class="br-eta-box ${l.sim.eta ? 'ok' : ''}"><div class="kicker">收敛</div><div class="num">${l.sim.eta ? (l.sim.eta <= tree.now ? '已达到' : ym(l.sim.eta)) : '推演期内未达到'}</div></div>
          </div>
          <div class="br-split">
            <div class="kicker">拟合度增长从哪来</div>
            <div class="br-split-bar">
              <i class="course" style="flex:${Math.max(0.001, courseGain)}" title="培养方案课程"></i>
              <i class="self" style="flex:${Math.max(0.001, selfGain)};--c:${COLORS[g.gi % COLORS.length]}" title="自主训练"></i>
            </div>
            <div class="br-split-l"><span><i class="course"></i>课程 <b class="num">+${(courseGain * 100).toFixed(1)}</b></span><span><i class="self" style="--c:${COLORS[g.gi % COLORS.length]}"></i>自主训练 <b class="num">+${(Math.max(0, selfGain) * 100).toFixed(1)}</b></span><span class="dim num">${Math.round(l.sim.hours)} 有效小时 / ${weeks} 周</span></div>
          </div>
          <div class="br-gaps">
            <div class="kicker">${gaps.length ? `推演终点仍差的能力` : '推演终点'}</div>
            ${gaps.length ? gaps.map((x) => `<div class="br-gap"><span>${esc(x.k.name)}</span><span class="num">${l.sim.S[x.k.id].toFixed(1)} / ${g.role.req[x.k.id]}</span><span class="num c-loss">−${x.gap.toFixed(1)}</span></div>`).join('') : '<p class="dim" style="font-size:12.5px">所有能力都达到岗位要求。</p>'}
          </div>
          <details class="br-weights"><summary class="kicker">终点能力向量</summary>${weightBars(l.sim.S, g.role, SKILLS, { compact: true })}</details>
          <div class="br-acts">
            ${g.current ? '' : `<button class="btn" data-act="target">${icon('objective', 14)} 设为目标函数</button>`}
            <button class="btn ai" data-act="replan">${icon('tree', 14)} 按这条分支调整路径</button>
          </div>
          <p class="br-note dim">推演按你的历史学习效率（${tree.kHours >= 40 ? `按过去 ${Math.round(tree.kHours)} 小时实测、取保守值` : '记录不足，取默认值'}：每有效小时 +${tree.k.toFixed(3)} 累计增益）、${l.mode === 'none' ? '不额外投入' : esc(PR.MODES[l.mode]?.desc || '')}计算，课程在学期末计入。它说明“照这样走大概会到哪”，不是承诺。</p>
        </div>`;
      const d = $('#brDetail', root);
      d.querySelector('[data-act="target"]')?.addEventListener('click', () => {
        store.update((st) => { st.target = g.role.id; }, 'target');
        toast(`目标函数已切换为「${g.role.name}」`, { type: 'success' });
      });
      d.querySelector('[data-act="replan"]').onclick = () => ctx.openAdam(replanPrompt(g, l));
      d.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
        if (!(await confirmBox('删除这条分支？', '只删除推演设置，不影响你的训练数据。', { ok: '删除', danger: true }))) return;
        store.update((st) => { st.whatIf = (st.whatIf || []).filter((x) => x.id !== l.key); }, 'whatif');
      });
    }

    const brief = (g, l) => `${g.role.name} · ${l.name}（${l.note}）：拟合度 ${pc(g.fitNow)} → ${pc(l.sim.fit)}，${l.sim.eta ? `${ym(l.sim.eta)} 达到收敛线` : '推演期内未收敛'}`;
    function replanPrompt(g, l) {
      const gaps = SKILLS.map((k) => ({ k, gap: (g.role.req[k.id] || 0) - l.sim.S[k.id] })).filter((x) => x.gap > 0.05).sort((a, b) => b.gap - a.gap).slice(0, 3);
      return `我在「分支推演」里选了这条分支，推演到 ${fmtDate(tree.end, true)}：${brief(g, l)}。${gaps.length ? `到那时仍差：${gaps.map((x) => `${x.k.name} ${x.gap.toFixed(1)}`).join('、')}。` : ''}${g.current ? '' : `这不是我现在的目标（${M.roleById(store.state, store.state.target)?.name || '未设定'}）。`}请按这条分支调整我接下来的路径：哪些任务该删、该缩小、该新增，下周先做什么。`;
    }
    function askPrompt() {
      const lines = tree.groups.flatMap((g) => g.leaves.map((l) => `- ${brief(g, l)}`));
      return `我在「分支推演」里把选择展开成了一棵树（推演到 ${fmtDate(tree.end, true)}，按我近期完成率 ${Math.round(tree.rate * 100)}%）：\n${lines.join('\n')}\n请帮我比较这些分支：哪条最值得走、代价是什么、有没有被推演忽略的风险（比如兴趣、实习时间窗、${tree.goal || '升学/就业'}）？给出你的建议，如需调整计划请附上操作。`;
    }

    function addBranch() {
      const s = store.state;
      const roles = M.allRoles(s);
      const { rate } = PR.historicalRate(s);
      modal({
        title: '自定义分支',
        kicker: 'WHAT-IF · 新的一条路',
        body: `<form id="wiForm" style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>分支名称</label><input class="input" name="name" maxlength="16" placeholder="例：暑假实习冲刺 / 下学期课多" required></div>
          <div class="field"><label>方向（目标岗位）</label><select class="select" name="role">${roles.map((r) => `<option value="${esc(r.id)}" ${r.id === s.target ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
          <div class="field"><label>训练方式</label><div class="seg" data-mode>${Object.entries(PR.MODES).map(([k, v], i) => `<button type="button" data-v="${k}" class="${i === 0 ? 'on' : ''}" title="${esc(v.desc)}">${v.name}</button>`).join('')}</div></div>
          <div class="grid-2" data-effort>
            <div class="field"><label>每周投入（小时）</label><input class="input num" name="hours" type="number" min="1" max="60" value="${s.profile.hoursPerWeek || 10}"></div>
            <div class="field"><label>预计完成率 <span class="num" data-rv>${Math.round(rate * 100)}%</span></label><input class="range" name="rate" type="range" min="0.2" max="1" step="0.05" value="${(Math.round(rate * 20) / 20).toFixed(2)}"></div>
          </div>
          <p class="dim" style="font-size:12px" data-hint>${esc(PR.MODES.grad.desc)}。完成率默认取你最近几轮 batch 的真实值。</p>
          <div class="row-end"><button class="btn primary" type="submit">${icon('tree', 14)} 展开这条分支</button></div>
        </form>`,
        onMount(panel, close) {
          const f = panel.querySelector('#wiForm');
          let mode = 'grad';
          panel.querySelectorAll('[data-mode] button').forEach((b) => (b.onclick = () => {
            mode = b.dataset.v;
            panel.querySelectorAll('[data-mode] button').forEach((x) => x.classList.toggle('on', x === b));
            panel.querySelector('[data-effort]').classList.toggle('hidden', mode === 'none');
            panel.querySelector('[data-hint]').textContent = PR.MODES[mode].desc;
          }));
          f.rate.oninput = () => { panel.querySelector('[data-rv]').textContent = `${Math.round(f.rate.value * 100)}%`; };
          f.onsubmit = (e) => {
            e.preventDefault();
            const b = { id: uid('wi'), name: f.name.value.trim().slice(0, 16), roleId: f.role.value, mode, hours: Math.max(1, Math.min(60, +f.hours.value || 10)), rate: +f.rate.value };
            store.update((st) => { st.whatIf = [...(st.whatIf || []), b].slice(-6); }, 'whatif');
            selected = b.id;
            close();
            render();
            toast('分支已展开', { type: 'success' });
          };
        },
      });
    }

    function bind() {
      $$('[data-hz] button', root).forEach((b) => (b.onclick = () => { hz = b.dataset.v; store.prefs.set('branchHorizon', hz); render(); }));
      $('[data-act="add"]', root).onclick = addBranch;
      $('[data-act="ask"]', root).onclick = () => ctx.openAdam(askPrompt());
      $('#tree', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-leaf]');
        if (b) { selected = b.dataset.leaf; renderSelection(); drawEdges(); }
        const g = e.target.closest('[data-l1]');
        if (g) { selected = tree.groups[+g.dataset.l1].leaves[0].key; renderSelection(); drawEdges(); }
      });
    }

    render();
    const redraw = debounce(() => { const hit = leafOf(selected); if (hit) drawChart(hit.g, hit.l); drawEdges(); }, 60);
    // 字体加载完成后节点尺寸会变化，重新连线
    document.fonts?.ready.then(() => drawEdges());
    return {
      update(reason) { if (['chat', 'batch-auto'].includes(reason)) return; render(); },
      resize: redraw,
      destroy: hideTip,
    };
  },
};
