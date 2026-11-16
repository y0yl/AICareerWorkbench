# Epoch · AI 专业生涯训练台

> **训练你自己。** 为人工智能专业学生打造的职业生涯规划学习实践工作台——把职业目标写成**目标函数**，把每一段经历当作**训练样本**，让 AI 导师 Adam 沿着**梯度**陪你一步步收敛到想成为的人。

- 设计方案（参赛说明）：[docs/DESIGN.md](docs/DESIGN.md)
- 零依赖：后端只用 Python 3.9+ 标准库，前端是原生 ES Modules，**无需 npm / pip，无构建步骤**
- AI：通义千问 Qwen（DashScope OpenAI 兼容接口）。未配置 Key 时自动进入**演示模式**，全部功能仍可体验

## 本地运行（30 秒）

```bash
cp .env.example .env        # 填入 QWEN_API_KEY（不填则为演示模式）
python3 server/app.py       # 打开 http://127.0.0.1:8080
```

- 首页 → 「初始化我的模型」：4 步完成建档
- 直接体验示例数据：访问 `http://127.0.0.1:8080/#/demo`（评委演示推荐用这个链接）

## 部署到你的服务器 + 域名

以 Ubuntu + nginx 为例（服务器需有 `python3`，系统自带即可）：

```bash
# 1. 本地一键同步代码（首次前先在服务器上 sudo mkdir -p /opt/epoch && sudo chown $USER /opt/epoch）
./deploy/deploy.sh user@your-server

# 2. 服务器上：写配置
cd /opt/epoch && cp .env.example .env && nano .env      # 填 QWEN_API_KEY，TRUST_PROXY=1

# 3. 注册为系统服务
sudo cp deploy/epoch.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now epoch

# 4. nginx + HTTPS（把 deploy/nginx.conf 里的 your-domain.com 换成你的域名）
sudo cp deploy/nginx.conf /etc/nginx/sites-available/epoch
sudo ln -s /etc/nginx/sites-available/epoch /etc/nginx/sites-enabled/
sudo certbot --nginx -d your-domain.com && sudo nginx -t && sudo systemctl reload nginx
```

之后每次更新只需再运行 `./deploy/deploy.sh user@your-server`。

**注意**：
- nginx 中 `/api/` 必须 `proxy_buffering off`，否则 AI 流式输出会卡住直到结束（配置里已写好）。
- 比赛期间公开访问时，用 `.env` 里的 `AI_RATE_PER_HOUR`（单 IP 每小时）与 `AI_DAILY_CAP`（全站每日）保护你的 API 额度。
- 国内服务器备案后再绑定域名；所有字体与脚本均已自托管，不依赖任何境外 CDN。

## 配置项（`.env`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `QWEN_API_KEY` | 空 | 百炼 / DashScope API Key；为空则演示模式 |
| `QWEN_MODEL` | `qwen-plus` | 可换 `qwen-max`、`qwen-turbo` 等 |
| `QWEN_BASE_URL` | 北京地域兼容接口 | 国际站改为 `dashscope-intl` |
| `QWEN_VL_MODEL` | `qwen-vl-max` | 成绩单识别用的视觉模型 |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | 监听地址 |
| `TRUST_PROXY` | `0` | 在 nginx 后设为 `1` |
| `AI_RATE_PER_HOUR` | `60` | 单 IP 每小时 AI 调用上限 |
| `AI_DAILY_CAP` | `3000` | 全站每日 AI 调用上限 |
| `ALLOW_REGISTER` | `1` | 是否开放注册 |
| `DATA_DIR` | `./data` | SQLite 数据目录 |

## 目录结构

```
server/            零依赖后端
  app.py           HTTP 服务：静态文件、账号、状态同步、AI 代理（SSE）、限流
  prompts.py       12 个 AI 任务的提示词（服务端拼装，前端只传结构化参数）
  guard.py         边界守卫：模型信息保密、无关请求拒答、注入防护、输出过滤
  qwen.py          Qwen 客户端（流式 / JSON 模式）
  mock.py          演示模式离线结果
  store.py         SQLite：账号（PBKDF2）、会话、训练状态
web/
  index.html       应用外壳
  css/             设计系统：base（令牌/外壳）· components · views · print
  js/core/         data 知识库（含 70 条微任务）· model 训练引擎 · batch 本周任务 · plans 培养方案 · project 分支推演
                   · planlog 路径变更日志 · ics 日历导出 · share 分享卡 · pwa · store（多设备三方合并）· ai · ui · demo
                  · testset 错题本（间隔重复）与测试集（真实投递）· feeds 桌面小组件 / 日历订阅
  js/viz/          landscape 损失地形图 · network 能力网络 · charts 曲线/热力图
  js/views/        landing · init · console · objective · branches · pretrain · dataset · schedule · runs · validate · export
                   · settings · batch-ui · planlog-ui · replay（训练回放）
  widget.html      手机桌面小组件页（js/widget.js、css/widget.css）
  sw.js            Service Worker（可安装、离线可打开）；manifest.webmanifest；icons/ 应用图标
  fonts/           自托管字体（Martian Mono / JetBrains Mono / 标题子集字体）
plans/             示例培养方案（测试占位数据）
tools/             build_curricula.py：培养方案 → 前端数据；build_icons.py：生成 PWA 图标（需 Pillow）
deploy/            nginx、systemd、一键部署脚本
docs/DESIGN.md     设计方案
```

## 培养方案（预训练）数据

`plans/` 下是示例培养方案（仅用于测试与占位，不代表任何学校）（Markdown）。修改或新增后运行：

```bash
python3 tools/build_curricula.py
```

脚本会解析课程表、区分必修 / 选修 / 多选一 / 二选一，按规则把课程映射到 12 维能力增益，生成 `web/js/core/curricula.data.js`，并列出未能映射的课程，方便补规则。

## 常见调整

- **增删职业 / 调整能力要求**：`web/js/core/data.js` 中的 `ROLES`（`req` 为 12 维要求，`pos` 为地形图位置）
- **增删实践项目 / 学习资源**：同文件 `PROJECTS`、`RESOURCES`
- **增删每周微任务**：同文件 `MICRO_TASKS`（`lv` 为适用的能力区间，`c` 为验收标准）
- **修改 AI 口吻或输出结构**：`server/prompts.py`
- **调整拒答范围 / 保密规则**：`server/guard.py`（`GUARD` 为提示词规则，`_ID` / `_INJECT` / `_OFFTOPIC` 为预检正则，`SELF_ID_RE` 为输出过滤）
- **调整课程→能力映射**：`tools/build_curricula.py` 中的 `RULES`，改完重新运行脚本
- **修改 loss 公式**：`web/js/core/model.js` 的 `lossOf`，并同步「设置 → 算法说明」
