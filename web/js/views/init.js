// 初始化：左侧表单，右侧实时生成“你的模型配置”代码。
import { store, emptyState } from '../core/store.js';
import { SKILLS, GROUPS, GRADES, GOALS, INTERESTS, LEVELS, ROLES } from '../core/data.js';
import { icon, esc, $, $$ } from '../core/ui.js';
import { recommendRoles, skillsAt, lossOf, fitOf } from '../core/model.js';
import * as P from '../core/plans.js';

const STEPS = [
  { key: 'profile', name: '基本信息', en: 'PROFILE' },
  { key: 'direction', name: '方向与预算', en: 'HYPERPARAMS' },
  { key: 'weights', name: '权重初始化', en: 'INIT WEIGHTS' },
  { key: 'objective', name: '目标函数', en: 'OBJECTIVE' },
];

export default {
  title: '初始化',
  mount(root, ctx) {
    const prev = store.state;
    const draft = emptyState(prev ? { ...prev.profile, interests: [...(prev.profile.interests || [])], createdAt: Date.now() } : {});
    if (prev) { draft.baseSkills = { ...prev.baseSkills }; draft.target = prev.target; draft.curriculum = prev.curriculum ? { ...prev.curriculum } : null; }
    let step = 0;
    let changed = '';
    let weightsTouched = !!prev;

    root.innerHTML = `
    <div class="init">
      <header class="init-top">
        <a class="brand" href="#/"><svg class="brand-mark" viewBox="0 0 26 26" fill="none" aria-hidden="true"><path d="M1 6V1h5M20 1h5v5M25 20v5h-5M6 25H1v-5" stroke="var(--line-3)" stroke-width="1.2"/><path d="M5 7c3.5 0 4.5 11 9.5 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="14.5" cy="18" r="2.6" fill="currentColor"/></svg><span class="brand-word">EPOCH</span></a>
        <div class="init-steps" id="steps"></div>
        <a class="btn ghost sm" href="${prev ? '#/console' : '#/'}">${prev ? '返回控制台' : '返回首页'}</a>
      </header>
      <div class="init-body">
        <section class="init-form" id="form"></section>
        <aside class="init-code panel ticks">
          <div class="panel-h"><span class="ph-idx">PY</span><span class="ph-title mono" style="font-size:12px">config/you.py</span><span class="ph-right"><span class="chip accent"><i class="dot"></i>LIVE</span></span></div>
          <pre class="code" id="code"></pre>
        </aside>
      </div>
    </div>`;

    const form = $('#form', root);
    const code = $('#code', root);

    function renderSteps() {
      $('#steps', root).innerHTML = STEPS.map((s, i) => `
        <button class="is-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}" data-step="${i}" ${i > step ? 'disabled' : ''}>
          <span class="mono">${i < step ? '✓' : String(i + 1).padStart(2, '0')}</span><span>${s.name}</span>
        </button>`).join('<i class="is-line"></i>');
      $$('[data-step]', root).forEach((b) => (b.onclick = () => { step = +b.dataset.step; render(); }));
    }

    // —— 代码预览（手写语法高亮） ——
    const str = (v) => `<span class="t-str">"${esc(v)}"</span>`;
    const num = (v) => `<span class="t-num">${v}</span>`;
    const cm = (v) => `<span class="t-cm"># ${esc(v)}</span>`;
    const kw = (v) => `<span class="t-kw">${v}</span>`;
    const fn = (v) => `<span class="t-fn">${v}</span>`;
    function renderCode() {
      const p = draft.profile;
      const goal = GOALS.find((g) => g.id === p.goal)?.name || '';
      const interests = INTERESTS.filter((i) => p.interests.includes(i.id)).map((i) => str(i.name)).join(', ');
      const role = ROLES.find((r) => r.id === draft.target);
      const L = (k, html) => ({ k, html });
      code.innerHTML = [
        cm('自动生成 · 你的模型配置'),
        `${kw('from')} epoch ${kw('import')} You, Trainer, TreeDiagram`,
        '',
        `model = ${fn('You')}(`,
        L('name', `    name=${str(p.name || '同学')},`),
        L('school', `    school=${p.school ? str(p.school) : kw('None')},`),
        L('grade', `    grade=${str(p.grade)},`),
        L('major', `    major=${str(p.major)},`),
        L('goal', `    goal=${str(goal)},`),
        L('hours', `    lr=${num(p.hoursPerWeek)},        ${cm('每周可投入小时 = 学习率')}`),
        L('interests', `    interests=[${interests}],`),
        L('plan', `    pretrain=${draft.curriculum?.planId ? str(P.planById(draft.curriculum.planId).school + ' ' + P.planById(draft.curriculum.planId).title) : kw('None')},  ${cm('培养方案 = 预训练语料')}`),
        ')',
        '',
        `model.${fn('init_weights')}({`,
        ...SKILLS.map((s) => L(`w_${s.id}`, `    ${str(s.id)}: ${num(draft.baseSkills[s.id].toFixed(1))},${' '.repeat(Math.max(1, 10 - s.id.length))}${cm(`${s.name} · ${LEVELS[Math.round(draft.baseSkills[s.id])]}`)}`)),
        '})',
        '',
        `trainer = ${fn('Trainer')}(`,
        L('target', `    objective=${role ? str(role.name) : kw('None')},${role ? '' : `  ${cm('稍后在地形图上选择')}`}`),
        `    mentor=${fn('TreeDiagram')}(),  ${cm('树形图设计者 · AI 导师')}`,
        `    validation=${str('mock_interview')},`,
        ')',
        `trainer.${fn('fit')}(epochs=${kw('∞')})`,
      ].map((x) => (typeof x === 'string' ? { k: '', html: x } : x))
        .map(({ k, html }) => `<span class="ln ${k && changed === k ? 'flash' : ''}">${html || ' '}</span>`).join('');
    }

    // —— 各步骤表单 ——
    function stepProfile() {
      const p = draft.profile;
      return `
        <div class="kicker">STEP 01 · PROFILE</div>
        <h2 class="init-h">先认识一下你。</h2>
        <p class="muted">这些信息只用于个性化建议与生成规划书。未登录时，所有数据仅保存在本地浏览器；登录后才会同步到云端。</p>
        <div class="init-fields">
          <div class="grid-2">
            <div class="field"><label>怎么称呼你</label><input class="input" data-k="name" value="${esc(p.name)}" placeholder="例如：林间" maxlength="20"></div>
            <div class="field"><label>学校（可选）</label><input class="input" data-k="school" value="${esc(p.school)}" placeholder="可留空" maxlength="30"></div>
          </div>
          <div class="field init-plan"><label>培养方案（可选 · 预训练语料）</label>
            <select class="select" id="planSel"><option value="">暂不选择 / 其他学校</option>${P.PLANS.map((pl) => `<option value="${pl.id}" ${draft.curriculum?.planId === pl.id ? 'selected' : ''}>${esc(pl.school)} · ${esc(pl.title)}${pl.partial ? '（数据不完整）' : ''}</option>`).join('')}</select>
            <div class="init-plan-meta dim" id="planMeta">${planMeta()}</div></div>
          <div class="field"><label>年级</label><div class="seg" data-seg="grade">${GRADES.map((g) => `<button type="button" data-v="${g}" class="${p.grade === g ? 'on' : ''}">${g}</button>`).join('')}</div></div>
          <div class="field"><label>专业</label><input class="input" data-k="major" value="${esc(p.major)}" maxlength="30"></div>
        </div>`;
    }
    function stepDirection() {
      const p = draft.profile;
      return `
        <div class="kicker">STEP 02 · HYPERPARAMETERS</div>
        <h2 class="init-h">设定你的超参数。</h2>
        <p class="muted">发展意向决定优化方向，每周可投入时间就是你的“学习率”。</p>
        <div class="init-fields">
          <div class="field"><label>毕业后的意向</label><div class="seg" data-seg="goal">${GOALS.map((g) => `<button type="button" data-v="${g.id}" class="${p.goal === g.id ? 'on' : ''}">${g.name}</button>`).join('')}</div></div>
          <div class="field">
            <label>每周可投入的学习时间 · learning rate</label>
            <div class="lr-row"><input type="range" class="range" min="2" max="40" step="1" value="${p.hoursPerWeek}" data-k="hoursPerWeek"><span class="lr-val num"><b id="lrVal">${p.hoursPerWeek}</b> h/周</span></div>
            <div class="lr-hint dim" id="lrHint">${lrHint(p.hoursPerWeek)}</div>
          </div>
          <div class="field"><label>感兴趣的方向（可多选）</label><div class="seg" data-multi="interests">${INTERESTS.map((i) => `<button type="button" class="tag-btn ${p.interests.includes(i.id) ? 'on' : ''}" data-v="${i.id}">${i.name}</button>`).join('')}</div></div>
        </div>`;
    }
    function planMeta() {
      const pl = P.planById(draft.curriculum?.planId);
      if (!pl) return '选择后将自动推断年级、按已修课程预估初始权重，并在每个学期结束时把课程计入能力。';
      const cs = P.currentSem(pl);
      const { n } = P.estimateBase(pl);
      return `${esc(pl.college)} · ${cs > 8 ? '已完成全部学期' : `当前第 ${cs} 学期（${P.semLabel(cs)}）`} · 已修 AI 相关必修 ${n} 门`;
    }

    function stepWeights() {
      const pl = P.planById(draft.curriculum?.planId);
      return `
        <div class="kicker">STEP 03 · INIT WEIGHTS</div>
        <h2 class="init-h">初始化你的权重。</h2>
        <p class="muted">诚实地评估 12 项能力（0-5）。不必精确，之后每一个训练样本都会更新它们。拖动时会显示参考描述。</p>
        ${pl ? `<div class="weights-note">${icon('book', 15)}<span>已根据「${esc(pl.title)}」中你修完的 ${P.estimateBase(pl).n} 门必修课预估了初始值（入学水平按 0.5 起步）。请按实际掌握情况微调——之后的课程会在每个学期结束时自动计入。</span></div>` : ''}
        <div class="weights">
          ${GROUPS.map((g) => `
            <div class="w-group">
              <div class="w-gh"><span class="kicker">${g.en}</span><span>${g.name}</span></div>
              ${SKILLS.filter((s) => s.group === g.id).map((s) => `
                <div class="w-row" data-skill="${s.id}">
                  <div class="w-name"><b>${s.name}</b><span class="dim">${s.desc}</span></div>
                  <input type="range" class="range" min="0" max="5" step="0.5" value="${draft.baseSkills[s.id]}" data-w="${s.id}" aria-label="${s.name}">
                  <div class="w-val num"><b>${draft.baseSkills[s.id].toFixed(1)}</b><span>${LEVELS[Math.round(draft.baseSkills[s.id])]}</span></div>
                  <div class="w-anchor" data-anchor="${s.id}">${anchorText(s, draft.baseSkills[s.id])}</div>
                </div>`).join('')}
            </div>`).join('')}
        </div>`;
    }
    function stepObjective() {
      const S = skillsAt(draft);
      const rec = recommendRoles(draft, S);
      return `
        <div class="kicker">STEP 04 · OBJECTIVE FUNCTION</div>
        <h2 class="init-h">选择你的目标函数。</h2>
        <p class="muted">按“能力拟合度 + 兴趣加权”排序（拟合度 = 1 − √loss，刚起步时普遍偏低很正常）。现在的选择随时可以改。</p>
        <div class="role-pick">
          ${rec.map(({ role, fit, score }, i) => `
            <button type="button" class="rp ${draft.target === role.id ? 'on' : ''} ${i < 3 ? 'top' : ''}" data-role="${role.id}">
              <span class="rp-rank mono">${i < 3 ? `TOP ${i + 1}` : String(i + 1).padStart(2, '0')}</span>
              <span class="rp-name">${role.name}</span>
              <span class="rp-tag dim">${role.tagline}${score - fit > 0.001 ? ' · <span class="c-ai">兴趣匹配</span>' : ''}</span>
              <span class="rp-fit"><span class="meter"><i style="width:${(fit * 100).toFixed(0)}%"></i></span><span class="num">${Math.round(fit * 100)}%</span></span>
            </button>`).join('')}
        </div>
        <button type="button" class="btn ghost sm" data-role="" style="margin-top:12px">${draft.target ? '' : '✓ '}暂不确定，先去地形图上看看</button>`;
    }

    function render() {
      renderSteps();
      renderCode();
      const body = [stepProfile, stepDirection, stepWeights, stepObjective][step]();
      form.innerHTML = `<div class="init-card">${body}</div>
        <div class="init-nav">
          ${step > 0 ? `<button class="btn ghost" data-nav="-1">${icon('arrow', 14, 'flip')} 上一步</button>` : '<span></span>'}
          ${step < STEPS.length - 1
            ? `<button class="btn primary" data-nav="1">下一步：${STEPS[step + 1].name} ${icon('arrow', 15)}</button>`
            : `<button class="btn primary lg" data-go>${icon('play', 14)} 初始化并开始训练</button>`}
        </div>`;
      bind();
    }

    function bind() {
      $$('[data-k]', form).forEach((el) => el.addEventListener('input', () => {
        const k = el.dataset.k;
        draft.profile[k] = k === 'hoursPerWeek' ? +el.value : el.value;
        changed = k === 'hoursPerWeek' ? 'hours' : k;
        if (k === 'hoursPerWeek') { $('#lrVal', form).textContent = el.value; $('#lrHint', form).textContent = lrHint(+el.value); }
        renderCode();
      }));
      $('#planSel', form)?.addEventListener('change', (e) => {
        const pl = P.planById(e.target.value);
        draft.curriculum = pl ? { planId: pl.id, since: Date.now(), skip: [], electives: [] } : null;
        if (pl) {
          draft.profile.school = draft.profile.school || pl.school;
          if (P.currentSem(pl) <= 8) draft.profile.grade = P.gradeFromPlan(pl);
          if (!weightsTouched) draft.baseSkills = P.estimateBase(pl).base;
        }
        changed = 'plan';
        render();
      });
      $$('[data-seg]', form).forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
        draft.profile[seg.dataset.seg] = b.dataset.v;
        changed = seg.dataset.seg;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        renderCode();
      })));
      $$('[data-multi]', form).forEach((seg) => seg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
        const arr = draft.profile.interests;
        const i = arr.indexOf(b.dataset.v);
        if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.v);
        b.classList.toggle('on');
        changed = 'interests';
        renderCode();
      })));
      $$('[data-w]', form).forEach((el) => el.addEventListener('input', () => {
        const id = el.dataset.w;
        const v = +el.value;
        draft.baseSkills[id] = v;
        weightsTouched = true;
        const row = el.closest('.w-row');
        row.querySelector('.w-val').innerHTML = `<b>${v.toFixed(1)}</b><span>${LEVELS[Math.round(v)]}</span>`;
        row.querySelector('.w-anchor').textContent = anchorText(SKILLS.find((s) => s.id === id), v);
        row.classList.add('active');
        changed = `w_${id}`;
        renderCode();
      }));
      $$('[data-w]', form).forEach((el) => el.addEventListener('change', () => el.closest('.w-row').classList.remove('active')));
      $$('[data-role]', form).forEach((b) => (b.onclick = () => {
        draft.target = b.dataset.role || null;
        changed = 'target';
        render();
      }));
      $$('[data-nav]', form).forEach((b) => (b.onclick = () => {
        step = Math.max(0, Math.min(STEPS.length - 1, step + +b.dataset.nav));
        changed = '';
        render();
        root.closest('.main')?.scrollTo({ top: 0 });
      }));
      $('[data-go]', form)?.addEventListener('click', boot);
    }

    function boot() {
      if (!draft.profile.name.trim()) draft.profile.name = '同学';
      const S = skillsAt(draft);
      const role = ROLES.find((r) => r.id === draft.target);
      const lines = [
        ['>>> model = You(...)', ''],
        [`initializing 12 weights ...`, 'ok'],
        [`mean activation = ${(Object.values(S).reduce((a, b) => a + b, 0) / 12).toFixed(2)}`, ''],
        [role ? `objective = ${role.name}` : 'objective = None  (将在地形图中选择)', role ? 'ok' : 'warn'],
        role ? [`initial loss = ${lossOf(S, role).toFixed(4)}   fit = ${Math.round(fitOf(lossOf(S, role)) * 100)}%`, ''] : ['landscape loaded · 10 minima found', ''],
        draft.curriculum ? [`pretrain corpus = ${P.planById(draft.curriculum.planId).title} · ${P.estimateBase(P.planById(draft.curriculum.planId)).n} courses absorbed`, 'ok'] : ['pretrain corpus = None', ''],
        ['mentor = TreeDiagram()  online', 'ok'],
        ['>>> trainer.fit(epochs=∞)', ''],
        ['Epoch 001 started. Good luck.', 'ok'],
      ];
      const ov = document.createElement('div');
      ov.className = 'boot';
      ov.innerHTML = `<div class="boot-box mono"><div class="boot-lines"></div><div class="meter ticked" style="margin-top:18px"><i style="width:0%"></i></div></div>`;
      root.appendChild(ov);
      const box = ov.querySelector('.boot-lines');
      const bar = ov.querySelector('.meter i');
      let i = 0;
      const tick = setInterval(() => {
        if (i < lines.length) {
          const [t, lv] = lines[i];
          box.insertAdjacentHTML('beforeend', `<div class="bl ${lv}">${esc(t)}${lv ? `<span class="bl-tag">${lv === 'ok' ? ' [ OK ]' : ' [WARN]'}</span>` : ''}</div>`);
          bar.style.width = `${((i + 1) / lines.length) * 100}%`;
          i++;
        } else {
          clearInterval(tick);
          if (prev) {
            // 重新初始化：保留数据集等，只更新档案、初始权重与目标
            store.update((s) => {
              s.profile = { ...s.profile, ...draft.profile, createdAt: s.profile.createdAt };
              s.baseSkills = draft.baseSkills;
              s.target = draft.target;
              if (draft.curriculum?.planId !== s.curriculum?.planId) s.curriculum = draft.curriculum;
            }, 'init');
          } else {
            store.replace(draft, 'init');
          }
          ctx.navigate(draft.target ? '/console' : '/objective');
        }
      }, 260);
    }

    render();
    return {};
  },
};

function lrHint(h) {
  if (h <= 5) return 'lr 较低：稳但慢，适合课业繁重的学期。建议聚焦 1 个方向。';
  if (h <= 12) return 'lr 适中：可以同时推进“一门课 + 一个项目”。';
  if (h <= 24) return 'lr 较高：收敛快，记得每周留出复盘时间。';
  return 'lr 很高：注意防止“发散”（倦怠），保证睡眠和休息。';
}
function anchorText(s, v) {
  if (v <= 0) return '未接触';
  return v < 2 ? `≈ ${s.anchors[0]}` : v < 4 ? `≈ ${s.anchors[1]}` : `≈ ${s.anchors[2]}`;
}
