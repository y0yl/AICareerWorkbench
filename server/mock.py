"""演示模式：未配置 Qwen API Key 时返回的离线结果，保证页面完整可演示。"""
import json
import random
import re

from prompts import SKILL_IDS, SKILLS

SKILL_NAME = {sid: name for sid, name, _ in SKILLS}

KEYWORDS = {
    "math": ["数学", "线代", "线性代数", "概率", "统计", "优化", "建模", "微积分"],
    "code": ["leetcode", "算法题", "刷题", "c++", "python", "java", "数据结构", "开源", "pull request", "acm", "蓝桥"],
    "ml": ["机器学习", "xgboost", "lightgbm", "sklearn", "特征", "kaggle", "天池", "回归", "分类", "推荐", "召回", "排序", "双塔", "ctr"],
    "dl": ["深度学习", "pytorch", "神经网络", "cnn", "训练", "transformer", "d2l"],
    "llm": ["大模型", "llm", "gpt", "qwen", "lora", "微调", "rag", "agent", "prompt", "nlp", "bert", "对齐"],
    "cv": ["视觉", "图像", "检测", "yolo", "分割", "clip", "扩散", "diffusion", "多模态", "opencv"],
    "rl": ["强化学习", "ppo", "dqn", "机器人", "具身", "ros", "仿真", "mujoco", "isaac"],
    "data": ["数据", "sql", "pandas", "可视化", "爬虫", "清洗", "分析", "faiss", "特征工程"],
    "infra": ["部署", "docker", "linux", "cuda", "vllm", "推理", "分布式", "量化", "加速", "服务器"],
    "research": ["论文", "paper", "复现", "科研", "实验室", "投稿", "arxiv", "顶会"],
    "product": ["产品", "需求", "用户", "prd", "商业", "创业", "运营"],
    "comm": ["分享", "演讲", "答辩", "团队", "社团", "队长", "写作", "博客", "英语", "汇报", "同学", "小组"],
}

TYPE_HINTS = [
    ("intern", ["实习"]),
    ("competition", ["竞赛", "比赛", "大赛", "kaggle", "获奖", "一等奖", "二等奖"]),
    ("paper", ["论文", "投稿", "发表"]),
    ("course", ["课程", "课", "学完", "mooc", "cs2", "cs3"]),
    ("project", ["项目", "实现", "开发", "搭建", "复现", "系统"]),
    ("reading", ["阅读", "读完", "书"]),
]


def _meta(p):
    return p.get("meta") or {}


def _gaps(p, n=4):
    gaps = _meta(p).get("gaps") or []
    ids = [g.get("id") for g in gaps if g.get("id") in SKILL_IDS][:n]
    return ids or ["dl", "llm", "code", "infra"][:n]


# ---------- 流式 ----------

def mentor(p):
    m = _meta(p)
    question = ""
    for msg in reversed(p.get("messages") or []):
        if msg.get("role") == "user":
            question = str(msg.get("content", ""))[:60]
            break
    g = _gaps(p, 3)
    target = m.get("target") or "目标岗位"
    return (
        f"> 当前为**演示模式**（AI 服务未接入），以下是基于你训练状态的规则化建议。\n\n"
        f"关于「{question or '本周重点'}」，我先看了一眼你的训练曲线：目标是 **{target}**，"
        f"当前拟合度 **{m.get('match', '—')}**。\n\n"
        f"**梯度最大的三个方向：**\n"
        f"1. **{SKILL_NAME[g[0]]}** —— 这是 loss 的主要来源，建议本周投入 40% 的时间，产出一个可展示的小成果。\n"
        f"2. **{SKILL_NAME[g[1]]}** —— 结合正在进行的实验（项目）来练，比单纯看课程收敛更快。\n"
        f"3. **{SKILL_NAME[g[2]]}** —— 每天 30 分钟的小批量训练（small batch），保持梯度不消失。\n\n"
        "**本周可执行清单：**\n- 周一：确定本轮 epoch 的唯一核心目标\n- 周三：完成一次可验收的产出（代码/笔记/博客）\n"
        "- 周日：点击「结束本轮 Epoch」做复盘，让曲线记录下你的进步\n\n"
        "接入 AI 服务后，我会给出真正个性化、可对话的建议。"
        + (_log_action(question) if re.search(r"完成了|做完|学完|跑通|上线了|参加了|拿到了|获得了", question)
           else _remember_action(question) if re.search(r"我每周|我周[一二三四五六日]|我不想|我决定|我打算|我更喜欢", question)
           else _adjust_action(m) if re.search(r"吃不消|调整|太多|太累|累|烦|跟不上|落后", question)
           else _mentor_action(g, "下周" in question) if re.search(r"计划|安排|规划|任务|下周|本周|这周", question) else "")
    )


