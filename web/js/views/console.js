// 控制台：训练总览。
import { store } from '../core/store.js';
import { SKILLS, RESOURCES, ENTRY_TYPE } from '../core/data.js';
import * as M from '../core/model.js';
import * as P from '../core/plans.js';
import { icon, esc, $, pad, countUp, relTime, fmtDate, reducedMotion } from '../core/ui.js';
import * as G from '../core/greet.js';
import { createNetwork } from '../viz/network.js';
import { createLandscape } from '../viz/landscape.js';
import { lossCurve, heatmap, weightBars, showTip, hideTip } from '../viz/charts.js';
import { batchPanel, bindBatch, ensureBatch } from './batch-ui.js';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
}

// ---------- 欢迎语 ----------
// 每次打开页面后第一次进入控制台时弹出；控制台重渲染（含云端同步后的重载）时保留，离开控制台后不再出现
const welcome = { status: 'pending', data: null, i: 0, timer: 0 };

// 标志：小球沿 loss 曲线滚进山谷（梯度下降），与顶栏品牌标识同源
const CURVE = 'M6 10C26 10 32 44 56 44';
function mascot(anim) {
  // 循环：滚下（约 1.5s）→ 在谷底停住 → 淡出，回到起点重来
  const ball = reducedMotion()
    ? '<circle r="5" class="wl-ball" cx="56" cy="44"/>'
    : `<circle r="5" class="wl-ball">
        <animateMotion dur="4.5s" begin="${anim ? 0.35 : 0}s" repeatCount="indefinite" calcMode="spline" keyPoints="0;1;1" keyTimes="0;.34;1" keySplines=".45 0 .25 1;0 0 1 1" path="${CURVE}"/>
        <animate attributeName="opacity" dur="4.5s" begin="${anim ? 0.35 : 0}s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.06;.88;1"/>
      </circle>`;
  return `<svg class="wl-mascot" viewBox="0 0 96 56" aria-hidden="true">
    <path d="M10 52C30 52 36 30 56 30S84 40 92 40" class="wl-contour"/>
    <path d="M14 56C30 56 38 38 56 38S82 46 92 46" class="wl-contour"/>
    <path d="${CURVE}C70 44 80 37 92 35" class="wl-curve" pathLength="120"/>
    ${ball}
  </svg>`;
}

function welcomeBox(anim) {
  const { hello, tag, pool } = welcome.data;
  const q = pool[welcome.i];
  return `<section class="welcome ${anim ? 'anim' : ''}" aria-label="欢迎语">
    <div class="wl-bar">
      <span class="wl-brand">EPOCH</span><span class="wl-tag">${esc(tag)}</span>
      <span class="wl-tools">
        <button class="wl-btn" data-wl="next" title="换一句" aria-label="换一句">${icon('refresh', 13)}</button>
        <button class="wl-btn" data-wl="close" title="收起" aria-label="收起欢迎语">${icon('close', 13)}</button>
      </span>
    </div>
    <div class="wl-body">
      ${mascot(anim)}
      <div class="wl-text">
        <div class="wl-hello">${esc(hello)}</div>
        <p class="wl-line" aria-label="${esc(q.line)}">${anim ? '' : esc(q.line)}</p>
        <div class="wl-by ${anim ? 'wait' : ''}"><span>—— ${esc(q.by)}</span>${q.note ? `<span class="wl-note">${esc(q.note)}</span>` : ''}</div>
      </div>
    </div>
  </section>`;
}

/** 逐字打出当前这句；标点处稍作停顿。 */
function typeLine(box, delay = 0) {
  clearTimeout(welcome.timer);
  const q = welcome.data.pool[welcome.i];
  const line = $('.wl-line', box);
  const by = $('.wl-by', box);
  line.setAttribute('aria-label', q.line);
  by.innerHTML = `<span>—— ${esc(q.by)}</span>${q.note ? `<span class="wl-note">${esc(q.note)}</span>` : ''}`;
  if (reducedMotion()) { line.textContent = q.line; by.classList.remove('wait'); return; }
  by.classList.add('wait');
  line.textContent = '';
  line.classList.add('caret');
  const chars = [...q.line];
  let n = 0;
  const tick = () => {
    line.textContent = chars.slice(0, ++n).join('');
    if (n < chars.length) welcome.timer = setTimeout(tick, /[，。；：？！、]/.test(chars[n - 1]) ? 240 : 70);
    else welcome.timer = setTimeout(() => { line.classList.remove('caret'); by.classList.remove('wait'); }, 500);
  };
  welcome.timer = setTimeout(tick, delay);
}

