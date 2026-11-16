// 欢迎语：进入控制台时弹出的一句应景的话——节日 / 节气 / 求职季 / 时段 / 训练状态。
// 诗句全部出自古籍（公有领域）；署名 Epoch 的是原创的训练隐喻短句。
import * as M from './model.js';

const DAY = 86400000;

// ---------- 历法 ----------
// 农历用浏览器内置的中国历法（Intl），闰月返回非纯数字，自然不会命中节日
const LUNAR = (() => { try { return new Intl.DateTimeFormat('en-US-u-ca-chinese', { month: 'numeric', day: 'numeric' }); } catch { return null; } })();
function lunarOf(d) {
  if (!LUNAR) return null;
  const parts = Object.fromEntries(LUNAR.formatToParts(d).map((p) => [p.type, p.value]));
  return /^\d+$/.test(parts.month) && /^\d+$/.test(parts.day) ? { m: +parts.month, d: +parts.day } : null;
}

// 二十四节气（21 世纪寿星公式：日 = ⌊Y·0.2422 + C⌋ − ⌊L/4⌋，小寒~雨水的 L 取 Y−1）
const TERMS = [
  ['小寒', 1, 5.4055], ['大寒', 1, 20.12], ['立春', 2, 3.87], ['雨水', 2, 18.73], ['惊蛰', 3, 5.63], ['春分', 3, 20.646],
  ['清明', 4, 4.81], ['谷雨', 4, 20.1], ['立夏', 5, 5.52], ['小满', 5, 21.04], ['芒种', 6, 5.678], ['夏至', 6, 21.37],
  ['小暑', 7, 7.108], ['大暑', 7, 22.83], ['立秋', 8, 7.5], ['处暑', 8, 23.13], ['白露', 9, 7.646], ['秋分', 9, 23.042],
  ['寒露', 10, 8.318], ['霜降', 10, 23.438], ['立冬', 11, 7.438], ['小雪', 11, 22.36], ['大雪', 12, 7.18], ['冬至', 12, 21.94],
];
/** 当前所处的节气，以及今天是否正是交节日。 */
function solarTerm(d) {
  const y = d.getFullYear() % 100;
  const dateOf = (i, year) => {
    const [, m, c] = TERMS[i];
    const L = i < 4 ? y - 1 : y;
    return new Date(year, m - 1, Math.floor(y * 0.2422 + c) - Math.floor(L / 4));
  };
  const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  for (let i = TERMS.length - 1; i >= 0; i--) {
    const td = dateOf(i, d.getFullYear()).getTime();
    if (td <= t0) return { name: TERMS[i][0], today: td === t0 };
  }
  return { name: '冬至', today: false }; // 1 月初、小寒之前
}

// ---------- 语料 ----------
const Q = (line, by, note = '') => ({ line, by, note });

const FESTIVALS = {
  // 农历
  'L1-1': ['春节', [Q('爆竹声中一岁除，春风送暖入屠苏。', '王安石《元日》', '新的一年，新的 epoch。')]],
  'L1-15': ['元宵', [Q('东风夜放花千树，更吹落、星如雨。', '辛弃疾《青玉案·元夕》', '今晚给自己放个假，loss 明天再降。')]],
  'L5-5': ['端午', [Q('节分端午自谁言，万古传闻为屈原。', '文秀《端午》', '路漫漫其修远兮——上下求索，本来就是梯度下降。')]],
  'L7-7': ['七夕', [Q('纤云弄巧，飞星传恨，银汉迢迢暗度。', '秦观《鹊桥仙》', '七夕快乐。')]],
  'L8-15': ['中秋', [Q('但愿人长久，千里共婵娟。', '苏轼《水调歌头》', '中秋快乐。今晚的训练，可以换成一通电话。'), Q('海上生明月，天涯共此时。', '张九龄《望月怀远》', '中秋快乐。')]],
  'L9-9': ['重阳', [Q('独在异乡为异客，每逢佳节倍思亲。', '王维《九月九日忆山东兄弟》', '重阳登高——今天也给家里打个电话吧。'), Q('待到重阳日，还来就菊花。', '孟浩然《过故人庄》')]],
  'eve': ['除夕', [Q('一年将尽夜，万里未归人。', '戴叔伦《除夜宿石头驿》', '除夕夜，关掉训练台，和家人吃顿饭。')]],
  // 公历
  '1-1': ['元旦', [Q('千门万户曈曈日，总把新桃换旧符。', '王安石《元日》', '新年快乐。今年的 loss 曲线，从这一步开始画。')]],
  '5-1': ['劳动节', [Q('谁知盘中餐，粒粒皆辛苦。', '李绅《悯农》', '劳动节快乐。休息也是训练计划的一部分。')]],
  '5-4': ['青年节', [Q('少年心事当拏云。', '李贺《致酒行》', '青年节快乐。')]],
  '9-10': ['教师节', [Q('随风潜入夜，润物细无声。', '杜甫《春夜喜雨》', '教师节快乐——谢谢每一位把你“预训练”好的老师。')]],
  '10-1': ['国庆', [Q('七天长假，也是一个完整的 epoch。', 'Epoch', '国庆快乐。训练可以慢一点，但别停。')]],
  '10-24': ['程序员节', [Q('2¹⁰ = 1024。愿你的代码一次跑通，loss 一路下降。', 'Epoch', '程序员节快乐。')]],
};

