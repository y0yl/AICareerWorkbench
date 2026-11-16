// 验证集：AI 模拟面试。逐题打分、追问、生成评估报告，防止“只在训练集上表现好”。
// 另含：错题本（难例挖掘，间隔重复复测）与测试集（真实投递追踪）。
import { store, uid } from '../core/store.js';
import * as M from '../core/model.js';
import * as T from '../core/testset.js';
import { SKILL, SKILLS } from '../core/data.js';
import { icon, esc, $, $$, toast, modal, fmtDate, relTime, confirmBox, debounce } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';

const KINDS = [
  { id: 'tech', name: '技术面', desc: '基础知识与原理' },
  { id: 'project', name: '项目深挖', desc: '围绕你的经历追问' },
  { id: 'hr', name: '综合面', desc: '动机、规划与协作' },
];
const KIND_NAME = { tech: '技术面', project: '项目深挖', hr: '综合面', review: '错题复测' };
const DIMS = { knowledge: '专业知识', depth: '项目深度', logic: '表达逻辑', fit: '岗位匹配' };
const DRAFT_TTL = 3 * 86400000;
const validSkill = (id) => (SKILL[id] ? id : null);

export default {
  title: '验证集',
  mount(root, ctx) {
    let session = null; // { id, mode, roleId, roleName, roleDesc, kind, total, qa:[{q,focus,skill,hardId,a,eval}], current, busy, report, reviewAt }
    const s0 = store.state;
    let cfg = { roleId: s0.target || 'llm_algo', kind: 'tech', total: 5 };
    let tab = ['val', 'hard', 'test'].includes(ctx.params.get('tab')) ? ctx.params.get('tab') : 'val';
    let draftAnswer = '';

    // ---------- 草稿：面试进行中离开页面也不丢 ----------
    const saveDraft = () => {
      if (session && !session.report && session.qa.length + (session.current ? 1 : 0) > 0) store.prefs.set('ivDraft', { ...session, busy: false, draftAnswer, savedAt: Date.now() });
    };
    const saveAnswer = debounce(saveDraft, 400);
    const clearDraft = () => store.prefs.set('ivDraft', null);
    const draft = () => { const d = store.prefs.get('ivDraft', null); return d && Date.now() - (d.savedAt || 0) < DRAFT_TTL ? d : null; };

    function shell() {
      root.innerHTML = `
      <div class="page ${ctx.again ? 'static' : ''}">
        <div class="page-head">
          <div class="page-title">
            <div class="path">~/epoch/<b>validation</b> · ${tab === 'test' ? 'test set' : tab === 'hard' ? 'hard example mining' : 'mock interview'}</div>
            <h1>验证集</h1>
            <p class="page-desc">训练集上的 loss 再低，也要在验证集上检验。AI 面试官逐题打分，每道题的得分会反过来<b>校准你的能力估计</b>；答砸的题进入<b>错题本</b>按间隔重复复测；真实投递记在<b>测试集</b>里。</p>
          </div>
        </div>
        <div class="tabs val-tabs">${[['val', '模拟面试'], ['hard', '错题本', T.hardStats(store.state).due], ['test', '测试集 · 真实投递', (store.state.applications || []).length]].map(([id, n, c]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${n}${c ? `<span class="count">${c}</span>` : ''}</button>`).join('')}</div>
        <div class="val-grid">
          <div id="stage"></div>
          <aside class="val-side">
            <section class="panel ticks"><div class="panel-h"><span class="ph-idx">GAP</span><span class="ph-title">泛化差距</span><span class="ph-en">train vs val</span></div><div class="panel-b" id="genPanel"></div></section>
            <section class="panel ticks"><div class="panel-h"><span class="ph-idx">ACC</span><span class="ph-title">验证准确率</span><span class="ph-en">val_acc / session</span></div><div class="panel-b" id="valChart"></div></section>
            <section class="panel ticks"><div class="panel-h"><span class="ph-idx">LOG</span><span class="ph-title">历史记录</span></div><div id="history"></div></section>
          </aside>
        </div>
      </div>`;
      $$('[data-tab]', root).forEach((b) => (b.onclick = () => {
        if (session && !session.report && b.dataset.tab !== 'val') saveDraft();
        tab = b.dataset.tab;
        history.replaceState(null, '', `#/validate?tab=${tab}`);
        shell();
      }));
      renderSide();
      renderStage();
    }

    function renderSide() {
      const s = store.state;
      const ivs = (s.interviews || []).filter((i) => i.report);
      $('#genPanel', root).innerHTML = genHTML(s);
      $('#valChart', root).innerHTML = ivs.length ? valChart(ivs) : '<div class="dim" style="font-size:12.5px">完成第一场模拟面试后，这里会出现你的验证曲线。</div>';
      $('#history', root).innerHTML = ivs.length ? [...ivs].reverse().map((iv) => `
        <button class="hist-row" data-iv="${esc(iv.id)}">
          <span class="hist-score num ${iv.report.overall >= 75 ? 'c-accent' : iv.report.overall >= 60 ? 'c-warn' : 'c-loss'}">${iv.report.overall}</span>
          <span class="grow"><b>${esc(iv.roleName)}</b><span class="dim">${KIND_NAME[iv.kind] || ''} · ${fmtDate(iv.t)} · ${esc(iv.report.verdict || '')}</span></span>
          ${icon('arrow', 14)}
        </button>`).join('') : '<div class="dim panel-b" style="font-size:12.5px">暂无记录</div>';
      $$('[data-iv]', root).forEach((b) => (b.onclick = () => showReport(store.state.interviews.find((i) => i.id === b.dataset.iv))));
    }

    function renderStage() {
      const el = $('#stage', root);
      if (tab === 'hard') { el.innerHTML = hardHTML(); bindHard(); return; }
      if (tab === 'test') { el.innerHTML = testHTML(); bindTest(); return; }
      if (!session) { el.innerHTML = setupHTML(); bindSetup(); return; }
      if (session.report) { el.innerHTML = reportHTML(session); bindReport(); return; }
      el.innerHTML = sessionHTML();
      bindSession();
      saveDraft();
    }

    // —— 设置 ——
    function setupHTML() {
      const s = store.state;
      const roles = M.allRoles(s);
      const d = draft();
      const due = T.dueHard(s);
      return `
      ${d ? `<div class="notice iv-resume">${icon('play', 15)}<span>有一场未完成的面试：<b>${esc(d.roleName)} · ${KIND_NAME[d.kind] || ''}</b>，已答 ${d.qa.filter((x) => x.eval).length}/${d.total} 题（${relTime(d.savedAt)}）。</span>
        <span class="row" style="margin-left:auto"><button class="btn ghost sm" data-act="drop">放弃</button><button class="btn primary sm" data-act="resume">继续作答</button></span></div>` : ''}
      ${due.length ? `<div class="notice iv-due">${icon('refresh', 15)}<span>错题本有 <b>${due.length}</b> 道题到期复测。开始新面试时会自动穿插 ${Math.min(2, due.length)} 道（换个问法再答一次）。</span><button class="btn ghost sm" data-act="review" style="margin-left:auto">只做错题复测</button></div>` : ''}
      <section class="panel ticks val-setup">
        <div class="panel-h"><span class="ph-idx">CFG</span><span class="ph-title">配置一场面试</span><span class="ph-en">validation config</span></div>
        <div class="panel-b">
          <div class="field"><label>面试岗位</label><select class="select" id="ivRole">${roles.map((r) => `<option value="${r.id}" ${r.id === cfg.roleId ? 'selected' : ''}>${esc(r.name)}${r.id === s.target ? '（当前目标）' : ''}</option>`).join('')}</select></div>
          <div class="field" style="margin-top:16px"><label>面试类型</label>
            <div class="kind-pick">${KINDS.map((k) => `<button type="button" class="kp ${cfg.kind === k.id ? 'on' : ''}" data-kind="${k.id}"><b>${k.name}</b><span class="dim">${k.desc}</span></button>`).join('')}</div></div>
          <div class="field" style="margin-top:16px"><label>题目数量</label><div class="seg" id="ivN">${[3, 5, 8].map((n) => `<button type="button" data-n="${n}" class="${cfg.total === n ? 'on' : ''}">${n} 题</button>`).join('')}</div></div>
          <div class="val-tips">
            <div class="kicker">作答建议</div>
            <ul><li>先给结论，再讲原理，最后用你自己的项目举例</li><li>不会的题坦诚说明思路，比硬编更加分</li><li>项目题尽量量化：指标、规模、你负责的部分</li><li>中途离开也没关系：进度会自动保存，回来可以接着答</li></ul>
          </div>
          <button class="btn primary lg" data-act="start" style="margin-top:18px">${icon('play', 14)} 开始面试</button>
        </div>
      </section>`;
    }
    function bindSetup() {
      $('#ivRole', root).onchange = (e) => (cfg.roleId = e.target.value);
      $$('[data-kind]', root).forEach((b) => (b.onclick = () => { cfg.kind = b.dataset.kind; $$('[data-kind]', root).forEach((x) => x.classList.toggle('on', x === b)); }));
      $$('[data-n]', root).forEach((b) => (b.onclick = () => { cfg.total = +b.dataset.n; $$('[data-n]', root).forEach((x) => x.classList.toggle('on', x === b)); }));
      $('[data-act="start"]', root).onclick = start;
      $('[data-act="resume"]', root)?.addEventListener('click', resume);
      $('[data-act="drop"]', root)?.addEventListener('click', () => { clearDraft(); renderStage(); });
      $('[data-act="review"]', root)?.addEventListener('click', () => startReview());
    }

    async function start() {
      const role = M.roleById(store.state, cfg.roleId);
      clearDraft();
      // 难例挖掘：到期的错题按 Q2、Q4 穿插进来
      const due = T.dueHard(store.state).slice(0, cfg.total >= 5 ? 2 : 1);
      const reviewAt = {};
      due.forEach((h, i) => { if (1 + i * 2 < cfg.total) reviewAt[1 + i * 2] = h.id; });
      session = { id: uid('iv'), mode: 'normal', roleId: role.id, roleName: role.name, roleDesc: role.desc || role.summary || '', kind: cfg.kind, total: cfg.total, qa: [], current: null, busy: true, opening: '', reviewAt };
      draftAnswer = '';
      renderStage();
      try {
        const { data, mock } = await aiJSON('interview_start', payload());
        session.mock = mock;
        session.opening = data.opening || '';
        session.current = { q: data.question || '请先做个自我介绍。', focus: data.focus || '', skill: validSkill(data.skill) };
      } catch (e) {
        toast(e.message, { type: 'error' });
        session = null;
      }
      if (session) session.busy = false;
      renderStage();
    }

    /** 错题复测：只出错题本里的题（到期的优先），每题由面试官重新打分。 */
    function startReview(ids = null) {
      const s = store.state;
      const pool = ids ? (s.hardQs || []).filter((h) => ids.includes(h.id)) : T.dueHard(s);
      const list = (pool.length ? pool : (s.hardQs || []).filter((h) => !h.mastered).sort((a, b) => a.due - b.due)).slice(0, 6);
      if (!list.length) { toast('错题本是空的——答砸的面试题会自动进来'); return; }
      const role = M.roleById(s, list[0].roleId) || M.roleById(s, s.target) || M.allRoles(s)[0];
      clearDraft();
      tab = 'val';
      session = {
        id: uid('iv'), mode: 'review', roleId: role.id, roleName: role.name, roleDesc: role.desc || role.summary || '', kind: 'review', total: list.length, qa: [], busy: false,
        opening: `错题复测：这 ${list.length} 道是你之前没答好的题。别看参考答案，先凭现在的理解再答一次——答好一次升一档，五档全过就算真正掌握。`,
        queue: list.map((h) => h.id), current: hardQ(list[0]), reviewAt: {},
      };
      draftAnswer = '';
      shell();
    }
    const hardQ = (h) => ({ q: h.q, focus: h.focus || '错题复测', skill: h.skill, hardId: h.id });

    async function resume() {
      const d = draft();
      if (!d) return renderStage();
      session = { ...d, busy: false };
      draftAnswer = d.draftAnswer || '';
      const last = session.qa.at(-1);
      if (last && !last.eval) { session.qa.pop(); session.current = { q: last.q, focus: last.focus, skill: last.skill, hardId: last.hardId }; draftAnswer = last.a || draftAnswer; }
      if (!session.current && session.qa.length < session.total) {
        session.busy = true;
        renderStage();
        try { session.current = await nextQuestion(); } catch (e) { toast(e.message, { type: 'error' }); }
        session.busy = false;
      }
      if (!session.current && session.qa.length >= session.total) return finish();
      renderStage();
    }

    async function nextQuestion() {
      const i = session.qa.length;
      if (session.mode === 'review') { const h = (store.state.hardQs || []).find((x) => x.id === session.queue[i]); return h ? hardQ(h) : null; }
      const hid = session.reviewAt?.[i];
      const h = hid && (store.state.hardQs || []).find((x) => x.id === hid);
      if (h) return hardQ(h);
      const { data } = await aiJSON('interview_turn', payload({ history: session.qa.map(({ q, a }) => ({ q, a: a || '（候选人跳过了此题）' })), remaining: session.total - i }));
      return data.next_question ? { q: data.next_question, focus: data.focus || '', skill: validSkill(data.next_skill) } : null;
    }

    const payload = (extra = {}) => ({ role: session.roleName, roleDesc: session.roleDesc, kind: session.kind === 'review' ? 'tech' : session.kind, ...extra });

    // —— 面试中 ——
    function sessionHTML() {
      const scored = session.qa.filter((x) => x.eval);
      const avg = scored.length ? scored.reduce((a, x) => a + (+x.eval.score || 0), 0) / scored.length : null;
      const idx = session.qa.length + (session.current ? 1 : 0);
      const cur = session.current;
      return `
      <section class="panel ticks iv">
        <div class="panel-h">
          <span class="ph-idx">Q${Math.min(idx, session.total)}/${session.total}</span><span class="ph-title">${esc(session.roleName)} · ${KIND_NAME[session.kind]}</span>
          ${session.mock ? '<span class="chip warn">DEMO</span>' : ''}
          <span class="ph-right"><span class="num dim" style="font-size:11px">${avg != null ? `avg ${avg.toFixed(1)}/10` : ''}</span><button class="btn sm ghost" data-act="end">结束面试</button></span>
        </div>
        <div class="iv-prog">${Array.from({ length: session.total }, (_, i) => {
          const q = session.qa[i];
          const sc = q?.eval ? +q.eval.score : null;
          return `<i class="${sc != null ? (sc >= 7.5 ? 'good' : sc >= 6 ? 'ok' : 'bad') : i === session.qa.length ? 'cur' : ''}"></i>`;
        }).join('')}</div>
        <div class="iv-body" id="ivBody">
          ${session.opening ? `<div class="iv-q opening"><div class="iv-who mono">INTERVIEWER</div><p>${esc(session.opening)}</p></div>` : ''}
          ${session.qa.map((x, i) => qaHTML(x, i)).join('')}
          ${cur ? `<div class="iv-q ${cur.hardId ? 'hard' : ''}"><div class="iv-who mono">Q${session.qa.length + 1}${cur.focus ? ` · <span class="c-target">${esc(cur.focus)}</span>` : ''}${cur.hardId ? ' · <span class="c-warn">错题复测</span>' : ''}</div><p>${esc(cur.q)}</p></div>` : ''}
          ${session.busy ? '<div class="iv-q thinking"><span class="typing"><i></i><i></i><i></i></span><span class="dim">面试官正在思考…</span></div>' : ''}
        </div>
        ${cur && !session.busy ? `
        <form class="iv-answer" id="ivForm">
          <textarea class="textarea" id="ivA" placeholder="输入你的回答……（Ctrl/⌘ + Enter 提交）" rows="5">${esc(draftAnswer)}</textarea>
          <div class="row" style="justify-content:space-between"><span class="dim num" id="ivCount" style="font-size:11px">${draftAnswer.trim().length} 字 · 自动保存</span>
            <div class="row"><button type="button" class="btn ghost sm" data-act="skip">不会，跳过</button><button class="btn primary" type="submit">${icon('send', 14)} 提交回答</button></div></div>
        </form>` : ''}
      </section>`;
    }
    function qaHTML(x, i) {
      const e = x.eval;
      const sc = e ? +e.score : null;
      return `
        <div class="iv-q ${x.hardId ? 'hard' : ''}"><div class="iv-who mono">Q${i + 1}${x.focus ? ` · <span class="c-target">${esc(x.focus)}</span>` : ''}${x.skill ? ` · ${esc(SKILL[x.skill]?.name || '')}` : ''}${x.hardId ? ' · <span class="c-warn">错题复测</span>' : ''}</div><p>${esc(x.q)}</p></div>
        <div class="iv-a"><div class="iv-who mono">YOU</div><p>${esc(x.a || '（跳过）')}</p></div>
        ${e ? `<div class="iv-eval">
          <div class="ie-score"><span class="num ${sc >= 7.5 ? 'c-accent' : sc >= 6 ? 'c-warn' : 'c-loss'}">${sc.toFixed(1)}</span><span class="dim">/10</span></div>
          <div class="ie-body">
            <p>${esc(e.feedback || '')}</p>
            ${(e.strengths || []).length ? `<div class="ie-line"><span class="c-accent">✓</span> ${e.strengths.map(esc).join('；')}</div>` : ''}
            ${(e.improve || []).length ? `<div class="ie-line"><span class="c-warn">△</span> ${e.improve.map(esc).join('；')}</div>` : ''}
            ${e.reference ? `<details><summary class="kicker">参考要点</summary><p class="muted">${esc(e.reference)}</p></details>` : ''}
            ${x.hardNote ? `<div class="ie-line dim">${esc(x.hardNote)}</div>` : ''}
          </div>
        </div>` : ''}`;
    }

    function bindSession() {
      const body = $('#ivBody', root);
      body.scrollTop = body.scrollHeight;
      root.closest('.main')?.scrollTo({ top: root.closest('.main').scrollHeight, behavior: 'smooth' });
      $('[data-act="end"]', root).onclick = finish;
      const form = $('#ivForm', root);
      if (!form) return;
      const ta = $('#ivA', root);
      ta.focus({ preventScroll: true });
      ta.addEventListener('input', () => { draftAnswer = ta.value; $('#ivCount', root).textContent = `${ta.value.trim().length} 字 · 自动保存`; saveAnswer(); });
      ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') form.requestSubmit(); });
      form.onsubmit = (e) => { e.preventDefault(); answer(ta.value.trim()); };
      $('[data-act="skip"]', root).onclick = () => answer('');
    }

    /** 记录一道题的结果：低分题进错题本；复测题更新它在错题本里的档位。 */
    function bank(item) {
      const sc = item.eval?.score ?? 0;
      store.update((st) => {
        if (item.hardId) {
          const h = T.reviewHard(st, item.hardId, sc);
          if (h) item.hardNote = h.mastered ? '错题本：五档全过，已掌握 ✓' : sc >= T.PASS ? `错题本：升到第 ${h.box + 1} 档，${T.BOXES[h.box]} 天后再测` : sc < T.HARD_BAR ? '错题本：回到第 1 档，明天再测' : '错题本：档位不变';
        } else if (sc < T.HARD_BAR) {
          T.addHard(st, { q: item.q, focus: item.focus, skill: item.skill, roleId: session.roleId, roleName: session.roleName, score: sc, reference: item.eval?.reference || '', from: 'val' });
          item.hardNote = '已收进错题本（难例挖掘），明天起按间隔重复复测';
        }
      }, 'hard');
    }

    async function answer(text) {
      if (!session.current) return;
      if (text.length === 0 && !confirm('跳过这道题？会按 0 分计入。')) return;
      const item = { ...session.current, a: text, eval: null };
      session.qa.push(item);
      session.current = null;
      session.busy = true;
      draftAnswer = '';
      renderStage();
      const remaining = session.total - session.qa.length;
      const nextIsLocal = session.mode === 'review' || !!session.reviewAt?.[session.qa.length];
      try {
        if (!text) {
          item.eval = { score: 0, feedback: '本题跳过。建议课后查阅参考资料补齐这个知识点。', strengths: [], improve: ['补齐该知识点'], reference: '' };
          item.skill = item.skill || M.skillOfText(`${item.focus} ${item.q}`);
          if (remaining > 0) session.current = await nextQuestion();
        } else {
          const { data } = await aiJSON('interview_turn', payload({ history: session.qa.map(({ q, a }) => ({ q, a: a || '（候选人跳过了此题）' })), remaining: nextIsLocal ? 0 : remaining }));
          item.eval = {
            score: Math.max(0, Math.min(10, +data.score || 0)), feedback: String(data.feedback || ''),
            strengths: (data.strengths || []).slice(0, 3).map(String), improve: (data.improve || []).slice(0, 3).map(String), reference: String(data.reference || ''),
          };
          item.skill = item.skill || validSkill(data.skill) || M.skillOfText(`${item.focus} ${item.q}`, session.kind === 'hr' ? 'comm' : null);
          if (remaining > 0) {
            if (nextIsLocal) session.current = await nextQuestion();
            else if (data.next_question) session.current = { q: data.next_question, focus: data.focus || '', skill: validSkill(data.next_skill) };
          }
        }
        bank(item);
      } catch (e) {
        toast(e.message, { type: 'error' });
        if (!item.eval) {
          session.qa.pop();
          session.current = { q: item.q, focus: item.focus, skill: item.skill, hardId: item.hardId };
          draftAnswer = text;
        }
      }
      session.busy = false;
      if (!session.current && session.qa.length >= session.total) return finish();
      renderStage();
    }

    async function finish() {
      if (!session.qa.some((x) => x.eval)) { session = null; clearDraft(); renderStage(); return; }
      session.busy = true;
      session.current = null;
      renderStage();
      try {
        const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(+v || 0)));
        const scored = session.qa.filter((x) => x.eval);
        if (session.mode === 'review') {
          const good = scored.filter((x) => x.eval.score >= T.PASS).length;
          const avg = scored.reduce((a, x) => a + x.eval.score, 0) / scored.length;
          session.report = { overall: clamp100(avg * 10), verdict: good === scored.length ? '通过' : good ? '待定' : '未通过', summary: `错题复测 ${scored.length} 题，答好 ${good} 题。答好的题会升档、间隔拉长；没答好的回到第一档，明天再来。`, dims: null, advice: [] };
        } else {
          const { data } = await aiJSON('interview_report', payload({ history: session.qa.map((x) => ({ q: x.q, a: x.a, score: x.eval?.score ?? 0 })) }));
          session.report = {
            overall: clamp100(data.overall), verdict: String(data.verdict || ''), summary: String(data.summary || ''),
            dims: Object.fromEntries(Object.keys(DIMS).map((k) => [k, clamp100(data.dims?.[k])])), advice: (data.advice || []).slice(0, 5).map(String),
          };
        }
        const role = M.roleById(store.state, store.state.target);
        const before = role ? M.generalization(store.state) : null;
        const iv = { id: session.id, t: Date.now(), roleId: session.roleId, roleName: session.roleName, kind: session.kind, qa: session.qa.map(({ hardNote, ...x }) => x), report: session.report, mock: session.mock };
        store.update((st) => { st.interviews = [...(st.interviews || []), iv]; }, 'interview');
        clearDraft();
        const after = role ? M.generalization(store.state) : null;
        const moved = after?.val != null && before?.val != null ? after.val - before.val : null;
        toast(`验证完成：${session.report.overall} 分${moved != null && Math.abs(moved) > 0.0005 ? ` · 验证 loss ${moved < 0 ? '▼' : '▲'}${Math.abs(moved).toFixed(4)}` : ''}`, { type: 'success' });
      } catch (e) {
        toast(e.message, { type: 'error' });
      }
      session.busy = false;
      renderSide();
      renderStage();
    }

    function reportHTML(sess) {
      const r = sess.report;
      return `
      <section class="panel ticks iv-report">
        <div class="panel-h"><span class="ph-idx">EVAL</span><span class="ph-title">验证报告 · ${esc(sess.roleName)}</span><span class="ph-en">${KIND_NAME[sess.kind] || ''}</span></div>
        <div class="panel-b">${reportBody(r, sess.qa)}
          <div class="row-end"><button class="btn" data-act="again">${icon('refresh', 14)} 再来一场</button><button class="btn ai" data-act="ask">${icon('tree', 14)} 让树形图设计者制定提升计划</button></div>
        </div>
      </section>`;
    }
    function bindReport() {
      $('[data-act="again"]', root).onclick = () => { session = null; renderStage(); };
      const weak = session.qa.filter((x) => x.eval && x.eval.score < 6).map((x) => x.focus || x.q.slice(0, 16));
      $('[data-act="ask"]', root).onclick = () => ctx.openAdam(`我刚完成「${session.roleName}」${KIND_NAME[session.kind]}，得分 ${session.report.overall}。总评：${session.report.summary}${weak.length ? `。没答好的考点：${weak.join('、')}` : ''}。请结合验证集校准后的短板，给我一个两周的针对性提升计划。`);
    }

    function showReport(iv) {
      modal({ title: `${iv.roleName} · ${iv.report.overall} 分`, kicker: `VALIDATION · ${KIND_NAME[iv.kind] || ''} · ${fmtDate(iv.t, true)}`, wide: true, body: reportBody(iv.report, iv.qa) });
    }

    // ---------- 错题本 ----------
    function hardHTML() {
      const s = store.state;
      const st = T.hardStats(s);
      const list = [...(s.hardQs || [])].sort((a, b) => (a.mastered - b.mastered) || ((a.due ?? Infinity) - (b.due ?? Infinity)));
      const now = Date.now();
      return `
      <section class="panel ticks hard-panel">
        <div class="panel-h"><span class="ph-idx">HARD</span><span class="ph-title">错题本</span><span class="ph-en hide-sm">hard example mining · spaced repetition</span>
          <span class="ph-right"><button class="btn ghost sm" data-act="add-hard">${icon('plus', 13)} 手动添加</button></span></div>
        <div class="panel-b">
          <div class="hard-sum">
            <div><b class="num">${st.active}</b><span class="kicker">待掌握</span></div>
            <div><b class="num c-warn">${st.due}</b><span class="kicker">今天到期</span></div>
            <div><b class="num c-accent">${st.mastered}</b><span class="kicker">已掌握</span></div>
            <div class="grow dim" style="font-size:12.5px">训练里最有价值的样本是模型答错的那些。面试中低于 6 分的题会自动收进来，按 ${T.BOXES.join(' / ')} 天的间隔复测：答好（≥7）升一档，答砸回到第一档，五档全过算掌握。</div>
            <button class="btn primary" data-act="review" ${st.active ? '' : 'disabled'}>${icon('play', 14)} ${st.due ? `复测 ${Math.min(6, st.due)} 道到期题` : '提前复测'}</button>
          </div>
          ${list.length ? `<div class="hard-list">${list.map((h) => {
            const last = h.history?.at(-1);
            return `<div class="hard-row ${h.mastered ? 'mastered' : h.due <= now ? 'due' : ''}">
              <div class="hr-boxes" title="间隔重复档位">${T.BOXES.map((d, i) => `<i class="${h.mastered || i < h.box ? 'on' : i === h.box ? 'cur' : ''}"></i>`).join('')}</div>
              <div class="grow">
                <div class="hr-q">${esc(h.q)}</div>
                <div class="hr-m">${h.skill ? `<span class="chip">${esc(SKILL[h.skill]?.name || '')}</span>` : ''}${h.focus ? `<span class="chip target">${esc(h.focus)}</span>` : ''}<span class="dim">${h.from === 'test' ? '真实面试' : h.from === 'manual' ? '手动添加' : '模拟面试'}${h.roleName ? ` · ${esc(h.roleName)}` : ''}</span>
                  ${last ? `<span class="num ${last.score >= 7 ? 'c-accent' : last.score >= 6 ? 'c-warn' : 'c-loss'}">上次 ${(+last.score).toFixed(1)}</span>` : ''}
                  <span class="dim">${h.mastered ? `已掌握 · ${fmtDate(h.masteredAt)}` : h.due <= now ? '到期' : `${Math.ceil((h.due - now) / 86400000)} 天后复测`}</span></div>
                ${h.reference ? `<details><summary class="kicker">参考要点</summary><p class="muted">${esc(h.reference)}</p></details>` : ''}
              </div>
              <div class="hr-act">${h.mastered ? '' : `<button class="btn ghost sm" data-one="${h.id}" title="只复测这一道">${icon('play', 12)}</button>`}<button class="icon-btn" data-del-hard="${h.id}" title="删除">${icon('trash', 14)}</button></div>
            </div>`;
          }).join('')}</div>` : '<div class="empty" style="padding:28px"><h3>还没有错题</h3><p>做一场模拟面试吧——答得不好的题会自动收进来。真实面试里被问倒的题，可以在「测试集」里记录。</p></div>'}
        </div>
      </section>`;
    }
    function bindHard() {
      $('[data-act="review"]', root)?.addEventListener('click', () => startReview());
      $$('[data-one]', root).forEach((b) => (b.onclick = () => startReview([b.dataset.one])));
      $$('[data-del-hard]', root).forEach((b) => (b.onclick = () => store.update((st) => { st.hardQs = (st.hardQs || []).filter((h) => h.id !== b.dataset.delHard); }, 'hard')));
      $('[data-act="add-hard"]', root).onclick = () => questionModal({ title: '添加一道错题', onSave: ({ q, skill, score }) => store.update((st) => { T.addHard(st, { q, skill, score, from: 'manual', roleId: st.target, roleName: M.roleById(st, st.target)?.name || '' }); }, 'hard') });
    }

    function questionModal({ title, kicker = 'HARD EXAMPLE', company = '', onSave }) {
      modal({
        title, kicker,
        body: `<form id="qForm" style="display:flex;flex-direction:column;gap:14px">
          <div class="field"><label>题目</label><textarea class="textarea" name="q" rows="3" required placeholder="例：KV Cache 为什么能加速推理？显存占用怎么估算？"></textarea></div>
          <div class="grid-2">
            <div class="field"><label>能力维度</label><select class="select" name="skill"><option value="">自动判断</option>${SKILLS.map((k) => `<option value="${k.id}">${k.name}</option>`).join('')}</select></div>
            <div class="field"><label>当时答得怎么样 · <span class="num" id="qsv">4</span>/10</label><input class="range" type="range" name="score" min="0" max="10" step="1" value="4"></div>
          </div>
          <p class="dim" style="font-size:12px">低于 ${T.PASS} 分的题会进入错题本复测${company ? `；所有题目都会记在「${esc(company)}」这次投递下` : ''}。</p>
          <div class="row-end"><button class="btn primary" type="submit">${icon('check', 14)} 保存</button></div>
        </form>`,
        onMount(panel, close) {
          const f = panel.querySelector('#qForm');
          f.score.oninput = () => (panel.querySelector('#qsv').textContent = f.score.value);
          f.onsubmit = (e) => {
            e.preventDefault();
            const q = f.q.value.trim();
            if (!q) return;
            onSave({ q, skill: f.skill.value || M.skillOfText(q), score: +f.score.value });
            close();
            toast('已保存', { type: 'success' });
          };
        },
      });
    }

    // ---------- 测试集：真实投递 ----------
    function testHTML() {
      const s = store.state;
      const f = T.funnel(s);
      const rej = T.rejectionStats(s);
      const apps = [...(s.applications || [])].sort((a, b) => (!!T.STAGE[a.stage]?.end - !!T.STAGE[b.stage]?.end) || b.updatedAt - a.updatedAt);
      const max = Math.max(1, f.levels[0].n);
      return `
      <section class="panel ticks test-panel">
        <div class="panel-h"><span class="ph-idx">TEST</span><span class="ph-title">测试集 · 真实投递</span><span class="ph-en hide-sm">held-out test set</span>
          <span class="ph-right"><button class="btn primary sm" data-act="add-app">${icon('plus', 13)} 记录一次投递</button></span></div>
        <div class="panel-b">
          <p class="dim" style="font-size:12.5px;margin-bottom:14px">训练集是你的经历，验证集是模拟面试，<b>测试集是真实世界</b>：每一次投递、笔试、面试与结果都记在这里。被拒的原因会进入训练诊断与导师上下文——这是最真实的梯度；真实面试题可以一键收进错题本。</p>
          <div class="funnel">${f.levels.map((l, i) => `<div class="fn-step"><div class="fn-bar"><i style="height:${Math.max(4, (l.n / max) * 100)}%" class="${i === 4 ? 'win' : ''}"></i></div><b class="num">${l.n}</b><span class="kicker">${l.name}</span></div>`).join('')}
            <div class="fn-acc"><span class="kicker">test acc</span><b class="num ${f.acc != null ? 'c-accent' : ''}">${f.acc != null ? `${Math.round(f.acc * 100)}%` : '—'}</b><span class="dim">已结束投递中拿到 Offer 的比例</span></div></div>
          ${rej.list.length ? `<div class="rej-line"><span class="kicker">被拒原因</span>${rej.list.map((r) => `<span class="chip loss">${esc(r.name)} ×${r.n}</span>`).join('')}<button class="btn ai sm" data-act="ask-rej" style="margin-left:auto">${icon('tree', 13)} 让树形图设计者分析</button></div>` : ''}
          ${apps.length ? `<div class="app-list">${apps.map(appHTML).join('')}</div>` : '<div class="empty" style="padding:28px"><h3>还没有投递记录</h3><p>拟合度过了 80% 就可以开始投了。实习、暑期项目、保研夏令营都算。</p></div>'}
        </div>
      </section>`;
    }
    function appHTML(a) {
      const st = T.STAGE[a.stage];
      return `<div class="app-row ${st?.end || ''}" data-app="${a.id}">
        <div class="app-head">
          <div class="grow"><b>${esc(a.company || '未命名')}</b><span class="dim"> · ${esc(a.role || '')}</span>
            <div class="dim app-meta">${fmtDate(a.appliedAt, true)} 投递${a.channel ? ` · ${esc(a.channel)}` : ''} · 更新于 ${relTime(a.updatedAt)}${(a.questions || []).length ? ` · 记录了 ${a.questions.length} 道面试题` : ''}</div></div>
          <select class="select sm" data-stage="${a.id}">${T.STAGES.map((x) => `<option value="${x.id}" ${x.id === a.stage ? 'selected' : ''}>${x.name}</option>`).join('')}</select>
        </div>
        <div class="app-steps">${(a.timeline || []).map((x) => `<span class="${T.STAGE[x.stage]?.end || ''}">${esc(T.STAGE[x.stage]?.name || x.stage)}<i class="num">${fmtDate(x.t)}</i></span>`).join('<b>→</b>')}</div>
        ${a.stage === 'rejected' ? `<div class="app-rej"><span class="kicker">原因（可多选）</span>${T.REASONS.map((r) => `<button class="tag-btn ${a.reasons?.includes(r.id) ? 'on' : ''}" data-reason="${a.id}:${r.id}">${r.name}</button>`).join('')}</div>` : ''}
        ${a.notes ? `<p class="muted app-notes">${esc(a.notes)}</p>` : ''}
        <div class="app-act"><button class="btn ghost sm" data-q="${a.id}">${icon('plus', 12)} 记录面试题</button><button class="btn ghost sm" data-edit="${a.id}">${icon('edit', 12)} 编辑</button><button class="icon-btn" data-del-app="${a.id}" title="删除">${icon('trash', 14)}</button></div>
      </div>`;
    }
    function bindTest() {
      const upd = (id, fn) => store.update((st) => { const a = (st.applications || []).find((x) => x.id === id); if (a) { fn(a, st); a.updatedAt = Date.now(); } }, 'application');
      $('[data-act="add-app"]', root).onclick = () => appModal();
      $('[data-act="ask-rej"]', root)?.addEventListener('click', () => ctx.openAdam('看一下我测试集（真实投递）里的被拒原因和面试情况，告诉我真实世界暴露出的最大短板是什么，并据此调整我接下来两周的路径。'));
      $$('[data-stage]', root).forEach((sel) => (sel.onchange = () => upd(sel.dataset.stage, (a) => {
        a.stage = sel.value;
        a.timeline = [...(a.timeline || []), { t: Date.now(), stage: sel.value }];
        if (sel.value === 'offer') toast('🎯 测试集通过！记得把它记成一条训练样本', { type: 'success' });
      })));
      $$('[data-reason]', root).forEach((b) => (b.onclick = () => { const [id, r] = b.dataset.reason.split(':'); upd(id, (a) => { a.reasons = a.reasons?.includes(r) ? a.reasons.filter((x) => x !== r) : [...(a.reasons || []), r]; }); }));
      $$('[data-edit]', root).forEach((b) => (b.onclick = () => appModal(store.state.applications.find((a) => a.id === b.dataset.edit))));
      $$('[data-del-app]', root).forEach((b) => (b.onclick = async () => { if (await confirmBox('删除这条投递记录？', '已收进错题本的题目会保留。', { ok: '删除', danger: true })) store.update((st) => { st.applications = st.applications.filter((a) => a.id !== b.dataset.delApp); }, 'application'); }));
      $$('[data-q]', root).forEach((b) => (b.onclick = () => {
        const a = store.state.applications.find((x) => x.id === b.dataset.q);
        questionModal({ title: `${a.company} · 面试题`, kicker: 'TEST SET · 真实面试题', company: a.company, onSave: ({ q, skill, score }) => upd(a.id, (app, st) => {
          app.questions = [...(app.questions || []), { q, skill, score, t: Date.now() }];
          if (score < T.PASS) T.addHard(st, { q, skill, score, from: 'test', roleId: app.roleId, roleName: `${app.company} ${app.role}`.trim() });
        }) });
      }));
    }
    function appModal(a = null) {
      const roles = M.allRoles(store.state);
      modal({
        title: a ? '编辑投递' : '记录一次投递', kicker: 'TEST SET',
        body: `<form id="apForm" style="display:flex;flex-direction:column;gap:14px">
          <div class="grid-2"><div class="field"><label>公司 / 学校</label><input class="input" name="company" required maxlength="40" value="${esc(a?.company || '')}"></div>
            <div class="field"><label>岗位 / 项目</label><input class="input" name="role" maxlength="40" value="${esc(a?.role || '')}" placeholder="例：大模型算法实习生"></div></div>
          <div class="grid-2"><div class="field"><label>对应目标函数</label><select class="select" name="roleId"><option value="">不关联</option>${roles.map((r) => `<option value="${r.id}" ${(a ? a.roleId : store.state.target) === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
            <div class="field"><label>渠道</label><input class="input" name="channel" maxlength="20" value="${esc(a?.channel || '')}" placeholder="官网 / 内推 / 夏令营…"></div></div>
          <div class="field"><label>投递日期</label><input class="input" type="date" name="date" value="${M.localDay(new Date(a?.appliedAt || Date.now()))}"></div>
          <div class="field"><label>备注</label><textarea class="textarea" name="notes" rows="2" maxlength="400">${esc(a?.notes || '')}</textarea></div>
          <div class="row-end"><button class="btn primary" type="submit">${icon('check', 14)} 保存</button></div></form>`,
        onMount(panel, close) {
          const f = panel.querySelector('#apForm');
          f.onsubmit = (e) => {
            e.preventDefault();
            const fields = { company: f.company.value.trim(), role: f.role.value.trim(), roleId: f.roleId.value || null, channel: f.channel.value.trim(), notes: f.notes.value.trim(), appliedAt: new Date(`${f.date.value}T12:00:00`).getTime() || Date.now() };
            store.update((st) => {
              if (a) Object.assign(st.applications.find((x) => x.id === a.id), fields, { updatedAt: Date.now() });
              else st.applications = [...(st.applications || []), T.newApplication({ ...fields, timeline: [{ t: fields.appliedAt, stage: 'applied' }] })];
            }, 'application');
            close();
          };
        },
      });
    }

    if (ctx.params.get('review')) startReview();
    else shell();
    if (ctx.params.get('start')) $('[data-act="start"]', root)?.focus();
    return {
      update(reason) {
        if (reason === 'interview') return;
        if (reason === 'hard' && session && !session.report) { renderSide(); return; }
        if (['application', 'hard'].includes(reason)) { shell(); return; }
        renderSide();
      },
      destroy() { saveDraft(); },
    };
  },
};

/** 泛化差距面板：训练 loss vs 验证 loss，逐项能力的训练估计与面试体现。 */
function genHTML(s) {
  const role = M.roleById(s, s.target);
  const g = M.generalization(s);
  if (!role) return '<div class="dim" style="font-size:12.5px">设定目标函数后显示。</div>';
  if (!g.items.length) return '<div class="dim" style="font-size:12.5px">每道面试题都会按考察的能力维度计分。做完一场模拟面试，这里会对比“训练集估计”与“面试实际体现”的差距——差距大就是过拟合。</div>';
  return `<div class="gen-top">
      <div><span class="kicker">train loss</span><b class="num c-loss">${g.train.toFixed(4)}</b></div>
      <div><span class="kicker">val loss</span><b class="num" style="color:var(--ai)">${g.val.toFixed(4)}</b></div>
      <div><span class="kicker">gap</span><b class="num ${g.gap > 0.02 ? 'c-warn' : 'c-accent'}">${g.gap >= 0 ? '+' : ''}${g.gap.toFixed(4)}</b></div>
    </div>
    <div class="gen-list">${g.items.slice(0, 6).map((x) => `<div class="gen-row" title="训练集估计 ${x.S.toFixed(2)} · 面试体现 ${x.m.toFixed(2)} · ${x.n} 题 · 置信度 ${Math.round(x.c * 100)}%">
      <span>${esc(x.skill.name)}</span>
      <span class="gen-bar"><i class="tr" style="left:${(x.S / 5) * 100}%"></i><i class="va" style="left:${(x.m / 5) * 100}%"></i><b style="left:${(Math.min(x.S, x.m) / 5) * 100}%;width:${(Math.abs(x.S - x.m) / 5) * 100}%" class="${x.gap > 0 ? 'over' : 'under'}"></b></span>
      <span class="num ${x.gap >= 0.8 ? 'c-loss' : x.gap <= -0.8 ? 'c-accent' : 'dim'}">${x.gap >= 0 ? '−' : '+'}${Math.abs(x.gap).toFixed(1)}</span></div>`).join('')}</div>
    <div class="gen-legend dim"><span><i class="tr"></i>训练集估计</span><span><i class="va"></i>面试体现</span><span>${s.profile?.valCalib === false ? '未用于规划' : '已用于梯度与 batch'}</span></div>`;
}

function reportBody(r, qa = []) {
  return `
    <div class="rep-top">
      <div class="rd-ring big" style="--p:${r.overall}"><span class="num">${r.overall}</span></div>
      <div class="grow">
        <span class="chip ${r.verdict === '通过' ? 'accent' : r.verdict === '待定' ? 'warn' : 'loss'}">${esc(r.verdict || '—')}</span>
        <p style="margin-top:10px">${esc(r.summary || '')}</p>
      </div>
    </div>
    ${r.dims ? `<div class="rep-dims">${Object.entries(DIMS).map(([k, n]) => `<div class="rep-dim"><span>${n}</span><div class="meter"><i style="width:${r.dims?.[k] || 0}%"></i></div><span class="num">${r.dims?.[k] ?? '—'}</span></div>`).join('')}</div>` : ''}
    ${r.advice?.length ? `<div class="kicker" style="margin-top:18px">提升建议</div><ol class="rep-adv">${r.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    ${qa.length ? `<details class="rep-qa"><summary class="kicker">查看逐题记录（${qa.length} 题）</summary>${qa.map((x, i) => `<div class="rq"><div><b>Q${i + 1}</b> ${esc(x.q)}</div><div class="muted">${esc(x.a || '（跳过）')}</div>${x.eval ? `<div class="num ${x.eval.score >= 7.5 ? 'c-accent' : x.eval.score >= 6 ? 'c-warn' : 'c-loss'}">${(+x.eval.score).toFixed(1)}/10 <span class="dim" style="font-family:var(--font-sans)">${esc(x.eval.feedback || '')}</span></div>` : ''}</div>`).join('')}</details>` : ''}`;
}

function valChart(ivs) {
  const W = 320, H = 120, m = { l: 26, r: 10, t: 10, b: 20 };
  const n = ivs.length;
  const X = (i) => m.l + (n === 1 ? (W - m.l - m.r) / 2 : (i / (n - 1)) * (W - m.l - m.r));
  const Y = (v) => m.t + (1 - v / 100) * (H - m.t - m.b);
  const pts = ivs.map((iv, i) => `${X(i)},${Y(iv.report.overall)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="valchart">
    ${[0, 50, 75, 100].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="lc-grid"/><text x="${m.l - 6}" y="${Y(v) + 3}" class="lc-ax" text-anchor="end">${v}</text>`).join('')}
    <line x1="${m.l}" x2="${W - m.r}" y1="${Y(75)}" y2="${Y(75)}" class="lc-conv"/>
    <polyline points="${pts}" class="val-line"/>
    ${ivs.map((iv, i) => `<circle cx="${X(i)}" cy="${Y(iv.report.overall)}" r="3.5" class="val-dot"/>`).join('')}
    <text x="${W - m.r}" y="${Y(75) - 4}" class="lc-conv-t" text-anchor="end">目标线 75</text>
  </svg>`;
}
