// 路径变更日志面板（训练计划页）：git log 风格，每一次重排都有作者、理由和 diff。
import { store } from '../core/store.js';
import { icon, esc, relTime, fmtDate } from '../core/ui.js';
import { AUTHORS, shortHash, logStats } from '../core/planlog.js';

const SIGN = { '+': '+', '-': '−', '~': '~', '>': '→' };
let filter = 'all';
let expanded = false;

function commitHTML(e) {
  return `<li class="cm cm-${e.by} ${e.kind === 'epoch' ? 'cm-epoch' : ''}">
    <span class="cm-node" aria-hidden="true"></span>
    <div class="cm-h">
      <span class="cm-hash mono">${shortHash(e)}</span>
      <b class="cm-title">${esc(e.title)}</b>
      <span class="cm-meta"><span class="chip ${e.by === 'ai' ? 'ai' : e.by === 'system' ? 'accent' : ''}">${e.by === 'ai' ? icon('tree', 11) : ''}${AUTHORS[e.by] || e.by}</span><span class="dim num" title="${esc(fmtDate(e.t, true))}">${esc(relTime(e.t))}</span></span>
    </div>
    ${e.reason ? `<p class="cm-why">${esc(e.reason)}</p>` : ''}
    ${e.diff.length ? `<div class="cm-diff">${e.diff.map((d) => `<div class="cd cd-${d.op === '+' ? 'add' : d.op === '-' ? 'del' : d.op === '>' ? 'carry' : 'mod'}"><span class="cd-op">${SIGN[d.op] || '~'}</span><span>${esc(d.text)}</span></div>`).join('')}</div>` : ''}
  </li>`;
}

export function logPanel(s) {
  const log = s.planLog || [];
  const st = logStats(log);
  const shown = log.filter((e) => filter === 'all' || e.by === filter);
  const list = expanded ? shown : shown.slice(0, 5);
  const share = st.ai + st.user ? (st.ai / (st.ai + st.user)) * 100 : 0;
  return `
  <div class="sec-split"><div class="kicker">CHANGELOG · 路径变更日志</div></div>
  <section class="panel ticks log-panel" id="planLog">
    <div class="panel-h"><span class="ph-idx">GIT</span><span class="ph-title">路径是怎么变过来的</span><span class="ph-en hide-sm">git log --plan</span>
      <span class="ph-right"><div class="seg seg-sm" data-logf>${[['all', '全部'], ['ai', '树形图设计者'], ['user', '你']].map(([k, n]) => `<button type="button" data-v="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('')}</div></span></div>
    ${log.length ? `
    <div class="cl-stats">
      <div class="cl-big"><b class="num">${st.commits}</b><span>次重排<br><span class="dim">计划不是写完就不动的清单</span></span></div>
      <div class="cl-ops">
        <span class="cd-add"><b class="num">+${st.add}</b>新增</span>
        <span class="cd-del"><b class="num">−${st.del}</b>删减</span>
        <span class="cd-mod"><b class="num">~${st.mod}</b>缩放 / 改期</span>
        <span class="cd-carry"><b class="num">→${st.carry}</b>顺延</span>
      </div>
      <div class="cl-who">
        <div class="cl-who-bar"><i style="width:${share}%"></i></div>
        <div class="cl-who-l"><span class="c-ai">树形图设计者 ${st.ai}</span><span>你 ${st.user}</span></div>
      </div>
    </div>
    <ol class="commits">${list.map(commitHTML).join('') || '<li class="cl-empty dim">这个筛选下还没有记录</li>'}</ol>
    ${shown.length > 5 ? `<div class="cl-more"><button class="btn ghost sm" data-logmore>${expanded ? '收起' : `显示全部 ${shown.length} 条`} ${icon('down', 13, expanded ? 'flip-y' : '')}</button></div>` : ''}`
    : `<div class="empty cl-empty-box"><div class="e-art">$ git log --plan\n(no commits yet)</div><p>树形图设计者或你每一次删减、缩小、改期、换方向，都会作为一条“提交”记在这里——谁改的、为什么、改了什么。</p></div>`}
  </section>`;
}

export function bindLog(root) {
  const panel = root.querySelector('#planLog');
  if (!panel) return;
  const redraw = () => { panel.outerHTML = logPanel(store.state).replace(/^[\s\S]*?(<section)/, '$1'); bindLog(root); };
  panel.querySelectorAll('[data-logf] button').forEach((b) => (b.onclick = () => { filter = b.dataset.v; redraw(); }));
  panel.querySelector('[data-logmore]')?.addEventListener('click', () => { expanded = !expanded; redraw(); });
}
