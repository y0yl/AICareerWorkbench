// 推理导出：Model Card（本地计算）、职业生涯规划书与简历（AI 流式生成）、数据导入导出。
import { store } from '../core/store.js';
import { SKILLS, ENTRY_TYPES, ENTRY_TYPE, GOALS } from '../core/data.js';
import * as M from '../core/model.js';
import * as P from '../core/plans.js';
import { icon, esc, $, $$, toast, md, fmtDate, confirmBox } from '../core/ui.js';
import { aiStream } from '../core/ai.js';
import { weightBars } from '../viz/charts.js';
import { renderShareCard } from '../core/share.js';

const TABS = [
  { id: 'card', name: 'Model Card', sub: '一页纸画像' },
  { id: 'share', name: '分享卡', sub: '训练报告' },
  { id: 'report', name: '职业生涯规划书', sub: 'AI 撰写' },
  { id: 'resume', name: '简历草稿', sub: 'AI 撰写' },
  { id: 'data', name: '数据', sub: '导入 / 导出' },
];

export default {
  title: '推理导出',
  mount(root, ctx) {
    let tab = ctx.params.get('tab') || 'card';
    let streaming = null;

    function render() {
      root.innerHTML = `
      <div class="page ${ctx.again ? 'static' : ''}">
        <div class="page-head">
          <div class="page-title">
            <div class="path">~/epoch/<b>inference</b> · model.generate()</div>
            <h1>推理导出</h1>
            <p class="page-desc">训练的意义在于推理。把你的训练状态导出为一张 Model Card、一份完整的职业生涯规划书和一份简历草稿——可打印、可导出 PDF，直接用于规划大赛与求职。</p>
          </div>
        </div>
        <div class="tabs">${TABS.map((t) => `<button class="${tab === t.id ? 'on' : ''}" data-tab="${t.id}">${t.name}<span class="count">${t.sub}</span></button>`).join('')}</div>
        <div id="tabBody"></div>
      </div>`;
      $$('[data-tab]', root).forEach((b) => (b.onclick = () => { if (streaming) return toast('正在生成中，请稍候'); tab = b.dataset.tab; render(); }));
      const body = $('#tabBody', root);
      if (tab === 'card') body.innerHTML = cardHTML();
      else if (tab === 'share') { body.innerHTML = shareHTML(); bindShare(); }
      else if (tab === 'data') { body.innerHTML = dataHTML(); bindData(); }
      else { body.innerHTML = docHTML(tab); bindDoc(tab); }
      $('[data-print]', root)?.addEventListener('click', () => printEl($('.print-target', root)));
    }

    // —— Model Card ——
    function cardHTML() {
      const s = store.state;
      const p = s.profile;
      const S = M.skillsAt(s);
      const role = M.roleById(s, s.target);
      const ranked = M.rankRoles(s, S);
      const { epoch } = M.epochInfo(s);
      const loss = role ? M.lossOf(S, role) : null;
      const entries = s.entries || [];
      const hours = M.gainEvents(s).reduce((a, e) => a + e.hours, 0);
      const days = Math.max(1, Math.round((Date.now() - p.createdAt) / 86400000));
      const top = [...entries].sort((a, b) => sumGain(b) - sumGain(a)).slice(0, 3);
      const strengths = [...SKILLS].sort((a, b) => S[b.id] - S[a.id]).slice(0, 3);
      const grads = role ? M.gradient(S, role).slice(0, 3) : [];
      const ivs = (s.interviews || []).filter((i) => i.report);
      const tasks = (s.plan?.phases || []).flatMap((x) => x.tasks);
      const warns = M.diagnostics(s).filter((d) => d.level === 'warn');
      const slug = (p.name || 'you').replace(/\s+/g, '');
      const goal = GOALS.find((g) => g.id === p.goal)?.name || '';
      return `
      <div class="row-end" style="margin:0 0 12px"><button class="btn" data-print>${icon('print', 15)} 打印 / 导出 PDF</button></div>
      <article class="mcard print-target">
        <header class="mc-head">
          <div>
            <div class="kicker">MODEL CARD · EPOCH ${String(epoch).padStart(3, '0')}</div>
            <h2 class="mc-title">${esc(slug)}<span class="mc-ver">-v${epoch}</span></h2>
            <p class="mc-tag">${esc(p.grade || '')}${esc(p.major || '')}专业学生${role ? `，正在朝「${esc(role.name)}」收敛` : ''}。</p>
          </div>
          ${role ? `<div class="mc-fit"><div class="rd-ring big" style="--p:${M.fitOf(loss) * 100}"><span class="num">${Math.round(M.fitOf(loss) * 100)}<small>%</small></span></div><div class="kicker" style="text-align:center;margin-top:6px">fit · loss ${loss.toFixed(3)}</div></div>` : ''}
        </header>
        <div class="mc-grid">
          <section><h4>Model details · 基本信息</h4>
            <table class="mc-kv">
              <tr><td>姓名</td><td>${esc(p.name || '—')}</td></tr>
              ${p.school ? `<tr><td>学校</td><td>${esc(p.school)}</td></tr>` : ''}
              <tr><td>年级 / 专业</td><td>${esc(p.grade)} · ${esc(p.major)}</td></tr>
              <tr><td>发展意向</td><td>${esc(goal)}</td></tr>
              ${P.userPlan(s) ? `<tr><td>预训练语料</td><td>${esc(P.userPlan(s).school)} ${esc(P.userPlan(s).title)} · ${P.currentSem(P.userPlan(s)) > 8 ? '已完成' : `第 ${P.currentSem(P.userPlan(s))}/8 学期`}</td></tr>` : ''}
              <tr><td>训练时长</td><td class="num">${days} 天 · ${epoch} epochs · ${M.globalStep(s)} steps</td></tr>
              <tr><td>累计投入</td><td class="num">${Math.round(hours)} 小时</td></tr>
            </table>
          </section>
          <section><h4>Intended use · 目标用途</h4>
            ${role ? `<p><b>主目标：</b>${esc(role.name)}</p>` : '<p class="dim">尚未设定目标函数</p>'}
            <p class="dim" style="margin-top:6px">备选最优解（拟合度排序）：</p>
            <ol class="mc-list">${ranked.filter((r) => r.role.id !== s.target).slice(0, 3).map((r) => `<li>${esc(r.role.name)} <span class="num dim">${Math.round(r.fit * 100)}%</span></li>`).join('')}</ol>
          </section>
          <section class="mc-wide"><h4>Weights · 能力向量（当前 / 目标要求）</h4>${weightBars(S, role, SKILLS, { compact: true })}</section>
          <section><h4>Training data · 训练数据</h4>
            <p class="num">${entries.length} samples · 实践占比 ${entries.length ? Math.round((entries.filter((e) => ENTRY_TYPE[e.type]?.practice).length / entries.length) * 100) : 0}%</p>
            <div class="row" style="gap:5px;margin:8px 0">${ENTRY_TYPES.map((t) => ({ t, n: entries.filter((e) => e.type === t.id).length })).filter((x) => x.n).map(({ t, n }) => `<span class="chip chip-cn">${t.name} ${n}</span>`).join('')}</div>
            <p class="dim">最高价值样本：</p>
            <ol class="mc-list">${top.map((e) => `<li>${esc(e.title)}</li>`).join('') || '<li class="dim">—</li>'}</ol>
          </section>
          <section><h4>Evaluation · 评估</h4>
            <table class="mc-kv">
              <tr><td>验证集（模拟面试）</td><td class="num">${ivs.length ? `${ivs.at(-1).report.overall}/100 · 共 ${ivs.length} 场` : '未评估'}</td></tr>
              <tr><td>验证趋势</td><td class="num">${ivs.length > 1 ? `${ivs[0].report.overall} → ${ivs.at(-1).report.overall}` : '—'}</td></tr>
              <tr><td>训练计划完成度</td><td class="num">${tasks.length ? `${tasks.filter((t) => t.done).length}/${tasks.length}` : '—'}</td></tr>
              <tr><td>优势能力</td><td>${strengths.map((k) => `${esc(k.name)} ${S[k.id].toFixed(1)}`).join('、')}</td></tr>
            </table>
          </section>
          <section><h4>Limitations · 局限与风险</h4>
            <ul class="mc-list">
              ${grads.map((g) => `<li>${esc(g.skill.name)}：${S[g.id].toFixed(1)} / 要求 ${role.req[g.id]}（梯度 ▼${g.delta.toFixed(3)}）</li>`).join('')}
              ${warns.map((w) => `<li class="c-warn">${esc(w.msg)}</li>`).join('')}
              ${!grads.length && !warns.length ? '<li class="dim">暂无明显短板</li>' : ''}
            </ul>
          </section>
          <section><h4>Training procedure · 训练方式</h4>
            <table class="mc-kv">
              <tr><td>learning rate</td><td class="num">${p.hoursPerWeek} h / week</td></tr>
              <tr><td>mentor</td><td>树形图设计者（AI 生涯导师）</td></tr>
              <tr><td>schedule</td><td>${s.plan ? s.plan.phases.map((x) => esc(x.name)).join(' → ') : '—'}</td></tr>
            </table>
          </section>
        </div>
        <footer class="mc-cite">
          <div class="kicker">Citation</div>
<pre>@career{${esc(slug)}${new Date().getFullYear()},
  title   = {${esc(slug)}: Training Myself Towards ${esc(role?.en || 'an AI Career')}},
  epochs  = {${epoch}},
  fit     = {${role ? M.fitOf(loss).toFixed(3) : 'N/A'}},
  note    = {Generated by Epoch · AI 专业生涯训练台}
}</pre>
        </footer>
      </article>`;
    }

    // —— 分享卡 ——
    function shareHTML() {
      const o = store.prefs.get('share', { theme: 'paper', showName: true });
      return `
      <div class="share-grid">
        <div class="share-stage"><div class="share-frame" id="shareFrame"><div class="share-loading"><span class="spinner"></span></div></div></div>
        <aside class="share-side panel ticks">
          <div class="panel-h"><span class="ph-idx">PNG</span><span class="ph-title">训练报告分享卡</span><span class="ph-en">1080 × 1440</span></div>
          <div class="panel-b">
            <p class="muted" style="font-size:13px">一张 3:4 的海报：你在损失地形上真实走过的轨迹、loss 曲线和 12 维能力向量，都由训练数据实时绘制。适合发朋友圈、小红书，或放进规划大赛的展示材料。</p>
            <div class="field" style="margin-top:18px"><label>配色</label><div class="seg" data-share="theme">${[['paper', '纸面'], ['dark', '夜间实验室']].map(([k, n]) => `<button type="button" data-v="${k}" class="${o.theme === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
            <label class="check-row" style="margin-top:14px"><input type="checkbox" data-share="name" ${o.showName ? 'checked' : ''}> 显示姓名</label>
            <p class="dim" style="font-size:11.5px;margin-top:6px">不显示时以“我”代替。卡片不包含学校、经历标题等其他个人信息。</p>
            <div class="share-acts">
              <button class="btn primary" data-share="dl">${icon('download', 15)} 下载 PNG</button>
              <button class="btn" data-share="copy">${icon('layers', 15)} 复制图片</button>
            </div>
            <div class="divider"></div>
            <div class="kicker">只读快照链接</div>
            <p class="muted" style="font-size:13px;margin-top:6px">把此刻完整的控制台（loss 曲线、梯度、计划、面试记录…）冻结成一个链接，发给辅导员、导师或比赛评委：对方不需要注册，打开就能像你一样浏览，但做的任何修改都不会保存。</p>
            <label class="check-row" style="margin-top:10px"><input type="checkbox" data-snap-private checked> 隐去对话记录、导师记忆与投递备注</label>
            <div class="share-acts"><button class="btn ai" data-share="snap">${icon('share', 15)} 生成只读链接</button></div>
            <div data-snap-out></div>
            ${(store.state.snapshots || []).length ? `<div class="snap-list">${[...store.state.snapshots].reverse().slice(0, 5).map((x) => `<div class="copy-row"><span class="dim num">${new Date(x.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><input class="input sm" readonly value="${esc(snapURL(x.id))}"></div>`).join('')}</div>` : ''}
          </div>
        </aside>
      </div>`;
    }
    let shareCanvas = null;
    async function drawShare() {
      const o = store.prefs.get('share', { theme: 'paper', showName: true });
      const frame = $('#shareFrame', root);
      if (!frame) return;
      try {
        shareCanvas = await renderShareCard(store.state, o);
        if (!$('#shareFrame', root)) return;
        shareCanvas.className = 'share-canvas';
        frame.replaceChildren(shareCanvas);
      } catch (e) {
        console.error(e);
        frame.innerHTML = `<div class="empty"><p>分享卡生成失败：${esc(e.message)}</p></div>`;
      }
    }
    function bindShare() {
      const set = (k, v) => { store.prefs.set('share', { ...store.prefs.get('share', { theme: 'paper', showName: true }), [k]: v }); drawShare(); };
      $$('[data-share="theme"] button', root).forEach((b) => (b.onclick = () => { $$('[data-share="theme"] button', root).forEach((x) => x.classList.toggle('on', x === b)); set('theme', b.dataset.v); }));
      $('[data-share="name"]', root).onchange = (e) => set('showName', e.target.checked);
      const blob = () => new Promise((res) => shareCanvas ? shareCanvas.toBlob(res, 'image/png') : res(null));
      $('[data-share="dl"]', root).onclick = async () => {
        const b = await blob();
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `epoch-report-${M.today()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      $('[data-share="copy"]', root).onclick = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
          toast('已复制到剪贴板，可直接粘贴', { type: 'success' });
        } catch {
          toast('当前浏览器不支持复制图片，请使用下载', { type: 'error' });
        }
      };
      $('[data-share="snap"]', root).onclick = async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const st = JSON.parse(JSON.stringify(store.state));
          if ($('[data-snap-private]', root).checked) {
            st.chat = [];
            st.memory = [];
            st.applications = (st.applications || []).map((a) => ({ ...a, notes: '' }));
          }
          delete st.feed; delete st.snapshots; delete st.snapshot;
          const { id } = await store.api('api/snapshot', { method: 'POST', body: { state: st } });
          store.update((x) => { x.snapshots = [...(x.snapshots || []), { id, t: Date.now() }].slice(-20); }, 'feed');
          const url = snapURL(id);
          $('[data-snap-out]', root).innerHTML = `<div class="copy-row" style="margin-top:10px"><input class="input sm" readonly value="${esc(url)}"><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">打开</a></div>`;
          try { await navigator.clipboard.writeText(url); toast('只读链接已复制', { type: 'success' }); } catch { toast('只读链接已生成', { type: 'success' }); }
        } catch (err) {
          toast(err.message, { type: 'error' });
        } finally {
          btn.disabled = false;
        }
      };
      drawShare();
    }

    // —— 规划书 / 简历 ——
    function docHTML(kind) {
      const doc = store.state.docs?.[kind];
      const name = kind === 'report' ? '职业生涯规划书' : '简历草稿';
      return `
      <div class="doc-bar">
        <div class="dim" style="font-size:12.5px">${doc ? `上次生成：${fmtDate(doc.t, true)}${doc.mock ? ' · 演示模式' : ''}。训练状态更新后可重新生成。` : `树形图设计者将基于你的完整训练数据撰写《${name}》。`}</div>
        <div class="row">
          ${doc ? `<button class="btn sm" data-act="copy">${icon('layers', 14)} 复制 Markdown</button><button class="btn sm" data-print>${icon('print', 14)} 打印 / PDF</button>` : ''}
          <button class="btn ${doc ? 'ai sm' : 'primary'}" data-act="gen">${icon('spark', 15)} ${doc ? '重新生成' : `生成${name}`}</button>
        </div>
      </div>
      <article class="paper print-target ${doc ? '' : 'empty-paper'}">
        <div class="paper-head mono"><span>EPOCH · ${name.toUpperCase()}</span><span>${doc ? fmtDate(doc.t, true) : ''}</span></div>
        <div class="prose" id="docBody">${doc ? md(doc.text) : `<div class="empty"><div class="e-art">model.generate(\n  prompt="${name}",\n  context=you,\n)</div><p>点击右上角按钮开始生成，约需 20-60 秒。</p></div>`}</div>
      </article>`;
    }
    function bindDoc(kind) {
      $('[data-act="gen"]', root).onclick = () => generate(kind);
      $('[data-act="copy"]', root)?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(store.state.docs[kind].text); toast('已复制 Markdown', { type: 'success' }); } catch { toast('复制失败，请手动选择文本', { type: 'error' }); }
      });
    }
    async function generate(kind) {
      const body = $('#docBody', root);
      const paper = $('.paper', root);
      paper.classList.remove('empty-paper');
      body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      body.classList.add('caret');
      $$('.doc-bar button', root).forEach((b) => (b.disabled = true));
      let mock = false;
      streaming = new AbortController();
      try {
        const text = await aiStream(kind, {}, { signal: streaming.signal, onMeta: (m) => (mock = m.mock), onDelta: (_, all) => { body.innerHTML = md(all); } });
        if (text) {
          streaming = null;
          store.update((st) => { st.docs = { ...(st.docs || {}), [kind]: { text, t: Date.now(), mock } }; }, 'doc');
          toast('生成完成', { type: 'success' });
        }
      } catch (e) {
        if (e.name !== 'AbortError') toast(e.message, { type: 'error' });
      } finally {
        streaming = null;
        render();
      }
    }

    // —— 数据 ——
    function dataHTML() {
      const s = store.state;
      const size = new Blob([JSON.stringify(s)]).size;
      return `
      <div class="data-grid">
        <section class="panel ticks"><div class="panel-h"><span class="ph-idx">OUT</span><span class="ph-title">导出训练数据</span></div>
          <div class="panel-b"><p class="muted" style="font-size:13px">导出全部数据为 JSON（${(size / 1024).toFixed(1)} KB），可用于备份或迁移到其他设备。</p>
          <button class="btn primary" data-act="export" style="margin-top:14px">${icon('download', 15)} 下载 epoch-${esc(s.profile.name || 'you')}.json</button></div></section>
        <section class="panel ticks"><div class="panel-h"><span class="ph-idx">IN</span><span class="ph-title">导入训练数据</span></div>
          <div class="panel-b"><p class="muted" style="font-size:13px">从之前导出的 JSON 恢复。将覆盖当前数据。</p>
          <label class="btn" style="margin-top:14px">${icon('upload', 15)} 选择 JSON 文件<input type="file" accept="application/json,.json" data-act="import" hidden></label></div></section>
      </div>`;
    }
    function bindData() {
      $('[data-act="export"]', root).onclick = () => {
        const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `epoch-${store.state.profile.name || 'you'}-${M.today()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      $('[data-act="import"]', root).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (!data.profile || !Array.isArray(data.entries)) throw new Error('不是有效的 Epoch 数据文件');
          if (!(await confirmBox('导入数据？', '当前训练数据将被覆盖，建议先导出备份。', { ok: '导入', danger: true }))) return;
          store.replace(data, 'import');
          toast('导入成功', { type: 'success' });
          ctx.navigate('/console');
        } catch (err) {
          toast(`导入失败：${err.message}`, { type: 'error' });
        }
      };
    }

    render();
    return {
      update(reason) { if (reason !== 'doc' && reason !== 'feed' && !streaming && (tab === 'card' || tab === 'share')) render(); },
      destroy() { streaming?.abort(); },
    };
  },
};

const snapURL = (id) => new URL(`#/view/${id}`, location.href.split('#')[0]).href;

function sumGain(e) { return Object.values(e.skills || {}).reduce((a, b) => a + (+b || 0), 0); }

function printEl(el) {
  if (!el) return;
  el.classList.add('printing');
  document.body.classList.add('is-printing');
  const done = () => { el.classList.remove('printing'); document.body.classList.remove('is-printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
}