// 交节当天
const TERM_LINES = {
  立春: Q('律回岁晚冰霜少，春到人间草木知。', '张栻《立春偶成》'),
  清明: Q('梨花风起正清明，游子寻春半出城。', '吴惟信《苏堤清明即事》'),
  立秋: Q('睡起秋声无觅处，满阶梧叶月明中。', '刘翰《立秋》'),
  白露: Q('露从今夜白，月是故乡明。', '杜甫《月夜忆舍弟》', '早晚凉了，记得加衣。'),
  寒露: Q('袅袅凉风动，凄凄寒露零。', '白居易《池上》', '早晚凉了，记得加衣。'),
  霜降: Q('霜降水返壑，风落木归山。', '白居易《岁晚》'),
  冬至: Q('天时人事日相催，冬至阳生春又来。', '杜甫《小至》', '白昼从今天开始变长。'),
};

const SEASON = {
  spring: [
    Q('好雨知时节，当春乃发生。', '杜甫《春夜喜雨》'),
    Q('等闲识得东风面，万紫千红总是春。', '朱熹《春日》'),
    Q('竹外桃花三两枝，春江水暖鸭先知。', '苏轼《惠崇春江晚景》'),
  ],
  summer: [
    Q('小荷才露尖尖角，早有蜻蜓立上头。', '杨万里《小池》'),
    Q('接天莲叶无穷碧，映日荷花别样红。', '杨万里《晓出净慈寺送林子方》'),
    Q('绿树阴浓夏日长，楼台倒影入池塘。', '高骈《山亭夏日》'),
  ],
  autumn: [
    Q('自古逢秋悲寂寥，我言秋日胜春朝。', '刘禹锡《秋词》'),
    Q('晴空一鹤排云上，便引诗情到碧霄。', '刘禹锡《秋词》'),
    Q('停车坐爱枫林晚，霜叶红于二月花。', '杜牧《山行》'),
    Q('一年好景君须记，最是橙黄橘绿时。', '苏轼《赠刘景文》'),
  ],
  winter: [
    Q('忽如一夜春风来，千树万树梨花开。', '岑参《白雪歌送武判官归京》'),
    Q('晚来天欲雪，能饮一杯无？', '白居易《问刘十九》'),
    Q('纸上得来终觉浅，绝知此事要躬行。', '陆游《冬夜读书示子聿》', '读再多论文，也要亲手跑一遍。'),
  ],
};

