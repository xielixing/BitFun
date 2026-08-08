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
- **看板式 UI**：目标按"需要人做什么"分列——等你处理（gate 置顶）、可运行、
  监控中；停表 / 异常列仅在有成员时出现。每张卡片一句叙述行说明当前该做什么。
- **Issue 快速入口**：粘贴 GitHub issue / PR 链接 → `issue-fix workflow-plan`
  解析（优先在线抓取公开 metadata，失败回退离线 URL 解析）→ 预览分支计划与
  ordered todos → 一键写回所选 goal（逐条 `loopx todo add`）→ 心跳接管。
- **执行是手动的**：点击 goal 卡片上的 "执行一次" 按钮，确认对话框展示的
  argv 与 worker 实际 spawn 的完全一致（同一函数生成），确认后运行
  `loopx turn run-once --execute`（上游标注 experimental）。运行期间 stderr
  进度实时显示在日志面板（loopx 的 json 模式在 stdout 只输出一份最终 JSON），
  可随时点击"取消运行"终止整个进程树。
- 窗口最小化或切到其它 BitFun 标签（iframe 不可见）时心跳自动暂停，
  切回时立即补一次轮询。

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
4. run-once 需要 host adapter：`codex-cli`（默认，需 codex 二进制）或
   `generic-cli`（需在设置中提供 host-command-json 适配器 argv）。

## 安装

在 BitFun 中导入（**必须走导入，不能手动复制目录**——手动复制缺少编译产物，
应用会出现在画廊里但无法打开）：

1. 打开 BitFun → Mini Apps 画廊。
2. 点击 "从文件夹导入"（Import from folder），选择本目录（`MiniApp/Demo/loopx-console`）。
3. 导入即完成编译，画廊中打开 "LoopX 控制台" 即可。无 npm 依赖。

## 文件

| 文件 | 职责 |
|---|---|
| `source/ui.js` | 心跳状态机（单 setTimeout 链 + 每 goal 到期时间）、看板渲染（指纹节流）、issue 入口、i18n |
| `source/worker.js` | loopx CLI 封装：探测、should-run、turn plan、run-once（含取消）、argv 预览、issue intake（workflow-plan → todo 写回） |
| `source/index.html` / `style.css` | 看板 UI 骨架与主题（继承 `--bitfun-*` 令牌，明暗自适应） |
| `meta.json` | 权限：shell(loopx/python/py)、fs 读 home、node worker |

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

The UI is a Symphony-style board organized around "what needs a human":
**Awaiting you** (gates, pinned first), **Should run**, **Monitoring** — with
Stopped / Errors columns appearing only when non-empty. Each card leads with a
one-line narration of the next action. A **+ Issue** entry accepts a GitHub
issue / PR URL: `issue-fix workflow-plan` parses it (live metadata fetch with
an offline URL-only fallback), previews the branch plan and ordered todos, and
one click writes them into a chosen goal via `loopx todo add` — the heartbeat
takes over from there. Executing an actual turn
(`loopx turn run-once --execute`, experimental upstream) stays manual: a
confirmation dialog previews the exact argv the worker will spawn, stderr
streams into the log panel, and cancel kills the whole process tree. The
heartbeat pauses whenever the iframe is hidden and resumes with an immediate
poll.

**Install**: use the Mini Apps gallery's **Import from folder** on this directory
(`MiniApp/Demo/loopx-console`). Do not copy the folder into the miniapps data
directory by hand — the import step compiles the app; a hand-copied bundle
lists in the gallery but cannot open. No npm deps. **Prereqs**: Python 3.11+
with loopx importable (`pip install -e <checkout>`; loopx is not on PyPI yet;
the worker falls back to `python -m loopx.cli` / `py -3 -m loopx.cli`, then to
`PYTHONPATH=<source dir from Settings>`), Bun or Node for the worker, and a
loopx registry (global or per-project `.loopx/registry.json`).
