// 订阅源：手机桌面小组件（JSON）与日历订阅（.ics）。
// 登录并开启后，每次训练数据同步到云端，都会顺带把“小组件要显示的内容”和本周 batch 的日历发布到一个不可猜的 token 地址；
// 小组件页面 / iOS Scriptable / 手机日历按这个地址定时拉取，不需要登录。
import { store } from './store.js';
import * as M from './model.js';
import * as B from './batch.js';
import * as T from './testset.js';
import { batchToICS } from './ics.js';

export const BLOCKS = [
  { id: 'today', name: '今天的任务', desc: '本周 batch 里今天要做的事，可在小组件上看到完成情况' },
  { id: 'fit', name: '拟合度与 loss', desc: '当前目标、拟合度、loss 及本轮变化' },
  { id: 'epoch', name: 'Epoch 进度', desc: '第几个 epoch、本周完成率、距离周日复盘还有几天' },
  { id: 'next', name: '下一项任务', desc: '今天做完后，接下来排的是什么' },
  { id: 'hard', name: '错题到期', desc: '错题本里今天到期复测的题数' },
  { id: 'test', name: '投递进展', desc: '测试集：进行中的投递与 Offer 数' },
  { id: 'tip', name: '本周策略', desc: '树形图设计者给本周的一句话' },
];
export const DEFAULT_BLOCKS = ['today', 'fit', 'epoch'];

/** 小组件数据：整周的任务都带上（小组件按自己的日期挑“今天”），这样当天不打开 Epoch 也能正确显示。 */
export function widgetData(s) {
  const role = M.roleById(s, s.target);
  const hist = role ? M.lossHistory(s) : [];
  const loss = hist.at(-1)?.loss ?? null;
  const prev = hist.length > 1 ? hist.at(-2).loss : loss;
  const b = s.batch;
  const st = b ? B.batchStats(b) : null;
  const f = T.funnel(s);
  return {
    v: 1,
    name: s.profile?.name || '',
    blocks: s.feed?.blocks || DEFAULT_BLOCKS,
    theme: s.feed?.theme || 'auto',
    epoch: M.epochInfo(s).epoch,
    target: role?.name || null,
    fit: loss != null ? +M.fitOf(loss).toFixed(4) : null,
    loss: loss != null ? +loss.toFixed(4) : null,
    delta: loss != null ? +(prev - loss).toFixed(4) : null,
    week: b ? { start: b.weekStart, done: st.done, total: st.total, hours: st.hours, budget: b.budget, tip: b.tip || '' } : null,
    tasks: b ? b.tasks.map((t) => ({ d: t.day, title: t.title, h: t.hours, done: !!t.done, src: t.src })) : [],
    hardDue: T.dueHard(s).length,
    test: f.total ? { active: f.active, interviews: f.levels[2].n, offers: f.offers } : null,
    builtAt: Date.now(),
  };
}

let timer = 0;
let lastSent = '';
/** 桌面小组件与日历订阅各自开关、各用一个地址。 */
export const widgetOn = (f) => !!f?.enabled && f.widgetOn !== false;
export const calOn = (f) => !!f?.enabled && f.calOn !== false;

/** 发布订阅源（登录且开启时）；rotate='widget' | 'cal' 只给那一项换新地址（旧地址立即失效）。 */
export async function publish({ rotate = false, force = false } = {}) {
  const s = store.state;
  if (!store.auth || !s?.feed?.enabled || store.sandboxed) return null;
  const widget = widgetData(s);
  const { ics } = batchToICS(s, { includeDone: true, ...(s.feed.cal || {}) });
  const kinds = { widget: widgetOn(s.feed), cal: calOn(s.feed) };
  const key = JSON.stringify({ ...widget, builtAt: 0, kinds }) + ics.replace(/DTSTAMP:\S+/g, '');
  if (!force && !rotate && key === lastSent && s.feed.token) return s.feed.token;
  const res = await store.api('api/feed', { method: 'POST', body: { widget, ics, kinds, rotate } });
  lastSent = key;
  if (res.token !== s.feed.token || res.calToken !== s.feed.calToken) store.update((st) => { st.feed = { ...st.feed, token: res.token, calToken: res.calToken }; }, 'feed');
  return res.token;
}
export async function disable() {
  if (store.auth) await store.api('api/feed', { method: 'POST', body: { disable: true } }).catch(() => {});
  store.update((st) => { st.feed = { ...(st.feed || {}), enabled: false, token: null, calToken: null }; }, 'feed');
}

