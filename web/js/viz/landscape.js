// 损失地形图：每个职业是一个“谷底”，你是一颗沿梯度下降的小球。
// 等高线用 marching squares 绘制；首页模式下多颗小球做 SGD 下降。
import { ROLES } from '../core/data.js';
import { cssVar, fitCanvas, reducedMotion } from '../core/ui.js';
import { allRoles, rolePos, positionFor, skillsAt, trajectory, lossOf, fitOf, START_POS, gainEvents, lossHistory } from '../core/model.js';

const SIGMA = 0.085;

export function makeField(roles, t = 0) {
  return (x, y) => {
    let h = 0.42 * y + 0.05 * Math.sin(5.1 * x + 2.3 * y + t * 0.6) * Math.cos(3.7 * y - 1.2 + t * 0.4)
      + 0.032 * Math.sin(11.3 * x - 7.1 * y + 0.5 + t * 0.9) + 0.18 * ((x - 0.5) ** 2) + 0.12 * Math.max(0, 0.12 - y) * 4;
    for (const r of roles) {
      const [px, py] = r.p;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      h -= 0.42 * r.depth * Math.exp(-d2 / (2 * SIGMA * SIGMA));
    }
    return h;
  };
}

function gradAt(f, x, y) {
  const e = 0.004;
  return [(f(x + e, y) - f(x - e, y)) / (2 * e), (f(x, y + e) - f(x, y - e)) / (2 * e)];
}

// marching squares：等级均匀分布，按单元格的取值范围只遍历相关等级
export function contours(grid, nx, ny, levels) {
  const segs = levels.map(() => []);
  const v0 = levels[0];
  const step = levels.length > 1 ? levels[1] - levels[0] : 1;
  const lerp = (a, b, v) => (v - a) / (b - a || 1e-9);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = grid[j * nx + i], b = grid[j * nx + i + 1], c = grid[(j + 1) * nx + i + 1], d = grid[(j + 1) * nx + i];
      const lo = Math.min(a, b, c, d), hi = Math.max(a, b, c, d);
      const k0 = Math.max(0, Math.ceil((lo - v0) / step)), k1 = Math.min(levels.length - 1, Math.floor((hi - v0) / step));
      for (let li = k0; li <= k1; li++) {
        const v = levels[li];
        const code = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (c > v ? 2 : 0) | (d > v ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const T = [i + lerp(a, b, v), j], R = [i + 1, j + lerp(b, c, v)], B = [i + lerp(d, c, v), j + 1], L = [i, j + lerp(a, d, v)];
        const s = segs[li];
        switch (code) {
          case 1: case 14: s.push(L, B); break;
          case 2: case 13: s.push(B, R); break;
          case 3: case 12: s.push(L, R); break;
          case 4: case 11: s.push(T, R); break;
          case 5: s.push(L, T, B, R); break;
          case 6: case 9: s.push(T, B); break;
          case 7: case 8: s.push(L, T); break;
          case 10: s.push(T, R, L, B); break;
          default: break;
        }
      }
    }
  }
  return segs;
}

/**
 * mode: 'hero'（首页，多小球动态下降） | 'map'（目标函数页，可交互） | 'mini'（控制台小图）
 */
/**
 * getCursor：训练回放用，返回轨迹上的位置（0 … 点数−1，可为小数）；null 表示显示当前。
 * overlay(ctx, w, h)：在每帧最上层绘制（回放录制视频时的字幕）。
 */
