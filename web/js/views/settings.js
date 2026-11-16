// 设置：档案、账号、外观、数据管理，以及算法说明（可解释性）。
import { store } from '../core/store.js';
import { GRADES, GOALS, INTERESTS } from '../core/data.js';
import { icon, esc, $, $$, toast, confirmBox } from '../core/ui.js';
import { aiHealth } from '../core/ai.js';
import * as P from '../core/plans.js';
import { canInstall, install, isStandalone, isIOS, onInstallChange } from '../core/pwa.js';
import * as F from '../core/feeds.js';
import { uid } from '../core/store.js';
import { modal } from '../core/ui.js';

export default {
  title: '设置',
  mount(root, ctx) {
    const s = store.state;
    const p = s.profile;
    const h = aiHealth();
    root.innerHTML = `
    <div class="page ${ctx.again ? 'static' : ''}">
      <div class="page-head">
        <div class="page-title">
          <div class="path">~/epoch/<b>settings</b></div>
          <h1>设置</h1>
          <p class="page-desc">管理你的档案、账号与数据。所有数据默认仅保存在本浏览器；登录后自动同步到服务器。</p>
        </div>
      </div>
      <div class="set-grid">
        <section class="panel ticks">
          <div class="panel-h"><span class="ph-idx">01</span><span class="ph-title">个人档案</span><span class="ph-en">hyperparameters</span></div>
          <form class="panel-b set-form" id="profileForm">
            <div class="grid-2">
              <div class="field"><label>称呼</label><input class="input" name="name" value="${esc(p.name)}" maxlength="20"></div>
              <div class="field"><label>学校</label><input class="input" name="school" value="${esc(p.school)}" maxlength="30"></div>
              <div class="field"><label>年级</label><select class="select" name="grade">${GRADES.map((g) => `<option ${g === p.grade ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
              <div class="field"><label>专业</label><input class="input" name="major" value="${esc(p.major)}" maxlength="30"></div>
              <div class="field"><label>发展意向</label><select class="select" name="goal">${GOALS.map((g) => `<option value="${g.id}" ${g.id === p.goal ? 'selected' : ''}>${g.name}</option>`).join('')}</select></div>
              <div class="field"><label>每周可投入（小时）</label><input class="input num" type="number" min="1" max="80" name="hoursPerWeek" value="${p.hoursPerWeek}"></div>
            </div>
            <div class="field" style="margin-top:14px"><label>培养方案 · 预训练语料</label>
              <div class="row"><span class="muted" style="font-size:13px">${P.userPlan(s) ? `${esc(P.userPlan(s).school)} ${esc(P.userPlan(s).title)}` : '未设定'}</span><a class="btn sm" href="#/pretrain">${icon('book', 13)} ${P.userPlan(s) ? '管理' : '设定'}</a></div></div>
            <div class="field" style="margin-top:14px"><label>兴趣方向</label><div class="seg">${INTERESTS.map((i) => `<button type="button" class="tag-btn ${p.interests?.includes(i.id) ? 'on' : ''}" data-int="${i.id}">${i.name}</button>`).join('')}</div></div>
            <div class="row-end"><a class="btn ghost" href="#/init">${icon('refresh', 14)} 重新初始化权重</a><button class="btn primary" type="submit">${icon('check', 15)} 保存</button></div>
          </form>
        </section>

        <div class="set-col">
          <section class="panel ticks">
            <div class="panel-h"><span class="ph-idx">02</span><span class="ph-title">账号与同步</span></div>
            <div class="panel-b">
              <p class="muted" style="font-size:13px">${store.auth ? `已登录为 <b>${esc(store.auth.username)}</b>，数据自动同步。` : '未登录：数据仅保存在本浏览器。登录后可多设备同步。'}</p>
              <button class="btn" data-act="account" style="margin-top:12px">${icon('user', 15)} ${store.auth ? '账号管理' : '登录 / 注册'}</button>
            </div>
          </section>
          <section class="panel ticks">
            <div class="panel-h"><span class="ph-idx">03</span><span class="ph-title">外观与 AI</span></div>
            <div class="panel-b">
              <div class="field"><label>主题</label><div class="seg"><button type="button" data-theme-set="dark" class="${document.documentElement.dataset.theme !== 'light' ? 'on' : ''}">${icon('moon', 14)} 夜间实验室</button><button type="button" data-theme-set="light" class="${document.documentElement.dataset.theme === 'light' ? 'on' : ''}">${icon('sun', 14)} 纸面</button></div></div>
              <div class="field" style="margin-top:14px"><label>安装为应用</label><div id="pwaRow"></div></div>
              <div class="field" style="margin-top:14px"><label>AI 导师</label><div class="row"><i class="pulse ${h.ai ? 'on' : 'demo'}"></i><span class="num" style="font-size:12px">${h.ai ? '树形图设计者在线' : h.offline ? '后端未连接' : '演示模式'}</span></div></div>
            </div>
          </section>
          <section class="panel ticks">
            <div class="panel-h"><span class="ph-idx">04</span><span class="ph-title">数据管理</span></div>
            <div class="panel-b set-data">
              <a class="btn" href="#/export?tab=data">${icon('download', 15)} 导入 / 导出 JSON</a>
              <button class="btn" data-act="demo">${icon('layers', 15)} 载入示例训练</button>
              <button class="btn danger" data-act="reset">${icon('trash', 15)} 清空全部数据</button>
            </div>
          </section>
        </div>

        <section class="panel ticks span-all" id="widgetPanel"></section>
        <section class="panel ticks span-all" id="calPanel"></section>

        <section class="panel ticks">
          <div class="panel-h"><span class="ph-idx">07</span><span class="ph-title">导师记忆</span><span class="ph-en">long-term memory</span></div>
          <div class="panel-b" id="memPanel"></div>
        </section>
        <section class="panel ticks">
          <div class="panel-h"><span class="ph-idx">08</span><span class="ph-title">训练选项</span><span class="ph-en">optimizer config</span></div>
          <div class="panel-b set-opts">
            <label class="opt-row"><input type="checkbox" data-opt="valCalib" ${p.valCalib !== false ? 'checked' : ''}><span><b>验证集校准</b><span class="dim">梯度、本周 batch 与导师建议使用“按模拟面试逐题得分校准后”的能力向量，面试暴露的短板会优先补。</span></span></label>
            <label class="opt-row"><input type="checkbox" data-opt="adaptiveBatch" ${p.adaptiveBatch !== false ? 'checked' : ''}><span><b>自适应 batch（AdamW）</b><span class="dim">按历次完成率自动缩放每周任务量（×0.55–×1.3）。关闭后严格按“每周可投入时间”排任务。</span></span></label>
          </div>
        </section>

        <section class="panel ticks span-all">
          <div class="panel-h"><span class="ph-idx">09</span><span class="ph-title">算法说明</span><span class="ph-en">how it works · 可解释</span></div>
          <div class="panel-b algo">
            <div class="algo-item"><div class="kicker">能力向量 S</div><code>S_i = b_i + (5 − b_i) · (1 − e^(−G_i / 2.5))</code><p>b 为初始化权重，G 为该能力累计增益（经历样本 + 完成的计划任务 + 实验里程碑）。越接近满级越难提升——边际递减。</p></div>
            <div class="algo-item"><div class="kicker">损失函数 loss</div><code>loss = Σ w_i · max(0, R_i − S_i)² / Σ w_i · R_i²,  w_i = R_i / 5</code><p>R 为岗位要求，只惩罚“不足”不惩罚“超出”；要求越高的能力权重越大。loss ∈ [0, 1]。</p></div>
            <div class="algo-item"><div class="kicker">拟合度 fit</div><code>fit = 1 − √loss</code><p>与 RMSE 同量纲，更符合直觉：各项能力都达到要求的一半时，fit ≈ 50%。</p></div>
            <div class="algo-item"><div class="kicker">梯度 ∇</div><code>Δ_i = loss(S) − loss(S + 0.5·e_i)</code><p>每项能力提升 0.5 级能带来的 loss 下降，按大小排序即“下一步最该做什么”。</p></div>
            <div class="algo-item"><div class="kicker">地形图位置</div><code>p = Σ softmax(−14·loss_r) · pos_r，向起点按 min(loss) 回缩</code><p>离哪个职业越近（loss 越小），你在地形图上就越靠近那个谷底。</p></div>
            <div class="algo-item"><div class="kicker">分支推演</div><code>G ← G + 课程(t) + h · r · k · ∇ / Σ∇，逐周迭代</code><p>h 为每周投入、r 为近 3 轮 batch 真实完成率、k 为你的历史学习效率（保守取值）；增益按梯度比例分给 loss 下降最快的 3 项能力，学期末计入课程。</p></div>
            <div class="algo-item"><div class="kicker">验证集校准 · 泛化差距</div><code>m = 0.5·score − 0.5 + 0.15·(R − 3),  Ŝ = S + c·(m − S),  c = Σw / (Σw + 3)</code><p>每道面试题按考察的能力维度计分，换算成“面试体现出的水平” m（6 分合格 ≈ 2.5）。证据按 90 天衰减（w = e^(−Δt/90d)），证据越多越可信。val loss = loss(Ŝ)，与 train loss 之差即泛化差距。</p></div>
            <div class="algo-item"><div class="kicker">自适应 batch · AdamW</div><code>g = rate − 0.8,  θ ← (1−λ)θ + η · m̂ / (√v̂ + ε),  预算 × e^θ</code><p>完成率低于 80% 就缩小下一轮的工作量，稳定超额完成就放大；二阶矩让波动大时步子更小，权重衰减 λ=0.3 让系数逐渐回到 ×1。</p></div>
            <div class="algo-item"><div class="kicker">难例挖掘 · 间隔重复</div><code>score &lt; 6 → 入库；复测 ≥ 7 升档，&lt; 6 回到第 1 档；间隔 1/3/7/14/30 天</code><p>模型最该学的是它答错的样本。到期错题会穿插进模拟面试（Q2、Q4），或作为本周 batch 的一条任务。</p></div>
            <div class="algo-item"><div class="kicker">成绩缩放 · 多 JD 集成</div><code>课程增益 × clamp(0.6 + 0.015·(成绩 − 60), 0.5, 1.2)；R = mean − 0.5·σ</code><p>成绩单让“预训练”因人而异；多份 JD 取均值并按分歧打折，各家都要的才是硬要求。</p></div>
            <div class="algo-item"><div class="kicker">训练诊断</div><code>overfitting · plateau · vanishing_gradient · lr_too_high …</code><p>基于样本类别比例、loss 变化、活跃间隔与投入时长的规则引擎，像训练日志一样提醒你。</p></div>
          </div>
        </section>
      </div>
    </div>`;

    const form = $('#profileForm', root);
    const interests = new Set(p.interests || []);
    $$('[data-int]', root).forEach((b) => (b.onclick = () => { b.classList.toggle('on'); interests.has(b.dataset.int) ? interests.delete(b.dataset.int) : interests.add(b.dataset.int); }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      store.update((st) => {
        Object.assign(st.profile, {
          name: String(fd.get('name')).trim(), school: String(fd.get('school')).trim(), grade: fd.get('grade'), major: String(fd.get('major')).trim(),
          goal: fd.get('goal'), hoursPerWeek: Math.max(1, Math.min(80, +fd.get('hoursPerWeek') || 10)), interests: [...interests],
        });
      }, 'profile');
      toast('档案已保存', { type: 'success' });
    };
    $('[data-act="account"]', root).onclick = () => ctx.openAccount();
    $('[data-act="demo"]', root).onclick = async () => {
      if (!(await confirmBox('载入示例训练？', '当前数据将被示例数据覆盖，建议先导出备份。', { ok: '载入示例', danger: true }))) return;
      ctx.loadDemo(true);
    };
    $('[data-act="reset"]', root).onclick = async () => {
      if (!(await confirmBox('清空全部数据？', '此操作会删除本浏览器中的全部训练数据，且无法撤销（云端数据不受影响）。', { ok: '清空', danger: true }))) return;
      store.clear();
      ctx.navigate('/');
    };
    $$('[data-theme-set]', root).forEach((b) => (b.onclick = () => { ctx.setTheme(b.dataset.themeSet); $$('[data-theme-set]', root).forEach((x) => x.classList.toggle('on', x === b)); }));
    const pwaRow = () => {
      const el = $('#pwaRow', root);
      if (!el) return;
      el.innerHTML = isStandalone() ? `<span class="num c-accent" style="font-size:12px">✓ 正在以应用方式运行</span>`
        : canInstall() ? `<button class="btn sm" data-act="install">${icon('install', 14)} 安装到桌面 / 主屏幕</button>`
        : `<span class="dim" style="font-size:12px">${isIOS() ? '在 Safari 中点「分享」→「添加到主屏幕」' : '用浏览器菜单中的「安装应用 / 添加到主屏幕」'}，之后像 App 一样打开，离线也能查看训练数据。</span>`;
      el.querySelector('[data-act="install"]')?.addEventListener('click', async () => { if (await install()) toast('已安装，可以从桌面打开 Epoch 了', { type: 'success' }); pwaRow(); });
    };
    pwaRow();
    const off = onInstallChange(pwaRow);

    // —— 训练选项 ——
    $$('[data-opt]', root).forEach((cb) => (cb.onchange = () => {
      store.update((st) => { st.profile[cb.dataset.opt] = cb.checked; }, 'profile-opt');
      toast(cb.checked ? '已开启' : '已关闭', { type: 'success' });
    }));

    // —— 导师记忆 ——
    const memPanel = () => {
      const el = $('#memPanel', root);
      const mem = store.state.memory || [];
      el.innerHTML = `<p class="dim" style="font-size:12.5px">你在对话里告诉树形图设计者的稳定信息（时间安排、偏好、已做的决定）会被记下，之后每次对话都会参考。可以随时删除或手动添加。</p>
        <div class="mem-list">${mem.length ? [...mem].reverse().map((m) => `<div class="mem-row"><span class="grow">${esc(m.text)}</span><span class="dim num">${new Date(m.t).getMonth() + 1}/${new Date(m.t).getDate()}</span><button class="icon-btn" data-mem-del="${m.id}" title="删除">${icon('trash', 14)}</button></div>`).join('') : '<div class="dim" style="font-size:12.5px;padding:8px 0">还没有记忆。试着告诉导师“我周三下午有实验课”。</div>'}</div>
        <form class="row" data-mem-add style="margin-top:10px"><input class="input grow" name="m" maxlength="60" placeholder="手动添加，例如：暑假在家，每周可以投入 25 小时"><button class="btn sm" type="submit">${icon('plus', 13)} 添加</button></form>`;
      $$('[data-mem-del]', el).forEach((b) => (b.onclick = () => { store.update((st) => { st.memory = (st.memory || []).filter((m) => m.id !== b.dataset.memDel); }, 'memory'); memPanel(); }));
      $('[data-mem-add]', el).onsubmit = (e) => {
        e.preventDefault();
        const v = e.target.m.value.trim();
        if (v.length < 2) return;
        store.update((st) => { st.memory = [...(st.memory || []), { id: uid('mem'), text: v, t: Date.now(), by: 'user' }].slice(-30); }, 'memory');
        memPanel();
      };
    };
    memPanel();

    // —— 手机桌面小组件 & 日历订阅：两个独立面板，各自开关；底层共用同一个订阅地址 ——
    const feedPanel = () => {
      const st = store.state;
      const fd = st.feed || {};
      const on = !!(store.auth && fd.enabled && fd.token);
      const wOn = on && F.widgetOn(fd);
      const cOn = on && F.calOn(fd) && !!fd.calToken;
      const blocks = fd.blocks || F.DEFAULT_BLOCKS;
      const loginNote = (what) => (!store.auth ? `<div class="notice" style="margin-top:12px">${icon('user', 15)}<span>${what}需要先登录（数据要先同步到服务器）。</span><button class="btn sm" data-act="login" style="margin-left:auto">登录 / 注册</button></div>` : '');
      const ctrl = (kind, isOn, label) => `<div class="row" style="margin-top:16px">${isOn
        ? `<button class="btn ghost sm" data-rotate="${kind}">${icon('refresh', 13)} 换一个地址</button><button class="btn danger sm" data-off="${kind}">关闭${label}</button>`
        : `<button class="btn primary" data-on="${kind}" ${store.auth ? '' : 'disabled'}>${icon(kind === 'cal' ? 'calendar' : 'bolt', 14)} 开启${label}</button>`}</div>`;

      const wEl = $('#widgetPanel', root);
      const calTok = fd.calToken;
      wEl.innerHTML = `
        <div class="panel-h"><span class="ph-idx">05</span><span class="ph-title">手机桌面小组件</span><span class="ph-en">widget</span>
          <span class="ph-right">${wOn ? '<span class="chip accent">已开启</span>' : ''}</span></div>
        <div class="panel-b feed-grid">
          <div>
            <p class="muted" style="font-size:13px">在手机桌面上直接看到<b>今天的任务</b>、拟合度和本周进度。数据会在每次云端同步后发布到一个只有你知道的地址。</p>
            ${loginNote('桌面小组件')}
            <div class="field" style="margin-top:14px"><label>小组件显示的内容（按顺序）</label>
              <div class="blk-list">${F.BLOCKS.map((b) => `<label class="opt-row"><input type="checkbox" data-blk="${b.id}" ${blocks.includes(b.id) ? 'checked' : ''}><span><b>${b.name}</b><span class="dim">${b.desc}</span></span></label>`).join('')}</div></div>
            <div class="field" style="margin-top:12px"><label>小组件主题</label><div class="seg" data-wtheme>${[['auto', '跟随系统'], ['dark', '夜间'], ['light', '纸面']].map(([v, n]) => `<button type="button" data-v="${v}" class="${(fd.theme || 'auto') === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
            ${ctrl('widget', wOn, '桌面小组件')}
          </div>
          <div>
            ${wOn ? `
            <div class="feed-preview"><div class="row" style="align-items:flex-end;gap:12px;flex-wrap:wrap"><iframe src="${esc(F.widgetURL(fd.token))}" title="小组件预览 2×2" loading="lazy"></iframe><iframe class="wide" src="${esc(F.widgetURL(fd.token))}" title="小组件预览 4×2" loading="lazy"></iframe></div><span class="kicker">实时预览 · 2×2 / 4×2 · 内容按尺寸自动取舍</span></div>
            <div class="feed-how">
              <div class="kicker">iPhone / iPad</div>
              <ol><li>App Store 安装免费的 <b>Scriptable</b></li><li>新建脚本，粘贴下面的代码</li><li>长按桌面 → 添加小组件 → Scriptable → 选择这个脚本</li></ol>
              <button class="btn sm" data-copy="script">${icon('download', 13)} 复制 Scriptable 脚本</button>
              <div class="kicker" style="margin-top:14px">Android</div>
              <p class="dim">用支持“网页小组件”的桌面 / 应用（如部分启动器自带的网页组件、KWGT 等）添加下面的小组件地址；或者在浏览器里打开它并“添加到主屏幕”。</p>
              <div class="copy-row"><input class="input sm" readonly value="${esc(F.widgetURL(fd.token))}"><button class="btn sm" data-copy="widget">复制</button></div>
            </div>` : `<div class="feed-mock"><div class="kicker">EPOCH 015 · 大模型算法工程师</div><b class="num">66.8<small>%</small></b><div class="meter"><i style="width:66.8%"></i></div><div class="fm-t">○ 实现带 mask 的多头注意力</div><div class="fm-t done">✓ 精读 LoRA 论文第 3 节</div><span class="dim num">本周 4/7 · 3 天后复盘</span></div>`}
          </div>
        </div>`;

      const cEl = $('#calPanel', root);
      cEl.innerHTML = `
        <div class="panel-h"><span class="ph-idx">06</span><span class="ph-title">日历订阅</span><span class="ph-en">webcal feed</span>
          <span class="ph-right">${cOn ? '<span class="chip accent">已开启</span>' : ''}</span></div>
        <div class="panel-b">
          <p class="muted" style="font-size:13px">用手机日历订阅本周 batch（iOS 日历 / Google 日历 / Outlook），任务变了日历自动跟着变。</p>
          ${loginNote('日历订阅')}
          ${cOn ? `
          <div class="copy-row" style="margin-top:14px"><input class="input sm" readonly value="${esc(F.feedURL(calTok, 'ics'))}"><button class="btn sm" data-copy="ics">复制</button><a class="btn sm primary" href="${esc(F.webcalURL(calTok))}">${icon('calendar', 13)} 订阅</a></div>
          <p class="dim" style="font-size:11.5px;margin-top:8px">与“导出 .ics”不同，订阅会随 batch 变化自动更新（刷新频率由日历应用决定，通常几小时一次）。地址不需要登录即可读取，请勿公开；泄露后点“换一个地址”。</p>` : ''}
          ${ctrl('cal', cOn, '日历订阅')}
        </div>`;

      const flag = { widget: 'widgetOn', cal: 'calOn' };
      const other = { widget: 'cal', cal: 'widget' };
      for (const el of [wEl, cEl]) {
        $('[data-act="login"]', el)?.addEventListener('click', () => ctx.openAccount());
        $('[data-rotate]', el)?.addEventListener('click', async (e) => {
          const kind = e.currentTarget.dataset.rotate;
          if (!(await confirmBox('换一个地址？', kind === 'cal' ? '旧的日历订阅会立即失效，需要用新地址重新订阅。桌面小组件不受影响。' : '旧的小组件和 Scriptable 脚本会立即失效，需要用新地址重新添加。日历订阅不受影响。', { ok: '换地址' }))) return;
          try { await F.publish({ rotate: kind }); toast('已更换地址', { type: 'success' }); } catch (err) { toast(err.message, { type: 'error' }); }
          feedPanel();
        });
        $$('[data-copy]', el).forEach((b) => (b.onclick = async () => {
          const v = { script: () => F.scriptableScript(fd.token), widget: () => F.widgetURL(fd.token), ics: () => F.feedURL(calTok, 'ics') }[b.dataset.copy]();
          try { await navigator.clipboard.writeText(v); toast('已复制', { type: 'success' }); }
          catch { modal({ title: '手动复制', body: `<textarea class="textarea mono" rows="10" readonly style="width:100%">${esc(v)}</textarea>` }); }
        }));
      }
      const save = (fn) => { store.update((x) => { x.feed = { ...(x.feed || {}) }; fn(x.feed); }, 'feed'); F.publish({ force: true }).then(() => $$('iframe', wEl).forEach((f) => { f.src = f.src; })).catch(() => {}); };
      $$('[data-blk]', wEl).forEach((cb) => (cb.onchange = () => save((f) => { f.blocks = F.BLOCKS.map((b) => b.id).filter((id) => $(`[data-blk="${id}"]`, wEl).checked); })));
      $$('[data-wtheme] button', wEl).forEach((b) => (b.onclick = () => { save((f) => { f.theme = b.dataset.v; }); $$('[data-wtheme] button', wEl).forEach((x) => x.classList.toggle('on', x === b)); }));
      $$('[data-on]', root).forEach((btn) => btn.addEventListener('click', async () => {
        const kind = btn.dataset.on;
        btn.disabled = true;
        const was = on;
        // 只开启点的那一项；另一项若之前没开，保持关闭
        store.update((x) => { x.feed = { blocks: F.DEFAULT_BLOCKS, ...(x.feed || {}), enabled: true, [flag[kind]]: true, ...(was ? {} : { [flag[other[kind]]]: false }) }; }, 'feed');
        try { await F.publish({ force: true }); toast(kind === 'cal' ? '已开启，点「订阅」添加到手机日历' : '已开启，按右侧步骤添加到手机桌面', { type: 'success' }); }
        catch (err) { toast(err.message, { type: 'error' }); store.update((x) => { x.feed[flag[kind]] = false; if (!was) x.feed.enabled = false; }, 'feed'); }
        feedPanel();
      }));
      $$('[data-off]', root).forEach((btn) => btn.addEventListener('click', async () => {
        const kind = btn.dataset.off;
        const label = kind === 'cal' ? '日历订阅' : '桌面小组件';
        const otherOn = kind === 'cal' ? wOn : cOn;
        if (!(await confirmBox(`关闭${label}？`, `${label}会停止更新，地址立即失效。`, { ok: '关闭', danger: true }))) return;
        if (otherOn) {
          store.update((x) => { x.feed = { ...x.feed, [flag[kind]]: false }; }, 'feed');
          try { await F.publish({ force: true }); } catch (err) { toast(err.message, { type: 'error' }); }
        } else await F.disable();
        feedPanel();
      }));
    };
    feedPanel();
    // 旧版本开启的订阅还没有单独的日历地址：发布一次拿到（服务器沿用原地址，已订阅的日历不受影响）
    if (store.auth && store.state.feed?.enabled && store.state.feed.token && !store.state.feed.calToken) F.publish({ force: true }).then(feedPanel).catch(() => {});
    const offAuth = store.subscribe((reason) => { if (reason === 'auth') feedPanel(); });
    return { update() {}, destroy() { off(); offAuth(); } };
  },
};
