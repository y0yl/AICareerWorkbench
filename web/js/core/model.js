// 训练引擎：把“经历”变成能力向量，再对目标岗位计算 loss / 拟合度 / 梯度 / 诊断。
import { SKILLS, SKILL, SKILL_IDS, ROLES, ROLE, ENTRY_TYPE, GOALS, PROJECTS } from './data.js';
import * as T from './testset.js';
import { curriculumEvents } from './plans.js';
import { logContext } from './planlog.js';

const DAY = 86400000;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const toTime = (d) => (typeof d === 'number' ? d : new Date(`${d}T00:00:00`).getTime());
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => localDay();

export function allRoles(state) {
  return [...ROLES, ...(state.customRoles || [])];
}
export function roleById(state, id) {
  return ROLE[id] || (state.customRoles || []).find((r) => r.id === id) || null;
}

/** 单个计划任务带来的能力增益（与投入时长相关）。 */
export function taskGain(task) {
  return clamp(0.08 + (Number(task.hours) || 8) * 0.012, 0.1, 0.5);
}

/** 所有带时间戳的增益事件：经历样本、完成的计划任务、实验里程碑。 */
export function gainEvents(state) {
  const ev = [];
  for (const e of state.entries || []) ev.push({ t: toTime(e.date), skills: e.skills || {}, hours: e.fromRun ? 0 : +e.hours || 0, kind: 'entry', ref: e });
  for (const ph of [...(state.plan?.phases || []), { tasks: state.archivedTasks || [] }]) {
    for (const t of ph.tasks) {
      if (t.done && SKILL[t.skill]) ev.push({ t: t.doneAt || Date.now(), skills: { [t.skill]: taskGain(t) }, hours: t.viaBatch ? 0 : +t.hours || 0, kind: 'task', ref: t });
    }
  }
  for (const run of state.runs || []) {
    const n = run.milestones.length || 1;
    run.milestones.forEach((m) => {
      if (!m.done) return;
      const skills = {};
      for (const [k, v] of Object.entries(run.skills || {})) skills[k] = v / n;
      ev.push({ t: m.doneAt || Date.now(), skills, hours: m.viaBatch ? 0 : (run.weeks || 2) * 6 / n, kind: 'run', ref: run });
    });
  }
  // 本周 batch 与历史 batch 中完成的任务（计划 / 实验类任务 gain 为 0，只计时长，增益由其父任务计入）
  for (const t of [...(state.batch?.tasks || []), ...(state.batchLog || [])]) {
    if (!(t.done ?? !!t.doneAt)) continue; // batchLog 里只存已完成的任务（无 done 字段）
    ev.push({ t: t.doneAt || Date.now(), skills: t.gain > 0 && SKILL[t.skill] ? { [t.skill]: t.gain } : {}, hours: +t.hours || 0, kind: 'batch', ref: t });
  }
  ev.push(...curriculumEvents(state));
  return ev.sort((a, b) => a.t - b.t);
}

/** t 时刻的能力向量（默认此刻；未来学期的课程不计入）。增益有边际递减：越接近满级越难提升。 */
export function skillsAt(state, t = Date.now(), events = gainEvents(state)) {
  const G = Object.fromEntries(SKILL_IDS.map((id) => [id, 0]));
  for (const e of events) {
    if (e.t > t) break;
    for (const [k, v] of Object.entries(e.skills)) if (k in G) G[k] += Number(v) || 0;
  }
  const S = {};
  for (const id of SKILL_IDS) {
    const base = clamp(Number(state.baseSkills?.[id]) || 0, 0, 5);
    S[id] = base + (5 - base) * (1 - Math.exp(-G[id] / 2.5));
  }
  return S;
}

/** 加权平方差损失，权重 = 岗位要求/5；只惩罚“不足”，不惩罚“超出”。 */
export function lossOf(S, role) {
  let num = 0, den = 0;
  for (const id of SKILL_IDS) {
    const R = role.req[id] || 0;
    if (!R) continue;
    const w = R / 5;
    const gap = Math.max(0, R - S[id]);
    num += w * gap * gap;
    den += w * R * R;
  }
  return den ? num / den : 0;
}
export const fitOf = (loss) => 1 - Math.sqrt(loss);

