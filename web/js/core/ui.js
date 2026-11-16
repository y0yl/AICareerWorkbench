// 通用 UI 工具：转义、图标、Toast、弹窗、Markdown 渲染、数字动画。

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const pct = (v, d = 0) => `${(v * 100).toFixed(d)}%`;
export const pad = (n, w = 3) => String(n).padStart(w, '0');
export const cssVar = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

export function fmtDate(t, withYear = false) {
  const d = new Date(t);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return withYear ? `${d.getFullYear()}年${md}` : md;
}
export function relTime(t) {
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(t, true);
}

// ---------- 图标（自绘线性图标，24 网格） ----------
const P = {
  console: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M6 15l3-4 3 2 3-5 3 3"/><path d="M3 8h18" opacity=".5"/>',
  objective: '<path d="M12 3.5c4.5 0 8.5 3.5 8.5 8s-3.6 8.5-8.3 8.5S3.5 16.4 3.5 12 7.5 3.5 12 3.5z"/><path d="M12 7.5c2.6 0 4.7 2 4.7 4.5s-2 4.6-4.6 4.6S7.4 14.7 7.4 12 9.4 7.5 12 7.5z"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  dataset: '<ellipse cx="12" cy="6" rx="7.5" ry="2.5"/><path d="M4.5 6v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5V6"/><path d="M4.5 12v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6"/>',
  schedule: '<path d="M4 6h5M4 12h9M4 18h6"/><circle cx="12" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="13" cy="18" r="2"/><path d="M14 6h6M18 12h2M15 18h5"/>',
  runs: '<path d="M9 3h6M10 3v6l-5.2 9.2A1.9 1.9 0 0 0 6.5 21h11a1.9 1.9 0 0 0 1.7-2.8L14 9V3"/><path d="M7.5 15h9"/>',
  validate: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  export: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  // 树形图设计者：轨道卫星 + 向下展开的树形信号（原创图形）
  tree: '<rect x="9.5" y="4" width="5" height="5.5" rx="1"/><path d="M2.5 5h5v4.5h-5zM16.5 5h5v4.5h-5zM5 5v4.5M19 5v4.5M7.5 7.25h2M14.5 7.25h2M12 9.5v3.3M12 12.8l-5 4.7M12 12.8v5.2M12 12.8l5 4.7"/><circle cx="6.3" cy="19" r="1.5"/><circle cx="12" cy="19.6" r="1.5"/><circle cx="17.7" cy="19" r="1.5"/>',
  nabla: '<path d="M4 5h16L12 20z"/><path d="M8.2 9h7.6" opacity=".55"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.2-6.5 8-6.5s7 2.3 8 6.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  print: '<path d="M7 9V3h10v6M7 18H4v-8h16v8h-3"/><rect x="7" y="14" width="10" height="7"/>',
  flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/><path d="M11 13l9-9"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5" opacity=".6"/>',
  book: '<path d="M4 5.5C6.5 4 9.5 4 12 5.5v14c-2.5-1.5-5.5-1.5-8 0z"/><path d="M12 5.5c2.5-1.5 5.5-1.5 8 0v14c-2.5-1.5-5.5-1.5-8 0"/><path d="M15 9h2.5M15 12h2.5" opacity=".6"/>',
  wave: '<path d="M3 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h2M14 13.5h2M8 17h2" opacity=".6"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  install: '<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18.5h4"/>',
  cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
};
export function icon(name, size = 18, extra = '') {
  return `<svg class="ico ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- Toast ----------
export function toast(msg, { type = 'info', duration = 2800, html = false } = {}) {
  let wrap = $('#toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toasts';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = html ? msg : esc(msg);
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, duration);
  return el;
}

/** “loss 下降”提示：训练反馈的核心瞬间。 */
export function lossToast(before, after, label = '') {
  const d = before - after;
  if (Math.abs(d) < 0.0005) return;
  const down = d > 0;
  toast(
    `<span class="lt-k">${esc(label || 'step')}</span><span class="lt-v ${down ? 'down' : 'up'}">loss ${down ? '▼' : '▲'} ${Math.abs(d).toFixed(4)}</span><span class="lt-n">${after.toFixed(4)}</span>`,
    { type: 'loss', html: true, duration: 3200 },
  );
}

// ---------- 弹窗 ----------
export function modal({ title, kicker = '', body = '', wide = false, onMount, onClose, closable = true }) {
  const root = document.createElement('div');
  root.className = 'modal-root';
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head">
        <div>${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}<h3>${esc(title)}</h3></div>
        ${closable ? `<button class="icon-btn" data-close aria-label="关闭">${icon('close')}</button>` : ''}
      </header>
      <div class="modal-body">${body}</div>
    </div>`;
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('in'));
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    onClose?.();
    root.classList.remove('in');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 220);
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && closable) close(); };
  document.addEventListener('keydown', onKey);
  if (closable) {
    root.querySelector('.modal-backdrop').addEventListener('click', close);
    root.querySelector('[data-close]')?.addEventListener('click', close);
  }
  const panel = root.querySelector('.modal');
  onMount?.(panel, close);
  setTimeout(() => panel.querySelector('input,textarea,select,button:not([data-close])')?.focus(), 60);
  return close;
}

export function confirmBox(title, text, { ok = '确定', danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    modal({
      title,
      kicker: 'CONFIRM',
      body: `<p class="muted">${esc(text)}</p><div class="row-end"><button class="btn ghost" data-no>取消</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
      onMount(panel, c) {
        panel.querySelector('[data-no]').onclick = c;
        panel.querySelector('[data-yes]').onclick = () => { answer = true; c(); };
      },
      onClose: () => resolve(answer),
    });
  });
}

// ---------- Markdown（轻量、安全：先转义再标记） ----------
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/【待补充】/g, '<mark>【待补充】</mark>');
}
export function md(src) {
  const lines = esc(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
    if (/^&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
      out.push(`<blockquote>${inline(buf.join('<br/>'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = row(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        const nested = /^\s{2,}/.test(lines[i]);
        const task = t.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) t = `<span class="md-check ${task[1] !== ' ' ? 'on' : ''}"></span>${task[2]}`;
        items.push(`<li${nested ? ' class="nested"' : ''}>${inline(t)}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|&gt;|\s*([-*+]|\d+[.)])\s|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    // 段内软换行：中文之间直接相连，其他加空格（与 Markdown 语义一致）
    const joined = buf.reduce((acc, l) => (!acc ? l : /[\u4e00-\u9fff，。；：！？、）」』]$/.test(acc) || /^[\u4e00-\u9fff（「『]/.test(l) ? acc + l : `${acc} ${l}`), '');
    out.push(`<p>${inline(joined)}</p>`);
  }
  return out.join('\n');
}

// ---------- 动画 ----------
export function countUp(el, to, { from = 0, decimals = 0, duration = 900, suffix = '' } = {}) {
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to.toFixed(decimals) + suffix; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = (from + (to - from) * e).toFixed(decimals) + suffix;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** 高 DPI 画布尺寸同步。 */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // 上限保护：防止异常布局导致画布无限增大
  const width = Math.min(4096, canvas.getBoundingClientRect().width);
  const height = Math.min(4096, canvas.getBoundingClientRect().height);
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: width, h: height, dpr };
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
