// SVG 图表：TensorBoard 风格的 loss 曲线（带 EMA 平滑）、注意力热力图、迷你折线。
import { esc, fmtDate } from '../core/ui.js';
import { localDay } from '../core/model.js';

/** TensorBoard 同款去偏 EMA 平滑。 */
export function smooth(values, weight) {
  let last = 0, num = 0;
  return values.map((v) => {
    last = last * weight + (1 - weight) * v;
    num += 1;
    const debias = 1 - Math.pow(weight, num);
    return weight > 0 ? last / debias : v;
  });
}

const tip = () => {
  let el = document.querySelector('.tooltip');
  if (!el) { el = document.createElement('div'); el.className = 'tooltip'; document.body.appendChild(el); }
  return el;
};
export function showTip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.classList.add('on');
  const r = el.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 14);
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
export const hideTip = () => tip().classList.remove('on');

/**
 * series: [{ name, points: [{epoch, loss, live, t}], color, main }]
 */
export function lossCurve(container, { series, smoothing = 0.6, height = 240, converge = 0.03 }) {
  const W = Math.max(320, container.clientWidth || 600);
  const H = height;
  const m = { l: 44, r: 16, t: 14, b: 26 };
  const main = series.find((s) => s.main) || series[0];
  if (!main || main.points.length < 1) { container.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const maxEpoch = Math.max(...series.map((s) => s.points.at(-1).epoch), 4);
  const allLoss = series.flatMap((s) => s.points.map((p) => p.loss));
  const raw = Math.max(...allLoss, 0.02) * 1.1;
  const tickStep = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25].find((st) => raw / st <= 6) || 0.25;
  const yMax = Math.min(1, Math.ceil(raw / tickStep) * tickStep);
  const nTicks = Math.round(yMax / tickStep);
  const dec = tickStep < 0.01 ? 3 : 2;
  const yMin = 0;
  const X = (e) => m.l + (e / maxEpoch) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b);

  const grid = [];
  for (let k = 0; k <= nTicks; k++) {
    const v = k * tickStep;
    grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="lc-grid"/><text x="${m.l - 8}" y="${Y(v) + 3}" class="lc-ax" text-anchor="end">${v.toFixed(dec)}</text>`);
  }
  const step = maxEpoch > 24 ? 5 : maxEpoch > 12 ? 2 : 1;
  for (let e = 0; e <= maxEpoch; e += step) grid.push(`<text x="${X(e)}" y="${H - 8}" class="lc-ax" text-anchor="middle">${e}</text>`);

  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.epoch).toFixed(1)},${Y(p.loss).toFixed(1)}`).join('');
  let layers = '';
  const sm = smooth(main.points.map((p) => p.loss), smoothing);
  const smPts = main.points.map((p, i) => ({ ...p, loss: sm[i] }));
  for (const s of series) {
    if (s === main) continue;
    const ss = smooth(s.points.map((p) => p.loss), smoothing);
    layers += `<path d="${path(s.points.map((p, i) => ({ ...p, loss: ss[i] })))}" class="lc-other" style="stroke:${s.color}"/>`;
  }
  const area = `${path(smPts)}L${X(smPts.at(-1).epoch)},${Y(0)}L${X(smPts[0].epoch)},${Y(0)}Z`;
  const live = main.points.at(-1);
  const convergeLine = converge != null && converge < yMax
    ? `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(converge)}" y2="${Y(converge)}" class="lc-conv"/><text x="${W - m.r}" y="${Y(converge) - 5}" class="lc-conv-t" text-anchor="end">收敛线 · 拟合度 ${Math.round((1 - Math.sqrt(converge)) * 100)}%</text>`
    : '';

  container.innerHTML = `
  <svg class="losscurve" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="loss 曲线">
    <defs><linearGradient id="lcg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--loss)" stop-opacity=".22"/><stop offset="1" stop-color="var(--loss)" stop-opacity="0"/></linearGradient></defs>
    ${grid.join('')}
    ${convergeLine}
    ${layers}
    <path d="${area}" fill="url(#lcg)"/>
    <path d="${path(main.points)}" class="lc-raw"/>
    <path d="${path(smPts)}" class="lc-main"/>
    ${main.points.map((p) => `<circle cx="${X(p.epoch)}" cy="${Y(p.loss)}" r="${p.live ? 0 : 2}" class="lc-dot"/>`).join('')}
    <circle cx="${X(live.epoch)}" cy="${Y(live.loss)}" r="9" class="lc-live-ring"/>
    <circle cx="${X(live.epoch)}" cy="${Y(live.loss)}" r="3.5" class="lc-live"/>
    <line class="lc-cross" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="lc-hit"/>
  </svg>`;

  const svg = container.querySelector('svg');
  const cross = svg.querySelector('.lc-cross');
  const hit = svg.querySelector('.lc-hit');
  hit.addEventListener('mousemove', (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const e = Math.round(((sx - m.l) / (W - m.l - m.r)) * maxEpoch);
    const idx = main.points.findIndex((p) => p.epoch === e);
    if (idx < 0) { hideTip(); return; }
    const p = main.points[idx];
    cross.setAttribute('x1', X(p.epoch));
    cross.setAttribute('x2', X(p.epoch));
    cross.setAttribute('visibility', 'visible');
    const prev = idx > 0 ? main.points[idx - 1].loss : null;
    const d = prev != null ? prev - p.loss : null;
    showTip(
      `<div class="tt-k">EPOCH ${p.epoch}${p.live ? ' · LIVE' : ''} · ${esc(fmtDate(p.t))}</div>
       <div class="num" style="margin-top:4px">loss <b>${p.loss.toFixed(4)}</b> <span class="dim">smoothed ${sm[idx].toFixed(4)}</span></div>
       ${d != null ? `<div class="num ${d >= 0 ? 'c-accent' : 'c-loss'}" style="font-size:11px">${d >= 0 ? '▼' : '▲'} ${Math.abs(d).toFixed(4)}</div>` : ''}
       <div class="dim" style="font-size:11px">拟合度 ${Math.round((1 - Math.sqrt(p.loss)) * 100)}%</div>
       ${series.filter((x) => x !== main && x.label).map((x) => { const q = x.points.find((pp) => pp.epoch === p.epoch); return q ? `<div class="num" style="font-size:11px;color:${x.color}">${esc(x.label)} loss ${q.loss.toFixed(4)}</div>` : ''; }).join('')}`,
      ev.clientX, ev.clientY,
    );
  });
  hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); });
}