def _log_action(question):
    """演示：把“我完成了 X”记成一条经历样本。"""
    kind = "project"
    for k, words in TYPE_HINTS:
        if any(w in question for w in words):
            kind = k
            break
    sid = next((sid for sid, words in KEYWORDS.items() if any(w.lower() in question.lower() for w in words)), "code")
    block = json.dumps({"actions": [{"type": "log_entry", "title": question[:20], "kind": kind, "date": "", "hours": 6,
                                      "summary": question[:40], "skills": {sid: 0.3}}]}, ensure_ascii=False)
    return f"\n\n这是一条有效的训练样本，我帮你整理好了，点“执行”记入数据集：\n\n```epoch-action\n{block}\n```"


def _remember_action(question):
    block = json.dumps({"actions": [{"type": "remember", "facts": [question[:40]]}]}, ensure_ascii=False)
    return f"\n\n好的，这一点我记下了，之后排任务会考虑进去。\n\n```epoch-action\n{block}\n```"


def _adjust_action(m):
    """演示：工时最长的未完成任务挪到下周，其余超过 2 小时的减到 1.5 小时。"""
    open_tasks = sorted(m.get("batch") or [], key=lambda t: -(t.get("hours") or 0))
    if not open_tasks:
        return ""
    changes = [{"op": "move", "ref": open_tasks[0]["ref"], "week": "next", "day": "周二"}]
    changes += [{"op": "resize", "ref": t["ref"], "hours": 1.5} for t in open_tasks[1:3] if (t.get("hours") or 0) > 2]
    block = json.dumps({"actions": [{"type": "adjust_tasks", "reason": "本周负荷过高，先减量保持节奏", "changes": changes}]}, ensure_ascii=False)
    return ("\n\n落后的时候硬塞只会更烦。我把本周最重的一项挪到下周，另外几项拆小——节奏比总量重要：\n\n"
            f"```epoch-action\n{block}\n```")


def _mentor_action(g, next_week=False):
    days = ["周一", "周三", "周五"] if next_week else ["周二", "周四", "周六"]
    tasks = [
        {"title": f"{SKILL_NAME[sid]}：完成一个 2 小时的专项练习", "skill": sid, "hours": 2, "week": "next" if next_week else "this", "day": days[i],
         "criteria": "提交代码或写满 1 页笔记", "resource": ""}
        for i, sid in enumerate(g[:3])
    ]
    block = json.dumps({"actions": [{"type": "add_batch_tasks", "tasks": tasks}]}, ensure_ascii=False)
    return f"\n\n我把上面三个方向整理成了{'下周' if next_week else '本周'}任务，点“执行”即可写入：\n\n```epoch-action\n{block}\n```"


def epoch_review(p):
    r = p.get("review") or {}
    return (
        f"[epoch 复盘 · 演示模式] 本轮投入 {r.get('hours', '—')} 小时，loss 变化 {r.get('delta', '—')}。"
        "整体来看，这是一个稳定下降的 epoch：样本质量不错，没有出现明显的过拟合。"
        "本轮最有价值的样本是你亲手完成的实践部分——它带来的梯度远大于被动输入。"
        f"下一轮建议把学习率集中在「{SKILL_NAME[_gaps(p, 1)[0]]}」上，并给自己设一个周三的中期检查点；"
        "同时安排一次模拟面试作为验证集，避免只在训练集上表现良好。"
    )