/** 订阅源地址（相对当前页面，兼容子路径部署）。 */
export const feedURL = (token, ext) => new URL(`api/feed/${token}.${ext}`, location.href).href;
export const widgetURL = (token) => new URL(`widget.html?t=${encodeURIComponent(token)}`, location.href).href;
export const webcalURL = (token) => feedURL(token, 'ics').replace(/^https?:/, 'webcal:');

export function setupFeeds() {
  store.onPushed(() => { clearTimeout(timer); timer = setTimeout(() => publish().catch(() => {}), 800); });
}

/** iOS「Scriptable」小组件脚本：在 App 里新建脚本粘贴即可，添加桌面小组件时选它。 */
export function scriptableScript(token) {
  const url = feedURL(token, 'json');
  return `// Epoch 桌面小组件 · 由 Epoch 生成（Scriptable）
const URL_ = ${JSON.stringify(url)};
const OPEN = ${JSON.stringify(new URL('#/console', location.href).href)};
const d = await new Request(URL_).loadJSON().catch(() => null);
const w = new ListWidget();
const dark = Device.isUsingDarkAppearance();
const C = { bg: dark ? "#0a0c0f" : "#efede6", text: dark ? "#e8eae6" : "#1c1d1a", dim: dark ? "#8a8f88" : "#6b6c64", accent: dark ? "#d4ff3a" : "#4d7a00", loss: "#ff6a3d" };
w.backgroundColor = new Color(C.bg); w.url = OPEN; w.setPadding(12, 14, 12, 14);
const t = (s, size, color, bold) => { const x = w.addText(String(s)); x.font = bold ? Font.boldMonospacedSystemFont(size) : Font.systemFont(size); x.textColor = new Color(color); x.lineLimit = 1; return x; };
if (!d || !d.ok) { t("EPOCH", 11, C.dim, true); t("打开 Epoch 同步一次数据", 13, C.text); }
else {
  const day = (new Date().getDay() + 6) % 7;
  const ws = d.week ? d.week.start : 0, cur = d.week && Date.now() - ws < 7 * 864e5 && Date.now() >= ws;
  t(\`EPOCH \${String(d.epoch).padStart(3, "0")}\${d.fit != null ? "  ·  " + (d.fit * 100).toFixed(1) + "%" : ""}\`, 11, C.accent, true);
  if (d.loss != null) t(\`loss \${d.loss.toFixed(4)} \${d.delta >= 0 ? "▼" : "▲"}\${Math.abs(d.delta).toFixed(4)}\`, 10, d.delta >= 0 ? C.accent : C.loss, true);
  w.addSpacer(6);
  const today = cur ? d.tasks.filter((x) => x.d === day) : [];
  if (!today.length) t(cur ? "今天没有安排 🎯" : "新的一周：打开 Epoch 生成 batch", 12, C.dim);
  for (const x of today.slice(0, config.widgetFamily === "small" ? 3 : 5)) t(\`\${x.done ? "✓" : "○"} \${x.title}\`, 12, x.done ? C.dim : C.text);
  w.addSpacer();
  if (d.week) t(\`本周 \${d.week.done}/\${d.week.total}\${d.hardDue ? "  ·  错题到期 " + d.hardDue : ""}\`, 9, C.dim);
}
w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);
Script.setWidget(w); Script.complete();
`;
}
