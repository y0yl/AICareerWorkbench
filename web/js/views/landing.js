// 首页：用“梯度下降的地形图”讲清楚整个隐喻。
import { store } from '../core/store.js';
import { icon, esc, $ } from '../core/ui.js';
import { createLandscape } from '../viz/landscape.js';
import { createNetwork } from '../viz/network.js';
import { lossCurve } from '../viz/charts.js';
import { demoState } from '../core/demo.js';
import { lossHistory, valHistory, generalization, diagnostics, gradient, skillsAt, roleById, recommendProjects, lossOf, fitOf, adaptiveBatch } from '../core/model.js';
import * as T from '../core/testset.js';
import { ROLES, SKILL as SKILLS_BY_ID, ENTRY_TYPE } from '../core/data.js';
import { generateBatch, WEEKDAYS, DAY } from '../core/batch.js';
import { buildTree } from '../core/project.js';

const short = (t, n) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** 4 步工作流：每一步配一块用示例学生真实数据算出来的小样。 */
function flowSteps(demo) {
  const S = skillsAt(demo);
  const role = roleById(demo, demo.target);
  const loss = lossOf(S, role);
  // ① 目标：岗位要求 vs 当前能力，取差距最大的 4 项
  const gaps = Object.entries(role.req).filter(([, r]) => r >= 3).map(([id, r]) => ({ id, r, s: S[id] }))
    .sort((x, y) => (y.r - y.s) - (x.r - x.s)).slice(0, 4);
  const skName = (id) => SKILLS_BY_ID[id]?.name || id;
  const art1 = `<div class="fs-art-h mono"><span>${esc(role.name)}</span><b>fit ${(fitOf(loss) * 100).toFixed(1)}%</b></div>
    ${gaps.map((g) => `<div class="fs-gap"><span>${esc(skName(g.id))}</span><span class="fs-gbar"><i style="width:${(g.s / 5) * 100}%"></i><em style="left:${(g.r / 5) * 100}%"></em></span><span class="num dim">${g.s.toFixed(1)}/${g.r}</span></div>`).join('')}
    <div class="fs-leg dim"><span><i class="cur"></i>现在</span><span><i class="req"></i>岗位要求</span></div>`;
  // ② 经历：最近 3 条，附 AI 标注的能力增益
  const ents = [...(demo.entries || [])].sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 3);
  const art2 = ents.map((e) => `<div class="fs-ent"><span class="fs-ty mono">${esc(ENTRY_TYPE[e.type]?.name || '经历')}</span><span class="fs-et">${esc(short(e.title, 20))}</span>
    <span class="fs-gain">${Object.entries(e.skills).slice(0, 2).map(([k, v]) => `<span class="mono">+${Number(v).toFixed(2)} ${esc(SKILLS_BY_ID[k]?.name || k)}</span>`).join('')}</span></div>`).join('');
  // ③ 梯度：每项能力 +0.5 能让 loss 降多少
  const g = gradient(S, role).slice(0, 3);
  const gmax = g[0]?.delta || 1;
  const proj = recommendProjects(demo, S)[0]?.project;
  const art3 = g.map((x, i) => `<div class="fs-grad ${i ? '' : 'top'}"><span>${esc(x.skill.name)}</span><span class="fs-gb"><i style="width:${(x.delta / gmax) * 100}%"></i></span><span class="num">▼${x.delta.toFixed(3)}</span></div>`).join('')
    + (proj ? `<div class="fs-rec">${icon('arrow', 12)} 推荐项目：<b>${esc(short(proj.title, 18))}</b></div>` : '');
  // ④ 复盘：每周一个点的 loss 曲线
  const hist = lossHistory(demo);
  const W = 260, H = 76, mx = Math.max(...hist.map((p) => p.loss)), mn = Math.min(...hist.map((p) => p.loss));
  const xy = hist.map((p, i) => [6 + (i / (hist.length - 1)) * (W - 12), 8 + ((mx - p.loss) / (mx - mn || 1)) * (H - 16)]);
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const last = xy.at(-1);
  const art4 = `<div class="fs-art-h mono"><span>EPOCH ${String(hist.length - 1).padStart(3, '0')}</span><b class="c-accent">loss ▼${(((hist[0].loss - hist.at(-1).loss) / hist[0].loss) * 100).toFixed(0)}%</b></div>
    <svg class="fs-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${line} L${last[0]},${H} L6,${H} Z" class="fs-area"/><path d="${line}" class="fs-line"/>${xy.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="1.8" class="fs-dot"/>`).join('')}<circle cx="${last[0]}" cy="${last[1]}" r="4" class="fs-me"/></svg>
    <div class="fs-axis mono dim"><span>${hist[0].loss.toFixed(3)}</span><span>${hist.length - 1} 周</span><span>${hist.at(-1).loss.toFixed(3)}</span></div>`;
  // 每一步挂 3 个模块：12 个功能都在首页露面，但只用一行说清楚
  const M = (ml, name, desc) => ({ ml, name, desc });
  return [
    { n: '01', title: '定下方向', desc: '选一个岗位或贴一段真实 JD，系统立刻算出你和它差在哪。', art: art1, mods: [
      M('目标函数', '职业目标', '选岗位或贴 JD，实时算出差距'),
      M('分支推演', '方向选择', '换方向会怎样？逐周推演到毕业'),
      M('预训练', '培养方案', '示例 AI 课程按学期自动计入能力'),
    ] },
    { n: '02', title: '把做过的事记下来', desc: '课程、项目、竞赛都算数，AI 自动标注每段经历涨了哪些能力。', art: art2, mods: [
      M('数据集', '经历档案', '每段经历自动标注能力增益'),
      M('实验', '项目实践', '按里程碑推进，每步一次 checkpoint'),
      M('推理导出', '成果输出', '一键生成规划书、简历草稿和海报'),
    ] },
    { n: '03', title: '拿到最划算的下一步', desc: '先补哪项离目标最快，直接排进这周的任务。', art: art3, mods: [
      M('梯度', '下一步行动', '补哪项能力离目标最快'),
      M('训练计划', '学习路线', '按短板和时间预算排进每一周'),
      M('树形图设计者', 'AI 导师', '落后时减量、改期，必要时换方向'),
    ] },
    { n: '04', title: '每周复盘、检验', desc: '一周一个点，曲线往下走就是在进步；面试官帮你验证是不是真会。', art: art4, mods: [
      M('Epoch', '每周复盘', '一周一个点，画出你的 loss 曲线'),
      M('验证集', '模拟面试', 'AI 面试官出题、追问、打分'),
      M('变更日志', '路径调整', '每次改计划都留下原因和记录'),
    ] },
  ];
}

function logLines(demo) {
  const S = skillsAt(demo);
  const g = gradient(S, roleById(demo, demo.target))[0];
  const p = recommendProjects(demo, S)[0]?.project;
  const lines = diagnostics(demo).slice(0, 3).map((d) => `<div><span class="lv ${d.level}">[${d.level.toUpperCase()}]</span> ${esc(d.code)} · ${esc(d.msg)}</div>`);
  if (g) lines.push(`<div><span class="lv info">[GRAD]</span> ∇ 最大梯度：${esc(g.skill.name)}（+0.5 → loss ▼${g.delta.toFixed(3)}）${p ? ` → 推荐「${esc(p.title)}」` : ''}</div>`);
  return lines.join('');
}


// 树形图：从“现在的你”出发，展开拟合度最高的几个职业分支，每条分支再接上它最陡的梯度方向（真实计算）
function treeDiagram(demo) {
  const S = skillsAt(demo);
  // 每个方向按“保持节奏”推演半年后的拟合度（与「分支推演」页同一套引擎）
  const proj = Object.fromEntries(buildTree(demo, Date.now() + 26 * 7 * DAY).groups.map((g) => [g.role.id, g.leaves.find((l) => l.key.endsWith(':keep'))?.sim.fit]));
  const target = roleById(demo, demo.target);
  let roles = ROLES.map((r) => ({ r, fit: fitOf(lossOf(S, r)) })).sort((a, b) => b.fit - a.fit).slice(0, 4);
  if (target && !roles.some((x) => x.r.id === target.id)) roles = [{ r: target, fit: fitOf(lossOf(S, target)) }, ...roles.slice(0, 3)];
  const W = 600, H = 320, x0 = 46, x1 = 236, x2 = 420;
  const ys = roles.map((_, i) => 46 + i * ((H - 92) / (roles.length - 1 || 1)));
  const curve = (ax, ay, bx, by) => `M${ax} ${ay} C ${(ax + bx) / 2} ${ay}, ${(ax + bx) / 2} ${by}, ${bx} ${by}`;
  const parts = roles.map(({ r, fit }, i) => {
    const on = target && r.id === target.id;
    const g = gradient(S, r).slice(0, 2);
    const kids = g.map((x, j) => {
      const y = ys[i] + (j - (g.length - 1) / 2) * 22;
      return `<path d="${curve(x1 + 8, ys[i], x2 - 6, y)}" class="td-l ${on ? 'on' : ''}"/><circle cx="${x2}" cy="${y}" r="3" class="td-n2 ${on ? 'on' : ''}"/>
        <text x="${x2 + 10}" y="${y + 4}" class="td-t2">∇ ${esc(x.skill.name)} <tspan class="td-d">▼${x.delta.toFixed(3)}</tspan></text>`;
    }).join('');
    return `<path d="${curve(x0 + 10, H / 2, x1 - 8, ys[i])}" class="td-l ${on ? 'on' : ''}"/>${kids}
      <circle cx="${x1}" cy="${ys[i]}" r="7" class="td-n1 ${on ? 'on' : ''}"/>
      <text x="${x1}" y="${ys[i] - 14}" text-anchor="middle" class="td-t1 ${on ? 'on' : ''}">${esc(r.name)}</text>
      <text x="${x1}" y="${ys[i] + 22}" text-anchor="middle" class="td-fit">fit ${Math.round(fit * 100)}%${proj[r.id] ? ` → 半年 ${Math.round(proj[r.id] * 100)}%` : ''}</text>`;
  }).join('');
  return `<svg class="td-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="职业分支树形图">
    ${parts}
    <circle cx="${x0}" cy="${H / 2}" r="10" class="td-root"/><text x="${x0}" y="${H / 2 + 30}" text-anchor="middle" class="td-t1">现在的你</text>
  </svg>`;
}

/** 日历小样：示例学生本周接下来的 3 个任务，按默认时段排开。 */
function calendarArt(demo) {
  const b = demo.batch || generateBatch(demo);
  const rows = b.tasks.filter((t) => !t.done && t.src !== 'ritual').slice(0, 3);
  return `<div class="tc-head mono"><span>Epoch 本周训练</span><span>${rows.length} 个日程</span></div>${rows.map((t) => {
    const d = new Date(b.weekStart + t.day * DAY);
    const at = t.day >= 5 ? '10:00' : '19:30';
    return `<div class="tc-row"><span class="tc-day mono"><b>${d.getDate()}</b>${WEEKDAYS[t.day]}</span><span class="tc-ev"><span class="mono">${at} · ${t.hours}h</span>${esc(t.title.length > 22 ? `${t.title.slice(0, 22)}…` : t.title)}</span></div>`;
  }).join('')}`;
}

function chatDemo(demo) {
  // 用示例学生的本周 batch 演示一次“调整”：最重的一项改到下周，第二重的减量，再删掉一条梯度微任务
  const open = (demo.batch || generateBatch(demo)).tasks.filter((t) => !t.done && t.src !== 'ritual');
  const heavy = [...open].sort((a, b) => b.hours - a.hours);
  const drop = open.find((t) => t.src === 'grad' && t !== heavy[0] && t !== heavy[1]);
  const cut = (t) => esc(t.title.length > 20 ? `${t.title.slice(0, 20)}…` : t.title);
  const items = [
    heavy[0] && `「${cut(heavy[0])}」${WEEKDAYS[heavy[0].day]} → 下周二`,
    heavy[1] && `「${cut(heavy[1])}」${heavy[1].hours}h → 1.5h`,
    drop && `删除本周任务「${cut(drop)}」`,
  ].filter(Boolean);
  return `
    <div class="msg user"><div class="m-av">你</div><div class="m-body">这周有点吃不消，任务越积越多，看着就烦。</div></div>
    <div class="msg assistant"><div class="m-av">${icon('tree', 14)}</div><div class="m-body prose">
      <p>落后的时候硬塞只会更烦。我按这周的真实进度重新演算了一遍：最重的一项挪到下周，另一项拆小，再去掉一条对目标贡献最低的。节奏保住了，方向不变：</p>
      <div class="act-card" id="demoCard">
        <div class="act-h">${icon('spark', 14)}<b>调整路径：改期 1 · 调整工时 1 · 删减 1</b></div>
        <ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>
        <div class="act-f"><button class="btn primary sm" data-act="demo-apply">${icon('check', 13)} 执行</button><span class="dim">确认后写入你的训练数据</span></div>
      </div>
    </div></div>`;
}

/** 泛化差距小样：训练集估计 vs 面试体现。 */
function genArt(demo) {
  const g = generalization(demo);
  if (!g.items.length) return '';
  return `<div class="lv-gen-top mono"><span>train <b class="c-loss">${g.train.toFixed(4)}</b></span><span>val <b style="color:var(--ai)">${g.val.toFixed(4)}</b></span><span>gap <b class="${g.gap > 0 ? 'c-warn' : 'c-accent'}">${g.gap >= 0 ? '+' : ''}${g.gap.toFixed(4)}</b></span></div>
    ${g.items.slice(0, 5).map((x) => `<div class="gen-row"><span>${esc(x.skill.name)}</span><span class="gen-bar"><i class="tr" style="left:${(x.S / 5) * 100}%"></i><i class="va" style="left:${(x.m / 5) * 100}%"></i><b style="left:${(Math.min(x.S, x.m) / 5) * 100}%;width:${(Math.abs(x.S - x.m) / 5) * 100}%" class="${x.gap > 0 ? 'over' : 'under'}"></b></span><span class="num ${x.gap >= 0.8 ? 'c-loss' : 'dim'}">${x.gap >= 0 ? '−' : '+'}${Math.abs(x.gap).toFixed(1)}</span></div>`).join('')}
    <div class="gen-legend dim"><span><i class="tr"></i>训练集估计（自评 + 经历）</span><span><i class="va"></i>面试体现</span></div>`;
}
/** 错题本小样。 */
function hardArt(demo) {
  return (demo.hardQs || []).slice(0, 4).map((h) => `<div class="lv-hard"><span class="hr-boxes">${T.BOXES.map((_, i) => `<i class="${i < h.box ? 'on' : i === h.box ? 'cur' : ''}"></i>`).join('')}</span><span class="lv-hq">${esc(h.q)}</span></div>`).join('')
    + `<div class="lv-int mono dim">${T.BOXES.map((d) => `${d}d`).join(' → ')} → 掌握</div>`;
}
/** 测试集漏斗小样。 */
function funnelArt(demo) {
  const f = T.funnel(demo);
  const max = Math.max(1, f.levels[0].n);
  return `<div class="funnel lv-funnel">${f.levels.map((l, i) => `<div class="fn-step"><div class="fn-bar"><i style="height:${Math.max(4, (l.n / max) * 100)}%" class="${i === 4 ? 'win' : ''}"></i></div><b class="num">${l.n}</b><span class="kicker">${l.name}</span></div>`).join('')}</div>
    ${T.rejectionStats(demo).list.map((r) => `<span class="chip loss">${esc(r.name)} ×${r.n}</span>`).join(' ')}`;
}
/** 桌面小组件小样（与真实小组件同一套样式语言）。 */
function widgetArt(demo) {
  const b = demo.batch;
  const hist = lossHistory(demo);
  const loss = hist.at(-1).loss;
  const d = (new Date().getDay() + 6) % 7;
  const today = (b?.tasks || []).filter((t) => t.day === d).slice(0, 2);
  const list = today.length ? today : (b?.tasks || []).slice(0, 2);
  return `<div class="wg">
    <div class="wg-h mono"><b>EPOCH ${String(hist.length - 1).padStart(3, '0')}</b><span>今天</span></div>
    ${list.map((t) => `<div class="wg-t ${t.done ? 'done' : ''}"><i></i><span>${esc(t.title)}</span></div>`).join('')}
    <div class="wg-fit mono"><b>${(fitOf(loss) * 100).toFixed(1)}<small>%</small></b><span>loss ${loss.toFixed(4)}</span></div>
    <div class="wg-bar"><i style="width:${fitOf(loss) * 100}%"></i></div>
  </div>`;
}
/** 训练回放小样：地形上的一串 epoch 点 + 时间轴。 */
function replayArt(demo) {
  const pts = lossHistory(demo);
  const W = 260, H = 150;
  const xy = pts.map((p, i) => [20 + (i / (pts.length - 1)) * (W - 40), 18 + p.loss * (H - 40) / Math.max(...pts.map((q) => q.loss))]);
  const k = Math.round(xy.length * 0.6);
  return `<svg viewBox="0 0 ${W} ${H + 26}" class="rp-svg" aria-hidden="true">
    ${[0, 1, 2, 3].map((i) => `<ellipse cx="${W * 0.72}" cy="${H * 0.78}" rx="${30 + i * 34}" ry="${12 + i * 14}" class="rp-c"/>`).join('')}
    <path d="${xy.slice(0, k + 1).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" class="rp-path"/>
    <path d="${xy.slice(k).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" class="rp-path ghost"/>
    ${xy.slice(0, k).map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2" class="rp-d"/>`).join('')}
    <circle cx="${xy[k][0]}" cy="${xy[k][1]}" r="5" class="rp-me"/>
    <line x1="20" x2="${W - 20}" y1="${H + 12}" y2="${H + 12}" class="rp-track"/><line x1="20" x2="${xy[k][0]}" y1="${H + 12}" y2="${H + 12}" class="rp-fill"/><circle cx="${xy[k][0]}" cy="${H + 12}" r="4" class="rp-me"/>
  </svg>`;
}

export default {
  title: '',
  mount(root, ctx) {
    const has = !!store.state;
    const demo = demoState();
    root.innerHTML = `
    <div class="landing">
      <section class="hero">
        <canvas class="hero-canvas" aria-hidden="true"></canvas>
        <div class="hero-veil"></div>
        <nav class="land-nav">
          <a class="brand" href="#/">
            <svg class="brand-mark" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M1 6V1h5M20 1h5v5M25 20v5h-5M6 25H1v-5" stroke="var(--line-3)" stroke-width="1.2"/><path d="M5 7c3.5 0 4.5 11 9.5 11 3 0 4.5-1.3 6.5-1.3" stroke="var(--line-3)" stroke-width="1.6" stroke-linecap="round"/><path d="M5 7c3.5 0 4.5 11 9.5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="14.5" cy="18" r="2.6" fill="currentColor"/></svg>
            <span class="brand-word">EPOCH</span>
          </a>
          <span class="nav-upd mono hidden" data-upd></span>
          <div class="land-links">
            <a href="#concept" data-scroll>理念</a><a href="#modules" data-scroll>模块</a><a href="#preview" data-scroll>预览</a><a href="#mentor" data-scroll>AI 导师</a><a href="#tools" data-scroll>工具</a>
            <button class="icon-btn" data-act="theme" aria-label="切换主题">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', 17)}</button>
            <button class="btn sm outline" data-act="account">${store.auth ? esc(store.auth.username) : '登录'}</button>
          </div>
        </nav>
        <div class="hero-copy">
          <div class="hero-cmd mono"><span class="dim">$</span> <span id="typed"></span><span class="cursor">▍</span></div>
          <h1 class="hero-title"><span>训练</span><span>你自己<em>.</em></span></h1>
          <p class="hero-en mono">TRAIN YOURSELF — AN AI CAREER WORKBENCH</p>
          <p class="hero-lede">Epoch 是为<strong>人工智能专业</strong>学生打造的生涯训练台。把职业目标写成<em>目标函数</em>，把每一段经历当作<em>训练样本</em>，让 AI 导师沿着<em>梯度</em>，陪你一步步收敛到想成为的人。</p>
          <div class="hero-cta">
            ${has
              ? `<a class="btn primary lg" href="#/console">继续训练 ${icon('arrow', 16)}</a><a class="btn lg outline" href="#/init">重新初始化</a>`
              : `<a class="btn primary lg" href="#/init">初始化我的模型 ${icon('arrow', 16)}</a><button class="btn lg outline" data-act="demo">${icon('layers', 14)} 载入示例训练</button>`}
            <button class="btn lg ai tour-btn" data-act="tour">${icon('play', 14)} 观看动画演示</button>
          </div>
          <div class="hero-meta mono">
            <span><i class="pulse on"></i> ${ROLES.length} 个职业谷底</span><span>12 维能力向量</span><span>内置示例培养方案</span><a href="#mentor" data-scroll>AI 导师 · 树形图设计者</a><span>未登录时数据仅保存在本地浏览器</span>
          </div>
        </div>
        <div class="hero-legend mono" aria-hidden="true">
          <div><i class="lg-line"></i> 等高线 = loss</div>
          <div><i class="lg-dot"></i> 小球 = 正在训练的学生</div>
          <div><i class="lg-cross"></i> 谷底 = 职业目标</div>
        </div>
        <a class="hero-scroll" href="#concept" data-scroll aria-label="向下滚动了解更多">
          <span class="hs-label">向下滑动，了解 Epoch 如何运作</span>
          <span class="hs-mouse" aria-hidden="true"><i></i></span>
          <svg class="hs-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </a>
      </section>

      <section class="land-sec" id="concept">
        <div class="sec-head">
          <div class="kicker">01 · Concept</div>
          <h2 class="sec-title">把机器学习的语言，<br>翻译成生涯规划。</h2>
          <p class="sec-desc">你每天都在训练模型，却很少用同样严谨的方式训练自己。用起来只有四步，12 个功能分别落在这四步里。下面的数字都来自示例学生「林间」的真实数据。</p>
        </div>
        <ol class="flow" id="modules">
          ${flowSteps(demo).map((st) => `
            <li class="flow-step">
              <div class="fs-top"><span class="fs-n mono">${st.n}</span><span class="fs-ml mono">STEP</span></div>
              <h3 class="fs-title">${esc(st.title)}</h3>
              <p class="fs-desc">${esc(st.desc)}</p>
              <div class="fs-art">${st.art}</div>
              <ul class="fs-mods">${st.mods.map((m) => `<li><span class="fs-mn">${esc(m.name)}<code>${esc(m.ml)}</code></span><span class="fs-md">${esc(m.desc)}</span></li>`).join('')}</ul>
            </li>`).join('')}
        </ol>
      </section>

      <section class="land-sec" id="preview">
        <div class="sec-head">
          <div class="kicker">02 · Observability</div>
          <h2 class="sec-title">让成长变得可观测。</h2>
          <p class="sec-desc">示例学生「林间」在 14 个 epoch 里的真实训练过程：左边是他的能力网络——信号从 12 项能力出发，经过能力簇，激活 10 个职业；右边是他朝“大模型算法工程师”收敛的 loss 曲线——实线是训练 loss，紫色虚线是用模拟面试校准后的验证 loss。</p>
        </div>
        <div class="preview-grid">
          <div class="panel ticks preview-net">
            <div class="panel-h"><span class="ph-idx">NET</span><span class="ph-title">能力网络 · 前向传播</span><span class="ph-right kicker">悬停查看连接</span></div>
            <canvas class="net-canvas"></canvas>
          </div>
          <div class="preview-side">
            <div class="panel ticks">
              <div class="panel-h"><span class="ph-idx">LOSS</span><span class="ph-title">训练曲线</span><span class="ph-right kicker">train / <span style="color:var(--ai)">val</span> · EMA 0.6</span></div>
              <div class="panel-b" id="landCurve"></div>
            </div>
            <div class="panel ticks diag-demo">
              <div class="panel-h"><span class="ph-idx">LOG</span><span class="ph-title">训练诊断</span></div>
              <div class="panel-b mono log-lines">${logLines(demo)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="land-sec ai-sec" id="mentor">
        <div class="sec-head">
          <div class="kicker c-ai">03 · Tree Diagram</div>
          <h2 class="sec-title">树形图设计者：<br>路径会跟着你一起变。</h2>
          <p class="sec-desc">任务清单的问题是：它写好就不再变。落后一次，任务越积越多，坚持久了只剩烦躁。树形图设计者把你的每个选择展开成一棵树形图，并在你使用的过程中<b>不断重算</b>——做完了什么、卡在哪里、状态好不好、面试暴露了什么短板，都会让它删减、拆小、改期或换方向，让路径始终贴合现在的你。</p>
        </div>
        <div class="ai-vs">
          <div class="vs-col vs-list">
            <div class="vs-k mono">TODO LIST · 静态清单</div>
            <ul><li>写好就固定，不管你这周过得怎样</li><li>落后一次，未完成越积越多</li><li>坚持全靠意志力，越用越烦</li></ul>
          </div>
          <div class="vs-arrow mono" aria-hidden="true">→</div>
          <div class="vs-col vs-tree">
            <div class="vs-k mono">TREE DIAGRAM · 动态路径</div>
            <ul><li>每个 epoch 按真实进展重新演算</li><li>吃不消时先减量、拆小、改期</li><li>新经历、新目标进来，路径随之改道</li></ul>
          </div>
        </div>
        <div class="ai-grid">
          <div class="panel ticks ai-tree">
            <div class="panel-h"><span class="ph-idx">TREE</span><span class="ph-title">分支演算</span><span class="ph-right kicker">示例学生「林间」· 实时计算</span></div>
            <div class="panel-b">${treeDiagram(demo)}
              <p class="td-cap dim">每个分支是一个职业方向：fit 为现在的拟合度，箭头后是按你的真实完成率推演半年后的值；末端是这条路上最陡的梯度方向。完整的决策树（方向 × 投入、推演曲线、自定义分支）在「分支推演」页。</p></div>
          </div>
          <div class="panel ticks ai-chat">
            <div class="panel-h"><span class="ph-idx">CHAT</span><span class="ph-title">对话即调整</span><span class="ph-right kicker">点一下“执行”试试</span></div>
            <div class="panel-b ai-chat-b">${chatDemo(demo)}</div>
          </div>
        </div>
        <div class="ai-caps">
          <div class="ai-cap"><div class="ai-cap-k mono">01 · ADAPTIVE</div><h3>路径持续重算</h3><p>每轮复盘后按完成率与状态重排：落后就减量，超前就加速——下一周的工作量由 AdamW 按你的完成率自动调节。每一次调整都像 git 提交一样记进变更日志，有理由、有 diff。</p></div>
          <div class="ai-cap"><div class="ai-cap-k mono">02 · CONTEXT</div><h3>看得见全部状态，也记得住你</h3><p>能力向量、梯度、培养方案、面试暴露的短板、真实投递结果都在它的视野里；你提过的时间安排与偏好会存进长期记忆，不用反复解释。</p></div>
          <div class="ai-cap"><div class="ai-cap-k mono">03 · ACTION</div><h3>建议直接落地</h3><p>新增、删减、改期、预排下周、开一个实验都生成操作卡片，你点“执行”才写入；说一句“我刚做完 X”，它就整理成一条带能力增益的训练样本。</p></div>
          <div class="ai-cap"><div class="ai-cap-k mono">04 · ROLES</div><h3>不止是导师</h3><p>还能扮演面试官出题追问、撰写生涯规划书与简历草稿；只谈学习与生涯，不越界。</p></div>
        </div>
      </section>

      <section class="land-sec lv-sec" id="validation">
        <div class="sec-head">
          <div class="kicker">04 · Generalization</div>
          <h2 class="sec-title">在验证集里，<br>测出真实的你。</h2>
          <p class="sec-desc">自评和经历只是训练集。Epoch 用三层检验防止“只在训练集上好看”：模拟面试的<b>每一道题</b>都按能力维度计分，反过来校准你的能力估计；答砸的题进入<b>错题本</b>按间隔重复复测；真实投递记在<b>测试集</b>里，被拒的原因是真实世界给出的梯度。</p>
        </div>
        <div class="lv-grid">
          <div class="panel ticks"><div class="panel-h"><span class="ph-idx">VAL</span><span class="ph-title">泛化差距</span><span class="ph-right kicker">train vs val</span></div>
            <div class="panel-b">${genArt(demo)}<p class="lv-cap dim">面试 6 分（合格）≈ 能力 2.5，按证据量与时间衰减收缩到训练估计上。差距大的能力会被诊断为过拟合，并优先排进本周任务。</p></div></div>
          <div class="panel ticks"><div class="panel-h"><span class="ph-idx">HARD</span><span class="ph-title">错题本 · 难例挖掘</span><span class="ph-right kicker">spaced repetition</span></div>
            <div class="panel-b">${hardArt(demo)}<p class="lv-cap dim">低于 6 分的题自动入库。答好一次升一档、答砸回到第一档；到期的题会穿插进下一场模拟面试。</p></div></div>
          <div class="panel ticks"><div class="panel-h"><span class="ph-idx">TEST</span><span class="ph-title">测试集 · 真实投递</span><span class="ph-right kicker">held-out</span></div>
            <div class="panel-b">${funnelArt(demo)}<p class="lv-cap dim">每次投递的阶段、时间线与结果；被拒原因进入训练诊断，真实面试题一键收进错题本。</p></div></div>
        </div>
      </section>

      <section class="land-sec tools-sec" id="tools">
        <div class="sec-head">
          <div class="kicker">05 · Everyday</div>
          <h2 class="sec-title">训练要发生在<br>真实的一周里。</h2>
          <p class="sec-desc">规划写得再好，也要落到日历上、放在手机桌面上，成果也该拿得出手。</p>
        </div>
        <div class="tools-grid">
          <div class="tool panel ticks">
            <div class="tool-art tool-cal" aria-hidden="true">${calendarArt(demo)}</div>
            <div class="tool-k mono">WEBCAL · 日历订阅</div><h3>本周任务，自动进日历</h3>
            <p>订阅一次，iPhone、Google、Outlook 日历就会跟着 batch 自动更新：按你设定的时段依次排开，带验收标准和提醒。也可以一键导出 .ics。</p>
          </div>
          <div class="tool panel ticks">
            <div class="tool-art tool-home" aria-hidden="true">
              <div class="th-phone"><div class="th-grid"><div class="th-widget">${widgetArt(demo)}</div><span class="th-app"><img src="icons/icon-192.png" alt=""><b>Epoch</b></span>${'<i></i>'.repeat(7)}</div></div>
            </div>
            <div class="tool-k mono">WIDGET · 桌面小组件</div><h3>今天做什么，抬手就看见</h3>
            <p>手机桌面小组件显示今天的任务、拟合度与本周进度，内容可选、按尺寸自动取舍（iPhone 用 Scriptable，安卓用网页小组件）。Epoch 也能像 App 一样装到主屏幕，离线可用。</p>
          </div>
          <div class="tool panel ticks">
            <div class="tool-art tool-share" aria-hidden="true"><div class="ts-card" id="shareMini"></div></div>
            <div class="tool-k mono">PNG · 分享卡</div><h3>训练报告，拿得出手</h3>
            <p>一张 3:4 海报：你在损失地形上走过的轨迹、loss 曲线与 12 维能力，全部由训练数据实时绘制，可隐去姓名。</p>
          </div>
          <div class="tool panel ticks">
            <div class="tool-art tool-replay" aria-hidden="true">${replayArt(demo)}</div>
            <div class="tool-k mono">REPLAY · 训练回放</div><h3>回看每一个 epoch</h3>
            <p>拖动时间轴，看小球在地形图上怎样一步步滚向目标、每一周写下了什么；一键录成视频，放进答辩或发给朋友。</p>
          </div>
          <div class="tool panel ticks">
            <div class="tool-art tool-snap" aria-hidden="true"><div class="sn-win"><div class="sn-bar mono"><i></i><i></i><i></i><span>epoch · /#/view/…</span></div><div class="sn-body"><span class="sn-pill">${icon('layers', 12)} 只读快照 · 修改不会保存</span><div class="sn-lines"><i></i><i></i><i style="width:60%"></i></div></div></div></div>
            <div class="tool-k mono">SNAPSHOT · 只读链接</div><h3>一个链接给导师看</h3>
            <p>把此刻完整的控制台冻结成链接，发给辅导员、导师或评委：不用注册就能浏览，怎么点都不会改动你的数据。</p>
          </div>
          <div class="tool panel ticks">
            <div class="tool-art tool-jd" aria-hidden="true"><div class="jd-stack">${['JD · 公司 A', 'JD · 公司 B', 'JD · 公司 C'].map((t, i) => `<div class="jd-card" style="--i:${i}"><span class="mono">${t}</span><i></i><i style="width:70%"></i></div>`).join('')}<div class="jd-out mono">ENSEMBLE → 硬性 / 偶尔</div></div></div>
            <div class="tool-k mono">ENSEMBLE · JD 与成绩单</div><h3>目标更准，底座更真</h3>
            <p>多份 JD 集成出一个目标函数，分清各家都要的硬要求；拍一张成绩单，课程带来的能力按成绩缩放。在多台设备上用，修改会自动合并。</p>
          </div>
        </div>
      </section>

      <section class="land-sec principles">
        <div class="pr-item"><div class="pr-k mono">∑</div><h3>可量化</h3><p>12 维能力向量 × 10 个岗位要求，loss 与拟合度用同一套公式计算，而不是凭感觉。</p></div>
        <div class="pr-item"><div class="pr-k mono">↻</div><h3>可迭代</h3><p>以周为 epoch 复盘，计划随梯度动态调整。规划不是一份文档，而是一个训练循环。</p></div>
        <div class="pr-item"><div class="pr-k mono">∂</div><h3>可解释</h3><p>每一条建议都能追溯到具体的能力差距与梯度大小，树形图设计者告诉你“为什么”。</p></div>
      </section>

      <section class="land-final">
        <h2 class="sec-title">准备好开始第一个 epoch 了吗？</h2>
        <div class="hero-cta" style="justify-content:center">
          ${has ? `<a class="btn primary lg" href="#/console">回到控制台 ${icon('arrow', 16)}</a>` : `<a class="btn primary lg" href="#/init">初始化我的模型 ${icon('arrow', 16)}</a><button class="btn lg outline" data-act="demo">先看看示例</button>`}
        </div>
        <footer class="land-foot mono"><span>EPOCH · AI 专业生涯训练台</span><span class="hidden" data-upd-full></span><span>未登录时数据仅保存在本地浏览器 · 登录后云端同步</span></footer>
      </section>
    </div>`;

    const hero = createLandscape(root.querySelector('.hero-canvas'), { mode: 'hero', getState: () => null });
    const net = createNetwork(root.querySelector('.net-canvas'), { getState: () => demo, compact: true });
    const drawCurve = () => lossCurve($('#landCurve', root), { series: [{ main: true, points: lossHistory(demo) }, { points: valHistory(demo), color: 'var(--ai)', label: 'val' }], height: 190 });
    drawCurve();

    // 项目最近更新时间（服务器上代码的最新修改时间）
    fetch('api/health').then((r) => r.json()).then((h) => {
      if (!h.updated) return;
      const d = new Date(h.updated);
      const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const full = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${hm}`;
      const a = root.querySelector('[data-upd]');
      if (a) { a.innerHTML = `<i class="upd-dot"></i>项目更新于 ${esc(full)}`; a.title = "作者最近一次更新项目代码的时间"; a.classList.remove('hidden'); }
      const b = root.querySelector('[data-upd-full]');
      if (b) { b.textContent = `项目更新于 ${full}`; b.classList.remove('hidden'); }
    }).catch(() => {});

    // 分享卡小样：滚动到附近时再绘制
    let io = null;
    const mini = $('#shareMini', root);
    if (mini && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(async (ents) => {
        if (!ents.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const { renderShareCard } = await import('../core/share.js');
        const c = await renderShareCard(demo, { theme: 'paper' });
        if (mini.isConnected) mini.replaceChildren(c);
      }, { rootMargin: '400px' });
      io.observe(mini);
    }

    // 命令行打字效果
    const cmd = 'python train.py --model=you --objective=career --epochs=∞';
    const typed = $('#typed', root);
    let k = 0;
    const timer = setInterval(() => { typed.textContent = cmd.slice(0, ++k); if (k >= cmd.length) clearInterval(timer); }, 38);

    root.querySelectorAll('[data-act="demo"]').forEach((b) => (b.onclick = () => ctx.loadDemo()));
    root.querySelector('[data-act="tour"]').onclick = () => import('../core/tour.js').then((m) => m.startTour(ctx));
    root.querySelector('[data-act="theme"]').onclick = (e) => {
      ctx.setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
      e.currentTarget.innerHTML = icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun', 17);
      drawCurve();
    };
    root.querySelector('[data-act="account"]').onclick = () => ctx.openAccount();
    root.querySelector('[data-act="demo-apply"]')?.addEventListener('click', (e) => {
      const card = $('#demoCard', root);
      card.classList.add('done');
      card.querySelector('.act-h').innerHTML = `${icon('check', 14)}<b>已执行 · 路径已重算</b>`;
      e.currentTarget.parentElement.innerHTML = `<span class="kicker">示例演示，不会写入数据</span>${has ? '<a class="btn ghost sm" href="#/console">去问问它</a>' : '<a class="btn ghost sm" href="#/init">开始使用</a>'}`;
    });
    root.querySelectorAll('[data-scroll]').forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      root.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
    }));

    // 滚动提示：一旦开始往下看就淡出
    const hint = root.querySelector('.hero-scroll');
    const onScroll = (e) => {
      const y = e.target === document ? window.scrollY : e.target.scrollTop || 0;
      hint.classList.toggle('gone', y > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });

    return {
      resize: drawCurve,
      destroy() { hero.destroy(); net.destroy(); clearInterval(timer); io?.disconnect(); window.removeEventListener('scroll', onScroll, { capture: true }); },
    };
  },
};