/** 负梯度方向：每个能力 +step 能带来的 loss 下降量。 */
export function gradient(S, role, step = 0.5) {
  const base = lossOf(S, role);
  return SKILLS.map((s) => {
    const S2 = { ...S, [s.id]: Math.min(5, S[s.id] + step) };
    return { id: s.id, skill: s, gap: Math.max(0, (role.req[s.id] || 0) - S[s.id]), delta: base - lossOf(S2, role) };
  })
    .filter((g) => g.delta > 1e-5)
    .sort((a, b) => b.delta - a.delta);
}

export function rankRoles(state, S) {
  return allRoles(state)
    .map((r) => {
      const loss = lossOf(S, r);
      return { role: r, loss, fit: fitOf(loss) };
    })
    .sort((a, b) => a.loss - b.loss);
}

// ---------- epoch / 时间线 ----------

export function epochInfo(state) {
  const reviews = [...(state.reviews || [])].sort((a, b) => a.t - b.t);
  const start = reviews.length ? reviews[reviews.length - 1].t : state.profile?.createdAt || Date.now();
  return { epoch: reviews.length + 1, reviews, start, days: Math.floor((Date.now() - start) / DAY) };
}

export function globalStep(state) {
  let n = (state.entries || []).length + (state.archivedTasks || []).length + (state.batchLog || []).length + (state.batch?.tasks || []).filter((t) => t.done).length;
  for (const ph of state.plan?.phases || []) n += ph.tasks.filter((t) => t.done).length;
  for (const r of state.runs || []) n += r.milestones.filter((m) => m.done).length;
  return n;
}

/** 每个 epoch 末的 loss 曲线（含初始化点与当前实时点）。 */
export function lossHistory(state, roleId = state.target) {
  const role = roleById(state, roleId);
  if (!role) return [];
  const events = gainEvents(state);
  const { reviews } = epochInfo(state);
  const created = state.profile?.createdAt || Date.now();
  const pts = [{ epoch: 0, t: created, loss: lossOf(skillsAt(state, created, events), role) }];
  reviews.forEach((r, i) => pts.push({ epoch: i + 1, t: r.t, loss: lossOf(skillsAt(state, r.t, events), role) }));
  pts.push({ epoch: reviews.length + 1, t: Date.now(), loss: lossOf(skillsAt(state, Date.now(), events), role), live: true });
  return pts;
}

export function hoursSince(state, since) {
  return gainEvents(state).filter((e) => e.t >= since).reduce((s, e) => s + (e.hours || 0), 0);
}

/** 每日投入时长（用于“注意力热力图”）。 */
export function dailyHours(state, days = 140) {
  const map = new Map();
  const from = Date.now() - days * DAY;
  for (const e of gainEvents(state)) {
    if (e.t < from) continue;
    const key = localDay(new Date(e.t));
    map.set(key, (map.get(key) || 0) + (e.hours || 0));
  }
  return map;
}

// ---------- 地形图位置 ----------

export function rolePos(state, role) {
  if (role.pos) return role.pos;
  // 自定义岗位：按能力向量相似度对内置岗位位置加权
  const sims = ROLES.map((r) => {
    let dot = 0, a = 0, b = 0;
    for (const id of SKILL_IDS) { dot += r.req[id] * role.req[id]; a += r.req[id] ** 2; b += role.req[id] ** 2; }
    return Math.exp(8 * (dot / Math.sqrt(a * b || 1)));
  });
  const z = sims.reduce((s, v) => s + v, 0);
  return [0, 1].map((k) => ROLES.reduce((s, r, i) => s + r.pos[k] * sims[i], 0) / z);
}

export const START_POS = [0.5, 0.97];

