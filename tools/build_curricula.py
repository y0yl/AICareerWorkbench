#!/usr/bin/env python3
"""把 plans/*.md（从教务系统整理的培养方案）转换为前端数据 web/js/core/curricula.data.js。

    python3 tools/build_curricula.py

- 课程 → 能力增益：按课程名的有序规则匹配（见 RULES），再按学分缩放；未匹配的视为通识/公共课，只计数。
- 课程类型：req 必修 / elec 选修 / choice 多选一（如“通识先导课（5选1）”）。
  “限选”课组若最少学分 ≥ 课组总学分，则视为必修。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLANS = ROOT / "plans"
OUT = ROOT / "web" / "js" / "core" / "curricula.data.js"

# 有序规则：越具体越靠前。增益以 ~3 学分课程为基准。
RULES = [
    (r"毕业设计", {"research": 0.35, "code": 0.2, "comm": 0.15}),
    (r"科研创新训练", {"research": 0.45, "comm": 0.05}),
    (r"论文选读|论文研读|学术研讨", {"research": 0.3, "comm": 0.1}),
    (r"人工智能前沿进展", {"research": 0.25, "llm": 0.1}),
    (r"Summer Workshop", {"research": 0.15, "comm": 0.2}),
    (r"自然语言处理课程设计", {"llm": 0.25, "code": 0.1}),
    (r"计算机视觉课程设计", {"cv": 0.25, "code": 0.1}),
    (r"神经网络课程设计", {"dl": 0.25, "code": 0.1}),
    (r"数据库系统原理课程设计", {"data": 0.25}),
    (r"数据结构与算法分析课程设计", {"code": 0.3}),
    (r"离散数学课程设计", {"math": 0.15, "code": 0.15}),
    (r"操作系统课程设计", {"infra": 0.25, "code": 0.1}),
    (r"计算机网络课程设计", {"infra": 0.25}),
    (r"计算机组成原理实验", {"infra": 0.25}),
    (r"计算机专业基础综合实践", {"code": 0.2, "infra": 0.15}),
    (r"计算机专业基础(综合|能力提升)", {"code": 0.2, "infra": 0.2}),
    (r"GPU", {"infra": 0.4, "dl": 0.1}),
    (r"计算机系统结构", {"infra": 0.35}),
    (r"操作系统", {"infra": 0.35, "code": 0.1}),
    (r"计算机组成原理", {"infra": 0.3}),
    (r"计算机网络", {"infra": 0.3}),
    (r"数字逻辑", {"infra": 0.2}),
    (r"计算机导论|计算概论", {"code": 0.15, "infra": 0.05}),
    (r"数据结构与算法|算法设计", {"code": 0.45}),
    (r"问题求解实战|编程实战", {"code": 0.35}),
    (r"Python程序设计与人工智能", {"code": 0.3, "ml": 0.1}),
    (r"AI编程|程序设计|JAVA|工程计算与软件开发", {"code": 0.35}),
    (r"Web前端", {"code": 0.25, "product": 0.1}),
    (r"软件工程|软件项目管理|软件开发环境", {"code": 0.25, "product": 0.1, "comm": 0.05}),
    (r"计算思维", {"code": 0.15}),
    (r"数据库", {"data": 0.4, "code": 0.1}),
    (r"数据可视化", {"data": 0.35, "comm": 0.1}),
    (r"数据挖掘", {"data": 0.25, "ml": 0.25}),
    (r"数据分析的机器智能", {"data": 0.25, "ml": 0.2}),
    (r"数据科学引论", {"data": 0.3, "ml": 0.1}),
    (r"模式识别与机器学习", {"ml": 0.55, "math": 0.1}),
    (r"机器学习", {"ml": 0.5}),
    (r"模式识别", {"ml": 0.4, "cv": 0.1}),
    (r"神经网络设计与实践", {"dl": 0.55, "code": 0.1}),
    (r"深度学习", {"dl": 0.45}),
    (r"表达学习|表征学习", {"dl": 0.3, "research": 0.1}),
    (r"类脑计算", {"dl": 0.2, "research": 0.15}),
    (r"大模型", {"llm": 0.5}),
    (r"自然语言处理", {"llm": 0.45}),
    (r"多模态", {"cv": 0.3, "llm": 0.25}),
    (r"计算机视觉|数字图像处理", {"cv": 0.5}),
    (r"计算机图形学", {"cv": 0.3, "math": 0.05}),
    (r"工业质检", {"cv": 0.3, "product": 0.15}),
    (r"信息融合", {"ml": 0.2, "cv": 0.15}),
    (r"强化学习", {"rl": 0.55, "math": 0.05}),
    (r"智能决策", {"rl": 0.35, "ml": 0.1}),
    (r"进化计算|Evolutionary", {"ml": 0.2, "math": 0.15}),
    (r"开源硬件|HarmonyOS|物联", {"infra": 0.2, "rl": 0.1, "product": 0.1}),
    (r"人工智能的数学基础", {"math": 0.5, "ml": 0.1}),
    (r"人工智能引论", {"ml": 0.25, "dl": 0.1}),
    (r"人工智能伦理", {"product": 0.15, "comm": 0.05}),
    (r"人工智能赋能|AI\+", {"product": 0.25, "dl": 0.15, "research": 0.15}),
    (r"人工智能产业实践", {"product": 0.35, "comm": 0.1}),
    (r"人工智能实践", {"dl": 0.3, "code": 0.15}),
    (r"AI技能实践", {"llm": 0.15, "code": 0.1}),
    (r"专业实训", {"code": 0.3, "product": 0.15}),
    (r"创新创业|创业", {"product": 0.35, "comm": 0.2}),
    (r"微积分|高等数学", {"math": 0.4}),
    (r"线性代数", {"math": 0.45}),
    (r"概率统计", {"math": 0.45}),
    (r"矩阵分析", {"math": 0.45}),
    (r"最优化", {"math": 0.45, "ml": 0.1}),
    (r"离散数学", {"math": 0.3, "code": 0.1}),
    (r"随机过程", {"math": 0.45}),
    (r"科学计算|数值计算", {"math": 0.3, "code": 0.1}),
    (r"学术英语|英语写作|英语口语", {"comm": 0.2}),
    (r"新生研讨课", {"research": 0.05, "comm": 0.05}),
]

VARIANTS = [("AI+X", "aix", "AI+X 拔尖计划"), ("中外合作", "sino", "中外合作办学")]


def skills_for(name, credits):
    for pattern, gains in RULES:
        if re.search(pattern, name, re.I):
            scale = min(1.3, max(0.6, 0.45 + credits * 0.18))
            return {k: round(round(v * scale / 0.05) * 0.05, 2) for k, v in gains.items()}
    return None


def num(v):
    v = v.strip()
    if v in ("", "—", "-"):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def section(text, title):
    m = re.search(rf"^## {re.escape(title)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    return m.group(1) if m else ""


def rows(block):
    out = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|") or re.match(r"^\|\s*-{3}", line):
            continue
        out.append([c.strip() for c in line.strip("|").split("|")])
    return out[1:]  # 去掉表头


def parse(path):
    text = path.read_text(encoding="utf-8")
    title = re.search(r"^# (.+)$", text, re.M).group(1).strip()
    info = {r[0]: r[1] for r in rows(section(text, "方案信息")) if len(r) >= 2}
    start = int(info["开始学年"][:4])
    variant = next(((vid, vname) for key, vid, vname in VARIANTS if key in info["专业名称"]), ("std", ""))
    if "新方案" in info.get("方案名称", ""):
        variant = (variant[0], "新方案")

    groups = {}
    for r in rows(section(text, "课组修读要求")):
        if len(r) < 6 or r[0] in groups and groups[r[0]]["total"] is not None:
            continue
        groups[r[0]] = {"total": num(r[1]), "min_count": num(r[2]), "min_credits": num(r[3]), "note": r[5]}

    raw = [r for r in rows(section(text, "全部方案课程")) if len(r) >= 8]
    per_group = {}
    for r in raw:
        per_group[r[2]] = per_group.get(r[2], 0) + 1

    courses, general, unmatched = [], {}, []
    for code, name, group, attr, credits, hours, year, term in raw:
        credits_f = num(credits) or 0
        sem = None
        if term in ("秋", "春") and year[:4].isdigit():
            sem = (int(year[:4]) - start) * 2 + (1 if term == "秋" else 2)
        g = groups.get(group, {})
        if attr == "必修":
            # 只有“N选1”或顶层公共课组（如通用英语）里的多门课是多选一；课组路径含“必修”的一律视为必修
            mc = g.get("min_count")
            pick_one = mc == 1 and per_group[group] > 1 and "必修" not in group
            kind = "choice" if "选1" in group or pick_one else "req"
        else:
            restricted = "限选" in group and (
                per_group[group] == 1 or (g.get("total") and g.get("min_credits") and g["min_credits"] >= g["total"]))
            kind = "req" if restricted else "elec"
        sk = skills_for(name, credits_f)
        if not sk:
            key = str(sem or 0)
            general[key] = general.get(key, 0) + 1
            if not re.search(r"思政|思想|法治|通识|体育|军事|心理|劳动|英语|形势|国家安全|马克思|毛泽东|习近平|中国|史|文化|物理|化学|生命|力学|实践教育|研讨", group + name):
                unmatched.append(name)
            continue
        courses.append({"c": code, "n": name, "g": group, "k": kind, "cr": credits_f, "h": int(num(hours) or 0), "s": sem, "sk": sk})

    # 课组备注里的“XX二选一”：保留第一门为必修，其余作为可替换的选修（alt）
    for gname, g in groups.items():
        m = re.match(r"(.+?)二选一", g.get("note") or "")
        if not m:
            continue
        alts = [c for c in courses if c["g"] == gname and c["n"].startswith(m.group(1))]
        for c in alts[1:]:
            c["k"], c["alt"] = "elec", m.group(1)

    partial = num(info.get("课程总学分", "0")) < num(info.get("要求总学分", "0"))
    plan_id = f"sample-{start}-{variant[0]}"
    return {
        "id": plan_id,
        "school": "示例大学",
        "grade": start,
        "title": f"{start}级 人工智能" + (f"（{variant[1]}）" if variant[1] else ""),
        "college": info.get("院系名称", ""),
        "requiredCredits": num(info.get("要求总学分", "0")),
        "totalCourses": int(num(info.get("课程总门数", "0")) or 0),
        "partial": bool(partial),
        "source": "示例数据（仅用于测试占位）",
        "collected": re.search(r"整理日期：([\d-]+)", text).group(1),
        "general": general,
        "courses": sorted(courses, key=lambda c: (c["s"] or 99, c["k"] != "req", c["n"])),
        "_unmatched": unmatched,
        "_file": path.name,
    }


def main():
    plans = [parse(p) for p in sorted(PLANS.glob("*.md"))]
    plans.sort(key=lambda p: (-p["grade"], p["id"]))
    for p in plans:
        req = [c for c in p["courses"] if c["k"] == "req"]
        print(f"{p['id']:<16} {p['title']:<28} AI相关 {len(p['courses']):>3} 门（必修 {len(req)}）"
              f"{'  [不完整]' if p['partial'] else ''}  ← {p.pop('_file')}")
        um = p.pop("_unmatched")
        if um:
            print("   未映射（请检查是否需要加规则）：", "、".join(sorted(set(um))))
    body = json.dumps(plans, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(
        "// 由 tools/build_curricula.py 从 plans/*.md 自动生成，请勿手动修改。\n"
        "// 字段：c 课程号 · n 课程名 · g 课组 · k req必修/elec选修/choice多选一 · cr 学分 · h 学时 · s 第几学期(1-8) · sk 能力增益\n"
        f"export const CURRICULA = {body};\n",
        encoding="utf-8",
    )
    print(f"\n→ {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.1f} KB）")


if __name__ == "__main__":
    sys.exit(main())