export function createLandscape(canvas, { mode = 'map', getState = () => null, onSelect, onHover, getCursor = () => null, overlay = null } = {}) {
  let raf = 0;
  let destroyed = false;
  let base = null; // 离屏等高线
  let size = { w: 0, h: 0 };
  let hover = null;
  let t0 = performance.now();
  let lastBase = 0;
  let stepAcc = 0, lastFrame = 0;
  const balls = [];
  let memo = { key: null };
  let roleCount = 0;
  const pad = mode === 'mini' ? 14 : 28;

  const roleList = () => {
    const s = getState();
    const list = s ? allRoles(s) : ROLES;
    return list.map((r) => {
      let p = s ? rolePos(s, r) : r.pos;
      if (mode === 'hero' && window.innerWidth > 720) p = [0.4 + p[0] * 0.56, 0.1 + p[1] * 0.8];
      return { id: r.id, name: r.name, depth: r.depth || 0.7, p, role: r };
    });
  };

  const toPx = ([x, y]) => [pad + x * (size.w - 2 * pad), pad + y * (size.h - 2 * pad)];
  const fromPx = (px, py) => [(px - pad) / (size.w - 2 * pad), (py - pad) / (size.h - 2 * pad)];

  function renderBase(time = 0) {
    const { ctx, w, h, dpr } = fitCanvas(canvas);
    size = { w, h };
    if (!base) base = document.createElement('canvas');
    base.width = canvas.width;
    base.height = canvas.height;
    const b = base.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    b.clearRect(0, 0, w, h);

    const roles = roleList();
    const f = makeField(roles, time);
    const cell = mode === 'hero' ? 10 : mode === 'mini' ? 7 : 6;
    const nx = Math.min(480, Math.max(40, Math.round(w / cell)));
    const ny = Math.min(480, Math.max(30, Math.round(h / cell)));
    const grid = new Float32Array(nx * ny);
    let min = Infinity, max = -Infinity;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const [x, y] = fromPx((i / (nx - 1)) * w, (j / (ny - 1)) * h);
        const v = f(x, y);
        grid[j * nx + i] = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const N = mode === 'mini' ? 16 : mode === 'hero' ? 24 : 26;
    const levels = Array.from({ length: N }, (_, k) => min + ((k + 0.5) / N) * (max - min));
    const segs = contours(grid, nx, ny, levels);
    const sx = w / (nx - 1), sy = h / (ny - 1);
    const line = cssVar('--line-3');
    const accent = cssVar('--accent-line');
    levels.forEach((v, li) => {
      const s = segs[li];
      if (!s.length) return;
      const depth = 1 - li / (N - 1); // 越深越亮
      b.beginPath();
      for (let k = 0; k < s.length; k += 2) {
        b.moveTo(s[k][0] * sx, s[k][1] * sy);
        b.lineTo(s[k + 1][0] * sx, s[k + 1][1] * sy);
      }
      const index = li % 5 === 0;
      if (depth > 0.72) {
        b.strokeStyle = accent;
        b.globalAlpha = (mode === 'hero' ? 0.16 : 0.2) + (depth - 0.72) * 1.2;
      } else {
        b.strokeStyle = line;
        b.globalAlpha = (index ? 0.75 : 0.42) * (mode === 'hero' ? 0.85 : 1);
      }
      b.lineWidth = index ? 1.1 : 0.7;
      b.stroke();
    });
    b.globalAlpha = 1;
    return f;
  }

  let field = null;
  function rebuild() {
    field = renderBase(0);
  }

  // —— 首页：多颗小球做带噪声的梯度下降 ——
  // 以 60Hz 固定步长推进（与屏幕刷新率无关）；单位：步
  const LR = 0.0055;   // 学习率：越小走得越慢
  const REST = 150;    // 收敛后停留
  const FADE = 50;     // 淡入 / 淡出
  function spawn(ball = {}, delay = 0) {
    const roles = roleList();
    const wide = window.innerWidth > 720;
    ball.x = wide ? 0.45 + Math.random() * 0.5 : 0.1 + Math.random() * 0.8;
    ball.y = 0.92 + Math.random() * 0.06;
    ball.trail = [];
    ball.life = -delay;
    ball.rest = null;
    ball.out = null;
    ball.target = roles[Math.floor(Math.random() * roles.length)];
    return ball;
  }

  function stepBalls() {
    for (const ball of balls) {
      ball.life += 1;
      if (ball.life < 0) continue;
      if (ball.out != null) {
        if (++ball.out > FADE) spawn(ball, Math.random() * 90);
        continue;
      }
      const pull = [ball.target.p[0] - ball.x, ball.target.p[1] - ball.y];
      const dist = Math.hypot(pull[0], pull[1]);
      if (ball.rest != null) {
        // 已收敛：停在谷底，不再更新
        ball.x += pull[0] * 0.15; ball.y += pull[1] * 0.15;
        if (++ball.rest > REST) ball.out = 0;
        continue;
      }
      if (dist < 0.012) { ball.rest = 0; continue; }
      // SGD：地形梯度 + 目标牵引 + 每步噪声；梯度权重与噪声随训练衰减（类似学习率调度），保证最终收敛
      const [gx, gy] = gradAt(field, ball.x, ball.y);
      // 最后一段（dist < 0.12）逐渐只剩目标牵引，否则会在谷底附近被梯度和噪声拉住来回抖
      const t = Math.min(1, Math.max(0, (dist - 0.025) / 0.095));
      const near = t * t * (3 - 2 * t);
      const anneal = Math.max(0, 1 - ball.life / 900) * near;
      const k = (dist < 0.06 ? 4 : 1.8) + (1 - anneal) * 2;
      const noise = 0.0028 * (0.3 + 0.7 * anneal) * near;
      ball.x += -gx * LR * 0.6 * anneal + pull[0] * LR * k + (Math.random() - 0.5) * noise;
      ball.y += -gy * LR * 0.6 * anneal + pull[1] * LR * k + (Math.random() - 0.5) * noise;
      ball.trail.push([ball.x, ball.y]);
      if (ball.trail.length > 420) ball.trail.shift();
      if (ball.life > 1500) ball.out = 0;
    }
  }

  // 出生淡入、退场淡出
  const ballAlpha = (b) => Math.min(1, Math.max(0, b.life) / FADE) * (b.out != null ? 1 - b.out / FADE : 1);

  function drawMarker(ctx, [x, y], role, { target, fit, highlight }) {
    const accent = cssVar('--accent-line');
    const text = cssVar('--text');
    const text3 = cssVar('--text-3');
    const r = mode === 'mini' ? 2.5 : 3.5;
    ctx.save();
    if (target) {
      const t = (performance.now() - t0) / 1000;
      for (let k = 0; k < 2; k++) {
        const ph = ((t * 0.6 + k * 0.5) % 1);
        ctx.beginPath();
        ctx.arc(x, y, 6 + ph * (mode === 'mini' ? 12 : 22), 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = (1 - ph) * 0.6;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // 十字准星
    ctx.strokeStyle = target || highlight ? accent : text3;
    ctx.lineWidth = 1;
    const c = mode === 'mini' ? 4 : 6;
    ctx.beginPath();
    ctx.moveTo(x - c, y); ctx.lineTo(x - r - 1, y);
    ctx.moveTo(x + r + 1, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x, y - c); ctx.lineTo(x, y - r - 1);
    ctx.moveTo(x, y + r + 1); ctx.lineTo(x, y + c);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, target ? r + 0.5 : r - 1, 0, Math.PI * 2);
    ctx.fillStyle = target || highlight ? accent : text3;
    ctx.fill();

    if ((mode !== 'mini' || target) && !(mode === 'hero' && size.w < 720)) {
      ctx.font = `${target || highlight ? 600 : 500} ${mode === 'mini' ? 10 : 12}px ${cssVar('--font-sans')}`;
      ctx.textBaseline = 'middle';
      const label = role.name;
      const right = x < size.w - 150;
      ctx.textAlign = right ? 'left' : 'right';
      const lx = right ? x + 11 : x - 11;
      if (target && mode !== 'hero') {
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = cssVar('--accent');
        const bx = right ? lx - 5 : lx - tw - 5;
        ctx.fillRect(bx, y - 10, tw + 10, 20);
        ctx.fillStyle = cssVar('--accent-ink');
        ctx.fillText(label, lx, y + 0.5);
      } else {
        ctx.fillStyle = highlight ? text : mode === 'hero' ? text3 : cssVar('--text-2');
        ctx.fillText(label, lx, y);
      }
      if (fit != null && mode === 'map') {
        ctx.font = `400 10px ${cssVar('--font-mono')}`;
        ctx.fillStyle = target ? accent : text3;
        ctx.fillText(`${Math.round(fit * 100)}%`, lx + (right ? 0 : 0), y + 15);
      }
    }
    ctx.restore();
  }

  function frame(now) {
    if (destroyed) return;
    const { ctx, w, h } = fitCanvas(canvas);
    const nRoles = roleList().length;
    if (w !== size.w || h !== size.h || !base || nRoles !== roleCount) { roleCount = nRoles; rebuild(); }
    if (mode === 'hero' && !reducedMotion() && now - lastBase > 160) {
      field = renderBase((now - t0) / 4000);
      lastBase = now;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0, w, h);

    const s = getState();
    const roles = roleList();
    const accent = cssVar('--accent-line');
    const accentFill = cssVar('--accent-bar');

    if (mode === 'hero') {
      if (!balls.length) for (let k = 0; k < 7; k++) balls.push(spawn({}, k * 70));
      if (!reducedMotion()) {
        stepAcc = Math.min(stepAcc + (lastFrame ? now - lastFrame : 0), 100);
        for (; stepAcc >= 1000 / 60; stepAcc -= 1000 / 60) stepBalls();
      }
      lastFrame = now;
      for (const ball of balls) {
        if (ball.trail.length < 2) continue;
        const a = ballAlpha(ball);
        ctx.beginPath();
        ball.trail.forEach((p, k) => { const [x, y] = toPx(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.55 * a;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        const [bx, by] = toPx([ball.x, ball.y]);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, 14);
        g.addColorStop(0, accentFill);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.5 * a;
        ctx.fillRect(bx - 14, by - 14, 28, 28);
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(bx, by, 3, 0, Math.PI * 2);
        ctx.fillStyle = accentFill;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      roles.forEach((r) => drawMarker(ctx, toPx(r.p), r, { target: false, highlight: balls.some((b) => b.target.id === r.id && Math.hypot(b.x - r.p[0], b.y - r.p[1]) < 0.05) }));
    } else if (s) {
      if (memo.key !== s.updatedAt + s.target) {
        const S0 = skillsAt(s);
        const events = gainEvents(s);
        memo = { key: s.updatedAt + s.target, S: S0, traj: trajectory(s), me: positionFor(s, S0), times: lossHistory(s).map((p) => (p.live ? Date.now() : p.t)), events, cur: null };
      }
      let { S, traj } = memo;
      const cur = getCursor();
      if (cur != null && traj.length > 1) {
        // 回放：轨迹只画到游标处，小球在两个 epoch 之间插值，岗位拟合度按当时的能力计算
        const k = Math.max(0, Math.min(traj.length - 1, cur));
        const i = Math.floor(k), f = k - i;
        const a = traj[i], b = traj[Math.min(i + 1, traj.length - 1)];
        const at = memo.times[i] + (memo.times[Math.min(i + 1, memo.times.length - 1)] - memo.times[i]) * f;
        if (!memo.cur || Math.abs(memo.cur.t - at) > 3600000) memo.cur = { t: at, S: skillsAt(s, at, memo.events) };
        S = memo.cur.S;
        traj = [...traj.slice(0, i + 1), [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]];
      }
      const meP = cur != null && traj.length ? traj.at(-1) : memo.me;
      if (traj.length > 1) {
        ctx.beginPath();
        traj.forEach((p, k) => { const [x, y] = toPx(p); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        traj.forEach((p, k) => {
          if (k === traj.length - 1) return;
          const [x, y] = toPx(p);
          ctx.beginPath();
          ctx.arc(x, y, mode === 'mini' ? 1.6 : 2.2, 0, Math.PI * 2);
          ctx.fillStyle = cssVar('--bg-2');
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      }
      roles.forEach((r) => {
        const fit = fitOf(lossOf(S, r.role));
        drawMarker(ctx, toPx(r.p), r, { target: r.id === s.target, fit, highlight: hover === r.id });
      });
      // 你
      const me = toPx(meP);
      const pulse = (Math.sin((now - t0) / 500) + 1) / 2;
      const g = ctx.createRadialGradient(me[0], me[1], 0, me[0], me[1], 26);
      g.addColorStop(0, accentFill);
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.35 + pulse * 0.25;
      ctx.fillStyle = g;
      ctx.fillRect(me[0] - 26, me[1] - 26, 52, 52);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(me[0], me[1], mode === 'mini' ? 4.5 : 6, 0, Math.PI * 2);
      ctx.fillStyle = accentFill;
      ctx.fill();
      ctx.strokeStyle = cssVar('--bg');
      ctx.lineWidth = 2;
      ctx.stroke();
      if (mode === 'map') {
        ctx.font = `600 11px ${cssVar('--font-mono')}`;
        ctx.fillStyle = cssVar('--text');
        ctx.textAlign = 'center';
        ctx.fillText('YOU', me[0], me[1] + 20);
      }
      // 起点
      if (mode === 'map') {
        const st = toPx(START_POS);
        ctx.font = `400 9.5px ${cssVar('--font-mono')}`;
        ctx.fillStyle = cssVar('--text-4');
        ctx.textAlign = 'center';
        ctx.fillText('INIT · 初始化高原', st[0], st[1] - 4);
      }
    }
    if (overlay) overlay(ctx, size.w, size.h);
    raf = requestAnimationFrame(frame);
  }

  function hit(e) {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    let best = null, bd = 26;
    for (const r of roleList()) {
      const [x, y] = toPx(r.p);
      const d = Math.hypot(px - x, py - y);
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  const onMove = (e) => {
    const r = hit(e);
    hover = r?.id || null;
    canvas.style.cursor = r && onSelect ? 'pointer' : 'default';
    onHover?.(r?.role || null, e);
  };
  const onClick = (e) => { const r = hit(e); if (r) onSelect?.(r.id); };
  const onLeave = () => { hover = null; onHover?.(null); };
  if (mode === 'map') {
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mouseleave', onLeave);
  }
  const ro = new ResizeObserver(() => { base = null; });
  ro.observe(canvas);
  const onTheme = () => { base = null; };
  document.addEventListener('themechange', onTheme);

  frame(performance.now());
  return {
    refresh() { base = null; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('themechange', onTheme);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mouseleave', onLeave);
    },
  };
}