function bindWelcome(root, anim) {
  const box = $('.welcome', root);
  if (!box) return;
  if (anim) typeLine(box, 650);
  box.querySelector('[data-wl="next"]').onclick = () => {
    welcome.i = (welcome.i + 1) % welcome.data.pool.length;
    typeLine(box);
  };
  box.querySelector('[data-wl="close"]').onclick = () => {
    clearTimeout(welcome.timer);
    welcome.status = 'done';
    box.style.height = `${box.offsetHeight}px`;
    box.getBoundingClientRect();
    box.classList.add('closing');
    setTimeout(() => box.remove(), 380);
  };
}

function firstSteps(s) {
  const steps = [
    { done: (s.entries || []).length > 0, t: '记录第一个训练样本', d: '课程、项目、竞赛都算', href: '#/dataset?new=1' },
    { done: !!s.plan, t: '生成训练计划', d: '树形图设计者按梯度排好优先级', href: '#/schedule' },
    { done: (s.runs || []).length > 0, t: '开始一个实验', d: '做项目才是反向传播', href: '#/runs' },
    { done: (s.interviews || []).some((i) => i.report), t: '跑一次验证集', d: '模拟面试检验真实水平', href: '#/validate' },
    { done: (s.reviews || []).length > 0, t: '结束第一个 Epoch', d: '每周复盘，曲线开始记录', href: '#epoch' },
  ];
  const n = steps.filter((x) => x.done).length;
  if (n >= 4 || store.prefs.get('hideSteps')) return '';
  return `<section class="panel ticks first-steps">
    <div class="panel-h"><span class="ph-idx">BOOT</span><span class="ph-title">开始训练</span><span class="ph-en">first epoch checklist · ${n}/${steps.length}</span>
      <span class="ph-right"><button class="btn ghost sm" data-act="hide-steps">隐藏</button></span></div>
    <ol class="fs-list">${steps.map((x, i) => `<li class="${x.done ? 'done' : ''}"><a href="${x.href}" ${x.href === '#epoch' ? 'data-act="epoch2"' : ''}>
      <span class="fs-i mono">${x.done ? '✓' : String(i + 1).padStart(2, '0')}</span><span class="fs-t"><b>${x.t}</b><span>${x.d}</span></span></a></li>`).join('')}</ol>
  </section>`;
}