export function positionFor(state, S) {
  const ranked = allRoles(state).map((r) => ({ r, l: lossOf(S, r) }));
  const min = Math.min(...ranked.map((x) => x.l));
  const ws = ranked.map((x) => Math.exp(-14 * (x.l - min)));
  const z = ws.reduce((s, v) => s + v, 0);
  const p = [0, 1].map((k) => ranked.reduce((s, x, i) => s + rolePos(state, x.r)[k] * ws[i], 0) / z);
  const lam = clamp((min - 0.04) / 0.55, 0, 0.88);
  return [p[0] + (START_POS[0] - p[0]) * lam, p[1] + (START_POS[1] - p[1]) * lam];
}

export function trajectory(state) {
  const events = gainEvents(state);
  return lossHistory(state).map((pt) => positionFor(state, skillsAt(state, pt.live ? Date.now() : pt.t, events)));
}

// ---------- 验证集校准（泛化差距） ----------
// 训练集上的能力估计来自自评 + 经历样本，可能“只在训练集上好看”。模拟面试的逐题得分是独立的验证信号：
// 按题目考察的能力维度累计，换算成“面试体现出的水平” m，再按证据量收缩到训练估计上：Ŝ = S + c·(m − S)。

const SKILL_HINTS = [
  ['llm', /大模型|LLM|Transformer|自注意力|注意力机制|RAG|Agent|微调|LoRA|RLHF|DPO|对齐|提示词|Prompt|NLP|分词|Token|KV ?Cache|预训练|幻觉/i],
  ['rl', /强化学习|\bRL\b|PPO|DQN|策略梯度|奖励|机器人|具身|ROS|Sim2Real|模仿学习|运动控制|MDP/i],
  ['cv', /视觉|图像|目标检测|分割|CNN|卷积|ViT|多模态|扩散|生成模型|YOLO|点云|3D/i],
  ['infra', /CUDA|GPU|部署|推理加速|分布式|Docker|Linux|量化|显存|吞吐|并行|算子|vLLM|系统设计|操作系统|高并发/i],
  ['data', /SQL|数据清洗|数据管线|pandas|ETL|指标体系|可视化|A\/B|数据分析|埋点/i],
  ['math', /数学|概率|统计|线性代数|矩阵|求导|推导|凸优化|贝叶斯|信息论|特征值/i],
  ['ml', /机器学习|过拟合|正则|偏差|方差|决策树|XGBoost|GBDT|SVM|特征工程|评估指标|交叉验证|聚类|逻辑回归|AUC/i],
  ['dl', /深度学习|神经网络|反向传播|BatchNorm|LayerNorm|归一化|梯度消失|PyTorch|残差|Dropout|优化器|学习率|初始化/i],
  ['code', /算法题|编程|代码|数据结构|复杂度|链表|排序|动态规划|二叉树|C\+\+|Python|LeetCode|手写|手撕/i],
  ['research', /论文|科研|研究|实验设计|创新点|消融|顶会|复现/i],
  ['product', /产品|需求|用户|商业|场景|PRD|竞品|增长/i],
  ['comm', /沟通|协作|团队|冲突|自我介绍|职业规划|为什么选择|优缺点|压力|表达|领导|动机/i],
];
/** 从题目 / 考察点文字推断能力维度（用于没有标注维度的题目）。 */
export function skillOfText(text, fallback = null) {
  for (const [id, re] of SKILL_HINTS) if (re.test(String(text || ''))) return id;
  return fallback;
}
const VAL_HALF = 90 * DAY; // 证据的时间衰减尺度
const VAL_PRIOR = 3; // 证据量达到 3 道“新题”时，验证信号占一半

/**
 * 逐题验证证据：{ skill, level, t }。面试是按应届生标准出题的，得分换算成能力等级：
 * 6 分（合格）≈ 2.5，8 分（优秀）≈ 3.5，10 分 ≈ 4.5；岗位对该能力要求越高，题目越难，同样得分对应的水平略高。
 */
