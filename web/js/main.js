// 应用入口：路由、外壳（状态行/导航）、树形图设计者导师抽屉、命令面板、Epoch 复盘、账号。
import { store, emptyState } from './core/store.js';
import { checkHealth, aiHealth, aiStream } from './core/ai.js';
import * as M from './core/model.js';
import { icon, esc, modal, toast, md, $, pad, debounce, confirmBox } from './core/ui.js';
import { demoState } from './core/demo.js';
import { MOODS } from './core/data.js';
import * as B from './core/batch.js';
import * as A from './core/actions.js';
import { logChange } from './core/planlog.js';
import { setupPWA, canInstall, install } from './core/pwa.js';
import { setupFeeds } from './core/feeds.js';

const VIEWS = {
  home: () => import('./views/landing.js'),
  init: () => import('./views/init.js'),
  console: () => import('./views/console.js'),
  objective: () => import('./views/objective.js'),
  branches: () => import('./views/branches.js'),
  pretrain: () => import('./views/pretrain.js'),
  dataset: () => import('./views/dataset.js'),
  schedule: () => import('./views/schedule.js'),
  runs: () => import('./views/runs.js'),
  validate: () => import('./views/validate.js'),
  export: () => import('./views/export.js'),
  settings: () => import('./views/settings.js'),
};

export const NAV = [
  { id: 'console', name: '控制台', sub: '训练总览', icon: 'console' },
  { id: 'objective', name: '目标函数', sub: '职业探索', icon: 'objective' },
  { id: 'branches', name: '分支推演', sub: '树形图 · what-if', icon: 'tree' },
  { id: 'pretrain', name: '预训练', sub: '培养方案', icon: 'book' },
  { id: 'dataset', name: '数据集', sub: '经历档案', icon: 'dataset' },
  { id: 'schedule', name: '训练计划', sub: '学习路线', icon: 'schedule' },
  { id: 'runs', name: '实验', sub: '项目实践', icon: 'runs' },
  { id: 'validate', name: '验证集', sub: '模拟面试', icon: 'validate' },
  { id: 'export', name: '推理导出', sub: '规划书 · 简历', icon: 'export' },
];

const app = $('#app');
const main = $('#main');
let current = null;
let currentName = null;
let currentCtx = null;

// ---------------- 路由 ----------------
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [path, q] = h.split('?');
  return { name: path.replace(/^\/+/, '').split('/')[0] || 'home', params: new URLSearchParams(q || '') };
}
export function navigate(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  let { name, params } = parseHash();
  if (name === 'view') {
    // 只读快照 /#/view/<id>：在沙盒里打开别人分享的训练状态，任何修改都不会保存
    const id = location.hash.slice(1).split('?')[0].split('/')[2];
    if (!(await openSnapshot(id))) { history.replaceState(null, '', store.state ? '#/console' : '#/'); return route(); }
    if (token !== routeToken) return;
    history.replaceState(null, '', '#/console');
    name = 'console';
  }
  if (name === 'demo') {
    // 分享链接 /#/demo：直接载入示例训练（评委 / 演示用）
    const own = store.state && !store.state.demo && (store.state.entries || []).length;
    if (own) setTimeout(() => toast('你已有自己的训练数据，未覆盖。如需查看示例，请在「设置」中载入。'), 300);
    else if (!store.state?.demo) store.replace(demoState(), 'demo-silent');
    history.replaceState(null, '', '#/console');
    name = 'console';
  }
  if (!VIEWS[name]) name = 'home';
  if (!store.state && !['home', 'init'].includes(name)) { history.replaceState(null, '', '#/'); name = 'home'; }
  let mod;
  try {
    mod = await VIEWS[name]();
  } catch (e) {
    console.error(e);
    toast('页面加载失败，请刷新重试', { type: 'error' });
    return;
  }
  if (token !== routeToken) return;
  current?.destroy?.();
  current = null;
  currentName = name;
  const bare = name === 'home' || name === 'init';
  app.classList.toggle('bare', bare);
  $('#adamFab').classList.toggle('hidden', bare || isSnapshot());
  if (bare) closeAdam();
  main.innerHTML = '';
  main.scrollTop = 0;
  $('#adamFab').classList.remove('compact');
  currentCtx = makeCtx(params);
  current = mod.default.mount(main, currentCtx) || {};
  if (params.get('adam') && !isSnapshot()) setTimeout(() => openAdam(), 300);
  document.title = `${mod.default.title ? `${mod.default.title} · ` : ''}Epoch · AI 专业生涯训练台`;
  renderShell();
}

