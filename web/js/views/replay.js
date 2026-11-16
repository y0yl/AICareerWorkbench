// 训练回放：拖动时间轴回看任意 epoch 的位置、loss 与当周日志；可以把小球在地形图上的整条轨迹录成视频（零依赖：canvas.captureStream + MediaRecorder）。
import { store } from '../core/store.js';
import * as M from '../core/model.js';
import { ENTRY_TYPE } from '../core/data.js';
import { icon, esc, modal, toast, fmtDate, pad, cssVar, reducedMotion } from '../core/ui.js';
import { createLandscape } from '../viz/landscape.js';

export function openReplay() {
  const s = store.state;
  const role = M.roleById(s, s.target);
  if (!role) { toast('先设定目标函数，才有训练轨迹可以回放'); return; }
  const hist = M.lossHistory(s);
  if (hist.length < 2) { toast('至少结束一个 Epoch 后才有轨迹可以回放'); return; }
  const N = hist.length - 1;
  const reviews = [...(s.reviews || [])].sort((a, b) => a.t - b.t);
  const at = (k) => { const i = Math.floor(k), f = k - i; const a = hist[i], b = hist[Math.min(i + 1, N)]; return { i, loss: a.loss + (b.loss - a.loss) * f, t: a.t + (b.t - a.t) * f }; };
  let cursor = N;
  let playing = 0;
  let land = null;
  let rec = null;

  const caption = (ctx, w) => {
    const { i, loss } = at(cursor);
    const ep = hist[Math.round(cursor)];
    ctx.save();
    ctx.font = `600 13px ${cssVar('--font-mono')}`;
    ctx.fillStyle = cssVar('--text');
    ctx.textAlign = 'left';
    ctx.fillText(`EPOCH ${pad(ep.epoch)}${ep.live ? ' · NOW' : ''}`, 16, 24);
    ctx.font = `400 11px ${cssVar('--font-mono')}`;
    ctx.fillStyle = cssVar('--text-3');
    ctx.fillText(`${fmtDate(at(cursor).t, true)} · loss ${loss.toFixed(4)} · fit ${(M.fitOf(loss) * 100).toFixed(1)}%`, 16, 42);
    ctx.textAlign = 'right';
    ctx.fillText(`objective → ${role.name}`, w - 16, 24);
    if (rec) { ctx.fillStyle = cssVar('--loss'); ctx.fillText('● REC', w - 16, 42); }
    ctx.restore();
    return i;
  };

  modal({
    title: '训练回放',
    kicker: `REPLAY · ${N} 个 epoch · ${fmtDate(hist[0].t, true)} → 今天`,
    wide: true,
    body: `
      <div class="replay">
        <canvas class="replay-canvas" aria-label="训练轨迹回放"></canvas>
        <div class="replay-ctl">
          <button class="btn primary sm" data-act="play">${icon('play', 13)} 播放</button>
          <input class="range grow" type="range" min="0" max="${N}" step="0.01" value="${N}" aria-label="时间轴">
          <span class="num dim" data-ep></span>
        </div>
        <div class="replay-info" data-info></div>
        <div class="row-end"><span class="dim" style="font-size:12px;margin-right:auto">录制会从头完整播放一遍轨迹（约 ${Math.round(2 + N * 0.6)} 秒），导出可直接发朋友圈 / 放进答辩的视频。</span>
          <button class="btn" data-act="rec">${icon('download', 14)} 导出视频</button></div>
      </div>`,
    onMount(panel, close) {
      const canvas = panel.querySelector('canvas');
      const slider = panel.querySelector('input[type=range]');
      const playBtn = panel.querySelector('[data-act="play"]');
      land = createLandscape(canvas, { mode: 'map', getState: () => store.state, getCursor: () => cursor, overlay: (ctx, w) => caption(ctx, w) });
      const info = () => {
        const k = Math.round(cursor);
        const p = hist[k];
        const r = reviews[k - 1];
        const prev = hist[Math.max(0, k - 1)];
        const from = k ? hist[k - 1].t : 0;
        const ents = (s.entries || []).filter((e) => { const t = M.toTime(e.date); return t > from && t <= (p.live ? Date.now() : p.t); });
        panel.querySelector('[data-ep]').textContent = `epoch ${pad(p.epoch)} / ${pad(hist[N].epoch)}`;
        panel.querySelector('[data-info]').innerHTML = `
          <div><span class="kicker">loss</span><b class="num c-loss">${p.loss.toFixed(4)}</b>${k ? `<span class="num ${prev.loss - p.loss >= 0 ? 'c-accent' : 'c-loss'}">${prev.loss - p.loss >= 0 ? '▼' : '▲'}${Math.abs(prev.loss - p.loss).toFixed(4)}</span>` : '<span class="dim">初始化</span>'}</div>
          <div><span class="kicker">fit</span><b class="num">${(M.fitOf(p.loss) * 100).toFixed(1)}%</b></div>
          <div class="grow">${r ? `<span class="kicker">epoch ${pad(k)} 日志 · ${esc(r.mood || '')} · ${r.hours || 0}h${r.batch ? ` · batch ${Math.round(r.batch.rate * 100)}%` : ''}</span><p>${esc(r.note || '（没有写日志）')}</p>` : p.live ? '<span class="kicker">现在</span><p>本轮 epoch 进行中。</p>' : '<span class="kicker">起点</span><p>模型初始化：自评的 12 维能力向量。</p>'}
            ${ents.length ? `<div class="replay-ents">${ents.slice(0, 4).map((e) => `<span class="chip">${esc(ENTRY_TYPE[e.type]?.name || '样本')}</span>${esc(e.title)}`).join('　')}</div>` : ''}</div>`;
      };
      const stop = () => { cancelAnimationFrame(playing); playing = 0; playBtn.innerHTML = `${icon('play', 13)} 播放`; };
      const play = (onEnd) => {
        if (cursor >= N - 0.01) cursor = 0;
        let last = performance.now();
        playBtn.innerHTML = `${icon('stop', 13)} 暂停`;
        const speed = reducedMotion() ? 4 : 1.6; // epoch / 秒
        const tick = (now) => {
          cursor = Math.min(N, cursor + ((now - last) / 1000) * speed);
          last = now;
          slider.value = cursor;
          info();
          if (cursor >= N) { stop(); onEnd?.(); return; }
          playing = requestAnimationFrame(tick);
        };
        playing = requestAnimationFrame(tick);
      };
      slider.oninput = () => { stop(); cursor = +slider.value; info(); };
      playBtn.onclick = () => (playing ? stop() : play());
      panel.querySelector('[data-act="rec"]').onclick = async (e) => {
        const btn = e.currentTarget;
        if (rec) return;
        if (!canvas.captureStream || !window.MediaRecorder) { toast('当前浏览器不支持录制，请用新版 Chrome / Edge / Safari', { type: 'error' }); return; }
        const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
        if (!type) { toast('当前浏览器不支持录制视频', { type: 'error' }); return; }
        const chunks = [];
        rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 4e6 });
        rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: type.split(';')[0] });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `epoch-replay-${M.today()}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
          rec = null;
          btn.disabled = false;
          toast('视频已导出', { type: 'success' });
        };
        btn.disabled = true;
        stop();
        cursor = 0;
        slider.value = 0;
        rec.start();
        setTimeout(() => play(() => setTimeout(() => rec?.stop(), 1200)), 600);
      };
      info();
      return close;
    },
    onClose() { cancelAnimationFrame(playing); if (rec?.state === 'recording') rec.stop(); land?.destroy(); },
  });
}
