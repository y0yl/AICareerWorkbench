// 目标函数：在损失地形图上探索职业，查看差距，设定目标；支持从真实 JD 生成自定义目标。
import { store, uid } from '../core/store.js';
import { SKILLS, SKILL, SKILL_IDS, PROJECTS } from '../core/data.js';
import { logChange } from '../core/planlog.js';
import * as M from '../core/model.js';
import { icon, esc, $, $$, modal, toast } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';
import { createLandscape } from '../viz/landscape.js';
import { weightBars, showTip, hideTip } from '../viz/charts.js';

const dots = (n) => `<span class="dots">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

export default {
  title: '目标函数',
  mount(root, ctx) {
    let selected = ctx.params.get('role') || store.state.target || 'llm_algo';
    if (!M.roleById(store.state, selected)) selected = M.allRoles(store.state)[0].id;

    root.innerHTML = `
    <div class="page ${ctx.again ? 'static' : ''}">
      <div class="page-head">
        <div class="page-title">
          <div class="path">~/epoch/<b>objective</b> · loss landscape</div>
          <h1>目标函数</h1>
          <p class="page-desc">每个职业都是地形上的一个谷底，等高线越密，坡越陡。亮点是现在的你，虚线是你走过的路。选一个谷底作为目标函数，系统会据此计算 loss 与梯度。</p>
        </div>
        <div class="page-actions">
          <button class="btn ai" data-act="jd">${icon('spark', 15)} 从真实 JD 创建目标</button>
        </div>
      </div>
      <section class="panel ticks land-panel">
        <div class="panel-h"><span class="ph-idx">MAP</span><span class="ph-title">损失地形图</span><span class="ph-en">career loss landscape</span>
          <span class="ph-right kicker hide-sm">点击谷底查看岗位</span></div>
        <canvas class="land-canvas" aria-label="职业损失地形图"></canvas>
      </section>
      <div class="obj-grid">
        <section class="panel ticks obj-list"><div class="panel-h"><span class="ph-idx">RANK</span><span class="ph-title">按拟合度排序</span><span class="ph-en">argmin loss</span></div><div id="roleList"></div></section>
        <section class="panel ticks obj-detail" id="roleDetail"></section>
      </div>
    </div>`;

    const land = createLandscape($('.land-canvas', root), {
      mode: 'map',
      getState: () => store.state,
      onSelect: (id) => { selected = id; renderSide(); $('#roleDetail', root).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
      onHover: (role, e) => {
        if (!role || !e) return hideTip();
        const S = M.skillsAt(store.state);
        const l = M.lossOf(S, role);
        showTip(`<div class="tt-k">MINIMUM · ${esc(role.en || 'CUSTOM')}</div><b>${esc(role.name)}</b><div class="num" style="margin-top:4px">fit ${Math.round(M.fitOf(l) * 100)}% · loss ${l.toFixed(4)}</div>`, e.clientX, e.clientY);
      },
    });

    function renderSide() {
      const s = store.state;
      const S = M.skillsAt(s);
      const ranked = M.rankRoles(s, S);
      $('#roleList', root).innerHTML = ranked.map(({ role, fit, loss }, i) => `
        <button class="rl-row ${role.id === selected ? 'on' : ''}" data-role="${esc(role.id)}">
          <span class="rl-i mono">${String(i + 1).padStart(2, '0')}</span>
          <span class="rl-name">${esc(role.name)}${role.id === s.target ? '<span class="chip accent" style="margin-left:8px">TARGET</span>' : ''}${role.custom ? '<span class="chip ai" style="margin-left:6px">JD</span>' : ''}</span>
          <span class="rl-fit"><span class="meter"><i style="width:${(fit * 100).toFixed(1)}%"></i></span><span class="num">${Math.round(fit * 100)}%</span></span>
          <span class="rl-loss num dim">${loss.toFixed(3)}</span>
        </button>`).join('');
      $$('[data-role]', $('#roleList', root)).forEach((b) => (b.onclick = () => { selected = b.dataset.role; renderSide(); }));
      renderDetail(S);
    }

    function renderDetail(S) {
      const s = store.state;
      const role = M.roleById(s, selected);
      const loss = M.lossOf(S, role);
      const fit = M.fitOf(loss);
      const isTarget = s.target === role.id;
      const grads = M.gradient(S, role).slice(0, 3);
      const projects = M.recommendProjects({ ...s, target: role.id }, S).slice(0, 3);
      $('#roleDetail', root).innerHTML = `
        <div class="panel-h"><span class="ph-idx">ROLE</span><span class="ph-title">岗位详情</span><span class="ph-en">${esc(role.en || 'custom objective')}</span>
          <span class="ph-right">${role.custom ? `<button class="icon-btn" data-act="del" title="删除自定义目标">${icon('trash', 15)}</button>` : ''}</span></div>
        <div class="panel-b">
          <div class="rd-head">
            <div>
              <div class="kicker">${esc(role.tagline || role.company || '自定义目标')}</div>
              <h2 class="rd-name">${esc(role.name)}</h2>
              ${role.custom ? '' : `<div class="rd-meta"><span>热度 ${dots(role.heat)}</span><span>门槛 ${dots(role.bar)}</span></div>`}
            </div>
            <div class="rd-fit">
              <div class="rd-ring" style="--p:${fit * 100}"><span class="num">${Math.round(fit * 100)}<small>%</small></span></div>
              <div class="num dim" style="font-size:10.5px;text-align:center;margin-top:6px">loss ${loss.toFixed(4)}</div>
            </div>
          </div>
          <p class="rd-desc">${esc(role.desc || role.summary || '')}</p>
          <div class="row" style="margin:14px 0 4px">
            ${isTarget ? `<span class="btn primary" style="pointer-events:none">${icon('check', 15)} 当前目标函数</span>` : `<button class="btn primary" data-act="target">${icon('flag', 15)} 设为目标函数</button>`}
            <button class="btn ai" data-act="ask">${icon('tree', 15)} 问树形图设计者这个岗位</button>
          </div>
          <div class="rd-sec"><div class="kicker">能力差距 · 当前 vs 要求</div>${weightBars(S, role, SKILLS)}</div>
          ${grads.length ? `<div class="rd-sec"><div class="kicker">若以此为目标，最陡的下降方向</div><div class="rd-grads">${grads.map((g) => `<div class="rd-g"><b>${esc(g.skill.name)}</b><span class="loss-delta">▼${g.delta.toFixed(4)}</span></div>`).join('')}</div></div>` : ''}
          ${role.daily?.length ? `<div class="rd-cols">
            <div class="rd-sec"><div class="kicker">日常工作</div><ul class="rd-list">${role.daily.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
            <div class="rd-sec"><div class="kicker">面试重点</div><ul class="rd-list">${role.interview.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
          </div>` : ''}
          ${role.path ? `<div class="rd-sec"><div class="kicker">进入路径</div><p class="muted" style="font-size:13px">${esc(role.path)}</p></div>` : ''}
          ${role.tips ? `<div class="rd-sec"><div class="kicker">备考建议</div><p class="muted" style="font-size:13px">${esc(role.tips)}</p></div>` : ''}
          ${role.ensemble?.samples?.length > 1 ? `<div class="rd-sec"><div class="kicker">集成自 ${role.ensemble.samples.length} 份 JD</div><div class="row" style="gap:6px">${(role.ensemble.hard || []).map((id) => `<span class="chip loss">硬性 · ${esc(SKILL[id].name)}</span>`).join('')}${(role.ensemble.rare || []).map((id) => `<span class="chip">偶尔 · ${esc(SKILL[id].name)}</span>`).join('')}</div><p class="dim" style="font-size:12px;margin-top:6px">${role.ensemble.samples.map((x) => esc(x.company || x.name)).filter(Boolean).join(' · ')}</p></div>` : ''}
          ${role.keywords?.length ? `<div class="rd-sec"><div class="kicker">关键词</div><div class="row" style="gap:6px">${role.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</div></div>` : ''}
          <div class="rd-sec"><div class="kicker">推荐的实践实验</div>
            <div class="rd-projects">${projects.map(({ project: p }) => `<a class="rd-proj" href="#/runs"><span class="mono dim">L${p.level}</span><span>${esc(p.title)}</span><span class="dim num">${p.weeks}w</span></a>`).join('')}</div>
          </div>
          <p class="dim" style="font-size:11.5px;margin-top:16px">岗位信息为通用概括，仅供参考；行业变化快，请以目标企业最新招聘要求为准。</p>
        </div>`;
      const d = $('#roleDetail', root);
      d.querySelector('[data-act="target"]')?.addEventListener('click', () => {
        store.update((st) => { st.target = role.id; }, 'target');
        toast(`目标函数已切换为「${role.name}」，loss 与梯度已重新计算`, { type: 'success' });
      });
      d.querySelector('[data-act="ask"]').onclick = () => ctx.openAdam(`我想深入了解「${role.name}」：结合我现在的能力向量，这个方向适合我吗？如果要走这条路，接下来半年该怎么安排？`);
      d.querySelector('[data-act="del"]')?.addEventListener('click', () => {
        store.update((st) => {
          st.customRoles = st.customRoles.filter((r) => r.id !== role.id);
          if (st.target === role.id) st.target = 'llm_algo';
        }, 'role-del');
        selected = store.state.target;
        renderSide();
      });
    }

    root.querySelector('[data-act="jd"]').onclick = () => openJD((id) => { selected = id; renderSide(); });
    renderSide();

    return {
      update() { renderSide(); },
      destroy() { land.destroy(); hideTip(); },
    };
  },
};

/**
 * 多份 JD 集成：每份 JD 单独解析成 12 维要求，再取均值与标准差。
 * 集成后的要求 = 均值 − 0.5σ（各家都要的才算硬要求，个别公司的特殊要求被打折），按 0.5 取整。
 */
export function ensembleOf(samples) {
  const n = samples.length;
  const mean = {}, std = {}, req = {}, hard = [], rare = [];
  for (const id of SKILL_IDS) {
    const v = samples.map((x) => x.req[id] || 0);
    mean[id] = v.reduce((a, b) => a + b, 0) / n;
    std[id] = Math.sqrt(v.reduce((a, b) => a + (b - mean[id]) ** 2, 0) / n);
    req[id] = n > 1 ? Math.max(0, Math.round((mean[id] - 0.5 * std[id]) * 2) / 2) : v[0];
    if (n > 1 && v.every((x) => x >= 3) && std[id] <= 0.8) hard.push(id);
    else if (n > 1 && v.filter((x) => x >= 2).length > 0 && v.filter((x) => x >= 2).length <= n / 2) rare.push(id);
  }
  return { n, mean, std, req, hard, rare };
}

/** 数据漂移：新 JD（或集成结果）与当前目标的差异。 */
function driftOf(req, role) {
  if (!role) return null;
  let dot = 0, a = 0, b = 0;
  const diffs = [];
  for (const id of SKILL_IDS) {
    const x = req[id] || 0, y = role.req[id] || 0;
    dot += x * y; a += x * x; b += y * y;
    if (Math.abs(x - y) >= 1.5) diffs.push({ id, d: x - y });
  }
  const cos = dot / Math.sqrt(a * b || 1);
  return { cos, diffs: diffs.sort((p, q) => Math.abs(q.d) - Math.abs(p.d)), drift: cos < 0.93 || diffs.some((x) => Math.abs(x.d) >= 2) };
}

function openJD(onCreated) {
  let samples = [];
  let texts = [''];
  const cur = () => M.roleById(store.state, store.state.target);
  modal({
    title: '从真实 JD 创建目标函数',
    kicker: 'CUSTOM OBJECTIVE · AI 解析 · 多 JD 集成',
    wide: true,
    body: `
      <p class="muted" style="font-size:13px">粘贴你感兴趣的岗位描述（招聘 JD），AI 会把它转换成 12 维能力要求。<b>建议粘贴 3–5 份同类岗位的 JD</b>：系统会做集成（ensemble），算出各家都要求的“硬性能力”和只有个别公司要的“偶尔要求”，比单份 JD 稳得多。</p>
      <div id="jdList"></div>
      <div class="row" style="margin-top:12px;justify-content:space-between"><button class="btn ghost sm" id="jdAdd">${icon('plus', 13)} 再加一份同类 JD</button><button class="btn ai" id="jdGo">${icon('spark', 15)} 解析 JD</button></div>
      <div id="jdOut"></div>`,
    onMount(panel, close) {
      const list = panel.querySelector('#jdList');
      const drawList = () => {
        list.innerHTML = texts.map((t, i) => `<div class="field jd-item" style="margin-top:12px"><label>JD ${texts.length > 1 ? `#${i + 1}` : ''}${texts.length > 1 ? `<button class="icon-btn" data-rm="${i}" title="移除" style="margin-left:auto">${icon('close', 13)}</button>` : ''}</label><textarea class="textarea" data-jd="${i}" style="min-height:${texts.length > 1 ? 110 : 180}px" placeholder="例如：\n岗位职责：负责大模型后训练（SFT/RLHF）数据构建与实验……\n任职要求：熟悉 PyTorch，了解 Transformer、DeepSpeed……">${esc(t)}</textarea></div>`).join('');
        list.querySelectorAll('[data-jd]').forEach((ta) => (ta.oninput = () => (texts[+ta.dataset.jd] = ta.value)));
        list.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { texts.splice(+b.dataset.rm, 1); drawList(); }));
        panel.querySelector('#jdAdd').disabled = texts.length >= 5;
      };
      drawList();
      panel.querySelector('#jdAdd').onclick = () => { if (texts.length < 5) { texts.push(''); drawList(); list.querySelector(`[data-jd="${texts.length - 1}"]`).focus(); } };
      const go = panel.querySelector('#jdGo');
      go.onclick = async () => {
        const inputs = texts.map((t) => t.trim()).filter(Boolean);
        if (!inputs.length || inputs.some((t) => t.length < 20)) { toast('JD 内容太短啦，每份至少粘贴几行岗位要求', { type: 'error' }); return; }
        go.disabled = true;
        go.innerHTML = `<span class="spinner"></span> 解析中${inputs.length > 1 ? `（${inputs.length} 份）` : ''}…`;
        try {
          const res = await Promise.all(inputs.map((text) => aiJSON('jd_parse', { text })));
          const mock = res.some((r) => r.mock);
          samples = res.map(({ data }, i) => {
            const req = {};
            for (const id of SKILL_IDS) req[id] = Math.max(0, Math.min(5, Math.round(Number(data.req?.[id]) || 0)));
            return { ...data, req, text: inputs[i] };
          });
          const ens = ensembleOf(samples);
          const first = samples[0];
          const S = M.skillsAt(store.state);
          const fake = { req: ens.req };
          const l = M.lossOf(S, fake);
          const target = cur();
          const dr = driftOf(ens.req, target);
          const canMerge = target?.custom;
          const kw = [...new Set(samples.flatMap((x) => x.keywords || []))];
          const kwCount = Object.fromEntries(kw.map((k) => [k, samples.filter((x) => (x.keywords || []).includes(k)).length]));
          panel.querySelector('#jdOut').innerHTML = `
            <div class="divider"></div>
            ${mock ? '<div class="chip warn" style="margin-bottom:10px">演示模式：关键词估计</div>' : ''}
            <div class="grid-2">
              <div class="field"><label>岗位名称</label><input class="input" id="jdName" value="${esc(first.name || '自定义岗位')}" maxlength="20"></div>
              <div class="field"><label>公司</label><input class="input" id="jdCo" value="${esc(ens.n > 1 ? samples.map((x) => x.company).filter(Boolean).slice(0, 3).join(' / ') || `${ens.n} 家公司` : first.company || '')}" maxlength="30"></div>
            </div>
            <p class="muted" style="font-size:13px;margin:12px 0">${esc(first.summary || '')}</p>
            ${ens.n > 1 ? `<div class="ens-box"><div class="kicker">ENSEMBLE · ${ens.n} 份 JD · 要求 = 均值 − 0.5 × 标准差</div>
              <div class="ens-grid">${SKILL_IDS.filter((id) => ens.mean[id] >= 0.5).sort((a, b) => ens.mean[b] - ens.mean[a]).map((id) => `<div class="ens-row"><span>${esc(SKILL[id].name)}</span><span class="num">${ens.mean[id].toFixed(1)}<span class="dim"> ±${ens.std[id].toFixed(1)}</span></span><span class="num c-target">${ens.req[id]}</span>${ens.hard.includes(id) ? '<span class="chip loss">硬性</span>' : ens.rare.includes(id) ? '<span class="chip">偶尔</span>' : '<span></span>'}</div>`).join('')}</div></div>` : ''}
            ${dr?.drift ? `<div class="notice warn" style="margin-top:12px">${icon('flag', 15)}<span><b>数据漂移</b>：与当前目标「${esc(target.name)}」的相似度 ${Math.round(dr.cos * 100)}%。${dr.diffs.slice(0, 3).map((x) => `${SKILL[x.id].name}${x.d > 0 ? '要求更高' : '要求更低'}（${x.d > 0 ? '+' : ''}${x.d.toFixed(1)}）`).join('，')}。${canMerge ? '如果这是同一个岗位的新版要求，可以合并进当前目标；' : ''}方向差异大时建议先去「分支推演」比较一下。</span></div>` : dr ? `<div class="dim" style="font-size:12px;margin-top:10px">与当前目标「${esc(target.name)}」相似度 ${Math.round(dr.cos * 100)}%，没有明显漂移。</div>` : ''}
            <div class="row" style="justify-content:space-between;margin:14px 0 8px"><span class="kicker">能力要求（蓝线）vs 你</span><span class="num c-accent">你的拟合度 ${Math.round(M.fitOf(l) * 100)}%</span></div>
            ${weightBars(S, fake, SKILLS, { compact: true })}
            ${kw.length ? `<div class="row" style="gap:6px;margin-top:12px">${kw.sort((a, b) => kwCount[b] - kwCount[a]).slice(0, 12).map((k) => `<span class="chip ${kwCount[k] > 1 ? 'target' : ''}">${esc(k)}${kwCount[k] > 1 ? ` ×${kwCount[k]}` : ''}</span>`).join('')}</div>` : ''}
            <div class="row-end">${canMerge ? `<button class="btn" data-merge>${icon('layers', 14)} 合并进「${esc(target.name)}」</button>` : ''}<button class="btn" data-save="0">仅保存</button><button class="btn primary" data-save="1">${icon('flag', 15)} 保存并设为目标</button></div>`;
          const pack = (x) => ({ name: x.name || '', company: x.company || '', req: x.req, keywords: x.keywords || [] });
          panel.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => {
            const id = uid('c');
            const role = {
              id, custom: true, name: panel.querySelector('#jdName').value.trim() || '自定义岗位', en: ens.n > 1 ? `Ensemble · ${ens.n} JDs` : 'Custom · from JD',
              company: panel.querySelector('#jdCo').value.trim(), summary: first.summary || '', desc: first.summary || '',
              tagline: panel.querySelector('#jdCo').value.trim() || '来自真实 JD', req: ens.req, keywords: kw.slice(0, 10),
              tips: first.tips || '', depth: 0.8, jd: inputs.join('\n\n---\n\n').slice(0, 6000),
              ensemble: { samples: samples.map(pack), hard: ens.hard, rare: ens.rare, std: ens.std },
            };
            store.update((st) => { st.customRoles = [...(st.customRoles || []), role]; if (b.dataset.save === '1') st.target = id; }, 'role-add');
            toast(`已创建目标「${role.name}」${ens.n > 1 ? `（集成 ${ens.n} 份 JD）` : ''}`, { type: 'success' });
            close();
            onCreated(id);
          }));
          panel.querySelector('[data-merge]')?.addEventListener('click', () => {
            const t = cur();
            const prev = t.ensemble?.samples || [{ name: t.name, company: t.company || '', req: t.req, keywords: t.keywords || [] }];
            const all = [...prev, ...samples.map(pack)].slice(-12);
            const e2 = ensembleOf(all);
            store.update((st) => {
              const r = st.customRoles.find((x) => x.id === t.id);
              const before = { ...r.req };
              r.req = e2.req;
              r.en = `Ensemble · ${e2.n} JDs`;
              r.keywords = [...new Set([...(r.keywords || []), ...kw])].slice(0, 12);
              r.ensemble = { samples: all, hard: e2.hard, rare: e2.rare, std: e2.std };
              const ch = SKILL_IDS.filter((id) => before[id] !== e2.req[id]).map((id) => `${SKILL[id].name} ${before[id]}→${e2.req[id]}`);
              logChange(st, { by: 'user', kind: 'plan', title: `目标「${r.name}」合并了 ${samples.length} 份新 JD（共 ${e2.n} 份）`, reason: '用最新的真实招聘要求更新目标函数', diff: ch.length ? ch.map((text) => ({ op: '~', text })) : [{ op: '~', text: '能力要求没有变化' }] });
            }, 'role-add');
            toast(`已合并：目标函数现在集成了 ${e2.n} 份 JD`, { type: 'success' });
            close();
            onCreated(t.id);
          });
        } catch (e) {
          toast(e.message, { type: 'error' });
        } finally {
          go.disabled = false;
          go.innerHTML = `${icon('spark', 15)} 重新解析`;
        }
      };
    },
  });
}