function makeCtx(params, again = false) {
  return {
    params,
    again,
    navigate,
    openAdam,
    closeAdam,
    simulateAdam,
    endEpoch,
    loadDemo,
    setTheme,
    openAccount,
    rerender() {
      const top = main.scrollTop;
      current?.destroy?.();
      main.innerHTML = '';
      current = VIEWS_CACHE[currentName]?.mount(main, makeCtx(params, true)) || {};
      main.scrollTop = top;
    },
  };
}
const VIEWS_CACHE = {};
// 缓存已加载的视图模块，供 rerender 同步使用
for (const [k, loader] of Object.entries(VIEWS)) {
  VIEWS[k] = () => loader().then((m) => { VIEWS_CACHE[k] = m.default; return m; });
}

// ---------------- 外壳 ----------------
function renderRail() {
  const rail = $('#rail');
  const h = aiHealth();
  const aiLabel = !h.checked ? '连接中…' : h.offline ? '离线：后端未连接' : h.ai ? '树形图设计者在线' : '演示模式';
  rail.innerHTML = `
    <div class="rail-label kicker">Training Pipeline</div>
    ${NAV.map((n, i) => `
      <a class="nav-item ${currentName === n.id ? 'active' : ''}" href="#/${n.id}" data-nav="${n.id}">
        ${icon(n.icon, 18)}
        <span class="ni-name">${n.name}<span class="ni-en">${n.sub}</span></span>
        <span class="ni-idx">${pad(i + 1, 2)}</span>
      </a>`).join('')}
    <div class="rail-spacer"></div>
    <div class="rail-foot">
      <button class="btn primary block" data-act="epoch">${icon('flag', 15)}<span class="lbl">结束本轮 Epoch</span></button>
      <a class="nav-item ${currentName === 'settings' ? 'active' : ''}" href="#/settings">${icon('settings', 18)}<span class="ni-name">设置<span class="ni-en">数据 · 账号</span></span><span></span></a>
      ${store.auth
        ? `<button class="store-mode cloud" data-act="account" title="已登录：${esc(store.auth.username)}">${icon('upload', 14)}<span><b>云端同步</b>已登录 · ${esc(store.auth.username)}</span></button>`
        : `<button class="store-mode" data-act="account" title="登录后可云端同步">${icon('download', 14)}<span><b>本地模式</b>未登录 · 数据仅保存在本浏览器</span></button>`}
      <div class="ai-status"><i class="pulse ${h.ai ? 'on' : h.checked ? 'demo' : ''}"></i><span>${esc(aiLabel)}</span></div>
    </div>`;
  rail.querySelector('[data-act="epoch"]').onclick = endEpoch;
  rail.querySelector('[data-act="account"]').onclick = openAccount;
}

function renderStatus() {
  const el = $('#statusline');
  const s = store.state;
  if (!s) { el.innerHTML = ''; return; }
  const { epoch } = M.epochInfo(s);
  const role = M.roleById(s, s.target);
  const step = M.globalStep(s);
  if (!role) {
    el.innerHTML = `<span>EPOCH <b>${pad(epoch)}</b></span><span class="sl-sep">│</span><span>step <b>${step}</b></span><span class="sl-sep">│</span><span class="c-warn">未设定目标函数</span>`;
    return;
  }
  const hist = M.lossHistory(s);
  const loss = hist.at(-1).loss;
  const prev = hist.length > 1 ? hist.at(-2).loss : loss;
  const d = prev - loss;
  const fit = M.fitOf(loss);
  el.innerHTML = `
    <span>EPOCH <b>${pad(epoch)}</b></span><span class="sl-sep">│</span>
    <span class="sl-bar"><span class="sl-track"><span class="sl-fill" style="width:${(fit * 100).toFixed(1)}%"></span></span><b>${(fit * 100).toFixed(1)}%</b></span>
    <span class="sl-sep">│</span>
    <span>loss <b class="c-loss">${loss.toFixed(4)}</b> ${hist.length < 3 && Math.abs(d) < 1e-6 ? '<span class="dim">init</span>' : `<span class="${d >= 0 ? 'c-accent' : 'c-loss'}">${d >= 0 ? '▼' : '▲'}${Math.abs(d).toFixed(4)}</span>`}</span>
    <span class="sl-sep sl-hide-sm">│</span><span class="sl-hide-sm">step <b>${step}</b></span>
    <span class="sl-sep sl-hide-md">│</span><span class="sl-target sl-hide-md">objective → <b>${esc(role.name)}</b></span>`;
}

function renderTopActions() {
  const theme = document.documentElement.getAttribute('data-theme');
  $('#themeBtn').innerHTML = icon(theme === 'light' ? 'moon' : 'sun', 17);
  $('#themeBtn').title = theme === 'light' ? '切换到夜间实验室' : '切换到纸面模式';
  const a = store.auth;
  $('#userBtn').innerHTML = `<span style="position:relative;display:grid">${icon('user', 17)}<i class="sync-dot ${a ? store.syncStatus : ''}" style="position:absolute;right:-3px;bottom:-2px;${a ? '' : 'display:none'}"></i></span>`;
  $('#userBtn').title = a ? `已登录：${a.username}` : '登录以云端同步';
}