export function valEvidence(state) {
  const out = [];
  for (const iv of state.interviews || []) {
    if (!iv.report) continue;
    const role = roleById(state, iv.roleId);
    const fb = iv.kind === 'hr' ? 'comm' : null;
    for (const x of iv.qa || []) {
      if (!x.eval) continue;
      const skill = SKILL[x.skill] ? x.skill : skillOfText(`${x.focus || ''} ${x.q || ''}`, fb);
      if (!skill) continue;
      const sc = +x.eval.score || 0;
      out.push({ skill, level: clamp(0.5 * sc - 0.5 + 0.15 * ((role?.req?.[skill] ?? 3) - 3), 0, 5), score: sc, t: iv.t });
    }
  }
  return out;
}

/** 用 t 时刻之前的验证证据校准能力向量。返回 { S: 校准后, per: { id: { m, n, c, gap } } }。 */
export function calibrate(state, S, t = Date.now(), evidence = valEvidence(state)) {
  const acc = {};
  for (const e of evidence) {
    if (e.t > t) continue;
    const w = Math.exp(-(t - e.t) / VAL_HALF);
    const a = (acc[e.skill] ||= { w: 0, sum: 0, n: 0 });
    a.w += w; a.sum += w * e.level; a.n++;
  }
  const out = { ...S };
  const per = {};
  for (const [id, a] of Object.entries(acc)) {
    const m = a.sum / a.w;
    const c = a.w / (a.w + VAL_PRIOR);
    out[id] = clamp(S[id] + c * (m - S[id]), 0, 5);
    per[id] = { m, n: a.n, c, gap: S[id] - m };
  }
  return { S: out, per };
}

/** 规划用的能力向量：开启“验证集校准”时（默认）用校准值，让梯度与 batch 针对真实短板。 */
export function planningSkills(state, S = skillsAt(state)) {
  return state.profile?.valCalib === false ? S : calibrate(state, S).S;
}

/** 验证 loss 曲线：每个 epoch 末用当时已有的面试证据校准后的 loss；没有任何证据之前不画点。 */
export function valHistory(state, roleId = state.target) {
  const role = roleById(state, roleId);
  const ev = valEvidence(state);
  if (!role || !ev.length) return [];
  const first = Math.min(...ev.map((e) => e.t));
  const events = gainEvents(state);
  return lossHistory(state, roleId)
    .filter((p) => (p.live ? Date.now() : p.t) >= first)
    .map((p) => {
      const t = p.live ? Date.now() : p.t;
      return { ...p, loss: lossOf(calibrate(state, skillsAt(state, t, events), t, ev).S, role) };
    });
}

/** 泛化差距汇总：训练 loss、验证 loss、差距最大的能力。 */
export function generalization(state) {
  const role = roleById(state, state.target);
  const S = skillsAt(state);
  const { S: V, per } = calibrate(state, S);
  const items = Object.entries(per).map(([id, x]) => ({ id, skill: SKILL[id], S: S[id], ...x })).sort((a, b) => b.gap * b.c - a.gap * a.c);
  const train = role ? lossOf(S, role) : null;
  const val = role && items.length ? lossOf(V, role) : null;
  return { train, val, gap: val != null ? val - train : null, items, V };
}

// ---------- 自适应 batch（真正的 AdamW） ----------
// 参数 θ = log(工作量系数)。每结束一轮，把“batch 完成率 − 目标 80%”当作梯度，用 Adam 的一阶 / 二阶矩做归一化步长：
// 连续完成不了就缩小 batch，稳定超额完成就适当放大，波动大时步子迈小一点；权重衰减让 θ 逐渐回到 0（系数回到 ×1），
// 一次糟糕的考试周不会永久压低之后的工作量。
export const ADAPT = { target: 0.8, lr: 0.2, b1: 0.6, b2: 0.85, eps: 0.12, decay: 0.3, min: 0.55, max: 1.3 };
export function adaptiveBatch(state) {
  const rates = (state.reviews || []).map((r) => r.batch?.rate).filter((r) => r != null);
  let th = 0, m = 0, v = 0;
  rates.forEach((r, i) => {
    const g = r - ADAPT.target;
    m = ADAPT.b1 * m + (1 - ADAPT.b1) * g;
    v = ADAPT.b2 * v + (1 - ADAPT.b2) * g * g;
    const mh = m / (1 - ADAPT.b1 ** (i + 1));
    const vh = v / (1 - ADAPT.b2 ** (i + 1));
    th = (1 - ADAPT.decay) * th + (ADAPT.lr * mh) / (Math.sqrt(vh) + ADAPT.eps);
  });
  const f = clamp(Math.exp(th), ADAPT.min, ADAPT.max);
  const on = state.profile?.adaptiveBatch !== false;
  const budget = Math.max(3, +state.profile?.hoursPerWeek || 10);
  return { on, factor: on ? f : 1, raw: f, m, v, rates: rates.slice(-4), budget, hours: Math.max(3, Math.round(budget * (on ? f : 1) * 2) / 2) };
}

