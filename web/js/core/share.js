// 训练报告分享卡：1080×1440 的 Canvas 海报（3:4，适合朋友圈 / 小红书）。
// 视觉延续站内语言：仪器面板的四角刻度、刻度尺、损失地形等高线上你真实走过的轨迹、TensorBoard 式 loss 曲线。
import { SKILLS } from './data.js';
import * as M from './model.js';
import { makeField, contours } from '../viz/landscape.js';
import { smooth } from '../viz/charts.js';

export const W = 1080;
export const H = 1440;
const P = 72;

const THEMES = {
  dark: {
    bg: '#0a0c0f', panel: '#0e1115', line: '#1d232b', line2: '#2a313b', line3: '#3a434f',
    text: '#ecebe6', text2: '#a7abb2', text3: '#6c727b', text4: '#4a5059',
    accent: '#d4ff3a', accentLine: '#d4ff3a', bar: '#d4ff3a', mark: null,
    loss: '#ff6a3d', target: '#6cb6ff', dot: 'rgba(255,255,255,.05)', glow: 'rgba(212,255,58,.35)',
  },
  paper: {
    bg: '#efede6', panel: '#f6f4ee', line: '#dcd8cd', line2: '#cbc6b9', line3: '#aba595',
    text: '#15161a', text2: '#4b4e56', text3: '#7d8088', text4: '#a4a6ab',
    accent: '#cdf545', accentLine: '#5d8a00', bar: '#8fc31f', mark: '#cdf545',
    loss: '#e14d1b', target: '#2563d9', dot: 'rgba(20,22,26,.08)', glow: 'rgba(205,245,69,.75)',
  },
};
const MONO = '"Martian Mono", ui-monospace, "SF Mono", Menlo, monospace';
const SANS = '-apple-system, BlinkMacSystemFont, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';

const ym = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

function spacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }
function text(ctx, str, x, y, { font, color, align = 'left', ls = 0, base = 'alphabetic' }) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  spacing(ctx, ls);
  ctx.fillText(str, x, y);
  const w = ctx.measureText(str).width;
  spacing(ctx, 0);
  return w;
}
function ticks(ctx, x, y, w, h, color, len = 14) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.moveTo(cx + dx * len, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * len);
  }
  ctx.stroke();
}
function panel(ctx, c, x, y, w, h) {
  ctx.fillStyle = c.panel;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ticks(ctx, x, y, w, h, c.line3);
}
/** 刻度尺：仪器感的分隔线。 */
function ruler(ctx, c, x0, x1, y) {
  ctx.strokeStyle = c.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5);
  for (let x = x0, i = 0; x <= x1 + 0.1; x += 18, i++) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + (i % 5 ? 4 : 9)); }
  ctx.stroke();
}