// 学期节奏：[名称, 起 [月,日], 止 [月,日], 适用条件, 语料]
const SENIOR = (p) => ['大三', '大四', '研一', '研二', '研三'].includes(p.grade);
const ACADEMIC = [
  ['开学季', [2, 20], [3, 10], () => true, [Q('少年易老学难成，一寸光阴不可轻。', '朱熹《偶成》', '新学期，新 epoch。')]],
  ['春招季', [3, 1], [4, 30], (p) => SENIOR(p) && p.goal === 'job', [Q('长风破浪会有时，直挂云帆济沧海。', '李白《行路难·其一》', '春招进行中——每投一份简历，都是一次前向传播。')]],
  ['毕业季', [6, 1], [6, 30], (p) => ['大四', '研二', '研三'].includes(p.grade), [Q('莫愁前路无知己，天下谁人不识君。', '高适《别董大》', '毕业快乐。训练台会一直在这里。')]],
  ['期末季', [6, 10], [7, 10], () => true, [Q('书山有路勤为径，学海无涯苦作舟。', '韩愈（传）', '期末加油。考完记得把成绩记进数据集。')]],
  ['暑假', [7, 11], [8, 31], () => true, [Q('接天莲叶无穷碧，映日荷花别样红。', '杨万里《晓出净慈寺送林子方》', '暑假是最长的一个 epoch——适合做一个完整的项目。')]],
  ['开学季', [9, 1], [9, 15], () => true, [Q('少年易老学难成，一寸光阴不可轻。', '朱熹《偶成》', '新学期，新 epoch。')]],
  ['秋招季', [9, 1], [11, 30], (p) => SENIOR(p) && p.goal === 'job', [
    Q('长风破浪会有时，直挂云帆济沧海。', '李白《行路难·其一》', '秋招正酣——每投一份简历，都是一次前向传播。'),
    Q('莫愁前路无知己，天下谁人不识君。', '高适《别董大》', '秋招季：先把验证集分数刷上去。'),
  ]],
  ['考研季', [10, 1], [12, 31], (p) => ['grad', 'phd'].includes(p.goal) && ['大三', '大四'].includes(p.grade), [Q('宝剑锋从磨砺出，梅花香自苦寒来。', '《警世贤文》', '考研倒计时，稳住学习率。')]],
  ['期末季', [12, 20], [1, 20], () => true, [Q('书山有路勤为径，学海无涯苦作舟。', '韩愈（传）', '期末加油。考完记得把成绩记进数据集。')]],
  ['寒假', [1, 21], [2, 19], () => true, [Q('梅须逊雪三分白，雪却输梅一段香。', '卢梅坡《雪梅》', '寒假：慢下来，补一补理论。')]],
];
const inRange = (d, [m1, d1], [m2, d2]) => {
  const v = (d.getMonth() + 1) * 100 + d.getDate(), a = m1 * 100 + d1, b = m2 * 100 + d2;
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
};

// 训练状态——同一件事，换成诗来说
const STATE = {
  fresh: Q('千里之行，始于足下。', '《老子》', '你的第一个 epoch，从此刻开始。'),
  idle: (n) => Q('问渠那得清如许？为有源头活水来。', '朱熹《观书有感》', `已经 ${n} 天没有新样本了。记录一件小事，让梯度重新流动。`),
  night: [
    Q('星垂平野阔，月涌大江流。', '杜甫《旅夜书怀》', '夜深了。loss 不会因为熬夜降得更快——早点休息。'),
    Q('明月别枝惊鹊，清风半夜鸣蝉。', '辛弃疾《西江月·夜行黄沙道中》', '夜深了，明天的你会感谢现在去睡觉的你。'),
    Q('床前明月光，疑是地上霜。', '李白《静夜思》', '这么晚还在训练——存个 checkpoint，去睡吧。'),
    Q('月落乌啼霜满天，江枫渔火对愁眠。', '张继《枫桥夜泊》', '睡眠也是一种正则化。'),
  ],
  dawn: Q('盛年不重来，一日难再晨。', '陶渊明《杂诗》', '早起的一小时，是一整天里学习率最高的时候。'),
  down: (d) => Q('欲穷千里目，更上一层楼。', '王之涣《登鹳雀楼》', `上个 epoch loss ▼${d.toFixed(4)}，方向是对的。`),
  plateau: Q('山重水复疑无路，柳暗花明又一村。', '陆游《游山西村》', 'loss 进入了平台期——换个学习方式，或挑一个更难的项目。'),
  near: (f) => Q('会当凌绝顶，一览众山小。', '杜甫《望岳》', `拟合度 ${f}%，已接近收敛，可以开始投递了。`),
};