def report(p):
    m = _meta(p)
    name = m.get("name") or "同学"
    target = m.get("target") or "AI 算法工程师"
    strengths = "、".join(m.get("strengths") or ["编程与算法", "机器学习"])
    gaps = "、".join(SKILL_NAME[g] for g in _gaps(p, 3))
    return f"""# {name}的职业生涯规划书

> 演示模式生成（AI 服务未接入）。接入后将基于你的完整训练数据撰写个性化版本。

## 一、自我认知

我是一名{m.get('grade', '')}人工智能专业学生。通过 Epoch 训练台的能力建模，我在 **{strengths}** 上已具备一定基础，
而 **{gaps}** 是目前 loss 的主要来源。我对用 AI 解决真实问题有强烈兴趣，偏好“动手实践 + 系统学习”结合的成长方式。

## 二、职业认知

**目标岗位：{target}。** 该方向对模型原理、工程实现与项目落地能力均有较高要求，招聘通常关注扎实的基础、
有深度的项目经历与持续学习能力。行业信息变化较快，具体要求需以目标企业最新招聘信息为准。

## 三、职业决策

- **目标函数**：以「{target}」为主目标，当前拟合度 {m.get('match', '—')}。
- **差距分析**：主要短板集中在 {gaps}。
- **备选最优解**：若主目标推进受阻，可转向能力向量相近的相邻岗位，保留已积累的能力权重。

## 四、行动计划

| 阶段 | 时间 | 核心任务 | 里程碑 |
| --- | --- | --- | --- |
| 短期 | 本学期 | 补齐 {SKILL_NAME[_gaps(p, 1)[0]]} 基础 | 完成 1 个可展示项目 |
| 中期 | 未来一年 | 打造 2 个有深度的代表作 | 获得 1 段相关实习 |
| 长期 | 毕业前后 | 面向目标岗位冲刺 | 拿到目标 offer / 升学录取 |

## 五、评估与调整

每周通过“结束本轮 Epoch”复盘，每月检查 loss 曲线：若连续 3 个 epoch 进入平台期，则调整学习策略；
每两个月进行一次模拟面试作为验证集评估，防止“只在训练集上表现好”。

## 结语

职业生涯是我训练过的最重要的模型。保持学习率，持续迭代，终将收敛。
"""


def resume(p):
    m = _meta(p)
    return f"""# {m.get('name') or '姓名'} · 简历草稿（演示模式）

**求职意向**：{m.get('target') or '目标岗位'}　|　电话【待补充】　|　邮箱【待补充】

## 教育背景
**【学校名称】** · 人工智能专业 · {m.get('grade', '')}　GPA【待补充】

## 专业技能
- **熟练**：{('、'.join(m.get('strengths') or ['Python', 'PyTorch']))}
- **了解**：{'、'.join(SKILL_NAME[g] for g in _gaps(p, 3))}

## 项目经历
**【项目名称】**　*【时间】*
- 背景（S/T）：【一句话说明问题与目标】
- 行动（A）：【你负责的核心模块与技术方案】
- 结果（R）：【量化结果，如准确率提升 X%】

## 投递前检查清单
- [ ] 每个项目都有可量化结果
- [ ] 技能描述与项目经历相互印证
- [ ] 针对目标 JD 调整关键词
"""


# ---------- JSON ----------

def tag_entry(p):
    text = str(p.get("text") or "")
    low = text.lower()
    scores = {}
    for sid, words in KEYWORDS.items():
        hits = sum(1 for w in words if w in low)
        if hits:
            scores[sid] = round(min(0.8, 0.15 + 0.15 * hits), 2)
    if not scores:
        scores = {"code": 0.2}
    top = dict(sorted(scores.items(), key=lambda kv: -kv[1])[:4])
    etype = p.get("type") or "other"
    for t, words in TYPE_HINTS:
        if any(w in low for w in words):
            etype = t
            break
    title = re.split(r"[，。,.\n；;]", text.strip())[0][:20] or "新的训练样本"
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:个)?(?:小时|h\b|hours?)", low)
    hours = int(float(m.group(1))) if m else 10
    return {
        "title": title,
        "type": etype,
        "hours": hours,
        "summary": text.strip()[:40],
        "skills": top,
        "reason": "演示模式：基于关键词匹配的标注，接入 AI 服务后将进行语义理解。",
    }


