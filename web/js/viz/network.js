// “你”的神经网络：输入层 = 能力，隐藏层 = 能力簇，输出层 = 职业（激活值 = 拟合度）。
// 粒子沿连接前向传播，强度与能力值和岗位权重相关。
import { SKILLS, GROUPS } from '../core/data.js';
import { cssVar, fitCanvas, reducedMotion } from '../core/ui.js';
import { allRoles, skillsAt, lossOf, fitOf } from '../core/model.js';

export function createNetwork(canvas, { getState, onSelectRole, onHover, compact = false } = {}) {
  let raf = 0;
  let destroyed = false;
  let layout = null;
  let memoKey = null;
  let hover = null;
  let particles = [];
  let burst = 0;

  function compute() {
    const s = getState();
    const S = skillsAt(s);
    const roles = allRoles(s);
    const hidden = GROUPS.map((g) => {
      const members = SKILLS.filter((k) => k.group === g.id);
      return { ...g, members, act: members.reduce((a, k) => a + S[k.id], 0) / (members.length * 5) };
    });
    const outs = roles.map((r) => {
      const loss = lossOf(S, r);
      return { role: r, loss, fit: fitOf(loss), target: r.id === s.target };
    });
    return { S, hidden, outs };
  }

  function doLayout(w, h) {
    const data = compute();
    const top = 26, bottom = h - 18;
    const mctx = canvas.getContext('2d');
    mctx.font = `400 11.5px ${cssVar('--font-sans')}`;
    const inX = Math.max(...SKILLS.map((k) => mctx.measureText(k.name).width)) + 54;
    const outX = w - (compact ? 200 : 248);
    const hidX = inX + (outX - inX) * 0.46;
    const spread = (n, i, a = top, b = bottom) => (n === 1 ? (a + b) / 2 : a + ((b - a) * i) / (n - 1));
    const inputs = SKILLS.map((k, i) => ({ k, x: inX, y: spread(SKILLS.length, i), v: data.S[k.id] }));
    const hidden = data.hidden.map((g, i) => ({ ...g, x: hidX, y: spread(GROUPS.length, i, top + 34, bottom - 34) }));
    const outputs = data.outs.map((o, i) => ({ ...o, x: outX, y: spread(data.outs.length, i, top + 4, bottom - 4) }));
    const edges = [];
    inputs.forEach((n) => {
      hidden.forEach((g) => {
        const member = n.k.group === g.id;
        const wgt = member ? 1 : 0.1;
        edges.push({ from: n, to: g, w: wgt, strength: (n.v / 5) * wgt, layer: 0, skill: n.k.id, group: g.id });
      });
    });
    hidden.forEach((g) => {
      outputs.forEach((o) => {
        const imp = g.members.reduce((a, k) => a + (o.role.req[k.id] || 0), 0) / (g.members.length * 5);
        edges.push({ from: g, to: o, w: imp, strength: g.act * imp, layer: 1, group: g.id, roleId: o.role.id, target: o.target });
      });
    });
    edges.forEach((e) => {
      const dx = (e.to.x - e.from.x) * 0.5;
      e.p = [e.from.x, e.from.y, e.from.x + dx, e.from.y, e.to.x - dx, e.to.y, e.to.x, e.to.y];
    });
    return { inputs, hidden, outputs, edges, w, h };
  }

  const bez = (p, t) => {
    const u = 1 - t;
    return [
      u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
      u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7],
    ];
  };

  function spawnParticles(n = 1) {
    if (!layout) return;
    const L0 = layout.edges.filter((e) => e.layer === 0 && e.strength > 0.05);
    for (let k = 0; k < n; k++) {
      // 按强度抽样输入层连接，到达隐藏层后再按强度选一条输出连接
      const tot = L0.reduce((a, e) => a + e.strength, 0);
      let r = Math.random() * tot;
      const e = L0.find((x) => (r -= x.strength) <= 0) || L0[0];
      if (!e) return;
      particles.push({ e, t: 0, speed: 0.006 + Math.random() * 0.006 });
    }
  }

  function isLit(e) {
    if (!hover) return false;
    if (hover.type === 'out') return e.roleId === hover.id || (e.layer === 0 && hover.groups?.includes(e.group) && hover.skills?.includes(e.skill));
    if (hover.type === 'in') return e.skill === hover.id || (e.layer === 1 && e.group === hover.group);
    if (hover.type === 'hid') return e.group === hover.id;
    return false;
  }

  function frame(now) {
    if (destroyed) return;
    const { ctx, w, h } = fitCanvas(canvas);
    const s = getState();
    if (!s) { raf = requestAnimationFrame(frame); return; }
    const key = `${s.updatedAt}|${s.target}|${w}|${h}`;
    if (key !== memoKey) { layout = doLayout(w, h); memoKey = key; particles = particles.filter(() => false); }
    const L = layout;
    const C = {
      line: cssVar('--line-2'), line3: cssVar('--line-3'), text: cssVar('--text'), text2: cssVar('--text-2'),
      text3: cssVar('--text-3'), text4: cssVar('--text-4'), accent: cssVar('--accent-bar'), accentLine: cssVar('--accent-line'),
      bg: cssVar('--bg-2'), target: cssVar('--target'), sans: cssVar('--font-sans'), mono: cssVar('--font-mono'),
    };
    ctx.clearRect(0, 0, w, h);

    // 层标题
    ctx.font = `500 9px ${C.mono}`;
    ctx.fillStyle = C.text4;
    ctx.textAlign = 'center';
    ctx.fillText('INPUT · 能力', L.inputs[0].x - 40, 12);
    ctx.fillText('HIDDEN · 能力簇', L.hidden[0].x, 12);
    ctx.fillText('OUTPUT · 岗位激活', L.outputs[0].x + 70, 12);

    // 连接
    for (const e of L.edges) {
      const lit = isLit(e);
      const tgt = e.layer === 1 && e.target;
      ctx.beginPath();
      ctx.moveTo(e.p[0], e.p[1]);
      ctx.bezierCurveTo(e.p[2], e.p[3], e.p[4], e.p[5], e.p[6], e.p[7]);
      if (lit) { ctx.strokeStyle = C.accentLine; ctx.globalAlpha = 0.25 + e.strength * 0.8; ctx.lineWidth = 0.6 + e.w * 1.6; }
      else if (tgt && !hover) { ctx.strokeStyle = C.accentLine; ctx.globalAlpha = 0.1 + e.strength * 0.6; ctx.lineWidth = 0.5 + e.w * 1.4; }
      else { ctx.strokeStyle = C.line3; ctx.globalAlpha = hover ? 0.06 : 0.07 + e.strength * 0.4; ctx.lineWidth = 0.5 + e.w * 0.9; }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 粒子（前向传播）
    if (!reducedMotion()) {
      if (Math.random() < 0.55) spawnParticles(1);
      if (burst > 0) { spawnParticles(6); burst--; }
      const next = [];
      for (const p of particles) {
        p.t += p.speed;
        if (p.t >= 1) {
          if (p.e.layer === 0) {
            const outs = L.edges.filter((x) => x.layer === 1 && x.group === p.e.group);
            const tot = outs.reduce((a, x) => a + x.strength + 0.001, 0);
            let r = Math.random() * tot;
            const ne = outs.find((x) => (r -= x.strength + 0.001) <= 0) || outs[0];
            if (ne) next.push({ e: ne, t: 0, speed: p.speed });
          }
          continue;
        }
        next.push(p);
        const [x, y] = bez(p.e.p, p.t);
        const tgt = p.e.layer === 1 && p.e.target;
        const lit = isLit(p.e);
        ctx.beginPath();
        ctx.arc(x, y, tgt || lit ? 1.7 : 1.2, 0, Math.PI * 2);
        ctx.fillStyle = tgt || lit ? C.accent : C.text3;
        ctx.globalAlpha = hover && !lit ? 0.15 : 0.9;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      particles = next.slice(-320);
    }

    // 输入节点
    for (const n of L.inputs) {
      const lit = hover && ((hover.type === 'in' && hover.id === n.k.id) || (hover.type === 'out' && hover.skills?.includes(n.k.id)) || (hover.type === 'hid' && n.k.group === hover.id));
      const a = n.v / 5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, -Math.PI / 2, -Math.PI / 2 + a * Math.PI * 2);
      ctx.lineTo(n.x, n.y);
      ctx.fillStyle = C.accent;
      ctx.globalAlpha = 0.35 + a * 0.65;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = lit ? C.accentLine : C.line3;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `${lit ? 600 : 400} 11.5px ${C.sans}`;
      ctx.fillStyle = lit ? C.text : C.text2;
      ctx.fillText(n.k.name, n.x - 40, n.y);
      ctx.font = `400 10px ${C.mono}`;
      ctx.fillStyle = lit ? C.accentLine : C.text3;
      ctx.fillText(n.v.toFixed(1), n.x - 12, n.y);
    }

    // 隐藏层节点
    for (const g of L.hidden) {
      const lit = hover && hover.type === 'hid' && hover.id === g.id;
      const r = compact ? 15 : 18;
      ctx.beginPath();
      ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.strokeStyle = lit ? C.accentLine : C.line3;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.x, g.y, r - 4, -Math.PI / 2, -Math.PI / 2 + g.act * Math.PI * 2);
      ctx.strokeStyle = C.accentLine;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `500 10px ${C.mono}`;
      ctx.fillStyle = C.text;
      ctx.fillText(`${Math.round(g.act * 100)}`, g.x, g.y + 0.5);
      ctx.font = `500 11px ${C.sans}`;
      ctx.fillStyle = lit ? C.text : C.text2;
      ctx.fillText(g.name, g.x, g.y + r + 13);
    }

    // 输出节点
    const barW = compact ? 44 : 60;
    for (const o of L.outputs) {
      const lit = hover && hover.type === 'out' && hover.id === o.role.id;
      const on = o.target || lit;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.target ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? C.accent : C.bg;
      ctx.fill();
      ctx.strokeStyle = on ? C.accentLine : C.line3;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (o.target) {
        const ph = ((now / 1000) * 0.7) % 1;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 6 + ph * 12, 0, Math.PI * 2);
        ctx.strokeStyle = C.accentLine;
        ctx.globalAlpha = 1 - ph;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const bx = o.x + 14;
      ctx.fillStyle = C.line;
      ctx.fillRect(bx, o.y - 1.5, barW, 3);
      ctx.fillStyle = on ? C.accent : C.text3;
      ctx.fillRect(bx, o.y - 1.5, barW * o.fit, 3);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `500 10px ${C.mono}`;
      ctx.fillStyle = on ? C.accentLine : C.text3;
      ctx.fillText(`${Math.round(o.fit * 100)}%`.padStart(3, ' '), bx + barW + 7, o.y);
      ctx.font = `${on ? 600 : 400} 11.5px ${C.sans}`;
      ctx.fillStyle = on ? C.text : C.text2;
      const room = w - (bx + barW + 40) - 4;
      let name = o.role.name;
      if (ctx.measureText(name).width > room) {
        while (name.length > 2 && ctx.measureText(`${name}…`).width > room) name = name.slice(0, -1);
        name += '…';
      }
      ctx.fillText(name, bx + barW + 40, o.y);
    }
    raf = requestAnimationFrame(frame);
  }

  function hit(e) {
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const o of layout.outputs) if (Math.abs(y - o.y) < 9 && x > o.x - 10 && x < layout.w) {
      const skills = SKILLS.filter((k) => (o.role.req[k.id] || 0) >= 3).map((k) => k.id);
      return { type: 'out', id: o.role.id, node: o, skills, groups: [...new Set(SKILLS.filter((k) => skills.includes(k.id)).map((k) => k.group))] };
    }
    for (const n of layout.inputs) if (Math.abs(y - n.y) < 9 && x < n.x + 10) return { type: 'in', id: n.k.id, node: n, group: n.k.group };
    for (const g of layout.hidden) if (Math.hypot(x - g.x, y - g.y) < 24) return { type: 'hid', id: g.id, node: g };
    return null;
  }
  const onMove = (e) => {
    hover = hit(e);
    canvas.style.cursor = hover?.type === 'out' && onSelectRole ? 'pointer' : 'default';
    onHover?.(hover, e);
  };
  const onLeave = () => { hover = null; onHover?.(null, null); };
  const onClick = (e) => { const h = hit(e); if (h?.type === 'out') onSelectRole?.(h.id); };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  frame(performance.now());

  return {
    pulse() { burst = 18; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
    },
  };
}
