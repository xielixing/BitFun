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
        --runtime-profile outer_controller --include-detail scheduler
        │
        ├─ should_run / state / reason        → 渲染 goal 卡片
        └─ scheduler_hint
             ├─ cold_path_detail.local_scheduler
             │    ├─ recommended_interval_minutes  → 下次轮询间隔
             │    ├─ unchanged_poll_backoff_multiplier → 决策未变化时指数退避
             │    ├─ max_interval_minutes          → 间隔上限
             │    └─ unchanged_poll_limit / after_limit → 达到上限后停表
             └─ reset_policy.reset_token       → 变化时把间隔重置回推荐值
```

- **心跳只做只读监控**（`quota should-run` + `quota status`）。
- **执行是手动的**：点击 goal 卡片上的 "执行一次" 按钮，确认后运行
  `loopx turn run-once --execute`（上游标注 experimental），输出流式显示在日志面板。
- 切换到其它 BitFun 标签时心跳自动暂停，切回时立即补一次轮询。

## 数据流

```
iframe (ui.js 心跳状态机)
  └─ app.call('loopx.shouldRun', …)      JSON-RPC → BitFun 桥
       └─ worker.js (Node/Bun 进程)
            └─ child_process.spawn(loopx CLI, shell:false)
                 └─ 读写 loopx 状态文件（~/.codex/loopx/ 或 <项目>/.loopx/）
```

## 前置条件

1. **Python 3.11+** 且 loopx 可用，满足以下任一即可（worker 按序探测）：
   - `pip install -e D:\loopx`（推荐，提供 `loopx` 命令）
   - `python -m loopx.cli` 可导入
   - 都不行时，worker 会尝试用 `PYTHONPATH=D:\loopx` 直接跑源码
2. **Bun 或 Node.js**（BitFun worker 运行时）。
3. 至少一个 loopx registry：全局 `~/.codex/loopx/registry.global.json`，
   或某项目下的 `.loopx/registry.json`（在工具栏选择项目目录）。
4. run-once 需要 host adapter：`codex-cli`（需 codex 二进制）或
   `generic-cli`（需在设置中提供 host-command-json）。

## 安装

1. 把本目录整个复制到 BitFun 的 MiniApp 数据目录，目录名必须是 `loopx-console`：
   - Windows: `%APPDATA%\bitfun\data\miniapps\loopx-console\`
   - macOS/Linux: `~/.config/bitfun/data/miniapps/loopx-console/`（macOS 实际为 `~/Library/Application Support/bitfun/...`）
   - 确保 `meta.json`、`package.json`、`storage.json`、`source/` 位于该子目录根部
2. 无 npm 依赖，无需安装依赖。
3. 打开 BitFun → Mini Apps 画廊 → LoopX 控制台。

## 文件

| 文件 | 职责 |
|---|---|
| `source/ui.js` | 心跳状态机（单 setTimeout 链 + 每 goal 到期时间）、渲染、i18n |
| `source/worker.js` | loopx CLI 封装：探测、should-run、turn plan、run-once 流式执行 |
| `source/index.html` / `style.css` | UI 骨架与主题（继承 `--bitfun-*` 令牌，明暗自适应） |
| `meta.json` | 权限：shell(loopx/python/py)、fs 读 home、node worker |

## 独立冒烟测试（脱离 BitFun）

```bash
cd <本目录>
node -e "global.rpcEmit=()=>{}; const w=require('./source/worker.js'); (async()=>{ console.log(await w['loopx.detect']({})); console.log(await w['loopx.listGoals']({})); })()"
```

---

<a name="english"></a>

## English

A BitFun mini-app that hosts LoopX's heartbeat. LoopX ships no scheduler by
design — the host owns the timer. Each heartbeat tick runs the read-only gate
`loopx quota should-run … --runtime-profile outer_controller --include-detail scheduler`,
renders the decision, and re-arms the timer from the returned
`scheduler_hint.local_scheduler` (recommended interval, unchanged-poll backoff,
max clamp, `reset_token` reset semantics). Executing an actual turn
(`loopx turn run-once --execute`, experimental upstream) is manual: a button per
goal with an argv confirmation dialog and streaming logs.

**Install**: copy this folder to `%APPDATA%\bitfun\data\miniapps\loopx-console\`
(Windows; `~/.config/bitfun/data/miniapps/loopx-console/` elsewhere — the
directory name must match the meta `id`), no npm deps. **Prereqs**: Python 3.11+ with
loopx importable (`pip install -e D:\loopx` recommended; the worker falls back
to `python -m loopx.cli`, then to `PYTHONPATH=D:\loopx`), Bun or Node for the
worker, and a loopx registry (global or per-project `.loopx/registry.json`).
