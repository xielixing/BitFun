# LoopX Console MiniApp

**把 [LoopX](https://github.com/huangruiteng/loopx) 接入 BitFun 的控制台小程序：宿主心跳驱动，自适应轮询间隔，手动触发单次 Turn。**

[English](#english) | 中文

---

## 是什么

LoopX 是一个为长任务 AI Agent 设计的状态内核 + 本地控制平面，它自身**没有调度器** —— 由宿主（本小程序）持有定时器，每次心跳询问 loopx "现在该不该跑"，并按 loopx 返回的调度提示调整下一次唤醒时间。

本小程序实现了 loopx 文档定义的 outer controller 集成模式：

```
心跳 tick
  └─ loopx --format json quota should-run --goal-id G --agent-id A
        --runtime-profile outer_controller --include-scheduler-detail
        │
        ├─ should_run / state / reason        → 渲染 goal 卡片
        └─ scheduler_hint
             ├─ cold_path_detail.local_scheduler
             │    ├─ recommended_interval_minutes  → 下次轮询间隔
             │    ├─ unchanged_poll_backoff_multiplier → 决策未变化时指数退避
             │    ├─ max_interval_minutes          → 间隔上限
             │    └─ unchanged_poll_limit / after_limit → 达到上限后停表
             ├─ unchanged_identity_keys        → "决策未变化" 的判定字段
             └─ reset_policy.reset_token       → 变化时把间隔重置回推荐值
```

- **心跳只做监控**（`quota should-run` + `quota status`），不执行任何 turn。
  注意 loopx 会为每次 should-run 在 `<runtime_root>/goals/<id>/rollout-event-log.jsonl`
  追加一条 rollout 事件（loopx 侧行为，非本程序写入）。
- **输入框优先，Issue 场景专精**：空看板时整个应用就是一个居中大输入框。
  支持三种输入，全部围绕 GitHub Issues（自由目标暂未开放，后续将绑定 loopx
  capabilities）：单个 Issue 链接（走完整 `issue-fix workflow-plan` 生成有序
  todos）；仓库链接或 Issues 列表链接（`…/owner/repo` 或 `…/issues`，通过匿名
  GitHub REST API 展开为 open issues 清单，60 次/小时配额，仅公开仓库）。
- **确认单（唯一的刻意停顿）**：多个 issue 时弹出勾选清单（默认全选，超量
  截断会标注）；已有进行中任务时可选择「新建任务」或「引导现有任务」（引导 =
  把这段话作为 P0 todo 写入选中的 goal，agent 自动注册）。单一 issue 且无
  进行中任务时直接创建，零打扰。
- **执行引擎是 BitFun 自己**：turn 通过宿主 Agent 桥（`app.agent.run`，隐藏
  会话，按 goal 复用）执行；worker 用 `loopx heartbeat-prompt --compact` 生成
  任务体并加上仓库/registry 绑定前言。没有外部 CLI host，用户不需要配置任何
  执行参数（设置里只剩 loopx 探测兜底两项）。
- **自动连续执行**：由输入框创建的任务默认开启 auto-run——每次轮询
  should_run=true 且无 gate 时自动执行下一轮 turn，直到修完全部 todos、
  遇到 gate、或连续失败 3 次熔断（熔断会关闭开关并通知）。
- **审批必须显眼**：等待用户的 goal 置于看板最左列（脉冲高亮 + 徽标），
  卡片直接展示第一条待批事项；详情抽屉列出全部 user 车道 open todos，
  一键「批准 / 完成」（user_gate 自动带 `--decision-outcome approve`）并立即
  重新轮询；新 gate 出现时发系统通知（需要 notifications 权限）。
- 窗口最小化或切到其它 BitFun 标签（iframe 不可见）时心跳暂停，但 turn
  完成后的决策轮询会穿透暂停——后台批量修复与审批通知不受影响。

## 数据流

```
iframe (ui.js 心跳状态机)
  └─ app.call('loopx.shouldRun', …)      JSON-RPC → BitFun 桥
       └─ worker.js (Node/Bun 进程)
            └─ child_process.spawn(loopx CLI, shell:false, PYTHONUTF8=1)
                 └─ 读写 loopx 状态文件（~/.codex/loopx/ 或 <项目>/.loopx/）
```

## 前置条件

1. **Python 3.11+** 且 loopx 可用，满足以下任一即可（worker 按序探测）：
   - 对 loopx 源码 checkout 执行 `pip install -e <目录>`（推荐，提供 `loopx` 命令；loopx 暂未发布到 PyPI）
   - `python -m loopx.cli` / `py -3 -m loopx.cli` 可导入
   - 都不行时，在设置中填写 "loopx 源码目录"，worker 会用 `PYTHONPATH=<该目录>` 直接跑源码
2. **Bun 或 Node.js**（BitFun worker 运行时）。
3. 至少一个 loopx registry：全局 `~/.codex/loopx/registry.global.json`，
   或某项目下的 `.loopx/registry.json`（在工具栏选择项目目录）。
4. Turn 执行由 BitFun 宿主 Agent 完成（meta.json 已声明 agent 权限），
   无需任何外部 CLI host 或适配器配置。

## 安装

### 方式 A：分发包（推荐，无需源码）

1. 在 BitFun 仓库根目录构建安装包：

   ```bash
   pnpm run miniapp:package:loopx
   ```

   输出 `dist/miniapps/org.loopx.console-3.0.0.bitfun-miniapp`
   （ZIP 内含 `bitfun-miniapp.json` 清单 + SHA-256 文件清单，可复现构建）。

2. 打开 BitFun → Mini Apps 画廊 → 点击工具栏的「安装 Mini App 包」按钮，
   选择上面的 `.bitfun-miniapp` 文件。
3. BitFun 会校验包完整性（清单 / 哈希 / 路径安全）并弹出确认单，展示
   publisher、版本、权限和运行时依赖。运行时依赖为 **loopx CLI ≥ 0.2.13**
   （探测 `loopx --version`）；不满足时确认按钮禁用并提示原因。
4. 确认后安装并就地编译，随后自动打开应用。安装记录分发身份
   （package_id / 版本 / publisher），同一包不能重复安装。

### 方式 B：从源码导入（开发迭代）

在 BitFun 中导入（**必须走导入，不能手动复制目录**——手动复制缺少编译产物，
应用会出现在画廊里但无法打开）：

1. 打开 BitFun → Mini Apps 画廊。
2. 点击 "从文件夹导入"（Import from folder），选择本目录（`MiniApp/Demo/loopx-console`）。
3. 导入即完成编译，画廊中打开 "LoopX 控制台" 即可。无 npm 依赖。

## 文件

| 文件 | 职责 |
|---|---|
| `source/ui.js` | 心跳状态机（单 setTimeout 链 + 每 goal 到期时间）、看板渲染（指纹节流）、输入框 intake（分类 → 确认单 → 事件驱动创建）、宿主 Agent turn 执行（app.agent.run + agent:event）、auto-run 熔断、gate 审批、i18n |
| `source/worker.js` | loopx CLI 封装：探测、should-run、resolveIntake（含 GitHub open issues 匿名枚举）、taskIntake（事件驱动批量写入）、turnPrompt（heartbeat-prompt 任务体 + 仓库绑定前言）、todo list/complete |
| `source/index.html` / `style.css` | 首屏 hero + 看板 UI 骨架与主题（继承 `--bitfun-*` 令牌，明暗自适应） |
| `meta.json` | 权限：shell(loopx/python/py)、fs 读 home、net(api.github.com)、系统通知、agent（宿主执行）、node worker |

## 独立冒烟测试（脱离 BitFun）

```bash
cd <本目录>
node -e "global.rpcEmit=()=>{}; const w=require('./source/worker.js'); (async()=>{ console.log(await w['loopx.detect']({})); const g=await w['loopx.listGoals']({}); console.log(g.registryPath, g.goals.length); if(g.goals[0]) console.log(await w['loopx.shouldRun']({goalId:g.goals[0].goalId})); })()"
```

最后一行会真实跑一次 `quota should-run`，确认 flag、编码与 scheduler_hint
解析端到端可用（这正是心跳的主命令）。

---

<a name="english"></a>

## English

A BitFun mini-app that hosts LoopX's heartbeat. LoopX ships no scheduler by
design — the host owns the timer. Each heartbeat tick runs the monitoring gate
`loopx quota should-run … --runtime-profile outer_controller --include-scheduler-detail`,
renders the decision, and re-arms the timer from the returned
`scheduler_hint.cold_path_detail.local_scheduler` (recommended interval,
unchanged-poll backoff, max clamp, `reset_token` reset semantics, and the
contract's `unchanged_identity_keys` for change detection). Note that loopx
itself appends a rollout event per should-run call.

The UI is composer-first and issue-focused: an empty board is one big
centered input that takes a GitHub issue link, a repository link, or an
issues-list URL (`…/owner/repo/issues`) — the latter two expand into the
repo's open issues via the anonymous GitHub REST API (public repos, 60
req/h). Free-form goals are deliberately closed for now (they will bind to
specific loopx capabilities later). The one deliberate stop is a
confirmation sheet: pick which issues to fix (all selected by default,
truncation flagged), and when tasks are already running choose between
**new task** and **guiding an existing task** (guidance lands as a P0 todo;
the agent is auto-registered). Task creation is event-driven
(`taskIntake:progress/done`): bootstrap + register-agent + one
`[P1] Fix GitHub issue #N` todo per issue (a single issue takes the full
`issue-fix workflow-plan` route instead).

Execution runs on BitFun itself: each turn calls `app.agent.run` (the host
agent bridge, one hidden session per goal, reused for context) with a prompt
composed by the worker — `loopx heartbeat-prompt --compact` plus a
repository/registry binding preamble. No external CLI host, no execution
settings; Settings only keeps the loopx-detection fallbacks. Composer-made
tasks default to **auto-run**: every fresh should_run decision with no open
gate fires the next turn, until the todos are done, a gate opens, or three
consecutive failures trip the breaker (which visibly disables the toggle and
notifies).

Approvals are loud by design: gated goals sit in the leftmost board column
with a pulsing highlight and show their first pending ask on the card; the
detail drawer lists all open user-lane todos with one-click approve
(user_gate todos automatically get `--decision-outcome approve`), and a new
gate raises a system notification. The heartbeat pauses while the iframe is
hidden, but post-turn decision polls pierce the pause — background batches
and approval notifications keep flowing.

**Install**: two paths. **Package (preferred)**: build the distributable bundle
from the BitFun repo root with `pnpm run miniapp:package:loopx`
(→ `dist/miniapps/org.loopx.console-3.0.0.bitfun-miniapp`, a reproducible ZIP
with a `bitfun-miniapp.json` manifest and SHA-256 file list), then click the
install-package action in the Mini Apps gallery, pick the file, and review the
publisher/version/permissions/runtime-dependency report (loopx CLI >= 0.2.13,
probed via `loopx --version`) before confirming; the app is compiled locally
and opened after install, and the distribution identity prevents duplicate
installs. **From source**: use the Mini Apps gallery's **Import from folder** on
this directory (`MiniApp/Demo/loopx-console`). Do not copy the folder into the
miniapps data directory by hand — the import step compiles the app; a
hand-copied bundle lists in the gallery but cannot open. No npm deps.
**Prereqs**: Python 3.11+ with loopx importable (`pip install -e <checkout>`;
loopx is not on PyPI yet; the worker falls back to `python -m loopx.cli` /
`py -3 -m loopx.cli`, then to `PYTHONPATH=<source dir from Settings>`), Bun or
Node for the worker, and a loopx registry (global or per-project
`.loopx/registry.json`).
