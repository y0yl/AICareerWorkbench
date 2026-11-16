// 桌面小组件页：读取 ?t=<token> 对应的订阅源，渲染今天的任务、拟合度、Epoch 进度等（内容在 Epoch「设置 → 手机桌面小组件」里选）。
const $w = document.getElementById('w');
const q = new URLSearchParams(location.search);
const token = q.get('t') || '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY = 86400000;
const pad = (n) => String(n).padStart(3, '0');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; };

function render(d) {
  last = d;
  const theme = q.get('theme') || d.theme;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  const blocks = (q.get('show') || '').split(',').filter(Boolean).length ? q.get('show').split(',') : d.blocks || ['today', 'fit', 'epoch'];
  const now = Date.now();
  const w = d.week;
  const live = w && now >= w.start && now < w.start + 7 * DAY;
  const day = live ? Math.floor((now - w.start) / DAY) : -1;
  const today = live ? d.tasks.filter((t) => t.d === day) : [];
  const next = live ? d.tasks.find((t) => t.d > day && !t.done) || d.tasks.find((t) => t.d === day && !t.done) : null;
  const sec = {
    fit: () => d.fit == null ? '' : `<div class="w-fit"><b>${(d.fit * 100).toFixed(1)}<small>%</small></b><div class="ls">loss ${d.loss.toFixed(4)}<br><span class="${d.delta >= 0 ? 'dn' : 'up'}">${d.delta >= 0 ? '▼' : '▲'}${Math.abs(d.delta).toFixed(4)}</span></div></div><div class="bar"><i style="width:${d.fit * 100}%"></i></div>`,
    today: () => `<div class="w-sec"><div class="w-k"><span>${live ? `今天 · ${WD[day]}` : '本周'}</span><span>${today.filter((t) => !t.done).length ? `${today.filter((t) => !t.done).length} 项待办` : ''}</span></div>
      ${!w ? '<div class="w-empty">还没有本周任务，打开 Epoch 生成 batch</div>' : !live ? '<div class="w-empty">新的一周开始了：打开 Epoch 结束上一轮、生成新 batch</div>'
        : today.length ? today.map((t) => `<div class="w-task ${t.done ? 'done' : ''}"><i></i><span>${esc(t.title)}</span><em>${t.h}h</em></div>`).join('') : '<div class="w-empty">今天没有安排 🎯</div>'}</div>`,
    next: () => next ? `<div class="w-sec opt"><div class="w-k"><span>下一项</span><span>${WD[next.d]}</span></div><div class="w-task"><i></i><span>${esc(next.title)}</span><em>${next.h}h</em></div></div>` : '',
    epoch: () => w ? `<div class="w-sec opt"><div class="w-k"><span>本周 batch ${w.done}/${w.total}</span><span>${live ? (day >= 6 ? '今天复盘' : `${6 - day} 天后复盘`) : ''}</span></div><div class="bar"><i style="width:${w.total ? (w.done / w.total) * 100 : 0}%"></i></div></div>` : '',
    hard: () => d.hardDue ? `<div class="w-row"><span class="w-chip warn">错题到期 ${d.hardDue}</span></div>` : '',
    test: () => d.test ? `<div class="w-row"><span class="w-chip">投递中 ${d.test.active}</span><span class="w-chip">面试 ${d.test.interviews}</span><span class="w-chip">Offer ${d.test.offers}</span></div>` : '',
    tip: () => w?.tip ? `<div class="w-tip">${esc(w.tip)}</div>` : '',
  };
  $w.innerHTML = `<a href="./#/console" target="_top" class="w-head"><span class="ep">EPOCH ${pad(d.epoch)}</span><span class="tg">${esc(d.target || '')}</span></a>
    ${blocks.map((b) => sec[b]?.() || '').join('')}
    <div class="w-foot"><span>${esc(d.name || '')}</span><span>同步于 ${ago(d.updatedAt || d.builtAt)}</span></div>`;
  fit();
}

/** 小尺寸时逐步去掉次要内容，直到一屏放得下：可选区块 → 多余的任务 → 底栏 → 进度条。 */
function fit() {
  const over = () => $w.scrollHeight > innerHeight + 1;
  const drop = (sel, keep = 0) => { const els = [...$w.querySelectorAll(sel)]; while (over() && els.length > keep) els.pop().remove(); };
  drop('.w-tip'); drop('.w-row'); drop('.w-sec.opt'); drop('.w-task', 1); drop('.w-foot'); drop('.bar');
  $w.classList.toggle('tight', over());
}
addEventListener('resize', () => { if (last) render(last); });
document.fonts?.ready.then(() => { if (last) render(last); });
let last = null;

async function load() {
  if (!token) { $w.innerHTML = '<div class="w-err"><b>缺少订阅地址</b><span>请在 Epoch「设置 → 手机桌面小组件」中复制小组件链接。</span></div>'; return; }
  try {
    const res = await fetch(`api/feed/${encodeURIComponent(token)}.json`, { cache: 'no-store' });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || '加载失败');
    try { localStorage.setItem(`epoch.widget.${token}`, JSON.stringify(d)); } catch { /* ignore */ }
    render(d);
  } catch (e) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(`epoch.widget.${token}`)); } catch { /* ignore */ }
    if (cached) render(cached);
    else $w.innerHTML = `<div class="w-err"><b>小组件暂不可用</b><span>${esc(e.message)}</span></div>`;
  }
}
load();
setInterval(load, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
