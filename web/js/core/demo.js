// 示例训练：一位 AI 专业大三学生“林间”的 14 个 epoch。
import { emptyState, uid } from './store.js';
import { PROJECTS } from './data.js';
import { localDay } from './model.js';
import { planById, PLANS, gradeFromPlan } from './plans.js';
import { generateBatch, mondayOf, dayIndex, toggleTask } from './batch.js';

const DAY = 86400000;

export function demoState() {
  const now = Date.now();
  const created = now - 102 * DAY;
  const d = (daysAfter) => localDay(new Date(created + daysAfter * DAY));
  const t = (daysAfter) => created + daysAfter * DAY + 20 * 3600000;

  const s = emptyState({
    name: '林间', school: '', grade: '大三', major: '人工智能', goal: 'job', hoursPerWeek: 14,
    interests: ['llm', 'agent', 'infra'], createdAt: created,
  });
  s.baseSkills = { math: 2, code: 2, ml: 1.5, dl: 1, llm: 0.5, cv: 1, rl: 0, data: 1, infra: 0.5, research: 0.5, product: 1, comm: 1.5 };
  s.target = 'llm_algo';
  // 培养方案：选“此刻读大三”的那一届（示例方案），方案设定在暑假之后，之前的课程视为已计入初始权重
  const d0 = new Date(now);
  const ay = d0.getMonth() >= 7 ? d0.getFullYear() : d0.getFullYear() - 1;
  const plan = planById(`sample-${ay - 2}-std`) || PLANS.find((p) => p.id.endsWith('-std'));
  if (plan) {
    s.curriculum = { planId: plan.id, since: created + 15 * DAY, skip: [], electives: [] };
    s.profile.school = plan.school;
    s.profile.grade = gradeFromPlan(plan, now);
  }

  const E = (day, type, title, hours, skills, desc = '') => ({ id: uid('e'), type, title, date: d(day), hours, skills, desc });
  s.entries = [
    E(3, 'course', '模式识别与机器学习（专业核心课，92 分）', 48, { ml: 0.7, math: 0.3 }, '系统学习了线性模型、SVM、决策树、集成学习与聚类，完成 4 次编程作业。'),
    E(9, 'reading', '3Blue1Brown 线性代数 + CS109 概率复习', 14, { math: 0.45 }),
    E(15, 'course', '《动手学深度学习》前 10 章', 36, { dl: 0.8, code: 0.2 }, '跟着 d2l 敲完 CNN、RNN、注意力机制章节的全部代码。'),
    E(19, 'reading', '精读 Attention Is All You Need', 8, { llm: 0.3, research: 0.25 }),
    E(24, 'project', '课程项目：YOLO 校园垃圾分类检测', 30, { cv: 0.6, dl: 0.3, data: 0.2 }, '4 人小组，负责数据标注规范与训练调参，mAP50 从 0.61 提升到 0.78。'),
    E(31, 'competition', '全国大学生数学建模竞赛 · 省二', 72, { math: 0.5, data: 0.4, comm: 0.35 }),
    E(38, 'project', '复现 nanoGPT 并在中文小说语料上训练', 40, { dl: 0.5, llm: 0.65, code: 0.35 }, '实现 BPE 分词、训练 10M 参数模型并做层数/头数消融。'),
    E(45, 'other', 'LeetCode Hot 100 完成 72 题', 40, { code: 0.65 }),
    E(53, 'reading', 'LoRA / QLoRA 论文与源码阅读', 10, { llm: 0.35, research: 0.2 }),
    E(60, 'project', 'RAG 校园问答助手（开源大模型 + FAISS）', 36, { llm: 0.55, code: 0.4, product: 0.3 }, '构建 60 条评测集，引入重排后答案准确率从 58% 提升到 74%。'),
    E(66, 'course', 'Stanford CS336 前 6 讲', 24, { llm: 0.45, infra: 0.25 }),
    E(74, 'other', 'Docker + Linux 服务器部署实战', 12, { infra: 0.45 }),
    E(80, 'other', 'AI 社团技术分享：从 0 理解 Transformer', 8, { comm: 0.45 }),
    E(88, 'project', '向开源项目提交文档与 bug 修复 PR（已合并）', 14, { code: 0.3, comm: 0.2 }),
    E(95, 'reading', 'DeepSeek / Qwen 技术报告精读', 9, { llm: 0.3, research: 0.25 }),
    E(100, 'project', '实验室课题：中文指令数据自动清洗流水线', 6, { data: 0.35, llm: 0.2, research: 0.15 }, '加入导师课题组，负责数据去重与质量打分模块。'),
  ];

  const moods = ['平稳', '良好', '高能', '良好', '平稳', '低迷', '良好', '高能', '良好', '平稳', '良好', '高能', '良好', '良好'];
  const hours = [11, 13, 15, 12, 16, 9, 14, 17, 13, 12, 15, 18, 14, 13];
  const notes = [
    '确定了大模型方向，先把 ML 基础补起来。', '数学复习比想象中慢，概率部分还要再看。', '深度学习开窍的一周，自己写出了注意力。',
    '读第一篇论文很吃力，但读完很爽。', '小组项目推进顺利，学会了调参的耐心。', '建模比赛很累，这周几乎没碰别的。',
    '开始 nanoGPT，loss 降下来的那一刻很激动。', '刷题节奏不错，每天 3 题。', '读 LoRA 源码，理解了低秩分解。',
    'RAG 项目做了评测集，第一次体会到评测的重要性。', 'CS336 难度很大，作业还没做完。', '把项目部署到了服务器上，同学都能用了。',
    '第一次在社团做技术分享，紧张但有收获。', '开源 PR 被合并了！',
  ];
  s.reviews = hours.map((h, i) => ({ id: uid('r'), t: t(7 * (i + 1)), hours: h, mood: moods[i], note: notes[i], summary: '' }));

  const T = (title, skill, hours, resource, deliverable, doneDay = null) => ({
    id: uid('t'), title, skill, hours, resource, deliverable, done: doneDay !== null, doneAt: doneDay !== null ? t(doneDay) : null,
  });
  s.plan = {
    generatedAt: t(56), targetId: 'llm_algo', weeks: 16, hours: 14, mock: false,
    summary: '以「大模型算法工程师」为目标：先补齐深度学习与分布式基础，再用两个有深度的大模型项目驱动收敛，最后面向暑期实习做针对性准备。',
    phases: [
      { id: uid('ph'), stage: 'warmup', name: '预热：补齐底层能力', weeks: 4, goal: '深度学习与工程基础达到“能独立做项目”',
        tasks: [
          T('完成 d2l 注意力与 Transformer 章节习题', 'dl', 12, '《动手学深度学习》d2l.ai', '习题 notebook', 62),
          T('Karpathy Zero to Hero：makemore 系列', 'dl', 14, 'Karpathy · Neural Networks: Zero to Hero', '复现代码仓库', 70),
          T('Linux / Git / Docker 工具链熟练化', 'infra', 8, 'MIT Missing Semester', '个人开发环境脚本', 75),
          T('概率与优化专题复习', 'math', 10, 'Stanford CS109 + 《凸优化》前 4 章', '推导笔记'),
        ] },
      { id: uid('ph'), stage: 'train', name: '主训练：大模型项目驱动', weeks: 8, goal: '产出 2 个可写进简历的大模型项目',
        tasks: [
          T('LoRA 微调法律领域问答模型', 'llm', 30, 'LLaMA-Factory + Qwen 开源模型', '模型、评测报告与 Demo', 92),
          T('PyTorch DDP 多卡训练实践', 'infra', 12, 'PyTorch 分布式教程', '多卡训练吞吐对比'),
          T('CS336 作业 1：从零实现 Transformer LM', 'llm', 24, 'Stanford CS336', '通过全部单元测试'),
          T('复现一篇 DPO 相关论文', 'research', 20, '李沐「论文精读」+ 原论文', '复现报告与博客'),
          T('写一篇技术博客：LoRA 原理与实践', 'comm', 6, '个人博客 / 知乎', '公开博客', 96),
        ] },
      { id: uid('ph'), stage: 'finetune', name: '微调：冲刺暑期实习', weeks: 4, goal: '简历与面试准备就绪，验证集准确率 ≥ 75%',
        tasks: [
          T('整理大模型高频面试题知识卡片', 'llm', 10, '各大厂面经 + 技术报告', '100 张知识卡片'),
          T('LeetCode 剩余 Hot 100', 'code', 16, 'LeetCode Hot 100', '全部完成'),
          T('完成 4 次模拟面试并复盘', 'comm', 6, 'Epoch 验证集', '准确率曲线'),
        ] },
    ],
  };

  const proj = (id) => PROJECTS.find((p) => p.id === id);
  const lora = proj('p_lora');
  const vllm = proj('p_vllm');
  s.runs = [
    { id: uid('run'), projectId: lora.id, title: '法律问答 LoRA 微调', skills: lora.skills, weeks: lora.weeks, level: lora.level, stack: lora.stack,
      status: 'running', startedAt: t(78), notes: 'rank=16 比 rank=8 在法条引用准确率上高 4 个点，但训练慢 30%。',
      milestones: lora.milestones.map((m, i) => ({ text: m, done: i < 3, doneAt: i < 3 ? t(80 + i * 5) : null })) },
    { id: uid('run'), projectId: vllm.id, title: '大模型推理部署与压测', skills: vllm.skills, weeks: vllm.weeks, level: vllm.level, stack: vllm.stack,
      status: 'planned', startedAt: null, notes: '', milestones: vllm.milestones.map((m) => ({ text: m, done: false, doneAt: null })) },
  ];

  const qa = (q, focus, skill, score) => ({ q, focus, skill, a: '（演示数据）', eval: { score, feedback: '', strengths: [], improve: [], reference: score < 6 ? '先讲清楚问题是什么，再讲方法与取舍，最后给出你自己实践中的数字。' : '' } });
  s.interviews = [
    { id: uid('iv'), t: t(64), roleId: 'llm_algo', roleName: '大模型算法工程师', kind: 'tech', qa: [
      qa('Transformer 里为什么要除以 √d_k？不除会怎样？', '注意力缩放', 'llm', 7.2),
      qa('手写多头注意力的前向过程，并说明 mask 是怎么加的。', '代码实现', 'dl', 6.5),
      qa('分布式训练里 DP、TP、PP 分别切的是什么？各自的通信瓶颈在哪？', '并行策略', 'infra', 3.5),
      qa('推导一下交叉熵损失对 logits 的梯度。', '数学推导', 'math', 4.5),
      qa('RLHF 里 PPO 的 KL 惩罚起什么作用？', '对齐算法', 'rl', 3.0),
    ],
      report: { overall: 58, dims: { knowledge: 62, depth: 48, logic: 64, fit: 56 }, verdict: '未通过', summary: '基础概念清楚，但项目深度不足，对训练细节的追问回答较浅。', advice: [] } },
    { id: uid('iv'), t: t(95), roleId: 'llm_algo', roleName: '大模型算法工程师', kind: 'project', qa: [
      qa('介绍一下你的 RAG 项目：检索召回率怎么评估的？', 'RAG 评测', 'llm', 7.8),
      qa('nanoGPT 训练时 loss 不降，你会按什么顺序排查？', '训练调试', 'dl', 7.0),
      qa('LoRA 的秩怎么选？你做过对比实验吗？', '微调细节', 'llm', 6.8),
      qa('如果把推理服务的吞吐提高一倍，你会从哪几处下手？', '推理优化', 'infra', 4.0),
      qa('讲一次你和队友在技术方案上有分歧的经历。', '团队协作', 'comm', 7.5),
      qa('Adam 和 SGD 的收敛性有什么区别？二阶矩起什么作用？', '优化理论', 'math', 4.0),
    ],
      report: { overall: 71, dims: { knowledge: 70, depth: 72, logic: 74, fit: 68 }, verdict: '待定', summary: 'RAG 与 nanoGPT 项目讲得清楚，有评测意识；分布式训练与对齐部分仍需加强。', advice: [] } },
  ];

  // 错题本：两场面试里没答好的题（演示难例挖掘与间隔重复）
  s.hardQs = s.interviews.flatMap((iv) => iv.qa.filter((x) => x.eval.score < 6).map((x, i) => ({
    id: uid('hq'), q: x.q, focus: x.focus, skill: x.skill, roleId: 'llm_algo', roleName: '大模型算法工程师', reference: x.eval.reference, from: 'val',
    box: i % 2, due: iv.t + (i % 2 ? 3 : 1) * DAY + (iv.t > t(80) ? 0 : 10 * DAY), addedAt: iv.t, mastered: false, history: [{ t: iv.t, score: x.eval.score, from: 'val' }],
  })));
  // 测试集：暑期实习投递
  const ap = (company, role, stage, d0, steps, extra = {}) => ({ id: uid('ap'), company, role, roleId: 'llm_algo', channel: '官网', stage, appliedAt: t(d0), updatedAt: t(steps.at(-1)[1]), notes: '', reasons: [], timeline: steps.map(([st, d]) => ({ stage: st, t: t(d) })), ...extra });
  s.applications = [
    ap('某大厂 A', '大模型算法实习生', 'iv2', 88, [['applied', 88], ['test', 91], ['iv1', 96], ['iv2', 99]]),
    ap('某 AI 独角兽 B', 'LLM 应用算法实习', 'rejected', 80, [['applied', 80], ['iv1', 86], ['rejected', 89]], { reasons: ['system', 'depth'], questions: [{ q: 'vLLM 的 PagedAttention 解决了什么问题？', skill: 'infra', score: 3, t: t(86) }] }),
    ap('某研究院 C', '暑期科研实习', 'applied', 97, [['applied', 97]]),
  ];
  s.memory = [
    { id: uid('mem'), text: '周三下午和周四晚上有实验课，这两个时段别排任务', t: t(40) },
    { id: uid('mem'), text: '倾向本科直接工作，暂不考虑读博', t: t(55) },
  ];

  s.chat = [
    { role: 'assistant', content: '你好林间，我是 **树形图设计者**——我会把你的每个选择展开成树形图，根据你的 loss 曲线和梯度方向给出建议。今天想聊点什么？', t: now - DAY },
  ];
  // 历次 epoch 的 batch 完成率（演示“训练稳定性”）
  const rates = [4, 5, 5, 4, 6, 3, 5, 6, 5, 4, 6, 6, 5, 6];
  s.reviews.forEach((r, i) => {
    const total = 6 + (i % 2);
    const done = Math.min(total, rates[i]);
    r.batch = { total, done, hours: Math.round(hours[i] * 0.7), planned: hours[i], rate: +(done / total).toFixed(2) };
  });

  // 本周 batch：从本周一开始；今天之前的任务大多已完成，留一条逾期
  s.batch = generateBatch(s, { now: mondayOf(now) + 9 * 3600000, weekStart: mondayOf(now) });
  const today = dayIndex(s.batch, now);
  s.batch.tasks.forEach((t, i) => {
    if (t.src === 'ritual') return;
    if (t.day < today && i % 4 !== 2) toggleTask(s, t.id, s.batch.weekStart + t.day * DAY + 21 * 3600000);
    else if (today === 0 && i === 0) toggleTask(s, t.id, now - 2 * 3600000);
  });

  // 路径变更日志：计划生成之后，树形图设计者与林间如何一次次重排
  const C = (day, by, kind, title, reason, diff) => ({ id: uid('c'), t: t(day), by, kind, title, reason, diff: diff.map(([op, text]) => ({ op, text })) });
  s.planLog = [
    C(96, 'user', 'batch', '向本周 batch 添加任务', '', [['+', '周四 按 review 意见修改开源 PR · 1h']]),
    C(88, 'ai', 'batch', '预排下周 2 个任务', 'LoRA 实验进入评测阶段，先把最费时的人工评测排进下周，避免和期中周撞车', [
      ['+', '下周二 · 法律问答 LoRA：抽 50 条做人工评测并记录错误类型 · 2h'],
      ['+', '下周六 · 对比 rank=8 / 16 的评测结果，写进实验笔记 · 2h'],
    ]),
    C(79, 'user', 'batch', '本周任务改期', '', [['~', '「实验「法律问答 LoRA 微调」：完成 checkpoint 2」周三 → 周六']]),
    C(72, 'ai', 'plan', '调整路径：删减 1 · 调整工时 2', '连续两轮 batch 完成率在 60% 上下，先保住 LoRA 主线项目，把论文复现缩到一个可交付的最小版本', [
      ['~', '「复现一篇 DPO 相关论文」20h → 12h'],
      ['~', '「PyTorch DDP 多卡训练实践」16h → 12h'],
      ['-', '删除本周任务「整理 Transformer 面试题 50 道」'],
    ]),
    C(70, 'system', 'epoch', '结束 Epoch 010，生成 Epoch 011 的 batch', '本轮完成 4/7（57%）', [
      ['>', 'PyTorch DDP 多卡训练实践 · 第 2/4 段（按最新进度重新切片）'],
      ['-', '放弃：精读 1 篇 RLHF 综述并画出流程图'],
      ['+', '新 batch：7 个任务 · 14h'],
    ]),
    C(65, 'ai', 'plan', '调整路径：新增 1 · 调整工时 1', '第一次模拟面试 58 分：基础概念清楚，但项目深度不足——把时间从“多做”挪到“做深”', [
      ['~', '「CS336 作业 1：从零实现 Transformer LM」16h → 24h'],
      ['+', '写一篇技术博客：LoRA 原理与实践 · 表达与协作 · 6h'],
    ]),
    C(56, 'ai', 'plan', '生成长期训练计划 · 3 个阶段 / 12 个任务', s.plan.summary, s.plan.phases.map((p) => ['+', `${p.name}（${p.weeks} 周）：${p.tasks.map((x) => x.title).join('、')}`])),
  ];

  s.demo = true;
  return s;
}