def roadmap(p):
    g = _gaps(p, 4)
    weeks = max(4, min(int(p.get("weeks") or 12), 52))
    w1, w3 = max(1, weeks // 4), max(1, weeks // 4)
    w2 = weeks - w1 - w3
    res = {
        "math": "3Blue1Brown《线性代数的本质》+ MIT 18.06",
        "code": "LeetCode Hot 100 + MIT Missing Semester",
        "ml": "吴恩达 Machine Learning Specialization",
        "dl": "《动手学深度学习》（d2l.ai）",
        "llm": "Stanford CS336 + Hugging Face LLM Course",
        "cv": "Stanford CS231n",
        "rl": "OpenAI Spinning Up + Hugging Face Deep RL Course",
        "data": "Kaggle Learn + LeetCode SQL 50",
        "infra": "MIT 6.5940 + vLLM 官方文档",
        "research": "李沐「论文精读」系列",
        "product": "《启示录：打造用户喜爱的产品》",
        "comm": "技术博客写作 + 组会汇报练习",
    }

    def task(sid, title, hours, deliverable):
        return {"title": title, "skill": sid, "hours": hours, "resource": res[sid], "deliverable": deliverable}

    return {
        "summary": f"演示计划：{weeks} 周内优先补齐 {SKILL_NAME[g[0]]} 与 {SKILL_NAME[g[1]]}，并以项目驱动收敛。",
        "phases": [
            {
                "stage": "warmup", "name": "预热：补齐基础", "weeks": w1,
                "goal": f"把 {SKILL_NAME[g[0]]} 拉到可独立做项目的水平",
                "tasks": [
                    task(g[0], f"系统学习 {SKILL_NAME[g[0]]} 核心内容", 16, "一份结构化学习笔记"),
                    task(g[1], f"{SKILL_NAME[g[1]]} 入门练习", 10, "3 个练习 notebook"),
                    task("code", "整理开发环境与 Git 工作流", 4, "GitHub 主页与规范仓库"),
                ],
            },
            {
                "stage": "train", "name": "主训练：项目驱动", "weeks": w2,
                "goal": "完成 1 个能写进简历的代表作",
                "tasks": [
                    task(g[0], f"围绕 {SKILL_NAME[g[0]]} 完成一个完整项目", 30, "可运行代码 + README + 评测结果"),
                    task(g[2], f"在项目中引入 {SKILL_NAME[g[2]]}", 12, "项目新模块"),
                    task("research", "精读 3 篇相关论文并复现关键实验", 15, "论文笔记 + 复现报告"),
                    task("comm", "把项目写成一篇技术博客", 6, "一篇公开博客"),
                ],
            },
            {
                "stage": "finetune", "name": "微调：面向目标", "weeks": w3,
                "goal": "完成求职/升学材料并通过验证",
                "tasks": [
                    task(g[3], f"针对 JD 强化 {SKILL_NAME[g[3]]}", 10, "知识点清单"),
                    task("comm", "完成 3 次模拟面试", 6, "验证集准确率 ≥ 70%"),
                    task("product", "打磨简历与项目叙事", 6, "一页纸简历"),
                ],
            },
        ],
    }


def jd_parse(p):
    text = str(p.get("text") or "").lower()
    req = {sid: 1 for sid in SKILL_IDS}
    req.update({"code": 3, "comm": 3})
    for sid, words in KEYWORDS.items():
        hits = sum(1 for w in words if w in text)
        if hits:
            req[sid] = min(5, 2 + hits)
    first = str(p.get("text") or "").strip().split("\n")[0][:16]
    return {
        "name": first or "自定义岗位",
        "company": "",
        "summary": "演示模式：基于关键词估计的岗位能力需求。",
        "req": req,
        "keywords": [w for words in KEYWORDS.values() for w in words if w in text][:8],
        "tips": "接入 AI 服务后可获得精准的 JD 解析与备考建议。",
    }


def projects(p):
    pool = [
        {"title": "从零训练一个迷你 GPT（nanoGPT 复现）", "level": 2, "weeks": 3, "skills": {"dl": 0.5, "llm": 0.6, "code": 0.3},
         "why": "直击 Transformer 原理，是大模型方向最有说服力的入门作品。",
         "milestones": ["读懂 nanoGPT 代码结构", "准备中文语料与分词", "单卡训练并记录 loss 曲线", "采样与消融实验", "写 README 与博客"],
         "stack": ["PyTorch", "tiktoken", "W&B"]},
        {"title": "带评测集的 RAG 知识库问答", "level": 2, "weeks": 3, "skills": {"llm": 0.5, "code": 0.4, "product": 0.3},
         "why": "企业落地最常见的形态，能同时体现工程与评测意识。",
         "milestones": ["确定场景与文档集", "实现切分/向量检索", "构建 50 条评测集", "检索与生成优化对比", "Web Demo 上线"],
         "stack": ["开源大模型", "FAISS/Milvus", "FastAPI"]},
        {"title": "vLLM 推理部署与压测", "level": 2, "weeks": 2, "skills": {"infra": 0.6, "llm": 0.3},
         "why": "补齐工程短板，体现“能把模型变成服务”的能力。",
         "milestones": ["部署开源模型", "量化对比（INT8/INT4）", "并发压测", "输出性能报告"],
         "stack": ["vLLM", "Docker", "Locust"]},
        {"title": "论文复现 + 技术博客", "level": 2, "weeks": 3, "skills": {"research": 0.6, "dl": 0.3, "comm": 0.3},
         "why": "训练科研能力，也是读研/科研岗的重要敲门砖。",
         "milestones": ["选定论文", "复现主实验", "补充消融", "撰写博客"],
         "stack": ["PyTorch", "arXiv"]},
    ]
    random.shuffle(pool)
    return {"projects": pool[: max(2, min(int(p.get("count") or 3), 4))]}


QUESTIONS = {
    "tech": [
        ("请解释 Transformer 中自注意力的计算过程，以及为什么要除以 √d_k？", "注意力机制"),
        ("过拟合有哪些常见表现？你会用哪些手段缓解？", "泛化与正则"),
        ("Adam 优化器相比 SGD 做了哪些改进？各有什么适用场景？", "优化算法"),
        ("LoRA 微调的原理是什么？为什么它能显著节省显存？", "高效微调"),
        ("BatchNorm 和 LayerNorm 有什么区别？Transformer 为什么用 LayerNorm？", "归一化"),
    ],
    "project": [
        ("挑一个你最有成就感的项目，用 2 分钟介绍：背景、你的角色和最终结果。", "项目概述"),
        ("这个项目里你遇到的最大技术难点是什么？你是怎么定位和解决的？", "问题解决"),
        ("如果给你双倍的时间和算力，你会怎么改进这个项目？", "技术视野"),
        ("你是如何评估项目效果的？指标为什么这样选？", "评测意识"),
    ],
    "hr": [
        ("为什么选择这个方向？你理想中三年后的自己是什么样子？", "职业动机"),
        ("讲一次你和队友意见不一致的经历，最后怎么处理的？", "团队协作"),
        ("你最近在主动学习什么？是怎么安排时间的？", "学习能力"),
        ("你认为自己最大的短板是什么？正在如何弥补？", "自我认知"),
    ],
}


def interview_start(p):
    q, f = QUESTIONS.get(p.get("kind"), QUESTIONS["tech"])[0]
    return {"opening": f"你好，我是今天的面试官（演示模式）。我们开始「{p.get('role', '目标岗位')}」的模拟面试。", "question": q, "focus": f}


def interview_turn(p):
    history = p.get("history") or []
    answer = str((history[-1] if history else {}).get("a") or "")
    n = len(answer)
    score = 3.0 if n < 20 else 5.0 if n < 80 else 6.5 if n < 200 else 7.8
    score = round(min(9.5, score + random.uniform(-0.5, 0.5)), 1)
    bank = QUESTIONS.get(p.get("kind"), QUESTIONS["tech"])
    remaining = int(p.get("remaining") or 0)
    nq = bank[len(history) % len(bank)] if remaining > 0 else ("", "")
    return {
        "score": score,
        "feedback": "演示模式评分（按回答完整度估计）。回答结构清楚会加分，建议用“结论-原理-例子”展开。",
        "strengths": ["愿意展开说明"] if n >= 80 else ["回答直接"],
        "improve": ["补充原理层面的解释", "结合自己的项目举例"],
        "reference": "参考要点：先给结论，再讲原理与推导，最后结合实际场景/项目说明取舍。",
        "next_question": nq[0],
        "focus": nq[1],
    }


def interview_report(p):
    history = p.get("history") or []
    scores = [float(t.get("score") or 0) for t in history] or [6]
    avg = sum(scores) / len(scores)
    base = int(avg * 10)
    return {
        "overall": base,
        "dims": {"knowledge": min(100, base + 3), "depth": max(0, base - 6), "logic": min(100, base + 5), "fit": base},
        "verdict": "通过" if avg >= 7 else "待定" if avg >= 5.5 else "未通过",
        "summary": "演示模式总评：基础概念掌握尚可，项目细节与量化表达还有提升空间。",
        "advice": ["每个项目准备一个 2 分钟版本的 STAR 叙述", "针对岗位高频考点建立知识卡片", "回答时先给结论再展开"],
    }


def weekly_batch(p):
    tasks = p.get("tasks") or []
    out = []
    for t in tasks:
        crit = t.get("criteria") or "留下可检查的产出（代码提交 / 笔记）"
        out.append({
            "id": t.get("id"),
            "title": t.get("title"),
            "criteria": crit if "截图" in crit or len(crit) > 18 else f"{crit}，并截图存档",
            "resource": t.get("resource") or "",
            "hours": t.get("hours"),
            "day": t.get("day"),
        })
    return {"tip": "演示模式：先做“实验 / 计划”类任务保住主线，再用碎片时间完成梯度微任务。", "tasks": out}


def task_gain(p):
    text = f"{p.get('title') or ''} {p.get('criteria') or ''}".lower()
    hits = {sid: sum(1 for w in words if w in text) for sid, words in KEYWORDS.items()}
    best = max(hits.items(), key=lambda kv: kv[1])
    skill = best[0] if best[1] else (p.get("skill_id") or "code")
    try:
        hours = max(0.5, min(6.0, round(float(p.get("hours") or 1.5) * 2) / 2))
    except (TypeError, ValueError):
        hours = 1.5
    gain = 0.04 + 0.035 * hours
    if not p.get("criteria"):
        gain *= 0.8  # 没有验收标准，打个折
    if any(w in text for w in ("看看", "了解", "浏览")):
        gain *= 0.6
    return {
        "skill": skill,
        "gain": round(min(0.3, gain), 2),
        "hours": hours,
        "criteria": p.get("criteria") or "留下一份可检查的笔记或代码",
        "reason": "演示模式：按关键词判断能力维度，按时长与是否有验收标准估算增长。",
    }


def transcript(p):
    """演示：从培养方案课程里挑几门，给出确定性的“识别结果”。"""
    names = [str(n) for n in (p.get("names") or [])][:10]
    if not names:
        names = ["高等数学", "线性代数", "概率论与数理统计", "程序设计基础", "数据结构", "机器学习"]
    return {"courses": [{"name": n, "score": 72 + (sum(map(ord, n)) % 25), "credits": None, "term": ""} for n in names], "demo": True}


HANDLERS = {
    "mentor": mentor, "epoch_review": epoch_review, "report": report, "resume": resume,
    "tag_entry": tag_entry, "roadmap": roadmap, "jd_parse": jd_parse, "projects": projects, "weekly_batch": weekly_batch,
    "task_gain": task_gain,
    "interview_start": interview_start, "interview_turn": interview_turn, "interview_report": interview_report,
    "transcript": transcript,
}