// ---------- 诊断（训练日志） ----------

export function diagnostics(state) {
  const out = [];
  const role = roleById(state, state.target);
  const entries = state.entries || [];
  const hist = lossHistory(state);
  const { days, epoch } = epochInfo(state);
  const lastEvent = gainEvents(state).filter((e) => e.kind !== 'curriculum' && e.t <= Date.now()).at(-1);
  const idle = lastEvent ? Math.floor((Date.now() - lastEvent.t) / DAY) : 999;

  if (!role) out.push({ level: 'warn', code: 'objective_unset', msg: '尚未设定目标函数，梯度方向不明确。前往「目标函数」选择一个岗位。' });
  if (idle >= 14) out.push({ level: 'warn', code: 'vanishing_gradient', msg: `已 ${idle} 天没有新的训练样本，梯度正在消失。哪怕只记录一件小事也好。` });

  const practice = entries.filter((e) => ENTRY_TYPE[e.type]?.practice).length;
  if (entries.length >= 4) {
    const ratio = 1 - practice / entries.length;
    if (ratio >= 0.7) out.push({ level: 'warn', code: 'overfitting', msg: `理论类样本占比 ${Math.round(ratio * 100)}%，存在“过拟合于课本”风险，建议增加项目/竞赛等实践样本。` });
    else if (practice / entries.length >= 0.85) out.push({ level: 'info', code: 'low_theory', msg: '实践样本充足，但理论样本偏少，注意补齐原理，避免“只会调包”。' });
  } else {
    out.push({ level: 'info', code: 'underfitting', msg: `数据集仅 ${entries.length} 个样本，模型处于欠拟合状态。记录你的课程、项目与竞赛经历吧。` });
  }

  if (hist.length >= 4) {
    const last = hist.slice(-4).map((p) => p.loss);
    const drop = last[0] - last[3];
    if (drop > 0.015) out.push({ level: 'ok', code: 'converging', msg: `最近 3 个 epoch loss 下降 ${drop.toFixed(3)}，训练正在稳定收敛。` });
    else if (Math.abs(drop) <= 0.005) out.push({ level: 'warn', code: 'plateau', msg: '最近 3 个 epoch loss 几乎不变，进入平台期。试试换一种学习方式，或挑战一个更难的项目。' });
  }

  const budget = Number(state.profile?.hoursPerWeek) || 10;
  const recent = hoursSince(state, Date.now() - 7 * DAY);
  if (recent > budget * 1.6) out.push({ level: 'warn', code: 'lr_too_high', msg: `近 7 天投入 ${Math.round(recent)} 小时，远超预算 ${budget} 小时。学习率过高容易发散，注意休息。` });

  if (days >= 9) out.push({ level: 'info', code: 'epoch_due', msg: `本轮 epoch 已持续 ${days} 天，记得「结束本轮 Epoch」做一次复盘。` });

  const rates = (state.reviews || []).map((r) => r.batch?.rate).filter((r) => r != null);
  if (rates.length >= 2 && rates.slice(-2).every((r) => r < 0.5)) {
    out.push({ level: 'warn', code: 'batch_too_large', msg: `连续两轮 batch 完成率低于 50%（${rates.slice(-2).map((r) => Math.round(r * 100) + '%').join('、')}）。batch 太大会让训练不稳定：把每周可投入时间调低，或减少任务。` });
  } else if (rates.length >= 2 && rates.slice(-2).every((r) => r >= 0.85)) {
    out.push({ level: 'ok', code: 'batch_stable', msg: `连续两轮 batch 完成率 ≥ 85%，可以适当加大 batch（提高每周投入或挑战更难的任务）。` });
  }

  const lastVal = (state.interviews || []).filter((i) => i.report).at(-1);
  const S = skillsAt(state);
  if (role && fitOf(lossOf(S, role)) > 0.55 && (!lastVal || Date.now() - lastVal.t > 30 * DAY)) {
    out.push({ level: 'info', code: 'need_validation', msg: '拟合度已过 55%，但近 30 天没有验证集评估。去做一次模拟面试，检验是否只在训练集上表现好。' });
  }
  if (role && fitOf(lossOf(S, role)) > 0.82) out.push({ level: 'ok', code: 'early_stop', msg: (state.applications || []).length ? '已接近收敛，继续在测试集（真实投递）上检验。' : '已接近收敛！可以开始投递 / 申请，在「验证集 → 测试集」记录真实投递的每一步。' });
  if (role) {
    const gen = generalization(state);
    for (const x of gen.items.filter((i) => i.c >= 0.3 && i.gap >= 0.8).slice(0, 2)) {
      out.push({ level: 'warn', code: 'overfit_skill', msg: `「${x.skill.name}」训练集估计 ${x.S.toFixed(1)}，但验证集（${x.n} 道面试题）只体现出 ${x.m.toFixed(1)}：存在泛化差距。用错题本里的题倒逼复习，比再刷样本更有效。` });
    }
    const under = gen.items.find((i) => i.c >= 0.3 && i.gap <= -0.8);
    if (under) out.push({ level: 'info', code: 'underestimated', msg: `「${under.skill.name}」面试表现（${under.m.toFixed(1)}）明显高于训练集估计（${under.S.toFixed(1)}），可能低估了自己，可在「设置」上调初始权重。` });
    if (gen.gap != null && gen.gap > 0.03) out.push({ level: 'warn', code: 'generalization_gap', msg: `验证 loss ${gen.val.toFixed(4)} 比训练 loss 高 ${gen.gap.toFixed(4)}：纸面能力还没转化成面试表现。` });
  }
  const due = T.dueHard(state).length;
  if (due >= 3) out.push({ level: 'info', code: 'hard_examples_due', msg: `错题本有 ${due} 道题到期复测（难例挖掘）。去「验证集 → 错题复测」花 15 分钟过一遍。` });
  const rej = T.rejectionStats(state);
  if (rej.top && rej.top.n >= 2) out.push({ level: 'warn', code: 'test_failure_mode', msg: `测试集里有 ${rej.top.n} 次被拒的原因都是「${rej.top.name}」——这是真实世界给出的梯度，优先补这一项。` });
  if (!out.some((d) => d.level === 'warn')) out.push({ level: 'ok', code: 'healthy', msg: `epoch ${epoch} 训练状态健康，保持当前学习率。` });
  return out;
}