// 求学与训练：任何时候都合适
const GENERAL = [
  Q('路漫漫其修远兮，吾将上下而求索。', '屈原《离骚》', '上下求索——这本来就是梯度下降。'),
  Q('不积跬步，无以至千里；不积小流，无以成江海。', '荀子《劝学》', '每一个 step 都算数。'),
  Q('青，取之于蓝，而青于蓝。', '荀子《劝学》', '最早的知识蒸馏。'),
  Q('锲而不舍，金石可镂。', '荀子《劝学》'),
  Q('吾生也有涯，而知也无涯。', '《庄子·养生主》', '所以要挑梯度最大的方向学。'),
  Q('学而不思则罔，思而不学则殆。', '《论语·为政》'),
  Q('温故而知新，可以为师矣。', '《论语·为政》', '每个 epoch 末的复盘，就是温故。'),
  Q('工欲善其事，必先利其器。', '《论语·卫灵公》'),
  Q('博学之，审问之，慎思之，明辨之，笃行之。', '《礼记·中庸》'),
  Q('业精于勤，荒于嬉。', '韩愈《进学解》'),
  Q('没有完美的初始化，只有不断更新的权重。', 'Epoch'),
  Q('过拟合于课本，欠拟合于世界——今天去做点什么吧。', 'Epoch'),
  Q('别在局部最优里待太久，偶尔加一点噪声。', 'Epoch'),
  Q('学习率太高会发散，太低会停滞。今天，刚刚好。', 'Epoch'),
];

// 开场问候：随时段、星期轮换，避免每次都是“欢迎回来”
const HELLO = {
  深夜: ['夜猫子模式已开启，{n}', '还没睡呀，{n}？', '深夜还在训练，{n}？', '月亮都下班了，{n}', '夜深人静，最适合想清楚一件事，{n}', '凌晨的 GPU 和你都还醒着，{n}'],
  清晨: ['起得真早，{n}！', '晨间训练开始了，{n}', '早起的鸟儿有虫吃，{n}', '清晨的学习率最高，{n}', '天刚亮，{n}，先喝口水', '今天的第一个 step，{n}'],
  上午: ['早上好，{n}！', '上午好，{n}', '今天想学点什么，{n}？', '状态正好，{n}', '上午的脑子最清醒，{n}', '今天的 batch 已经备好了，{n}'],
  中午: ['午安，{n}', '吃过午饭了吗，{n}？', '午间小憩，还是跑一个 step，{n}？', '中午好，{n}，别忘了休息', '饭后十分钟，看一眼今天的任务？'],
  下午: ['下午好，{n}', '来杯咖啡，跑一个 epoch？', '下午茶时间到了，{n}', '下午容易犯困，{n}，挑件小事先做', '午后时光，{n}', '还剩半天，{n}，够推进一步了'],
  晚上: ['晚上好，{n}', '今晚想推进点什么，{n}？', '夜读时间，{n}', '忙完一天了，{n}', '今天的 loss 降了吗，{n}？', '晚上适合复盘，{n}'],
};
const HELLO_ANY = [
  '回来了，{n}！', '又见面了，{n}', '训练继续，{n}', '准备好下降了吗，{n}？', '梯度已就位，{n}', '欢迎回来，{n}！',
  'checkpoint 已恢复，{n}', '今天也往山谷走一步，{n}', '你的网络在等你，{n}', '树形图设计者在线，{n}', '一起把 loss 再压低一点，{n}',
  '今天打算做点什么，{n}？', '新的 step，新的可能，{n}', '数据集又该更新了吗，{n}？',
];
const HELLO_WEEK = {
  1: '新的一周，新的 batch，{n}', 2: '周二，节奏刚刚好，{n}', 3: '周三，本周过半，{n}', 4: '周四，再坚持一下，{n}',
  5: '周五了，{n}，给这周收个尾吧', 6: '周末也来训练，{n}？', 0: '周日，适合结束这个 epoch，{n}',
};

function timeOfDay(h) {
  return h < 5 ? '深夜' : h < 8 ? '清晨' : h < 11 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
}

/**
 * 挑一句应景的话。返回 { hello, helloKey, tag, pool }：pool[0] 为首选，其余供“换一句”轮换。
 * recent 是最近出现过的句子，首选会尽量避开它们。
 */
