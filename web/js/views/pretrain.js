// 预训练：培养方案是同届共享的“预训练语料”，个人经历是让你与众不同的“微调数据”。
import { store } from '../core/store.js';
import { SKILLS, SKILL, GROUPS } from '../core/data.js';
import * as M from '../core/model.js';
import * as P from '../core/plans.js';
import { icon, esc, $, $$, toast, modal, confirmBox, fmtDate } from '../core/ui.js';
import { aiJSON } from '../core/ai.js';

const STATUS = { done: '✓ 已训练', now: '● 进行中', future: '待训练' };

export default {
  title: '预训练',
  mount(root, ctx) {
    let picking = false;

    function render() {
      const s = store.state;
      const plan = P.userPlan(s);
      root.innerHTML = `
      <div class="page ${ctx.again ? 'static' : ''}">
        <div class="page-head">
          <div class="page-title">
            <div class="path">~/epoch/<b>pretrain</b> · curriculum</div>
            <h1>预训练</h1>
            <p class="page-desc">培养方案是同届同学共享的<b>预训练语料</b>，决定了你的“底座能力”；你的项目、竞赛与实习，才是让你与众不同的<b>微调数据</b>。看清课程能带你走多远，剩下的差距就是你要自己补的。</p>
          </div>
          ${plan && !picking ? `<div class="page-actions"><button class="btn" data-act="pick">${icon('refresh', 14)} 更换培养方案</button></div>` : ''}
        </div>
        ${plan && !picking ? planView(s, plan) : pickerView(s)}
      </div>`;
      bind();
    }

    // ---------- 选择方案 ----------
    function pickerView(s) {
      const cur = s.curriculum?.planId;
      return `
      <section class="panel ticks">
        <div class="panel-h"><span class="ph-idx">SRC</span><span class="ph-title">选择你的培养方案</span><span class="ph-en">pretraining corpus</span>
          ${picking ? `<span class="ph-right"><button class="btn ghost sm" data-act="cancel">取消</button></span>` : ''}</div>
        <div class="panel-b">
          <div class="plan-pick">${P.PLANS.map((p) => {
            const req = p.courses.filter((c) => c.k === 'req').length;
            return `<button class="pp ${cur === p.id ? 'on' : ''}" data-plan="${p.id}">
              <span class="kicker">${esc(p.school)} · ${esc(p.college)}</span>
              <b>${esc(p.title)}</b>
              <span class="dim num">要求 ${p.requiredCredits} 学分 · AI 相关课程 ${p.courses.length} 门（必修 ${req}）</span>
              ${p.partial ? '<span class="chip warn">数据不完整：源网站未返回专业课</span>' : ''}
            </button>`;
          }).join('')}</div>
          <p class="dim" style="font-size:12.5px;margin-top:14px">内置培养方案为示例数据，仅用于测试占位（整理于 ${esc(P.PLANS[0]?.collected || '')}）。其他学校可将培养方案整理到 <code>plans/</code> 目录后运行 <code>python3 tools/build_curricula.py</code> 导入。</p>
        </div>
      </section>`;
    }

    // ---------- 方案视图 ----------
    function planView(s, plan) {
      const now = Date.now();
      const role = M.roleById(s, s.target);
      const cs = P.currentSem(plan, now);
      const counted = P.countedCourses(s, plan);
      const reqAll = plan.courses.filter((c) => c.k === 'req' && c.s);
      const reqDone = reqAll.filter((c) => P.semStatus(plan, c.s, now) === 'done');
      const gradEnd = P.semRange(plan, 8)[1];
      const S = M.skillsAt(s);
      const Sg = M.skillsAt(s, Math.max(gradEnd, now));
      const electives = rankElectives(s, plan, S);
      const top3 = electives.filter((e) => !e.chosen).slice(0, 3);
      const Se = top3.length ? M.skillsAt({ ...s, curriculum: { ...s.curriculum, electives: [...(s.curriculum.electives || []), ...top3.map((e) => e.c.c)] } }, Math.max(gradEnd, now)) : Sg;
      const L = (X) => (role ? M.lossOf(X, role) : null);
      const fit = (X) => (role ? M.fitOf(L(X)) : null);

      return `
      ${plan.partial ? `<div class="notice warn">${icon('flag', 15)} 该方案在源网站只返回了 ${plan.totalCourses} 门课程（缺少专业课），以下分析仅供参考。</div>` : ''}
      <div class="readouts pre-readouts">
        <div class="readout"><div class="r-label kicker"><span>Corpus 培养方案</span></div>
          <div class="r-value pre-title">${esc(plan.title)}</div><div class="r-sub">${esc(plan.school)} · ${esc(plan.college)}</div></div>
        <div class="readout"><div class="r-label kicker"><span>Progress 学期</span></div>
          <div class="r-value">${cs > 8 ? '8' : cs}<small>/8 · ${cs > 8 ? '已毕业' : P.semLabel(cs)}</small></div>
          <div class="r-sub"><span class="meter ticked" style="display:block;margin-top:6px"><i style="width:${Math.min(100, ((cs - 1) / 8) * 100)}%"></i></span></div></div>
        <div class="readout"><div class="r-label kicker"><span>Coverage 已修必修</span></div>
          <div class="r-value">${reqDone.length}<small>/${reqAll.length} 门</small></div>
          <div class="r-sub">AI 相关必修课程</div></div>
        <div class="readout"><div class="r-label kicker"><span>毕业时拟合度</span><span>仅课程</span></div>
          <div class="r-value c-accent">${role ? `${(fit(Sg) * 100).toFixed(1)}<small>%</small>` : '—'}</div>
          <div class="r-sub">${role ? `现在 ${(fit(S) * 100).toFixed(1)}% → 修完课程 ${(fit(Sg) * 100).toFixed(1)}%` : '先设定目标函数'}</div></div>
      </div>

      <div class="pre-grid">
        <section class="panel ticks pre-cover">
          <div class="panel-h"><span class="ph-idx">01</span><span class="ph-title">课程能带你走多远</span><span class="ph-en">pretrain vs objective</span>
            <span class="ph-right wb-legend"><span><i class="lg-cur"></i>现在</span><span><i class="lg-pre"></i>+ 剩余课程</span><span><i class="lg-gap"></i>需自己补</span><span><i class="lg-req"></i>要求</span></span></div>
          <div class="panel-b">
            ${role ? coverSummary(S, Sg, Se, role, top3) : '<p class="muted">设定目标函数后，这里会对比课程覆盖与岗位要求。</p>'}
            ${coverBars(S, Sg, role)}
          </div>
        </section>
        <section class="panel ticks pre-elec">
          <div class="panel-h"><span class="ph-idx">02</span><span class="ph-title">选修课推荐</span><span class="ph-en">ranked by −∇loss</span></div>
          <div class="panel-b tight">
            ${electives.length ? `<p class="dim" style="font-size:12px;margin:2px 4px 10px">按“对目标岗位的 loss 下降”排序。勾选你选修的课，学期结束时自动计入能力。</p>
            <div class="elec-list">${electives.slice(0, 10).map((e) => `
              <div class="elec ${e.chosen ? 'on' : ''}">
                <button class="tk-check" data-elec="${esc(e.c.c)}" aria-pressed="${e.chosen}" aria-label="选修这门课">${e.chosen ? icon('check', 13) : ''}</button>
                <div class="grow"><div class="el-n">${esc(e.c.n)}</div>
                  <div class="el-m"><span class="chip">${P.semLabel(e.c.s)}</span><span class="dim num">${e.c.cr} 学分</span>${Object.entries(e.c.sk).map(([k, v]) => `<span class="gain sm"><b>${esc(SKILL[k].name)}</b><span class="num">+${v.toFixed(2)}</span></span>`).join('')}</div></div>
                ${role ? `<span class="loss-delta">${e.delta > 0.00005 ? `▼${e.delta.toFixed(4)}` : '—'}</span>` : ''}
              </div>`).join('')}</div>` : '<div class="empty"><p>本方案剩余学期中没有可选的选修课。</p></div>'}
          </div>
        </section>
      </div>

      <section class="panel ticks timeline-panel">
        <div class="panel-h"><span class="ph-idx">03</span><span class="ph-title">八个学期的预训练</span><span class="ph-en">semester timeline</span>
          <span class="ph-right tl-legend">${GROUPS.map((g) => `<span><i class="grp-${g.id}"></i>${g.name}</span>`).join('')}</span></div>
        <div class="timeline">${[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => semColumn(s, plan, sem, counted)).join('')}</div>
        <div class="tl-foot dim">实线 = 必修，虚线 = 选修（勾选后计入），划线 = 标记为未修。点击课程可查看详情或调整。</div>
      </section>

      <section class="panel ticks pre-meta">
        <div class="panel-h"><span class="ph-idx">04</span><span class="ph-title">数据与校准</span></div>
        <div class="panel-b pre-meta-b">
          <div>
            <p class="muted" style="font-size:12.5px">课程 → 能力的映射按课程名规则估算并按学分缩放（详见 <code>tools/build_curricula.py</code>）；上传成绩单后再按成绩缩放（60 分 ×0.6 → 90 分 ×1.05 → 100 分 ×1.2）。选定方案之前已修完的课程视为已体现在初始权重中；之后每个学期结束时，本学期计入的课程会自动转化为能力增益。</p>
            <p class="dim" style="font-size:12px;margin-top:8px">方案设定于 ${fmtDate(s.curriculum.since || Date.now(), true)} · 来源：${esc(plan.source)}（采集于 ${esc(plan.collected)}）</p>
          </div>
          <div class="row" style="align-self:center;flex-wrap:wrap">
            <label class="btn ai" title="拍一张成绩单 / 教务系统截图：AI 识别每门课的成绩，课程带来的能力增益按成绩缩放">${icon('image', 14)} ${Object.keys(s.curriculum.grades || {}).length ? `成绩单 · 已识别 ${Object.keys(s.curriculum.grades).length} 门` : '拍成绩单校准'}<input type="file" accept="image/*" data-act="transcript" hidden></label>
            <button class="btn" data-act="calib">${icon('settings', 14)} 按已修课程校准初始权重</button></div>
        </div>
      </section>`;
    }

    function rankElectives(s, plan, S) {
      const role = M.roleById(s, s.target);
      const chosen = new Set(s.curriculum?.electives || []);
      return plan.courses
        .filter((c) => c.k === 'elec' && c.s && P.semStatus(plan, c.s) !== 'done')
        .map((c) => {
          let delta = 0;
          if (role) {
            const T = { ...S };
            for (const [k, g] of Object.entries(c.sk)) T[k] = Math.min(5, T[k] + (5 - T[k]) * (1 - Math.exp(-g / 2.5)));
            delta = M.lossOf(S, role) - M.lossOf(T, role);
          }
          return { c, delta, chosen: chosen.has(c.c) };
        })
        .sort((a, b) => b.chosen - a.chosen || b.delta - a.delta);
    }

    function coverSummary(S, Sg, Se, role, top3) {
      const fit = (X) => M.fitOf(M.lossOf(X, role));
      const covered = SKILLS.map((k) => ({ k, gain: Sg[k.id] - S[k.id], rest: Math.max(0, (role.req[k.id] || 0) - Sg[k.id]) }));
      const byCourse = covered.filter((x) => x.gain >= 0.15).sort((a, b) => b.gain - a.gain).slice(0, 3);
      const self = covered.filter((x) => x.rest >= 0.5).sort((a, b) => b.rest * (role.req[b.k.id] || 0) - a.rest * (role.req[a.k.id] || 0)).slice(0, 3);
      return `<div class="cover-sum">
        <div class="cs-nums">
          <div><span class="kicker">现在</span><b class="num">${(fit(S) * 100).toFixed(1)}%</b></div>
          <span class="cs-arrow">→</span>
          <div><span class="kicker">修完剩余课程</span><b class="num c-accent">${(fit(Sg) * 100).toFixed(1)}%</b></div>
          ${top3.length ? `<span class="cs-arrow">→</span><div><span class="kicker">+ 推荐的 ${top3.length} 门选修</span><b class="num c-target">${(fit(Se) * 100).toFixed(1)}%</b></div>` : ''}
        </div>
        <p>${byCourse.length ? `剩余课程主要补强 <b>${byCourse.map((x) => esc(x.k.name)).join('、')}</b>。` : '剩余课程对目标岗位的帮助有限。'}
          ${self.length ? `但距「${esc(role.name)}」的要求，<b class="c-loss">${self.map((x) => esc(x.k.name)).join('、')}</b> 仍有明显差距——这部分需要你自己通过项目、竞赛和实习来“微调”。` : '课程基本能覆盖该岗位的能力要求，接下来重在实践深度。'}</p>
      </div>`;
    }

    function coverBars(S, Sg, role) {
      return `<div class="cbars">${SKILLS.map((k) => {
        const now = S[k.id], grad = Sg[k.id], req = role ? role.req[k.id] || 0 : 0;
        const gap = Math.max(0, req - grad);
        return `<div class="cbar">
          <div class="wb-name">${esc(k.name)}</div>
          <div class="wb-track">
            ${[1, 2, 3, 4].map((t) => `<i class="wb-tick" style="left:${t * 20}%"></i>`).join('')}
            <div class="wb-fill" style="width:${(now / 5) * 100}%"></div>
            ${grad - now > 0.02 ? `<div class="cb-pre" style="left:${(now / 5) * 100}%;width:${((grad - now) / 5) * 100}%"></div>` : ''}
            ${gap > 0.05 ? `<div class="wb-gap" style="left:${(Math.max(grad, now) / 5) * 100}%;width:${(gap / 5) * 100}%"></div>` : ''}
            ${req ? `<div class="wb-req" style="left:${(req / 5) * 100}%"></div>` : ''}
          </div>
          <div class="wb-val num">${now.toFixed(1)}${grad - now > 0.02 ? `<span class="c-accent">→${grad.toFixed(1)}</span>` : ''}${role ? `<span class="dim">/${req}</span>` : ''}</div>
        </div>`;
      }).join('')}</div>`;
    }

    function semColumn(s, plan, sem, counted) {
      const st = P.semStatus(plan, sem);
      const [a, b] = P.semRange(plan, sem);
      const skip = new Set(s.curriculum?.skip || []);
      const chosen = new Set(s.curriculum?.electives || []);
      const grades = s.curriculum?.grades || {};
      const courses = plan.courses.filter((c) => c.s === sem && c.k !== 'choice');
      const sums = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
      for (const c of counted.filter((x) => x.s === sem)) for (const [k, v] of Object.entries(c.sk)) sums[SKILL[k].group] += v;
      const total = Object.values(sums).reduce((x, y) => x + y, 0);
      const d = (t) => { const x = new Date(t); return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}`; };
      const general = plan.general?.[String(sem)] || 0;
      return `<div class="sem ${st}">
        <div class="sem-h"><b>${P.semLabel(sem)}</b><span class="kicker">${STATUS[st]}</span><span class="dim num">${d(a)}–${d(b)}</span></div>
        <div class="sem-gain" title="本学期计入的能力增益">${total ? GROUPS.map((g) => (sums[g.id] ? `<i class="grp-${g.id}" style="flex:${sums[g.id]}"></i>` : '')).join('') : '<i class="empty-g"></i>'}</div>
        <div class="sem-courses">
          ${courses.map((c) => {
            const cls = c.k === 'req' ? (skip.has(c.c) ? 'skip' : 'req') : chosen.has(c.c) ? 'elec on' : 'elec';
            return `<button class="cp ${cls} grp-${P.courseGroup(c)}" data-course="${esc(c.c)}" title="${esc(c.n)}${c.alt ? `（与另一门${esc(c.alt)}二选一）` : ''}"><span class="cp-n">${esc(c.n)}</span><span class="cp-cr num ${grades[c.c] != null ? (grades[c.c] >= 85 ? 'c-accent' : grades[c.c] < 70 ? 'c-loss' : '') : ''}">${grades[c.c] != null ? grades[c.c] : c.cr}</span></button>`;
          }).join('') || '<span class="dim" style="font-size:11.5px">无 AI 相关课程</span>'}
        </div>
        ${general ? `<div class="sem-f dim">+ ${general} 门通识 / 公共课</div>` : ''}
      </div>`;
    }

    function courseModal(code) {
      const s = store.state;
      const plan = P.userPlan(s);
      const c = plan.courses.find((x) => x.c === code);
      const st = P.semStatus(plan, c.s);
      const skip = (s.curriculum.skip || []).includes(c.c);
      const chosen = (s.curriculum.electives || []).includes(c.c);
      const kind = c.k === 'req' ? '必修' : '选修';
      const grade = s.curriculum.grades?.[c.c];
      modal({
        title: c.n,
        kicker: `${c.c} · ${P.semLabel(c.s)} · ${kind}`,
        body: `
          <div class="kv-grid">
            <div><span class="kicker">课组</span>${esc(c.g)}</div>
            <div><span class="kicker">学分 / 学时</span><span class="num">${c.cr} / ${c.h}</span></div>
            <div><span class="kicker">状态</span>${STATUS[st]}</div>
          </div>
          ${c.alt ? `<p class="dim" style="font-size:12.5px;margin-top:12px">该课与另一门「${esc(c.alt)}」二选一：默认计入另一门，如果你修的是这门，请把那门标记为未修并勾选本课。</p>` : ''}
          <div class="kicker" style="margin-top:16px">能力增益（估算${grade != null ? ` · 成绩 ${grade} 分 ×${P.gradeFactor(grade).toFixed(2)}` : ''}）</div>
          <div class="row" style="gap:6px;margin-top:8px">${Object.entries(P.courseGain(s, c)).map(([k, v]) => `<span class="gain"><b>${esc(SKILL[k].name)}</b><span class="num">+${v.toFixed(2)}</span></span>`).join('')}</div>
          <div class="field" style="margin-top:14px;max-width:220px"><label>成绩（百分制，可留空）</label><input class="input num" type="number" min="0" max="100" data-grade value="${grade ?? ''}"></div>
          <div class="row-end">
            ${c.k === 'req'
              ? `<button class="btn ${skip ? 'primary' : 'ghost'}" data-toggle="skip">${skip ? '恢复计入' : '标记为未修 / 免修'}</button>`
              : `<button class="btn ${chosen ? 'ghost' : 'primary'}" data-toggle="elec">${chosen ? '取消选修' : `${icon('check', 14)} 我选修了这门`}</button>`}
          </div>`,
        onMount(panel, close) {
          panel.querySelector('[data-grade]').onchange = (e) => {
            const v = e.target.value === '' ? null : Math.max(0, Math.min(100, Math.round(+e.target.value)));
            store.update((st) => { const g = { ...(st.curriculum.grades || {}) }; if (v == null) delete g[c.c]; else g[c.c] = v; st.curriculum.grades = g; }, 'curriculum');
            close();
          };
          panel.querySelector('[data-toggle]').onclick = () => {
            const key = c.k === 'req' ? 'skip' : 'electives';
            toggleIn(key, c.c);
            close();
          };
        },
      });
    }

    function toggleIn(key, code) {
      store.update((st) => {
        const list = new Set(st.curriculum[key] || []);
        list.has(code) ? list.delete(code) : list.add(code);
        st.curriculum[key] = [...list];
      }, 'curriculum');
    }

    function setPlan(id) {
      const p = P.planById(id);
      store.update((st) => {
        const same = st.curriculum?.planId === id;
        st.curriculum = same ? st.curriculum : { planId: id, since: Date.now(), skip: [], electives: [] };
        st.profile.school = st.profile.school || p.school;
        if (P.currentSem(p) <= 8) st.profile.grade = P.gradeFromPlan(p);
      }, 'curriculum');
      picking = false;
      toast(`已设定培养方案：${p.school} ${p.title}`, { type: 'success' });
      render();
    }

    async function calibrate() {
      const s = store.state;
      const plan = P.userPlan(s);
      const { base, n } = P.estimateBase(plan, Date.now(), 0.5, s.curriculum.grades);
      const diff = SKILLS.filter((k) => Math.abs((s.baseSkills[k.id] || 0) - base[k.id]) >= 0.5)
        .map((k) => `${k.name} ${(+s.baseSkills[k.id]).toFixed(1)}→${base[k.id].toFixed(1)}`);
      if (!diff.length) { toast('当前初始权重与已修课程的估计基本一致'); return; }
      const ok = await confirmBox('按已修课程校准初始权重？', `根据你已修完的 ${n} 门必修课，建议调整：${diff.join('，')}。只会取“当前值与估计值中较大者”，不会降低你的自评。`, { ok: '校准' });
      if (!ok) return;
      store.update((st) => { for (const k of SKILLS) st.baseSkills[k.id] = Math.max(+st.baseSkills[k.id] || 0, base[k.id]); }, 'calibrate');
      toast('初始权重已校准', { type: 'success' });
    }

    /** 成绩单照片 → 压缩 → 视觉模型识别 → 匹配培养方案课程 → 用户确认后写入成绩。 */
    async function transcript(file) {
      if (!file) return;
      const plan = P.userPlan(store.state);
      let image;
      try { image = await shrink(file, 1600); } catch { toast('图片读取失败', { type: 'error' }); return; }
      const t = toast('正在识别成绩单…', { duration: 20000 });
      try {
        const { data, mock } = await aiJSON('transcript', { image, names: plan.courses.map((c) => c.n) });
        t?.remove?.();
        const rows = P.matchCourses(plan, (data.courses || []).filter((r) => r?.name).map((r) => ({ name: String(r.name).slice(0, 40), score: Math.max(0, Math.min(100, Math.round(+r.score))) })).filter((r) => Number.isFinite(r.score)));
        if (!rows.length) { toast('没有识别出课程成绩，换一张更清晰的截图试试', { type: 'error' }); return; }
        reviewTranscript(plan, rows, mock);
      } catch (e) {
        t?.remove?.();
        toast(e.message, { type: 'error' });
      }
    }
    function reviewTranscript(plan, rows, mock) {
      const matched = rows.filter((r) => r.code);
      modal({
        title: '确认识别结果', kicker: `TRANSCRIPT · 识别 ${rows.length} 门 · 匹配到培养方案 ${matched.length} 门`, wide: true,
        body: `${mock ? '<div class="chip warn" style="margin-bottom:10px">演示模式：示例成绩</div>' : ''}
          <p class="muted" style="font-size:12.5px">只有匹配到培养方案 AI 相关课程的成绩会被使用：课程增益按成绩缩放，并用于“按已修课程校准初始权重”。识别有误可以直接改分数或取消勾选。</p>
          <div class="tr-list">${rows.map((r, i) => `<label class="tr-row ${r.code ? '' : 'off'}">
            <input type="checkbox" data-i="${i}" ${r.code ? 'checked' : 'disabled'}>
            <span class="grow"><b>${esc(r.name)}</b>${r.course ? `<span class="dim"> → ${esc(r.course.n)} · ${P.semLabel(r.course.s)} · ×${P.gradeFactor(r.score).toFixed(2)}</span>` : '<span class="dim"> · 不在培养方案的 AI 相关课程中</span>'}</span>
            <input class="input num sm" type="number" min="0" max="100" value="${r.score}" data-s="${i}" ${r.code ? '' : 'disabled'}></label>`).join('')}</div>
          <div class="row-end"><button class="btn primary" data-ok>${icon('check', 14)} 写入成绩</button></div>`,
        onMount(panel, close) {
          panel.querySelector('[data-ok]').onclick = () => {
            const g = {};
            panel.querySelectorAll('[data-i]').forEach((cb) => { const r = rows[+cb.dataset.i]; if (cb.checked && r.code) g[r.code] = Math.max(0, Math.min(100, Math.round(+panel.querySelector(`[data-s="${cb.dataset.i}"]`).value || r.score))); });
            store.update((st) => { st.curriculum.grades = { ...(st.curriculum.grades || {}), ...g }; }, 'curriculum');
            close();
            toast(`已写入 ${Object.keys(g).length} 门课的成绩，课程增益已按成绩重算`, { type: 'success' });
          };
        },
      });
    }

    function bind() {
      $('[data-act="transcript"]', root)?.addEventListener('change', (e) => transcript(e.target.files[0]));
      $$('[data-plan]', root).forEach((b) => (b.onclick = () => setPlan(b.dataset.plan)));
      $('[data-act="pick"]', root)?.addEventListener('click', () => { picking = true; render(); });
      $('[data-act="cancel"]', root)?.addEventListener('click', () => { picking = false; render(); });
      $('[data-act="calib"]', root)?.addEventListener('click', calibrate);
      $$('[data-course]', root).forEach((b) => (b.onclick = () => courseModal(b.dataset.course)));
      $$('[data-elec]', root).forEach((b) => (b.onclick = () => toggleIn('electives', b.dataset.elec)));
    }

    render();
    return { update: render };
  },
};

/** 把图片缩到最长边 max 像素、转成 JPEG data URL（控制上传体积）。 */
function shrink(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