/** 注意力热力图：最近 N 周每天的投入时长。 */
export function heatmap(container, dayMap, { weeks = 20 } = {}) {
  const cell = 12, gap = 3;
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const startDay = new Date(end);
  startDay.setDate(end.getDate() - (weeks * 7 - 1));
  // 对齐到周一
  const offset = (startDay.getDay() + 6) % 7;
  startDay.setDate(startDay.getDate() - offset);
  const max = Math.max(4, ...dayMap.values());
  const cells = [];
  const months = [];
  let d = new Date(startDay);
  let col = 0;
  let lastMonth = -1;
  while (d <= end) {
    const row = (d.getDay() + 6) % 7;
    const local = localDay(d);
    const v = dayMap.get(local) || 0;
    const lvl = v <= 0 ? 0 : v < max * 0.25 ? 1 : v < max * 0.5 ? 2 : v < max * 0.75 ? 3 : 4;
    cells.push(`<rect x="${28 + col * (cell + gap)}" y="${16 + row * (cell + gap)}" width="${cell}" height="${cell}" rx="2" class="hm hm-${lvl}" data-d="${local}" data-v="${v.toFixed(1)}"/>`);
    if (row === 0 && d.getMonth() !== lastMonth) {
      months.push(`<text x="${28 + col * (cell + gap)}" y="10" class="hm-ax">${d.getMonth() + 1}月</text>`);
      lastMonth = d.getMonth();
    }
    if (row === 6) col++;
    d.setDate(d.getDate() + 1);
  }
  const W = 28 + (col + 1) * (cell + gap);
  const H = 16 + 7 * (cell + gap);
  const days = ['一', '', '三', '', '五', '', '日'];
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="heatmap" role="img" aria-label="投入热力图">
    ${months.join('')}
    ${days.map((t, i) => (t ? `<text x="0" y="${16 + i * (cell + gap) + 10}" class="hm-ax">${t}</text>` : '')).join('')}
    ${cells.join('')}
  </svg>`;
  container.querySelectorAll('rect').forEach((r) => {
    r.addEventListener('mouseenter', (e) => showTip(`<div class="tt-k">${r.dataset.d}</div><div class="num">${r.dataset.v} h</div>`, e.clientX, e.clientY));
    r.addEventListener('mouseleave', hideTip);
  });
}

export function sparkline(values, { w = 80, h = 22, cls = 'spark' } = {}) {
  if (values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts.join(' ')}" fill="none"/></svg>`;
}

/** 雷达不用；用“权重条”展示能力 vs 要求。 */
export function weightBars(S, role, skills, { compact = false } = {}) {
  return `<div class="wbars ${compact ? 'compact' : ''}">${skills.map((k) => {
    const v = S[k.id];
    const req = role ? role.req[k.id] || 0 : null;
    const gap = req != null ? Math.max(0, req - v) : 0;
    return `<div class="wbar" data-skill="${k.id}">
      <div class="wb-name">${esc(k.name)}</div>
      <div class="wb-track">
        ${[1, 2, 3, 4].map((t) => `<i class="wb-tick" style="left:${t * 20}%"></i>`).join('')}
        <div class="wb-fill" style="width:${(v / 5) * 100}%"></div>
        ${gap > 0.05 ? `<div class="wb-gap" style="left:${(v / 5) * 100}%;width:${(gap / 5) * 100}%"></div>` : ''}
        ${req ? `<div class="wb-req" style="left:${(req / 5) * 100}%" title="岗位要求 ${req}"></div>` : ''}
      </div>
      <div class="wb-val num">${v.toFixed(1)}${req != null ? `<span class="dim">/${req}</span>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