export function greeting(state, { now = new Date(), recent = [], lastHello = '' } = {}) {
  const p = state.profile || {};
  const name = p.name || '同学';
  const h = now.getHours();
  const isNew = Date.now() - (p.createdAt || 0) < 30 * 60000 && !(state.entries || []).length;
  const tags = [];
  let must = []; // 节日 > 深夜 > 交节日：一定作为首选
  const top = []; // 训练状态
  const mid = []; // 学期节奏、时段
  const low = []; // 季节、通用

  // 节日（除夕 = 明天是正月初一）
  const lunar = lunarOf(now);
  const tomorrow = lunarOf(new Date(now.getTime() + DAY));
  const fest = (tomorrow?.m === 1 && tomorrow.d === 1 && FESTIVALS.eve)
    || (lunar && FESTIVALS[`L${lunar.m}-${lunar.d}`])
    || FESTIVALS[`${now.getMonth() + 1}-${now.getDate()}`]
    || (now.getMonth() === 9 && now.getDate() <= 7 && FESTIVALS['10-1']);
  const term = solarTerm(now);
  if (fest) { tags.push(fest[0]); must = fest[1]; } else tags.push(term.today ? `今日${term.name}` : term.name);
  if (h < 5 || h >= 23) { if (!fest) must = STATE.night; } else if (h < 8) mid.push(STATE.dawn);
  if (!must.length && term.today && TERM_LINES[term.name]) must = [TERM_LINES[term.name]];

  // 训练状态
  const lastEvent = M.gainEvents(state).filter((e) => e.kind !== 'curriculum' && e.t <= Date.now()).at(-1);
  const idle = lastEvent ? Math.floor((Date.now() - lastEvent.t) / DAY) : 0;
  const role = M.roleById(state, state.target);
  const hist = role ? M.lossHistory(state) : [];
  if (isNew) top.push(STATE.fresh);
  else if (idle >= 7 && (state.entries || []).length) top.push(STATE.idle(idle));
  if (hist.length >= 3) {
    const fit = Math.round(M.fitOf(hist.at(-1).loss) * 100);
    const drop = hist.at(-3).loss - hist.at(-2).loss; // 上一个完整 epoch 的下降
    if (fit >= 80) top.push(STATE.near(fit));
    else if (drop > 0.008) top.push(STATE.down(drop));
    else if (hist.length >= 4 && Math.abs(hist.at(-4).loss - hist.at(-2).loss) <= 0.005) top.push(STATE.plateau);
  }

  // 学期节奏（同一天可能命中多个，比如九月初既是开学季也是秋招季）
  for (const [nm, a, b, ok, qs] of ACADEMIC) {
    if (inRange(now, a, b) && ok(p)) { if (!tags.includes(nm)) tags.push(nm); mid.push(...qs); }
  }
  const m = now.getMonth() + 1;
  low.push(...SEASON[m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'], ...GENERAL);
  tags.push(timeOfDay(h));

  // 首选：节日/深夜必选；否则依次从 状态 → 学期 → 季节通用 里挑一句最近没出现过的，
  // 学期类有四成概率让位给季节诗，免得整个秋招季每天都是同一句
  const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const unseen = (xs) => xs.filter((q) => !recent.includes(q.line));
  // 节日当天总是用节日诗；深夜、交节日的句子都看过了就让位给其他句子
  let first = must.length && (fest || unseen(must).length) ? pick(unseen(must).length ? unseen(must) : must) : null;
  for (const tier of Math.random() < 0.6 ? [top, mid, low] : [top, low, mid]) {
    if (first) break;
    if (unseen(tier).length) first = pick(unseen(tier));
  }
  first ||= pick(low);
  const seen = new Set([first.line]);
  const others = [...must, ...top, ...mid, ...low].filter((q) => !seen.has(q.line) && seen.add(q.line));
  const shuffled = others.map((q) => [Math.random(), q]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

  const hellos = isNew ? ['欢迎来到 Epoch，{n}！']
    : idle >= 7 ? ['好久不见，{n}！', '你回来了，{n}', '梯度等你好久了，{n}', '欢迎归队，{n}！']
    : [...HELLO[timeOfDay(h)], ...HELLO[timeOfDay(h)], ...HELLO_ANY, ...(HELLO_WEEK[now.getDay()] ? [HELLO_WEEK[now.getDay()], HELLO_WEEK[now.getDay()]] : [])];
  const fresh = hellos.filter((x) => x !== lastHello);
  const helloKey = pick(fresh.length ? fresh : hellos);

  return {
    hello: helloKey.replace('{n}', name),
    helloKey,
    tag: tags.join(' · '),
    pool: [first, ...shuffled],
  };
}