// ---------- 推荐 ----------

const INTEREST_ROLES = {
  llm: ['llm_algo', 'ai_app'], agent: ['ai_app', 'ai_pm'], cv: ['cv_algo'], robot: ['embodied'],
  infra: ['ai_infra'], research: ['researcher'], product: ['ai_pm', 'ai_app'], data: ['data_sci', 'quant', 'rec_algo'],
  game: ['cv_algo', 'ai_app'],
};

export function recommendRoles(state, S = skillsAt(state)) {
  const bonus = {};
  for (const i of state.profile?.interests || []) for (const r of INTEREST_ROLES[i] || []) bonus[r] = (bonus[r] || 0) + 0.12;
  const goal = state.profile?.goal;
  if (goal === 'phd' || goal === 'abroad') bonus.researcher = (bonus.researcher || 0) + 0.1;
  if (goal === 'startup') { bonus.ai_app = (bonus.ai_app || 0) + 0.08; bonus.ai_pm = (bonus.ai_pm || 0) + 0.08; }
  return ROLES.map((r) => {
    const fit = fitOf(lossOf(S, r));
    return { role: r, fit, score: fit + (bonus[r.id] || 0) };
  }).sort((a, b) => b.score - a.score);
}

export function recommendProjects(state, S = skillsAt(state)) {
  const role = roleById(state, state.target);
  if (!role) return PROJECTS.slice(0, 6);
  const grad = Object.fromEntries(gradient(S, role).map((g) => [g.id, g.delta]));
  const taken = new Set((state.runs || []).map((r) => r.projectId));
  const avg = SKILL_IDS.reduce((s, id) => s + S[id], 0) / SKILL_IDS.length;
  return PROJECTS.filter((p) => !taken.has(p.id))
    .map((p) => {
      let v = 0;
      for (const [k, g] of Object.entries(p.skills)) v += (grad[k] || 0) * g;
      const levelFit = 1 - Math.abs(p.level - clamp(avg - 0.3, 1, 3)) * 0.25;
      return { project: p, value: v * levelFit };
    })
    .sort((a, b) => b.value - a.value);
}

