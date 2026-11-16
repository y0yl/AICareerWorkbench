// 动画演示：首页逐屏 → 新建个人 → 功能巡览。
// 全程运行在 store 沙盒里（不写 localStorage、不同步云端），退出后恢复原来的数据。
import { store } from './store.js';
import { demoState } from './demo.js';
import { icon, esc } from './ui.js';
import * as P from './plans.js';

class Stop extends Error {}
class Skip extends Error {}

const SPEEDS = [
  { name: '慢', k: 0.65 },
  { name: '标准', k: 1 },
  { name: '快', k: 1.6 },
];

const CHAPTERS = [
  { id: 'home', name: '首页' },
  { id: 'create', name: '新建个人' },
  { id: 'features', name: '功能' },
];

let active = null;

export function startTour(ctx) {
  if (active) return;
  active = new Tour(ctx);
  active.run();
}

class Tour {
  constructor(ctx) {
    this.ctx = ctx;
    this.paused = false;
    this.stopped = false;
    this.skip = false;
    this.nextReq = false;
    this.chapter = 0;
    // 节奏：每条字幕按字数给足阅读时间；clock 只在未暂停时走
    this.clock = 0;
    this.sayAt = 0;
    this.need = 0;
    this.speed = SPEEDS[store.prefs.get('tourSpeed', 1)] ? store.prefs.get('tourSpeed', 1) : 1;
    this.spotEl = null;
    this.root = document.createElement('div');
    this.root.className = 'tour';
    this.root.innerHTML = `
      <div class="tour-shield"></div>
      <div class="tour-ring hidden"></div>
      <div class="tour-cursor" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 3l14 8.5-6.2 1.3L9.6 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><i></i></div>
      <div class="tour-bar" role="status" aria-live="polite">
        <div class="tb-chapters">${CHAPTERS.map((c, i) => `<span data-ch="${i}"><b class="mono">0${i + 1}</b>${c.name}</span>`).join('')}</div>
        <div class="tb-speed seg" aria-label="演示速度">${SPEEDS.map((x, i) => `<button type="button" data-speed="${i}">${x.name}</button>`).join('')}</div>
        <div class="tb-main"><div class="tb-title"></div><div class="tb-text"></div></div>
        <div class="tb-ctl">
          <button class="btn sm ghost" data-t="pause">${icon('stop', 13)} 暂停</button>
          <button class="btn sm ghost" data-t="skip" title="跳过整个章节">跳过本节</button>
          <button class="btn sm primary" data-t="next" title="快捷键 →">下一步 ${icon('arrow', 13)}</button>
          <button class="btn sm" data-t="exit" title="Esc">${icon('close', 13)} 退出</button>
        </div>
        <div class="tb-prog"><i></i></div>
      </div>`;
    document.body.appendChild(this.root);
    this.cursor = this.root.querySelector('.tour-cursor');
    this.ring = this.root.querySelector('.tour-ring');
    this.bar = this.root.querySelector('.tour-bar');
    this.prog = this.root.querySelector('.tb-prog i');
    this.cx = innerWidth / 2;
    this.cy = innerHeight * 0.6;
    this.cursor.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    this.root.querySelector('[data-t="pause"]').onclick = () => this.togglePause();
    this.root.querySelector('[data-t="skip"]').onclick = () => { this.skip = true; };
    this.root.querySelector('[data-t="next"]').onclick = () => { this.nextReq = true; };
    this.root.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => this.setSpeed(+b.dataset.speed)));
    this.setSpeed(this.speed);
    this.root.querySelector('[data-t="exit"]').onclick = () => { this.stopped = true; };
    this.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.stopped = true; }
      else if (e.key === ' ' && !e.target.closest?.('input, textarea')) { e.preventDefault(); this.togglePause(); }
      else if (e.key === 'ArrowRight') this.nextReq = true;
    };
    document.addEventListener('keydown', this.onKey, true);
    // 聚光框跟随目标（滚动、重排时位置会变）
    const follow = () => {
      if (!this.root.isConnected) return;
      this.placeRing();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }

  setSpeed(i) {
    this.speed = i;
    store.prefs.set('tourSpeed', i);
    this.root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === i));
  }

  togglePause() {
    this.paused = !this.paused;
    this.root.classList.toggle('paused', this.paused);
    this.root.querySelector('[data-t="pause"]').innerHTML = this.paused ? `${icon('play', 13)} 继续` : `${icon('stop', 13)} 暂停`;
  }

  // —— 基础动作 ——
  async wait(ms) {
    let left = ms;
    while (left > 0) {
      if (this.stopped) throw new Stop();
      if (this.skip) throw new Skip();
      await new Promise((r) => setTimeout(r, 50));
      if (!this.paused) {
        const dt = 50 * (window.__tourSpeed || 1); // __tourSpeed：调试用加速
        left -= dt;
        this.clock += dt;
        // 进度线：当前字幕还剩多久自动翻到下一条
        const end = Math.max(this.until || 0, this.sayAt + this.need / SPEEDS[this.speed].k);
        this.prog.style.width = `${Math.min(100, ((this.clock - this.sayAt) / Math.max(1, end - this.sayAt)) * 100)}%`;
      }
    }
  }
  async find(sel, timeout = 6000) {
    for (let t = 0; t < timeout; t += 100) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (el && el.getClientRects().length) return el;
      await this.wait(100);
    }
    return null;
  }
  async go(path, sel) {
    this.spot(null);
    this.ctx.closeAdam?.();
    this.ctx.navigate(path);
    await this.find(sel);
    await this.wait(500);
  }
  /**
   * 停留到当前字幕读完（至少 min 毫秒，从现在算）。字幕出现后的鼠标移动、滚动也计入阅读时间。
   * 点“下一步”或按 → 立即继续。
   */
  async hold(min = 0) {
    const k = SPEEDS[this.speed].k;
    const start = this.clock;
    const until = Math.max(this.sayAt + this.need / k, start + min / k);
    this.until = until;
    // 演示动作进行中按下的“下一步”也算数（nextReq 不在这里清零）
    while (this.clock < until && !this.nextReq) await this.wait(50);
    if (this.nextReq) this.need = 0; // 手动翻页：这条字幕视为已读，后面不再补等
    this.nextReq = false;
    this.until = this.clock;
    this.bar.querySelector('.tb-prog i').style.width = '100%';
  }

  async say(title, text) {
    await this.hold(); // 上一条字幕还没读完就先等它
    // 阅读时间：边看面板边读字幕，按每字约 0.13 秒，另加 1.6 秒看面板
    const len = (title + String(text).replace(/<[^>]+>/g, '')).length;
    this.need = 1600 + len * 130;
    this.sayAt = this.clock;
    this.bar.querySelectorAll('[data-ch]').forEach((c) => {
      c.classList.toggle('on', +c.dataset.ch === this.chapter);
      c.classList.toggle('done', +c.dataset.ch < this.chapter);
    });
    this.bar.querySelector('.tb-title').textContent = title;
    this.bar.querySelector('.tb-text').innerHTML = text;
    this.bar.classList.remove('pop');
    void this.bar.offsetWidth;
    this.bar.classList.add('pop');
    this.bar.classList.toggle('shift', !!document.querySelector('#adam.open'));
  }
  spot(el) {
    this.spotEl = el || null;
    this.ring.classList.toggle('hidden', !el);
    this.placeRing();
  }
  placeRing() {
    if (!this.spotEl) return;
    const r = this.spotEl.getBoundingClientRect();
    const pad = 6;
    Object.assign(this.ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  }
  async scroll(sel, block = 'start') {
    const el = await this.find(sel);
    if (!el) return null;
    el.scrollIntoView({ behavior: 'smooth', block });
    await this.wait(900);
    return el;
  }
  async show(sel, title, text, ms = 2800, block = 'center') {
    const el = await this.scroll(sel, block);
    if (title) await this.say(title, text);
    this.spot(el);
    if (el) await this.move(el, 0.5, 0.5);
    await this.hold(ms);
    return el;
  }
  async move(el, fx = 0.5, fy = 0.5) {
    const r = el.getBoundingClientRect();
    this.cx = r.left + r.width * fx;
    this.cy = r.top + r.height * fy;
    this.cursor.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    await this.wait(650);
  }
  async click(sel, { scroll = true } = {}) {
    const el = await this.find(sel);
    if (!el) return null;
    if (scroll) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); await this.wait(500); }
    await this.move(el);
    this.cursor.classList.remove('press');
    void this.cursor.offsetWidth;
    this.cursor.classList.add('press');
    await this.wait(180);
    el.click();
    await this.wait(450);
    return el;
  }
  async type(sel, text, speed = 120) {
    const el = await this.click(sel);
    if (!el) return;
    el.focus();
    el.value = '';
    for (const ch of text) {
      el.value += ch;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await this.wait(speed);
    }
  }
  async slide(sel, to) {
    const el = await this.find(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.wait(450);
    const from = +el.value;
    const step = +el.step || 1;
    const n = Math.max(1, Math.round(Math.abs(to - from) / step));
    await this.move(el, (from - +el.min) / (+el.max - +el.min || 1), 0.5);
    for (let i = 1; i <= n; i++) {
      el.value = from + ((to - from) * i) / n;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const r = el.getBoundingClientRect();
      this.cursor.style.transform = `translate(${r.left + r.width * ((+el.value - +el.min) / (+el.max - +el.min || 1))}px, ${r.top + r.height / 2}px)`;
      await this.wait(70);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await this.wait(300);
  }

  // —— 流程 ——
  async run() {
    this.hadState = !!store.state;
    store.beginSandbox(null);
    const chapters = [() => this.home(), () => this.create(), () => this.features()];
    try {
      for (this.chapter = 0; this.chapter < chapters.length; this.chapter++) {
        this.skip = false;
        this.nextReq = false;
        this.need = 0; // 跳过章节后，不再等上一章没读完的字幕
        try {
          await chapters[this.chapter]();
        } catch (e) {
          if (!(e instanceof Skip)) throw e;
        }
      }
      this.skip = false;
      await this.finale();
    } catch (e) {
      if (!(e instanceof Stop)) console.error(e);
    }
    this.end();
  }

  end() {
    document.removeEventListener('keydown', this.onKey, true);
    this.root.remove();
    document.querySelectorAll('.modal-root').forEach((m) => m.remove());
    this.ctx.closeAdam?.();
    store.endSandbox();
    active = null;
    if (location.hash !== '#/') location.hash = '/';
    else this.ctx.navigate('/');
  }

  async home() {
    await this.go('/', '.hero-title');
    await this.say('训练你自己', 'Epoch 是为人工智能专业学生打造的生涯训练台：职业目标是<b>目标函数</b>，每段经历是<b>训练样本</b>，下一步行动就是<b>梯度</b>。');
    this.spot(await this.find('.hero-title'));
    await this.move(await this.find('.hero-title'), 0.6, 0.6);
    await this.hold(2200);
    await this.show('.hero-cta', '从这里开始', '初始化自己的模型，或者先载入一份训练了 14 周的示例数据。未登录时数据仅保存在本地浏览器。', 1900);

    await this.show('#concept .sec-head', '把机器学习的语言，翻译成生涯规划', '用起来只有四步，12 个功能分别落在这四步里。', 1600, 'start');
    for (const el of document.querySelectorAll('.flow-step')) {
      const title = el.querySelector('.fs-title')?.textContent || '';
      const mods = [...el.querySelectorAll('.fs-mn')].map((m) => m.firstChild.textContent).join(' · ');
      await this.show(el, title, `${esc(el.querySelector('.fs-desc')?.textContent || '')}<br><b>${esc(mods)}</b>`, 1600);
    }

    await this.show('.preview-net', '让成长变得可观测', '示例学生「林间」的能力网络与 loss 曲线：信号从 12 项能力出发，激活 10 个职业方向。', 2000);

    await this.show('#mentor .sec-head', '树形图设计者：路径会跟着你一起变', '任务清单写好就不再变，坚持久了只剩烦躁；树形图设计者会在使用过程中不断重算你的路径。', 2400, 'start');
    await this.show('.ai-vs', '静态清单 vs 动态路径', '落后时先减量、拆小、改期；新经历、新目标进来，路径随之改道。', 2000);
    await this.say('对话即调整', '它的建议会变成操作卡片，点“执行”才写入。');
    await this.click('[data-act="demo-apply"]');
    this.spot(await this.find('#demoCard'));
    await this.hold(1700);
    await this.show('.ai-caps', '它能做什么', '持续重算路径、看得见全部状态、建议直接落地，还能扮演面试官、撰写规划书。', 1800);
    await this.show('.tools-grid', '落到真实的一周里', '本周任务一键导入手机日历；安装到主屏幕，像 App 一样打开；训练报告做成一张能分享的海报。', 2600);
    await this.show('.land-final', '首页看完了', '接下来演示：一个新同学如何创建自己的模型。', 1400);
  }

  async create() {
    store.beginSandbox(null);
    await this.go('/init', '.init-card');
    await this.say('第 1 步 · 基本信息', '先认识一下你。<b>未登录时，所有数据仅保存在本地浏览器</b>；登录后才会同步到云端。');
    this.spot(await this.find('.init-form'));
    await this.type('[data-k="name"]', '林间');
    const plan = P.PLANS.find((p) => !p.partial) || P.PLANS[0];
    if (plan) {
      await this.say('选择培养方案 = 预训练语料', `选中「${esc(plan.school)} · ${esc(plan.title)}」：自动推断年级，并按已修课程预估初始能力。`);
      const sel = await this.click('#planSel');
      if (sel) { sel.value = plan.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      this.spot(await this.find('.init-code'));
      await this.hold(2600);
    }
    await this.click('[data-nav="1"]');

    await this.say('第 2 步 · 超参数', '发展意向决定优化方向，每周可投入的时间就是“学习率”。右边的配置代码实时更新。');
    this.spot(await this.find('.init-form'));
    await this.click('[data-seg="goal"] [data-v="job"]');
    await this.slide('[data-k="hoursPerWeek"]', 14);
    await this.click('[data-multi="interests"] [data-v="llm"]');
    await this.click('[data-multi="interests"] [data-v="agent"]');
    await this.wait(900);
    await this.click('[data-nav="1"]');

    await this.say('第 3 步 · 权重初始化', '诚实评估 12 项能力（0–5）。拖动时会显示参考描述，之后每个训练样本都会更新它们。');
    this.spot(await this.find('.init-form'));
    await this.slide('[data-w="code"]', 3);
    await this.slide('[data-w="dl"]', 2.5);
    await this.slide('[data-w="llm"]', 2);
    await this.wait(700);
    await this.click('[data-nav="1"]');

    await this.say('第 4 步 · 目标函数', '按“能力拟合度 + 兴趣加权”排序推荐职业方向。选一个作为目标，随时可以改。');
    this.spot(await this.find('.role-pick'));
    await this.hold(1800);
    await this.click('.rp.top');
    await this.wait(1200);
    await this.say('初始化并开始训练', '模型配置完成，第一个 epoch 开始。');
    this.spot(null);
    await this.click('[data-go]');
    await this.find('.boot');
    await this.wait(3200);
    await this.find('.page');
    await this.say('新模型已就绪', '刚创建的模型还没有训练样本。接下来换成一位已经训练了 14 周的示例学生，看看完整功能。');
    await this.hold(3000);
  }

  async features() {
    store.beginSandbox(demoState());
    await this.go('/console', '.readouts');
    await this.show('.readouts', '控制台 · 训练读数', 'Loss、拟合度、Epoch、本周投入、模拟面试成绩——成长被量化成一组实时读数。', 3000);
    // 窄屏下侧栏底部被收起，就跳过这一步
    if (document.querySelector('.store-mode span')?.getClientRects().length) await this.show('.store-mode', store.auth ? '云端同步' : '本地模式', store.auth
      ? '已登录：训练数据自动同步到服务器，换设备也能继续。'
      : '未登录时，数据仅保存在本地浏览器——清除浏览器数据或换设备后无法找回。点这里登录即可云端同步。', 2800);
    await this.show('.batch-panel', '本周 batch', '每周一个 mini-batch：具体到哪一天、能客观验收的任务。', 2800);
    await this.show('.net-panel', '你的网络', '能力 → 能力簇 → 职业方向的前向传播，点职业可查看详情。', 2800);
    await this.show('.grad-panel', '梯度方向', '对 loss 求导：哪项能力提升 0.5 能让你离目标最快，并配上对应的计划任务或推荐实验。', 3200);

    await this.go('/objective', '.land-panel');
    await this.show('.land-panel', '目标函数 · 损失地形图', '每个职业是一个山谷，小球是现在的你。也可以粘贴真实 JD，生成自定义目标。', 3200);

    await this.go('/branches', '.tree-panel');
    await this.show('.tree-panel', '分支推演 · 树形图', '树形图设计者把选择展开成一棵树：3 个方向 × 3 种投入，每条分支都用你的真实完成率逐周推演，叶子上是终点拟合度和预计收敛时间。', 3400, 'start');
    const best = await this.find('.tr-leaf .chip.accent');
    if (best) {
      await this.say('点开一条分支', '比如标着“最优路径”的这一条：换个方向、加大投入，会怎样？');
      await this.click(best.closest('.tr-leaf'));
      await this.show('.br-chart-panel', '推演曲线', '实线是走过的路，虚线是同一方向的几条分支；圆点标出预计越过收敛线的时间。', 3000);
      await this.show('.br-split', '增长从哪来', '拟合度的增长拆成“课程贡献”和“自主训练贡献”——上课补不上的部分，一眼就能看出来。', 2800);
    }

    await this.go('/pretrain', '.pre-grid');
    await this.show('.pre-grid .panel', '预训练 · 培养方案', '内置示例人工智能专业培养方案（测试占位数据），课程按学期自动计入能力。', 3000);

    await this.go('/dataset', '.page');
    await this.show('.ds-stats', '数据集 · 经历档案', '课程、项目、竞赛、实习都是训练样本，AI 自动标注它们提升了哪些能力。', 2600);
    await this.show('.sample', null, '', 2000);

    await this.go('/schedule', '.batch-panel');
    await this.show('.phases', '训练计划 · 长期路线', 'warmup → train → finetune 三个阶段，周任务会自动推进长期计划。', 2800);

    // 树形图设计者：一次真实的“调整路径”（本地回放，不调用 AI）
    await this.show('.batch-panel', '树形图设计者 · 调整路径', '假设这周有点吃不消，看看它怎么做。', 2000, 'start');
    this.ctx.openAdam();
    await this.find('#adam.open textarea');
    await this.wait(600);
    const ask = '这周有点吃不消，任务越积越多，看着就烦。';
    await this.say('对话', '直接用大白话告诉它你的状态。');
    await this.type('#adam textarea', ask, 90);
    await this.wait(400);
    this.spot(null);
    await this.ctx.simulateAdam(ask, adjustReply(store.state), (ms) => this.wait(ms));
    await this.say('操作卡片', '它不会继续往清单上堆任务，而是按真实进度删减、改期、减量——点“执行”才写入。');
    this.spot(await this.find('#adam .act-card'));
    await this.hold(2600);
    await this.click('#adam [data-apply]', { scroll: false });
    await this.wait(1600);
    this.ctx.closeAdam();
    await this.say('路径已重算', '本周任务随之更新，挪走的任务进入下周预排。');
    await this.show('.batch-panel', null, '', 3000, 'start');
    const cal = await this.find('[data-bt="ics"]');
    if (cal) {
      await this.say('导出到日历', '调整好的这一周，可以一键导出 .ics，导入手机或电脑日历，每条任务都带提醒。');
      cal.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.wait(600);
      this.spot(cal);
      await this.move(cal);
      await this.hold(2200);
    }
    await this.show('#planLog .cm', '路径变更日志', '刚才那次调整已经记成一条“提交”：作者是树形图设计者，附上理由和逐行 diff。路径怎么一步步变过来的，都查得到。', 3400);
    await this.show('#planLog .cl-stats', null, '', 2200);

    await this.go('/runs', '.page');
    await this.show('.run', '实验 · 项目实践', '像管理实验一样推进项目，每个里程碑都是一次 checkpoint。', 2800);

    await this.go('/validate', '.page');
    await this.show('.val-grid .panel', '验证集 · 模拟面试', 'AI 面试官出题、追问、打分，防止“只在训练集上表现好”。', 2800);

    await this.go('/export', '.page');
    await this.show('.page .tabs', '推理导出', '一键生成 Model Card、职业生涯规划书与简历草稿，数据与训练状态保持一致。', 2600);
    await this.click('[data-tab="share"]');
    await this.find('.share-canvas', 8000);
    await this.show('.share-frame', '训练报告分享卡', '地形上走过的轨迹、loss 曲线、12 维能力，全部实时绘制成一张海报，可下载或复制，也可以隐去姓名。', 3200);
  }

  async finale() {
    this.spot(null);
    this.chapter = CHAPTERS.length;
    await this.say('演示结束', '以上操作都在沙盒中进行，你的数据没有任何改动。');
    this.bar.querySelector('.tb-ctl').innerHTML = `<button class="btn sm primary" data-t="init">${icon('play', 13)} ${this.hadState ? '继续我的训练' : '初始化我的模型'}</button><button class="btn sm" data-t="exit">回到首页</button>`;
    let go = null;
    this.bar.querySelector('[data-t="init"]').onclick = () => { go = this.hadState ? '/console' : '/init'; this.stopped = true; };
    this.bar.querySelector('[data-t="exit"]').onclick = () => { this.stopped = true; };
    this.root.querySelector('.tour-shield').classList.add('dim');
    try {
      for (;;) await this.wait(1000);
    } finally {
      if (go) setTimeout(() => { location.hash = go; }, 50);
    }
  }
}

/** 按示例学生当前的本周任务，拼一段“调整路径”的回复（含操作块）。 */
function adjustReply(s) {
  const tasks = (s.batch?.tasks || []).map((t, i) => ({ t, ref: `B${i + 1}` })).filter(({ t }) => !t.done && t.src !== 'ritual');
  const heavy = [...tasks].sort((a, b) => b.t.hours - a.t.hours);
  const drop = tasks.find(({ t }) => t.src === 'grad' && t !== heavy[0]?.t && t !== heavy[1]?.t);
  const changes = [];
  const words = [];
  if (heavy[0]) { changes.push({ op: 'move', ref: heavy[0].ref, week: 'next', day: '周二' }); words.push(`把最重的「${heavy[0].t.title.slice(0, 18)}」挪到下周二`); }
  if (heavy[1] && heavy[1].t.hours > 1.5) { changes.push({ op: 'resize', ref: heavy[1].ref, hours: 1.5 }); words.push(`「${heavy[1].t.title.slice(0, 18)}」先做 1.5 小时的最小版本`); }
  if (drop) { changes.push({ op: 'remove', ref: drop.ref }); words.push('再去掉一条对目标贡献最低的练习'); }
  const block = JSON.stringify({ actions: [{ type: 'adjust_tasks', reason: '本周负荷过高，先保住节奏', changes }] });
  return `落后的时候硬塞只会更烦。我按这周的真实进度重新演算了一遍：${words.join('，')}。\n\n总量降下来，方向不变——节奏比总量重要。\n\n\`\`\`epoch-action\n${block}\n\`\`\``;
}