function renderShell() {
  renderRail();
  renderStatus();
  renderTopActions();
  renderSnapshotBar();
}

// ---------------- 只读快照 ----------------
const isSnapshot = () => store.sandboxed && !!store.state?.snapshot;
async function openSnapshot(id) {
  if (!id) return false;
  try {
    const data = await store.api(`api/snapshot/${encodeURIComponent(id)}`);
    if (!data.state?.profile) throw new Error('快照数据无效');
    store.beginSandbox({ ...data.state, snapshot: { id, createdAt: data.createdAt } });
    return true;
  } catch (e) {
    toast(`无法打开快照：${e.message}`, { type: 'error' });
    return false;
  }
}
function renderSnapshotBar() {
  let bar = $('#snapBar');
  if (!isSnapshot()) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'snapBar';
    bar.className = 'snap-bar';
    document.body.appendChild(bar);
  }
  const s = store.state;
  bar.innerHTML = `${icon('layers', 14)}<span><b>只读快照</b> · ${esc(s.profile?.name || '同学')} 的训练状态 · ${new Date(s.snapshot.createdAt).toLocaleDateString('zh-CN')}。你在这里的任何操作都不会保存。</span><button class="btn sm" data-exit>退出快照</button>`;
  bar.querySelector('[data-exit]').onclick = () => {
    store.endSandbox();
    renderShell();
    navigate(store.state ? '/console' : '/');
  };
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  store.prefs.set('theme', theme);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'light' ? '#efede6' : '#0a0c0f');
  document.dispatchEvent(new Event('themechange'));
  renderTopActions();
}

// ---------------- 树形图设计者导师 ----------------
const adamEl = $('#adam');
let adamBusy = null;
const QUICK = ['这周有点吃不消，帮我调整一下', '我下周最该做什么？', '分析我当前最大的短板', '读研还是直接工作？', '帮我挑一个最值得做的项目', '我的简历缺什么？'];

function adamMessages() {
  const s = store.state;
  return s?.chat?.length ? s.chat : [{ role: 'assistant', content: '你好，我是 **树形图设计者** —— 我会把你的每一个选择展开成一棵树形图，演算每条分支通向哪里。我能看到你的 loss 曲线、梯度方向和全部训练样本。问我任何关于学习、项目、升学或求职的问题吧。' }];
}

function renderAdam() {
  const h = aiHealth();
  adamEl.innerHTML = `
    <div class="drawer-head">
      <span class="af-orb" style="width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ai) 80%, white), var(--ai) 45%, color-mix(in srgb, var(--ai) 40%, black));color:#fff">${icon('tree', 18)}</span>
      <div class="grow">
        <div style="font-weight:700">树形图设计者 <span class="chip ai" style="margin-left:6px">${h.ai ? 'ONLINE' : 'DEMO'}</span></div>
        <div class="kicker" style="margin-top:2px">Tree Diagram · 把每个选择展开成树形图</div>
      </div>
      <button class="icon-btn" data-act="clear" title="清空对话">${icon('refresh', 16)}</button>
      <button class="icon-btn" data-act="close" title="关闭">${icon('close', 17)}</button>
    </div>
    <div class="drawer-body" id="adamBody">
      ${adamMessages().map((m) => msgHTML(m.role, m.content, '', m)).join('')}
    </div>
    <div class="drawer-foot">
      <div class="quick">${QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="composer" id="adamForm">
        <textarea rows="1" placeholder="问问树形图设计者…（Enter 发送，Shift+Enter 换行）" aria-label="输入问题"></textarea>
        <button class="btn primary sm" type="submit" aria-label="发送">${icon('send', 14)}</button>
      </form>
    </div>`;
  const body = $('#adamBody', adamEl);
  body.scrollTop = body.scrollHeight;
  adamEl.querySelector('[data-act="close"]').onclick = closeAdam;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-apply]');
    if (b) applyAction(b.dataset.apply);
    else if (e.target.closest('a[href^="#/"]')) closeAdam();
  });
  adamEl.querySelector('[data-act="clear"]').onclick = () => { adamBusy?.abort(); store.update((s) => { s.chat = []; }, 'chat'); renderAdam(); };
  adamEl.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => sendAdam(b.dataset.q)));
  const form = $('#adamForm', adamEl);
  const ta = form.querySelector('textarea');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = (e) => { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ''; sendAdam(v); } };
}

function msgHTML(role, content, extra = '', m = null) {
  return `<div class="msg ${role}"><div class="m-av">${role === 'user' ? '你' : icon('tree', 14)}</div><div class="m-body ${role === 'assistant' ? 'prose' : ''} ${extra}">${role === 'assistant' ? md(content) : esc(content)}${m?.actions?.length ? actionCards(m) : ''}</div></div>`;
}