// ---------- AI 上下文 ----------

/** 计划任务的短编号 P1、P2…（按计划顺序，含已完成），供 AI 引用。 */
export function planTaskByRef(state, ref) {
  const m = /^P(\d+)$/i.exec(String(ref || '').trim());
  return m ? (state.plan?.phases || []).flatMap((ph) => ph.tasks)[+m[1] - 1] || null : null;
}

export function aiContext(state) {
  const S = skillsAt(state);
  const role = roleById(state, state.target);
  const p = state.profile || {};
  const goal = GOALS.find((g) => g.id === p.goal)?.name || '未填写';
  const lines = [
    `姓名：${p.name || '同学'}；年级：${p.grade || '未知'}；专业：${p.major || '人工智能'}；${p.school ? `学校：${p.school}；` : ''}发展意向：${goal}；每周可投入：${p.hoursPerWeek || 10} 小时`,
  ];
  let meta = { name: p.name, grade: p.grade, gaps: [], strengths: [] };
  if (role) {
    const loss = lossOf(S, role);
    lines.push(`目标岗位：${role.name}（拟合度 ${Math.round(fitOf(loss) * 100)}%，loss ${loss.toFixed(3)}）`);
    lines.push('能力向量（当前/目标要求，0-5）：' + SKILLS.map((s) => `${s.name} ${S[s.id].toFixed(1)}/${role.req[s.id] || 0}`).join('，'));
    const g = gradient(planningSkills(state, S), role).slice(0, 4);
    lines.push('梯度最大的短板：' + g.map((x) => `${x.skill.name}（差距 ${x.gap.toFixed(1)}）`).join('、'));
    meta = { ...meta, target: role.name, match: `${Math.round(fitOf(loss) * 100)}%`, gaps: g.map((x) => ({ id: x.id, name: x.skill.name, gap: +x.gap.toFixed(2) })) };
  } else {
    lines.push('能力向量（0-5）：' + SKILLS.map((s) => `${s.name} ${S[s.id].toFixed(1)}`).join('，'));
  }
  const gapIds = new Set(meta.gaps.slice(0, 3).map((g) => g.id));
  meta.strengths = SKILLS.filter((s) => S[s.id] >= 2.5 && !gapIds.has(s.id)).sort((a, b) => S[b.id] - S[a.id]).slice(0, 3).map((s) => s.name);
  if (meta.strengths.length) lines.push(`相对优势：${meta.strengths.join('、')}`);
  const entries = [...(state.entries || [])].sort((a, b) => toTime(b.date) - toTime(a.date)).slice(0, 10);
  if (entries.length) lines.push('近期经历：' + entries.map((e) => `[${ENTRY_TYPE[e.type]?.name || '其他'}] ${e.title}`).join('；'));
  const tasks = (state.plan?.phases || []).flatMap((ph) => ph.tasks);
  if (tasks.length) {
    lines.push(`训练计划进度：${tasks.filter((t) => t.done).length}/${tasks.length} 个任务已完成`);
    const ref = new Map(tasks.map((t, i) => [t, `P${i + 1}`]));
    lines.push('训练计划阶段与未完成任务（[编号] 任务，剩余小时）：' + state.plan.phases.map((ph) => `${ph.name}(${ph.stage})：${ph.tasks.filter((t) => !t.done).map((t) => `[${ref.get(t)}] ${t.title}（剩 ${Math.max(0.5, (+t.hours || 0) - (+t.progressH || 0))}h）`).join('、') || '已全部完成'}`).join('；'));
  } else lines.push('训练计划：尚未创建');
  const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  lines.push(`今天：${WD[(new Date().getDay() + 6) % 7]}`);
  const b = state.batch;
  if (b) {
    const md = (t) => `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
    const di = Math.floor((Date.now() - b.weekStart) / 86400000);
    const when = di > 6 ? '已过期，等待结束本轮 Epoch' : di < 0 ? '下周的 batch，尚未开始' : '进行中';
    lines.push(`本周 batch（${md(b.weekStart)}–${md(b.weekStart + 6 * 86400000)}，${when}；[编号] 星期 任务 小时）：` + (b.tasks.map((t, i) => `${t.done || t.src === 'ritual' ? '' : `[B${i + 1}] `}${WD[t.day] || ''} ${t.title} ${t.hours}h${t.done ? '（已完成）' : ''}${t.carried ? `（已顺延 ${t.carried} 次）` : ''}`).join('；') || '空'));
  }
  if (b) meta.batch = b.tasks.map((t, i) => ({ ref: `B${i + 1}`, title: t.title, day: t.day, hours: t.hours, open: !t.done && t.src !== 'ritual' })).filter((t) => t.open);
  const q = state.batchQueue || [];
  if (q.length) lines.push('已预排到下一个 batch 的任务：' + q.map((t) => `${WD[t.day] || ''} ${t.title}`).join('；'));
  const runs = (state.runs || []).map((r) => `${r.title}（${r.milestones.filter((m) => m.done).length}/${r.milestones.length}）`);
  if (runs.length) lines.push('实践项目：' + runs.join('；'));
  const lastIv = (state.interviews || []).filter((i) => i.report).at(-1);
  if (lastIv) lines.push(`最近模拟面试：${lastIv.roleName} ${lastIv.report.overall} 分`);
  const gen = role ? generalization(state) : null;
  if (gen?.items.length) lines.push('验证集校准（面试体现水平 vs 训练集估计）：' + gen.items.slice(0, 5).map((x) => `${x.skill.name} ${x.m.toFixed(1)} vs ${x.S.toFixed(1)}（${x.n} 题）`).join('，') + (gen.gap != null ? `；验证 loss ${gen.val.toFixed(3)}，训练 loss ${gen.train.toFixed(3)}` : ''));
  const hard = T.dueHard(state);
  if ((state.hardQs || []).length) lines.push(`错题本：${(state.hardQs || []).filter((h) => !h.mastered).length} 道未掌握，${hard.length} 道到期；例：${hard.slice(0, 3).map((h) => h.q.slice(0, 30)).join('；') || '无'}`);
  const tctx = T.testContext(state);
  if (tctx) lines.push(tctx);
  const ad = adaptiveBatch(state);
  if (ad.on && ad.rates.length) lines.push(`自适应 batch：近几轮完成率 ${ad.rates.map((r) => Math.round(r * 100) + '%').join('/')}，本周工作量系数 ×${ad.factor.toFixed(2)}（约 ${ad.hours}h）`);
  const mem = (state.memory || []).slice(-12);
  if (mem.length) lines.push('导师长期记忆（学生之前告诉过你的稳定信息）：' + mem.map((m) => m.text).join('；'));
  lines.push('可设定的目标岗位（id:名称）：' + allRoles(state).map((r) => `${r.id}:${r.name}`).join('，'));
  const changes = logContext(state.planLog);
  if (changes) lines.push(changes);
  const diag = diagnostics(state).filter((d) => d.level === 'warn').map((d) => d.code);
  if (diag.length) lines.push('训练诊断：' + diag.join('，'));
  lines.push(`当前 epoch：${epochInfo(state).epoch}`);
  return { context: lines.join('\n'), meta };
}