function brandMark(ctx, c, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 26, s / 26);
  ctx.lineCap = 'round';
  ctx.strokeStyle = c.line3; ctx.lineWidth = 1.2;
  ctx.stroke(new Path2D('M1 6V1h5M20 1h5v5M25 20v5h-5M6 25H1v-5'));
  ctx.lineWidth = 1.6;
  ctx.stroke(new Path2D('M5 7c3.5 0 4.5 11 9.5 11 3 0 4.5-1.3 6.5-1.3'));
  ctx.strokeStyle = c.text; ctx.lineWidth = 1.8;
  ctx.stroke(new Path2D('M5 7c3.5 0 4.5 11 9.5 11'));
  ctx.fillStyle = c.mark ? c.text : c.accent;
  ctx.beginPath(); ctx.arc(14.5, 18, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 损失地形：等高线 + 你的真实轨迹。 */
function landscape(ctx, c, s, x, y, w, h) {
  const roles = M.allRoles(s).map((r) => ({ id: r.id, name: r.name, p: M.rolePos(s, r), depth: r.depth || 0.7 }));
  const pad = 26;
  const toPx = ([u, v]) => [x + pad + u * (w - 2 * pad), y + pad + v * (h - 2 * pad)];
  const f = makeField(roles, 0);
  const nx = 120, ny = 120;
  const grid = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u = ((i / (nx - 1)) * w - pad) / (w - 2 * pad);
    const v = ((j / (ny - 1)) * h - pad) / (h - 2 * pad);
    const val = f(u, v);
    grid[j * nx + i] = val;
    lo = Math.min(lo, val); hi = Math.max(hi, val);
  }
  const N = 22;
  const levels = Array.from({ length: N }, (_, k) => lo + ((k + 0.5) / N) * (hi - lo));
  const segs = contours(grid, nx, ny, levels);
  const sx = w / (nx - 1), sy = h / (ny - 1);
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
  levels.forEach((_, li) => {
    const sg = segs[li];
    if (!sg.length) return;
    const depth = 1 - li / (N - 1);
    ctx.beginPath();
    for (let k = 0; k < sg.length; k += 2) { ctx.moveTo(x + sg[k][0] * sx, y + sg[k][1] * sy); ctx.lineTo(x + sg[k + 1][0] * sx, y + sg[k + 1][1] * sy); }
    const index = li % 5 === 0;
    if (depth > 0.72) { ctx.strokeStyle = c.accentLine; ctx.globalAlpha = 0.22 + (depth - 0.72) * 1.3; }
    else { ctx.strokeStyle = c.line3; ctx.globalAlpha = index ? 0.8 : 0.45; }
    ctx.lineWidth = index ? 1.4 : 0.9;
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // 谷底：其他职业只画小点，目标谷底画靶环并标注名称（放在离小球较远的一侧）
  const tr = M.trajectory(s).map(toPx);
  const [bx, by] = tr.at(-1) || toPx(M.START_POS);
  for (const r of roles) {
    const [px, py] = toPx(r.p);
    const isT = r.id === s.target;
    ctx.fillStyle = isT ? c.target : c.text4;
    ctx.beginPath(); ctx.arc(px, py, isT ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    if (!isT) continue;
    ctx.strokeStyle = c.target; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.stroke();
    const label = r.name.length > 9 ? `${r.name.slice(0, 8)}…` : r.name;
    const font = `600 15px ${SANS}`;
    ctx.font = font;
    const tw = ctx.measureText(label).width;
    const lx = Math.min(x + w - 12 - tw, Math.max(x + 12, px - tw / 2));
    const ly = by < py ? py + 32 : py - 20;
    text(ctx, label, lx, ly, { font, color: c.text });
  }

  // 轨迹：每个 epoch 一个点，终点是一颗发光的小球
  if (tr.length > 1) {
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = c.text2; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath(); tr.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c.text3;
    for (const [px, py] of tr.slice(0, -1)) { ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill(); }
  }
  const g = ctx.createRadialGradient(bx, by, 0, bx, by, 34);
  g.addColorStop(0, c.glow); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c.mark ? c.text : c.accent;
  ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.mark ? c.bar : c.accent; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function lossChart(ctx, c, s, x, y, w, h) {
  const pts = M.lossHistory(s);
  if (pts.length < 2) {
    text(ctx, '结束第一个 Epoch 后，这里会画出你的 loss 曲线', x + w / 2, y + h / 2, { font: `400 18px ${SANS}`, color: c.text3, align: 'center' });
    return;
  }
  const maxE = Math.max(pts.at(-1).epoch, 4);
  const raw = Math.max(...pts.map((p) => p.loss), 0.05) * 1.02;
  const step = [0.05, 0.1, 0.2, 0.25].find((st) => raw / st <= 5) || 0.25;
  const yMax = Math.ceil(raw / step) * step;
  const X = (e) => x + (e / maxE) * w;
  const Y = (v) => y + (1 - v / yMax) * h;
  ctx.font = `400 12px ${MONO}`;
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(x, Y(v) + 0.5); ctx.lineTo(x + w, Y(v) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    text(ctx, v.toFixed(2), x - 12, Y(v) + 4, { font: `400 12px ${MONO}`, color: c.text4, align: 'right' });
  }
  const every = maxE > 24 ? 5 : maxE > 12 ? 2 : 1;
  for (let e = 0; e <= maxE; e += every) text(ctx, String(e), X(e), y + h + 24, { font: `400 12px ${MONO}`, color: c.text4, align: 'center' });
  const conv = 0.03;
  if (conv < yMax) {
    ctx.strokeStyle = c.accentLine; ctx.globalAlpha = 0.6; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(x, Y(conv)); ctx.lineTo(x + w, Y(conv)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  const sm = smooth(pts.map((p) => p.loss), 0.6);
  const path = (vals) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.epoch), Y(vals[i])) : ctx.moveTo(X(p.epoch), Y(vals[i])))); };
  const grd = ctx.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, `${c.loss}44`); grd.addColorStop(1, `${c.loss}00`);
  path(sm); ctx.lineTo(X(pts.at(-1).epoch), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
  ctx.fillStyle = grd; ctx.fill();
  path(pts.map((p) => p.loss)); ctx.strokeStyle = `${c.loss}66`; ctx.lineWidth = 1.5; ctx.stroke();
  path(sm); ctx.strokeStyle = c.loss; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = c.panel; ctx.strokeStyle = c.loss; ctx.lineWidth = 1.5;
  for (const p of pts.slice(0, -1)) { ctx.beginPath(); ctx.arc(X(p.epoch), Y(p.loss), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  const last = pts.at(-1);
  ctx.fillStyle = c.loss; ctx.beginPath(); ctx.arc(X(last.epoch), Y(last.loss), 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = c.loss; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(X(last.epoch), Y(last.loss), 14, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
}

/** 渲染分享卡。opts: { theme: 'paper' | 'dark', showName: true }，默认纸面。 */
export async function renderShareCard(state, { theme = 'paper', showName = true } = {}) {
  const c = THEMES[theme] || THEMES.paper;
  await Promise.all([document.fonts.load(`500 20px ${MONO}`), document.fonts.load(`700 20px ${MONO}`)]).catch(() => {});
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const s = state;
  const p = s.profile || {};
  const name = showName && p.name ? p.name : '我';
  const role = M.roleById(s, s.target);
  const S = M.skillsAt(s);
  const hist = role ? M.lossHistory(s) : [];
  const loss = hist.at(-1)?.loss;
  const fit = role ? M.fitOf(loss) : null;
  const { epoch } = M.epochInfo(s);

  // 背景：底色 + 点阵
  ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = c.dot;
  for (let yy = 11; yy < H; yy += 24) for (let xx = 11; xx < W; xx += 24) ctx.fillRect(xx, yy, 2, 2);

  // —— 页眉 ——
  brandMark(ctx, c, P, 66, 42);
  const bw = text(ctx, 'EPOCH', P + 60, 98, { font: `700 28px ${MONO}`, color: c.text, ls: 5 });
  ctx.fillStyle = c.line3; ctx.fillRect(P + 60 + bw + 14, 76, 1.5, 26);
  text(ctx, '生涯训练报告', P + 60 + bw + 30, 97, { font: `400 20px ${SANS}`, color: c.text3 });
  text(ctx, 'TRAINING REPORT', W - P, 82, { font: `500 13px ${MONO}`, color: c.text3, align: 'right', ls: 3 });
  text(ctx, `${ym(p.createdAt || Date.now())} — ${ym(Date.now())}`, W - P, 106, { font: `400 15px ${MONO}`, color: c.text2, align: 'right' });
  ruler(ctx, c, P, W - P, 136);

  // —— 主视觉：左侧标题与拟合度，右侧地形 ——
  const slug = `${(showName && p.name) || 'you'}`.replace(/\s+/g, '');
  text(ctx, `MODEL · ${slug}-v${epoch}`, P, 200, { font: `500 15px ${MONO}`, color: c.accentLine, ls: 3 });
  const H1 = `700 50px ${SANS}`;
  if (role) {
    text(ctx, `${name}，正在朝`, P, 268, { font: H1, color: c.text });
    const rn = role.name.length > 10 ? `${role.name.slice(0, 10)}…` : role.name;
    let size = 50;
    ctx.font = `800 ${size}px ${SANS}`;
    while (ctx.measureText(rn).width > 500 && size > 30) { size -= 2; ctx.font = `800 ${size}px ${SANS}`; }
    const rw = ctx.measureText(rn).width;
    if (c.mark) { ctx.fillStyle = c.mark; ctx.fillRect(P - 6, 308, rw + 12, size * 0.5); }
    text(ctx, rn, P, 332, { font: `800 ${size}px ${SANS}`, color: c.mark ? c.text : c.accent });
    text(ctx, '收敛。', P, 396, { font: H1, color: c.text });
  } else {
    text(ctx, `${name}，`, P, 268, { font: H1, color: c.text });
    text(ctx, '正在寻找自己的谷底。', P, 332, { font: H1, color: c.text });
  }
  if (role) {
    let fs = 148;
    const fv = (fit * 100).toFixed(1);
    ctx.font = `500 ${fs}px ${MONO}`;
    spacing(ctx, -6);
    while (ctx.measureText(fv).width > 430 && fs > 90) { fs -= 4; ctx.font = `500 ${fs}px ${MONO}`; }
    spacing(ctx, 0);
    const fw = text(ctx, fv, P - 6, 552, { font: `500 ${fs}px ${MONO}`, color: c.text, ls: -6 });
    text(ctx, '%', P + fw, 552, { font: `400 56px ${MONO}`, color: c.text3 });
    text(ctx, 'FIT · 拟合度 = 1 − √loss', P, 592, { font: `400 14px ${MONO}`, color: c.text3, ls: 1 });
  }
  const LX = 600, LY = 176, LS = 408;
  panel(ctx, c, LX, LY, LS, LS);
  landscape(ctx, c, s, LX, LY, LS, LS);
  text(ctx, 'LOSS LANDSCAPE', LX, LY + LS + 26, { font: `500 12px ${MONO}`, color: c.text3, ls: 3 });
  text(ctx, `你走过的 ${hist.length || 1} 个 epoch`, LX + LS, LY + LS + 26, { font: `400 14px ${SANS}`, color: c.text3, align: 'right' });

  // —— loss 曲线 ——
  const CY = 640, CH = 300;
  panel(ctx, c, P, CY, W - 2 * P, CH);
  text(ctx, 'LOSS / EPOCH', P + 26, CY + 40, { font: `500 13px ${MONO}`, color: c.accentLine, ls: 3 });
  if (hist.length > 1) {
    const first = hist[0].loss;
    const right = W - P - 26;
    const drop = first > 0 ? (first - loss) / first : 0;
    let xx = right;
    xx -= text(ctx, `▼${Math.round(drop * 100)}%`, xx, CY + 41, { font: `600 16px ${MONO}`, color: c.accentLine, align: 'right' }) + 18;
    xx -= text(ctx, loss.toFixed(4), xx, CY + 41, { font: `600 16px ${MONO}`, color: c.loss, align: 'right' }) + 10;
    xx -= text(ctx, '→', xx, CY + 41, { font: `400 16px ${MONO}`, color: c.text4, align: 'right' }) + 10;
    text(ctx, first.toFixed(4), xx, CY + 41, { font: `400 16px ${MONO}`, color: c.text3, align: 'right' });
  }
  lossChart(ctx, c, s, P + 84, CY + 70, W - 2 * P - 120, CH - 120);

  // —— 能力向量 ——
  const KY = 966, KH = 270;
  panel(ctx, c, P, KY, W - 2 * P, KH);
  text(ctx, 'WEIGHTS · 能力向量', P + 26, KY + 40, { font: `500 13px ${MONO}`, color: c.accentLine, ls: 3 });
  const S0 = M.skillsAt(s, p.createdAt || 0);
  const up = [...SKILLS].sort((a, b) => (S[b.id] - S0[b.id]) - (S[a.id] - S0[a.id]))[0];
  if (up && S[up.id] - S0[up.id] > 0.05) {
    const right = W - P - 26;
    const dw = text(ctx, `▲${(S[up.id] - S0[up.id]).toFixed(1)}`, right, KY + 41, { font: `600 15px ${MONO}`, color: c.accentLine, align: 'right' });
    text(ctx, `进步最大 · ${up.name}`, right - dw - 10, KY + 41, { font: `400 16px ${SANS}`, color: c.text2, align: 'right' });
  }
  const colW = (W - 2 * P - 52 - 40) / 2;
  SKILLS.forEach((k, i) => {
    const col = i < 6 ? 0 : 1;
    const row = i % 6;
    const x0 = P + 26 + col * (colW + 40);
    const y0 = KY + 82 + row * 31;
    text(ctx, k.name, x0, y0 + 6, { font: `400 16px ${SANS}`, color: k.id === up?.id ? c.text : c.text2 });
    const bx = x0 + 118, bw = colW - 118 - 64;
    ctx.fillStyle = c.line; ctx.fillRect(bx, y0 - 3, bw, 6);
    ctx.fillStyle = c.bar; ctx.fillRect(bx, y0 - 3, (S[k.id] / 5) * bw, 6);
    const req = role?.req[k.id] || 0;
    if (req) { ctx.fillStyle = c.target; ctx.fillRect(bx + (req / 5) * bw - 1, y0 - 9, 2, 18); }
    text(ctx, `${S[k.id].toFixed(1)}${req ? `/${req}` : ''}`, x0 + colW, y0 + 5, { font: `400 13px ${MONO}`, color: c.text3, align: 'right' });
  });

  // —— 读数 ——
  const RY = 1262;
  const ivs = (s.interviews || []).filter((i) => i.report);
  const hours = M.gainEvents(s).filter((e) => e.t <= Date.now()).reduce((a, e) => a + (e.hours || 0), 0);
  const cells = [
    ['EPOCHS', String(epoch).padStart(3, '0'), ''],
    ['SAMPLES', String((s.entries || []).length), '条经历'],
    ['HOURS', String(Math.round(hours)), '小时投入'],
    ['VAL', ivs.length ? String(Math.max(...ivs.map((i) => i.report.overall))) : '—', ivs.length ? '模拟面试最高分' : '模拟面试'],
  ];
  const cw = (W - 2 * P) / 4;
  cells.forEach(([k, v, u], i) => {
    const x0 = P + i * cw;
    if (i) { ctx.fillStyle = c.line2; ctx.fillRect(x0, RY + 4, 1, 72); }
    const tx = x0 + (i ? 26 : 0);
    text(ctx, k, tx, RY + 18, { font: `500 12px ${MONO}`, color: c.text3, ls: 3 });
    const vw = text(ctx, v, tx, RY + 66, { font: `500 38px ${MONO}`, color: c.text, ls: -2 });
    if (u) text(ctx, u, tx + vw + 8, RY + 64, { font: `400 14px ${SANS}`, color: c.text3 });
  });

  // —— 页脚 ——
  ruler(ctx, c, P, W - P, 1358);
  text(ctx, '规划不是一份文档，而是一个训练循环。', P, 1396, { font: `400 19px ${SANS}`, color: c.text2 });
  text(ctx, 'EPOCH · AI 专业生涯训练台', W - P, 1395, { font: `500 13px ${MONO}`, color: c.text3, align: 'right', ls: 2 });
  return canvas;
}