export default {
  title: '控制台',
  mount(root, ctx) {
    ensureBatch();
    const s = store.state;
    const S = M.skillsAt(s);
    const role = M.roleById(s, s.target);
    const { epoch, start, days } = M.epochInfo(s);
    const hist = role ? M.lossHistory(s) : [];
    const loss = hist.at(-1)?.loss;
    const prevLoss = hist.length > 1 ? hist.at(-2).loss : loss;
    const fit = role ? M.fitOf(loss) : 0;
    const step = M.globalStep(s);
    const hours = M.hoursSince(s, start);
    const budget = +s.profile.hoursPerWeek || 10;
    const lastIv = (s.interviews || []).filter((i) => i.report).at(-1);
    // 梯度按验证集校准后的能力来算：面试暴露的短板会排到前面
    const Sp = M.planningSkills(s, S);
    const calibrated = SKILLS.some((k) => Math.abs(Sp[k.id] - S[k.id]) > 0.05);
    const grads = role ? M.gradient(Sp, role).slice(0, 4) : [];
    const diags = M.diagnostics(s);
    const pendingTasks = (s.plan?.phases || []).flatMap((ph) => ph.tasks.filter((t) => !t.done));
    const recProj = M.recommendProjects(s, S);
    const recent = [...(s.entries || [])].sort((a, b) => M.toTime(b.date) - M.toTime(a.date)).slice(0, 5);
    const smoothing = store.prefs.get('smoothing', 0.6);

    const showWelcome = !store.sandboxed && welcome.status !== 'done';
    const animWelcome = showWelcome && welcome.status === 'pending';
    if (animWelcome) {
      const recent = store.prefs.get('greetRecent', []);
      welcome.data = G.greeting(s, { recent, lastHello: store.prefs.get('greetHello', '') });
      store.prefs.set('greetHello', welcome.data.helloKey);
      welcome.i = 0;
      welcome.status = 'shown';
      store.prefs.set('greetRecent', [welcome.data.pool[0].line, ...recent].slice(0, 12));
    }

    const usedProj = new Set();
    const actionFor = (g) => {
      const task = pendingTasks.find((t) => t.skill === g.id);
      if (task) return { kind: '计划任务', text: task.title, href: '#/schedule' };
      // 选“该能力增益最大”的实验，并避免多个梯度推荐同一个项目
      // 该能力增益足够大（≥0.3）的实验里，选对目标岗位整体价值最高的；多个梯度不重复推荐
      const proj = recProj.filter((p) => (p.project.skills[g.id] || 0) >= 0.3 && p.value > 0 && !usedProj.has(p.project.id))
        .sort((a, b) => b.value - a.value)[0];
      if (proj) { usedProj.add(proj.project.id); return { kind: '推荐实验', text: proj.project.title, href: '#/runs' }; }
      return { kind: '学习资源', text: RESOURCES[g.id][0], href: '#/schedule' };
    };
    const maxDelta = grads[0]?.delta || 1;

    root.innerHTML = `
    <div class="page ${ctx.again ? 'static' : ''}">
      ${showWelcome ? welcomeBox(animWelcome) : ''}
      <div class="page-head">
        <div class="page-title">
          <div class="path">~/epoch/<b>console</b> · epoch ${pad(epoch)} · day ${days + 1}</div>
          <h1>控制台</h1>
          <p class="page-desc">${showWelcome ? '' : `${greeting()}，${esc(s.profile.name || '同学')}。`}${role
            ? `你正在朝 <b class="c-accent">${esc(role.name)}</b> 收敛，当前拟合度 ${Math.round(fit * 100)}%。${grads[0] ? `本轮最陡的下降方向是「${esc(grads[0].skill.name)}」。` : ''}`
            : '还没有设定目标函数——先去地形图上挑一个山谷吧。'}</p>
        </div>
        <div class="page-actions">
          <a class="btn" href="#/dataset?new=1">${icon('plus', 15)} 记录样本</a>
          <button class="btn ai" data-act="adam">${icon('tree', 15)} 问树形图设计者</button>
          <button class="btn primary" data-act="epoch">${icon('flag', 15)} 结束 Epoch ${pad(epoch)}</button>
        </div>
      </div>

      <div class="readouts">
        <div class="readout r-loss"><div class="r-label kicker"><span>Loss</span><span>${role ? 'TRAIN' : ''}</span></div>
          <div class="r-value" data-count="${role ? loss : 0}" data-dec="4">${role ? loss.toFixed(4) : '—'}</div>
          <div class="r-sub">${!role ? '未设目标' : hist.length < 3 && Math.abs(prevLoss - loss) < 1e-6 ? '初始 loss' : `<span class="${prevLoss - loss >= 0 ? 'down' : 'up'}">${prevLoss - loss >= 0 ? '▼' : '▲'} ${Math.abs(prevLoss - loss).toFixed(4)}</span> vs 上个 epoch`}</div></div>
        <div class="readout"><div class="r-label kicker"><span>Fit 拟合度</span></div>
          <div class="r-value"><span data-count="${fit * 100}" data-dec="1">${(fit * 100).toFixed(1)}</span><small>%</small></div>
          <div class="r-sub">= 1 − √loss</div></div>
        <div class="readout"><div class="r-label kicker"><span>Epoch</span></div>
          <div class="r-value">${pad(epoch)}</div>
          <div class="r-sub">本轮已 ${days} 天</div></div>
        <div class="readout"><div class="r-label kicker"><span>Global step</span></div>
          <div class="r-value" data-count="${step}" data-dec="0">${step}</div>
          <div class="r-sub">${(s.entries || []).length} 样本 · ${step - (s.entries || []).length} 次迭代</div></div>
        <div class="readout"><div class="r-label kicker"><span>本轮投入</span><span>LR</span></div>
          <div class="r-value">${hours.toFixed(0)}<small>/${budget}h</small></div>
          <div class="r-sub"><span class="meter" style="display:block;margin-top:8px"><i style="width:${Math.min(100, (hours / budget) * 100)}%;${hours > budget * 1.6 ? 'background:var(--loss)' : ''}"></i></span></div></div>
        <div class="readout"><div class="r-label kicker"><span>Val acc</span><span>面试</span></div>
          <div class="r-value">${lastIv ? lastIv.report.overall : '—'}${lastIv ? '<small>/100</small>' : ''}</div>
          <div class="r-sub">${lastIv ? `${esc(lastIv.report.verdict || '')} · ${relTime(lastIv.t)}` : '<a href="#/validate" class="c-target">去做一次验证 →</a>'}</div></div>
      </div>

      ${batchPanel({ compact: true })}
      ${firstSteps(s)}
      <div class="console-grid">
        <section class="panel ticks span-8 net-panel">
          <div class="panel-h"><span class="ph-idx">01</span><span class="ph-title">你的网络</span><span class="ph-en">forward pass</span>
            <span class="ph-right"><span class="kicker hide-sm">点击岗位查看详情</span></span></div>
          <canvas class="net-canvas" aria-label="能力-岗位网络图"></canvas>
        </section>

        <section class="panel ticks span-4 grad-panel">
          <div class="panel-h"><span class="ph-idx">02</span><span class="ph-title">梯度方向</span><span class="ph-en">−∇loss · next step</span></div>
          <div class="panel-b">
            ${role ? (grads.length ? `<p class="dim grad-intro">每项能力 +0.5 可带来的 loss 下降，越长越值得投入${calibrated ? '（已按验证集校准）' : ''}：</p>
            <ol class="grads">${grads.map((g, i) => {
              const a = actionFor(g);
              return `<li class="grad">
                <div class="g-top"><span class="g-i mono">${pad(i + 1, 2)}</span><b>${esc(g.skill.name)}</b><span class="loss-delta">▼${g.delta.toFixed(4)}</span></div>
                <div class="g-arrow"><i style="width:${(g.delta / maxDelta) * 100}%"></i></div>
                <div class="g-meta num dim">${Sp[g.id].toFixed(1)}${Math.abs(Sp[g.id] - S[g.id]) > 0.05 ? `<span class="c-ai" title="训练集估计 ${S[g.id].toFixed(2)}，已按模拟面试表现校准"> (val)</span>` : ''} → ${role.req[g.id]} · 差距 ${g.gap.toFixed(1)}</div>
                <a class="g-act" href="${a.href}"><span class="chip">${a.kind}</span><span>${esc(a.text)}</span>${icon('arrow', 13)}</a>
                ${(() => { const up = P.upcomingFor(s, g.id); return up.length ? `<a class="g-plan" href="#/pretrain">${icon('book', 13)}<span>培养方案：${P.semLabel(up[0].s)}《${esc(up[0].n)}》${up.length > 1 ? `等 ${up.length} 门课` : ''}会覆盖一部分</span></a>` : ''; })()}
              </li>`;
            }).join('')}</ol>` : '<div class="empty"><h3>已收敛 🎯</h3><p>所有能力都达到了目标要求，去验证集检验一下吧。</p></div>')
            : `<div class="empty"><div class="e-art">∇ = undefined</div><h3>没有目标函数，就没有梯度</h3><a class="btn primary" href="#/objective">选择目标岗位</a></div>`}
          </div>
        </section>

        <section class="panel ticks span-7">
          <div class="panel-h"><span class="ph-idx">03</span><span class="ph-title">训练曲线</span><span class="ph-en hide-md">loss / epoch</span>
            <span class="ph-right"><button class="btn ghost sm" data-act="replay" title="训练回放：拖动时间轴回看任意 epoch，或导出视频">${icon('play', 12)} 回放</button><label class="smooth-ctl kicker">smoothing <input type="range" class="range" min="0" max="0.95" step="0.05" value="${smoothing}" data-smooth><span class="num" id="smv">${smoothing.toFixed(2)}</span></label></span></div>
          ${role && M.valEvidence(s).length ? '<div class="lc-legend"><span><i class="train"></i>train loss</span><a href="#/validate" title="用模拟面试逐题得分校准后的 loss"><i class="val"></i>val loss · 模拟面试校准</a></div>' : ''}
          <div class="panel-b" id="curve">${role ? '' : '<div class="empty">设定目标后显示 loss 曲线</div>'}</div>
        </section>

        <section class="panel ticks span-5">
          <div class="panel-h"><span class="ph-idx">04</span><span class="ph-title">权重</span><span class="ph-en">skills vs requirement</span>
            <span class="ph-right wb-legend"><span><i class="lg-cur"></i>当前</span><span><i class="lg-gap"></i>差距</span><span><i class="lg-req"></i>要求</span></span></div>
          <div class="panel-b">${weightBars(S, role, SKILLS, { compact: true })}</div>
        </section>

        <section class="panel ticks span-5">
          <div class="panel-h"><span class="ph-idx">05</span><span class="ph-title">训练日志</span><span class="ph-en">diagnostics</span></div>
          <div class="panel-b log-lines mono">
            ${diags.map((d) => `<div class="log-line"><span class="lv ${d.level}">[${d.level === 'ok' ? ' OK ' : d.level.toUpperCase()}]</span><span class="lc">${esc(d.code)}</span><span class="lm">${esc(d.msg)}</span></div>`).join('')}
          </div>
        </section>

        <section class="panel ticks span-3 mini-land">
          <div class="panel-h"><span class="ph-idx">06</span><span class="ph-title">地形图</span><span class="ph-right"><a class="icon-btn" href="#/objective" title="打开完整地形图">${icon('arrow', 15)}</a></span></div>
          <canvas class="land-canvas" aria-label="损失地形图缩略"></canvas>
        </section>

        <section class="panel ticks span-4">
          <div class="panel-h"><span class="ph-idx">07</span><span class="ph-title">注意力分布</span><span class="ph-en">hours / day</span></div>
          <div class="panel-b">
            <div class="hm-wrap" id="hm"></div>
            <div class="recent">
              ${recent.length ? recent.map((e) => `<a class="recent-row" href="#/dataset"><span class="chip chip-cn">${ENTRY_TYPE[e.type]?.name || '其他'}</span><span class="rr-t">${esc(e.title)}</span><span class="dim num">${fmtDate(M.toTime(e.date))}</span></a>`).join('')
                : '<div class="dim" style="font-size:12.5px">还没有样本。<a class="c-target" href="#/dataset?new=1">记录第一段经历 →</a></div>'}
            </div>
          </div>
        </section>
      </div>
    </div>`;

    const net = createNetwork($('.net-canvas', root), {
      getState: () => store.state,
      onSelectRole: (id) => ctx.navigate(`/objective?role=${id}`),
      onHover: (h, e) => {
        if (!h || !e) return hideTip();
        if (h.type === 'out') showTip(`<div class="tt-k">OUTPUT · ${esc(h.node.role.en || '')}</div><b>${esc(h.node.role.name)}</b><div class="num" style="margin-top:4px">fit ${Math.round(h.node.fit * 100)}% · loss ${h.node.loss.toFixed(4)}</div>`, e.clientX, e.clientY);
        else if (h.type === 'in') showTip(`<div class="tt-k">INPUT · ${esc(h.node.k.en)}</div><b>${esc(h.node.k.name)}</b> <span class="num">${h.node.v.toFixed(2)}</span><div class="dim" style="font-size:11.5px">${esc(h.node.k.desc)}</div>`, e.clientX, e.clientY);
        else showTip(`<div class="tt-k">HIDDEN · ${esc(h.node.en)}</div><b>${esc(h.node.name)}</b> <span class="num">${Math.round(h.node.act * 100)}</span>`, e.clientX, e.clientY);
      },
    });
    const land = createLandscape($('.land-canvas', root), { mode: 'mini', getState: () => store.state });
    const unbindBatch = bindBatch(root, ctx);
    if (showWelcome) bindWelcome(root, animWelcome);

    const drawCurve = () => {
      if (!role) return;
      const val = M.valHistory(store.state);
      lossCurve($('#curve', root), { series: [{ main: true, points: M.lossHistory(store.state) }, ...(val.length ? [{ points: val, color: 'var(--ai)', label: 'val' }] : [])], smoothing: store.prefs.get('smoothing', 0.6), height: 230 });
    };
    drawCurve();
    heatmap($('#hm', root), M.dailyHours(s, 140), { weeks: 18 });

    root.querySelector('[data-smooth]').addEventListener('input', (e) => {
      store.prefs.set('smoothing', +e.target.value);
      $('#smv', root).textContent = (+e.target.value).toFixed(2);
      drawCurve();
    });
    root.querySelector('[data-act="epoch"]').onclick = ctx.endEpoch;
    root.querySelector('[data-act="epoch2"]')?.addEventListener('click', (e) => { e.preventDefault(); ctx.endEpoch(); });
    root.querySelector('[data-act="hide-steps"]')?.addEventListener('click', () => { store.prefs.set('hideSteps', true); root.querySelector('.first-steps').remove(); });
    root.querySelector('[data-act="adam"]').onclick = () => ctx.openAdam();
    root.querySelector('[data-act="replay"]').onclick = async () => (await import('./replay.js')).openReplay();
    if (!ctx.again) root.querySelectorAll('[data-count]').forEach((el) => countUp(el, +el.dataset.count, { decimals: +el.dataset.dec, from: +el.dataset.dec === 4 ? Math.min(1, +el.dataset.count + 0.2) : 0 }));
    if (ctx.again) net.pulse();

    return {
      resize: drawCurve,
      destroy() { net.destroy(); land.destroy(); unbindBatch(); hideTip(); clearTimeout(welcome.timer); if (welcome.status === 'shown' && !location.hash.startsWith('#/console')) welcome.status = 'done'; },
    };
  },
};