/** 树形图设计者提出的操作卡片：用户点“执行”后才写入数据。 */
function actionCards(m) {
  return m.actions.map((a, i) => {
    if (A.AUTO.has(a.type)) return `<div class="act-mem" title="导师长期记忆：可在「设置 → 导师记忆」查看与删除">${icon('spark', 12)}<span>已记住：${a.facts.map(esc).join('；')}</span></div>`;
    const d = A.describe(a);
    const done = m.applied?.[i];
    return `<div class="act-card ${done ? 'done' : ''}">
      <div class="act-h">${icon(done ? 'check' : 'spark', 14)}<b>${esc(d.title)}</b></div>
      <ul>${d.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="act-f">${done
        ? `<span class="kicker">已执行</span><a class="btn ghost sm" href="#/schedule">查看计划</a>`
        : `<button class="btn primary sm" data-apply="${esc(m.t)}:${i}">${icon('check', 13)} 执行</button><span class="dim">确认后写入你的训练数据</span>`}</div>
    </div>`;
  }).join('');
}

async function applyAction(key) {
  const [t, i] = key.split(':');
  const m = store.state?.chat?.find((x) => String(x.t) === t);
  const a = m?.actions?.[+i];
  if (!a || m.applied?.[+i]) return;
  if (a.type === 'create_plan' && store.state.plan && !(await confirmBox('替换当前训练计划？', '已完成的任务会保留为历史记录，能力增益不会丢失。', { ok: '替换' }))) return;
  try {
    const note = String(m.content || '').replace(/[#*>`_]/g, '').split(/[\n。！？]/).map((x) => x.trim()).find((x) => x.length >= 6) || '';
    const msg = A.apply(a, { note: note.slice(0, 120) });
    store.update((s) => {
      const x = s.chat.find((c) => String(c.t) === t);
      if (x) x.applied = Object.assign([], x.applied, { [+i]: true });
    }, 'chat');
    renderAdam();
    toast(msg, { type: 'success' });
  } catch (e) {
    toast(e.message, { type: 'error' });
  }
}

/** 发给 AI 的历史：附上操作的执行状态，让树形图设计者知道哪些已经写入。 */
function historyFor(m) {
  if (!m.actions?.length) return { role: m.role, content: m.content };
  const notes = m.actions.map((a, i) => `[${m.applied?.[i] ? '已执行' : '未执行'}的操作：${A.describe(a).title}]`).join('\n');
  return { role: m.role, content: `${m.content}\n\n${notes}` };
}

async function sendAdam(text) {
  if (!store.state || adamBusy) return;
  const { body, live } = startAdamTurn(text);
  adamBusy = new AbortController();
  let full = '';
  try {
    full = await aiStream('mentor', { messages: store.state.chat.map(historyFor) }, {
      signal: adamBusy.signal,
      onDelta: (_, all) => streamInto(live, body, all),
    });
    finishAdam(live, body, full);
  } catch (e) {
    if (e.name !== 'AbortError') {
      live.innerHTML = `<span class="c-loss">⚠ ${esc(e.message)}</span>`;
      live.removeAttribute('id');
    }
  } finally {
    adamBusy = null;
  }
}

function startAdamTurn(text) {
  store.update((s) => { s.chat = [...(s.chat || []), { role: 'user', content: text, t: Date.now() }].slice(-40); }, 'chat');
  const body = $('#adamBody', adamEl);
  body.insertAdjacentHTML('beforeend', msgHTML('user', text));
  body.insertAdjacentHTML('beforeend', `<div class="msg assistant"><div class="m-av">${icon('tree', 14)}</div><div class="m-body prose" id="adamLive"><span class="typing"><i></i><i></i><i></i></span></div></div>`);
  body.scrollTop = body.scrollHeight;
  return { body, live: $('#adamLive', adamEl) };
}

function streamInto(live, body, all) {
  const { body: text, pending } = A.extractActions(all);
  live.innerHTML = md(text) + (pending ? `<div class="act-card pending"><div class="act-h"><span class="spinner"></span><b>正在准备操作…</b></div></div>` : '');
  live.classList.add('caret');
  if (body.scrollHeight - body.scrollTop - body.clientHeight < 120) body.scrollTop = body.scrollHeight;
}

function finishAdam(live, body, full) {
  live.classList.remove('caret');
  live.removeAttribute('id');
  if (!full) return;
  const { body: text, actions } = A.extractActions(full);
  const m = { role: 'assistant', content: text, t: Date.now(), ...(actions.length ? { actions, applied: [] } : {}) };
  store.update((s) => { s.chat = [...s.chat, m].slice(-40); }, 'chat');
  // 记忆类操作直接保存（不需要点“执行”）
  actions.forEach((a, i) => {
    if (!A.AUTO.has(a.type)) return;
    try { A.apply(a); m.applied[i] = true; } catch { /* ignore */ }
  });
  if (m.applied?.some(Boolean)) store.update((s) => { const x = s.chat.find((c) => c.t === m.t); if (x) x.applied = [...m.applied]; }, 'chat');
  live.innerHTML = md(text) + (actions.length ? actionCards(m) : '');
  body.scrollTop = body.scrollHeight;
}

/** 本地回放一段对话（动画演示用，不调用 AI）。wait 由调用方提供，以便支持暂停。 */
export async function simulateAdam(text, reply, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  if (!store.state) return;
  if (!adamEl.classList.contains('open')) openAdam();
  const ta = adamEl.querySelector('textarea');
  if (ta) ta.value = '';
  const { body, live } = startAdamTurn(text);
  await wait(900);
  for (let i = 3; i < reply.length + 3; i += 3) {
    streamInto(live, body, reply.slice(0, i));
    await wait(18);
  }
  finishAdam(live, body, reply);
}

export function openAdam(prompt) {
  if (!store.state) return;
  renderAdam();
  adamEl.classList.add('open');
  adamEl.setAttribute('aria-hidden', 'false');
  setTimeout(() => adamEl.querySelector('textarea')?.focus(), 200);
  if (prompt) sendAdam(prompt);
}
export function closeAdam() {
  adamEl.classList.remove('open');
  adamEl.setAttribute('aria-hidden', 'true');
}

// ---------------- 结束本轮 Epoch（周复盘） ----------------
export function endEpoch() {
  const s = store.state;
  if (!s) return;
  const { epoch, start, days } = M.epochInfo(s);
  const hours = Math.round(M.hoursSince(s, start));
  const role = M.roleById(s, s.target);
  const hist = role ? M.lossHistory(s) : [];
  const now = hist.at(-1)?.loss;
  const before = hist.length > 1 ? hist.at(-2).loss : now;
  const newSamples = M.gainEvents(s).filter((e) => e.t >= start && e.t <= Date.now() && e.kind !== 'curriculum');
  const bs = s.batch ? B.batchStats(s.batch) : null;
  const undone = (s.batch?.tasks || []).filter((t) => !t.done && t.src !== 'ritual' && t.src !== 'val');
  const autoSrc = ['plan', 'run', 'course'];
  modal({
    title: `结束 Epoch ${pad(epoch)}`,
    kicker: 'EPOCH END · 每周复盘',
    body: `
      <div class="epoch-sum">
        <div><div class="kicker">持续</div><div class="num big">${days}<small> 天</small></div></div>
        <div><div class="kicker">${bs ? 'batch 完成' : '新样本'}</div><div class="num big">${bs ? `${bs.done}<small>/${bs.total}</small>` : newSamples.length}</div></div>
        <div><div class="kicker">loss 变化</div><div class="num big ${before - now >= 0 ? 'c-accent' : 'c-loss'}">${role ? `${before - now >= 0 ? '▼' : '▲'}${Math.abs(before - now).toFixed(4)}` : '—'}</div></div>
      </div>
      <form id="epochForm" style="display:flex;flex-direction:column;gap:14px;margin-top:16px">
        <div class="grid-2">
          <div class="field"><label>本轮投入（小时）</label><input class="input num" name="hours" type="number" min="0" max="120" value="${hours}"></div>
          <div class="field"><label>训练状态</label><div class="seg" id="moodSeg">${MOODS.map((m, i) => `<button type="button" data-m="${m}" class="${i === 2 ? 'on' : ''}">${m}</button>`).join('')}</div></div>
        </div>
        ${undone.length ? `<div class="field"><label>未完成的任务 · 勾选的顺延到下一轮（梯度累积）</label>
          <div class="carry-list">${undone.map((t) => `<label class="carry ${autoSrc.includes(t.src) ? 'auto' : ''}">
            <input type="checkbox" name="carry" value="${esc(t.id)}" ${autoSrc.includes(t.src) ? 'checked disabled' : (t.carried || 0) >= 2 ? '' : 'checked'}>
            <span>${esc(t.title)}</span><span class="dim num">${t.hours}h${autoSrc.includes(t.src) ? ' · 按最新进度自动重排' : (t.carried || 0) >= 2 ? ' · 已顺延 2 次，建议放弃或拆小' : ''}</span></label>`).join('')}</div></div>` : ''}
        <div class="field"><label>本轮日志：做了什么、卡在哪里、有什么收获</label><textarea class="textarea" name="note" placeholder="例：完成了 LoRA 微调的第一轮实验，但评测集太小，下周扩充到 100 条……"></textarea></div>
        <div id="epochAI" class="hidden"></div>
        <div class="row-end" style="margin-top:4px"><button type="button" class="btn ghost" data-close-x>取消</button><button class="btn primary" type="submit">${icon('flag', 15)} 提交并开启 Epoch ${pad(epoch + 1)}</button></div>
      </form>`,
    onMount(panel, close) {
      let mood = MOODS[2];
      panel.querySelectorAll('#moodSeg button').forEach((b) => (b.onclick = () => { mood = b.dataset.m; panel.querySelectorAll('#moodSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
      panel.querySelector('[data-close-x]').onclick = close;
      const form = panel.querySelector('#epochForm');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const review = { id: `r_${Date.now().toString(36)}`, t: Date.now(), hours: Number(fd.get('hours')) || 0, mood, note: String(fd.get('note') || '').slice(0, 2000), summary: '' };
        const carryIds = fd.getAll('carry').map(String);
        store.update((st) => {
          if (st.batch) {
            const ids = new Set(carryIds);
            const carried = undone.filter((t) => ids.has(t.id) || autoSrc.includes(t.src));
            const dropped = undone.filter((t) => !ids.has(t.id) && !autoSrc.includes(t.src));
            review.batch = B.rollover(st, carryIds);
            logChange(st, {
              by: 'system', kind: 'epoch', title: `结束 Epoch ${pad(epoch)}，生成 Epoch ${pad(epoch + 1)} 的 batch`,
              reason: bs ? `本轮完成 ${bs.done}/${bs.total}（${Math.round(bs.rate * 100)}%）` : '',
              diff: [
                ...carried.map((t) => ({ op: '>', text: `${t.title}${autoSrc.includes(t.src) ? '（按最新进度重新切片）' : ''}` })),
                ...dropped.map((t) => ({ op: '-', text: `放弃：${t.title}` })),
                { op: '+', text: `新 batch：${st.batch.tasks.length} 个任务 · ${st.batch.tasks.reduce((a, t) => a + t.hours, 0)}h` },
              ],
            });
          }
          st.reviews = [...(st.reviews || []), review];
          if (st.batch) st.batch.epoch = st.reviews.length + 1;
        }, 'epoch');
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        panel.querySelector('[data-close-x]').classList.add('hidden');
        const out = panel.querySelector('#epochAI');
        out.classList.remove('hidden');
        out.innerHTML = `<div class="epoch-log"><div class="kicker c-ai">TREE DIAGRAM · EPOCH ${pad(epoch)} 训练日志</div><div class="prose caret" id="epochLog"></div></div>`;
        form.querySelectorAll('.field, .grid-2').forEach((f) => f.classList.add('hidden'));
        const log = panel.querySelector('#epochLog');
        try {
          const batchNote = bs ? `\n本轮 batch 完成 ${bs.done}/${bs.total}（${Math.round(bs.rate * 100)}%），未完成：${undone.map((t) => t.title).slice(0, 5).join('；') || '无'}` : '';
          const text = await aiStream('epoch_review', { review: { hours: review.hours, mood, note: review.note + batchNote, delta: role ? `${(before - now).toFixed(4)}（${before - now >= 0 ? '下降' : '上升'}）` : '未设目标' } }, { onDelta: (_, all) => { log.innerHTML = md(all); } });
          store.update((st) => { const r = st.reviews.find((x) => x.id === review.id); if (r) r.summary = text; }, 'epoch-summary');
        } catch (err) {
          log.innerHTML = `<span class="dim">（AI 复盘暂不可用：${esc(err.message)}）</span>`;
        }
        log.classList.remove('caret');
        btn.disabled = false;
        btn.innerHTML = `${icon('play', 14)} 开始 Epoch ${pad(epoch + 1)}`;
        btn.type = 'button';
        btn.onclick = close;
        // 复盘之后让树形图设计者按本轮真实完成情况重算路径
        const adj = document.createElement('button');
        adj.type = 'button';
        adj.className = 'btn ai';
        adj.innerHTML = `${icon('tree', 14)} 让树形图设计者调整路径`;
        adj.onclick = () => {
          close();
          openAdam(`我刚结束 Epoch ${pad(epoch)}：${bs ? `batch 完成 ${bs.done}/${bs.total}（${Math.round(bs.rate * 100)}%），` : ''}投入 ${review.hours} 小时，状态「${mood}」。${undone.length ? `没做完的：${undone.slice(0, 5).map((t) => t.title).join('；')}。` : ''}${review.note ? `我的记录：${review.note.slice(0, 300)}` : ''}请根据这一轮的真实情况调整我接下来的路径：该删的删、该拆小的拆小、该换方向的换方向，别只是继续加任务。`);
        };
        btn.before(adj);
        toast(`Epoch ${pad(epoch)} 已保存，下一周的 batch 已生成`, { type: 'success' });
      };
    },
  });
}

// ---------------- 账号 ----------------
function openAccount() {
  const a = store.auth;
  const h = aiHealth();
  if (a) {
    modal({
      title: a.username,
      kicker: 'ACCOUNT · 云端同步',
      body: `<p class="muted">训练数据会自动同步到服务器，换设备登录即可继续训练。</p>
        <div class="row" style="margin-top:14px"><span class="chip ${store.syncStatus === 'synced' ? 'accent' : store.syncStatus === 'error' ? 'loss' : 'warn'}"><i class="dot"></i>${{ synced: '已同步', syncing: '同步中', pending: '等待同步', error: '同步失败', local: '本地' }[store.syncStatus] || store.syncStatus}</span></div>
        <div class="row-end"><button class="btn ghost" data-sync>${icon('refresh', 14)} 立即同步</button><button class="btn danger" data-out>退出登录</button></div>`,
      onMount(panel, close) {
        panel.querySelector('[data-sync]').onclick = async () => { await store.pullRemote(); toast('同步完成', { type: 'success' }); close(); };
        panel.querySelector('[data-out]').onclick = async () => { await store.logout(); toast('已退出登录（本地数据保留）'); close(); };
      },
    });
    return;
  }
  modal({
    title: '登录 / 注册',
    kicker: 'ACCOUNT · 云端同步',
    body: `<p class="muted" style="font-size:13px">不登录也能完整使用，但<b>数据仅保存在本地浏览器</b>：清除浏览器数据或换设备后无法找回。登录后训练数据会同步到服务器，换设备也能继续。</p>
      <div class="tabs" style="margin-top:12px"><button class="on" data-tab="login">登录</button>${h.register === false ? '' : '<button data-tab="register">注册</button>'}</div>
      <form id="authForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>用户名</label><input class="input" name="u" autocomplete="username" required minlength="2" maxlength="24"></div>
        <div class="field"><label>密码</label><input class="input" name="p" type="password" autocomplete="current-password" required minlength="6"></div>
        <div class="c-loss" id="authErr" style="font-size:12.5px;min-height:18px"></div>
        <button class="btn primary block" type="submit">登录</button>
      </form>`,
    onMount(panel, close) {
      let mode = 'login';
      const form = panel.querySelector('#authForm');
      panel.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
        mode = b.dataset.tab;
        panel.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        form.querySelector('button[type="submit"]').textContent = mode === 'login' ? '登录' : '注册并同步当前数据';
        form.querySelector('[name="p"]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      }));
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await store.login(String(fd.get('u')).trim(), String(fd.get('p')), mode === 'register');
          toast(mode === 'login' ? '登录成功，已同步云端数据' : '注册成功，当前数据已上传', { type: 'success' });
          close();
          if (store.state && ['home', 'init'].includes(currentName)) navigate('/console');
          else route();
        } catch (err) {
          panel.querySelector('#authErr').textContent = err.message;
        } finally {
          btn.disabled = false;
        }
      };
    },
  });
}

// ---------------- 命令面板 ----------------
function openPalette() {
  if ($('.palette')) return;
  const s = store.state;
  const items = [
    ...(s ? NAV.map((n, i) => ({ group: '跳转', name: `${n.name} · ${n.sub}`, icon: n.icon, hint: `0${i + 1}`, run: () => navigate(`/${n.id}`) })) : []),
    ...(s ? [
      { group: '操作', name: '记录一个新样本（经历）', icon: 'plus', run: () => navigate('/dataset?new=1') },
      { group: '操作', name: '结束本轮 Epoch（周复盘）', icon: 'flag', run: endEpoch },
      { group: '操作', name: '问树形图设计者', icon: 'tree', run: () => openAdam() },
      { group: '操作', name: '开始一场模拟面试', icon: 'validate', run: () => navigate('/validate?start=1') },
      { group: '操作', name: '生成职业生涯规划书', icon: 'export', run: () => navigate('/export') },
      { group: '操作', name: '展开分支推演（换方向 / 加投入会怎样）', icon: 'tree', run: () => navigate('/branches') },
      { group: '操作', name: '把本周任务导出到日历（.ics）', icon: 'calendar', run: async () => (await import('./views/batch-ui.js')).exportCalendar() },
      { group: '操作', name: '生成训练报告分享卡', icon: 'image', run: () => navigate('/export?tab=share') },
    ] : [{ group: '开始', name: '初始化我的模型', icon: 'play', run: () => navigate('/init') }]),
    { group: '偏好', name: '切换明暗主题', icon: 'sun', run: () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light') },
    { group: '偏好', name: '载入示例训练（林间 · 大三）', icon: 'layers', run: loadDemo },
    { group: '偏好', name: '账号与云端同步', icon: 'user', run: openAccount },
    ...(canInstall() ? [{ group: '偏好', name: '安装 Epoch 到桌面 / 主屏幕', icon: 'install', run: install }] : []),
    ...(s ? [{ group: '偏好', name: '设置与数据管理', icon: 'settings', run: () => navigate('/settings') }] : []),
  ];
  const root = document.createElement('div');
  root.className = 'palette';
  root.innerHTML = `<div class="p-back"></div><div class="p-box" role="dialog" aria-label="命令面板"><div class="p-input">${icon('search', 17)}<input placeholder="跳转到页面或执行操作…" aria-label="搜索命令"><span class="kbd">ESC</span></div><div class="p-list"></div></div>`;
  document.body.appendChild(root);
  const input = root.querySelector('input');
  const list = root.querySelector('.p-list');
  let sel = 0;
  let shown = items;
  const close = () => root.remove();
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = items.filter((it) => !q || it.name.toLowerCase().includes(q) || it.group.includes(q));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    let g = '';
    list.innerHTML = shown.map((it, i) => {
      const head = it.group !== g ? `<div class="p-group kicker">${(g = it.group)}</div>` : '';
      return `${head}<div class="p-item ${i === sel ? 'on' : ''}" data-i="${i}">${icon(it.icon, 16)}<span>${esc(it.name)}</span>${it.hint ? `<span class="p-hint">${it.hint}</span>` : ''}</div>`;
    }).join('') || '<div class="empty" style="padding:24px">没有匹配的命令</div>';
    list.querySelectorAll('.p-item').forEach((el) => {
      el.onmouseenter = () => { sel = +el.dataset.i; list.querySelectorAll('.p-item').forEach((x) => x.classList.toggle('on', x === el)); };
      el.onclick = () => { close(); shown[+el.dataset.i].run(); };
    });
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = (sel + 1) % shown.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + shown.length) % shown.length; draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown[sel]) { close(); shown[sel].run(); }
    else if (e.key === 'Escape') close();
  });
  root.querySelector('.p-back').onclick = close;
  draw();
  input.focus();
}

export async function loadDemo(force = false) {
  const own = store.state && !store.state.demo && (store.state.entries || []).length;
  if (own && !force && !(await confirmBox('载入示例训练？', '当前训练数据将被示例数据覆盖，建议先在「推理导出 → 数据」导出备份。', { ok: '覆盖并载入', danger: true }))) return;
  store.replace(demoState(), 'demo');
  toast('已载入示例训练：林间 · 大三 · 目标大模型算法工程师', { type: 'success' });
  navigate('/console');
}
export function startFresh(profile) {
  store.replace(emptyState(profile), 'init');
}

// ---------------- 启动 ----------------
window.addEventListener('hashchange', route);
store.subscribe((reason) => {
  renderStatus();
  if (reason === 'auth' || reason === 'remote' || reason === 'clear' || reason === 'demo') renderShell();
  if (reason === 'remote' || reason === 'clear') route();
  else if (current?.update) current.update(reason);
  else if (current && !['chat', 'demo-silent', 'batch-auto', 'memory', 'iv-draft', 'feed'].includes(reason) && !['home', 'init'].includes(currentName)) currentCtx?.rerender();
});
store.onSync(() => renderTopActions());

$('#themeBtn').onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
$('#userBtn').onclick = openAccount;
$('#paletteBtn').onclick = openPalette;
$('#adamFab').onclick = () => (adamEl.classList.contains('open') ? closeAdam() : openAdam());
main.addEventListener('scroll', () => $('#adamFab').classList.toggle('compact', main.scrollTop > 120), { passive: true });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('.palette') ? $('.palette').remove() : openPalette(); }
  else if (e.key === 'Escape' && adamEl.classList.contains('open') && !$('.modal-root')) closeAdam();
});
window.addEventListener('resize', debounce(() => current?.resize?.(), 150));

setupPWA({ prefetch: () => Object.values(VIEWS).forEach((load) => load().catch(() => {})) });
setupFeeds();

// 新版本提示：长时间开着的页面 / 已安装的应用，部署后提示刷新（资源地址带版本号 v/<build>/）
const BUILD = /\/v\/([0-9a-f]+)\//.exec(import.meta.url)?.[1] || null;
let versionNoticed = false;
async function checkVersion() {
  if (!BUILD || versionNoticed || document.visibilityState !== 'visible') return;
  const h = await checkHealth();
  if (h.build && h.build !== BUILD) {
    versionNoticed = true;
    const t = toast(`Epoch 有新版本 <button class="btn sm primary" style="margin-left:10px" data-reload>刷新</button>`, { html: true, duration: 600000 });
    t.querySelector('[data-reload]').onclick = () => location.reload();
  }
}
document.addEventListener('visibilitychange', checkVersion);
setInterval(checkVersion, 30 * 60 * 1000);

window.epoch = { navigate, openAdam, endEpoch, loadDemo, startFresh, setTheme, openAccount, openSnapshot };
renderShell();
route();
checkHealth().then(() => { renderRail(); if (adamEl.classList.contains('open')) renderAdam(); });
if (store.auth) store.pullRemote();
