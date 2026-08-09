// LoopX Console — UI + host heartbeat.
// The heartbeat is a single setTimeout chain armed to the earliest per-goal
// due time; each poll's interval is dictated by loopx's scheduler_hint
// (recommended interval, unchanged-poll backoff, max clamp, reset_token).
// Rendering is fingerprint-throttled: unchanged decisions repaint nothing but
// the 1s countdown, and re-renders are deferred while a card input has focus.

const app = window.app;

const I18N = {
  'zh-CN': {
    title: 'LoopX 控制台',
    subtitle: '宿主心跳 · 自适应轮询 · 单次 Turn',
    globalRegistry: '全局 Registry',
    refresh: '刷新目标列表',
    settings: '设置',
    retry: '重试',
    notFoundTitle: '未检测到 loopx CLI',
    notFoundHint: '请先安装 loopx（对源码 checkout 执行 pip install -e），或在设置中指定调用命令 / 源码目录，然后点击重试。',
    goalsEmpty: '尚无任务',
    onboardTitle: '开始使用',
    onboardStep1: '安装 loopx：对源码 checkout 执行 pip install -e <目录>（左上角出现红色横幅说明还没检测到）',
    onboardStep2: '选择数据源：默认读"全局 Registry"——loopx 用 sync-global 把所有项目的 goals 汇总到 ~/.codex/loopx/registry.global.json；点上方文件夹按钮可改为读某个项目的 .loopx/registry.json',
    onboardStep3: '有 goal 后这里变成看板：等你处理（gate）/ 可运行 / 监控中，心跳会按 loopx 的调度提示自动轮询',
    onboardStep4: '或者直接点 ＋ Issue，粘贴一个 GitHub issue 链接，从一个 issue 开始自动修复',
    projectBtnHint: '选择包含 .loopx/registry.json 的项目目录；不选则读全局 Registry（~/.codex/loopx/registry.global.json，loopx 汇总的所有项目 goals）',
    logTitle: '心跳与执行日志',
    monitor: '监控',
    agent: 'Agent',
    agentFree: '手动输入 agent id…',
    plan: 'Plan',
    runOnce: '执行一次',
    cancelRun: '取消运行',
    running: (t) => `运行中 ${t}`,
    lastRun: (code, s) => `上次运行 exit=${code} · ${s}s`,
    lastRunCancelled: '上次运行已取消',
    resume: '已暂停 · 点击恢复',
    nextPoll: (t) => `下次轮询 ${t}`,
    intervalMath: (iv, base, mult, n, cap) => `间隔 ${iv}m（基准 ${base}m ×${mult}^${n}，上限 ${cap}m）`,
    intervalPlain: (iv) => `间隔 ${iv}m`,
    unchangedTimes: (n) => `未变化 ×${n}`,
    retryIn: (n, t) => `↻ 轮询失败 ×${n} · ${t} 后重试`,
    waitingOn: (w) => `等待：${w}`,
    runConfirmTitle: '执行单次 Turn？',
    runConfirmNote: '将执行以下命令（experimental）：',
    runConfirm: '执行',
    cancel: '取消',
    save: '保存',
    setPrefix: 'loopx 调用命令（JSON 数组，留空自动探测）',
    setSrcDir: 'loopx 源码目录（可选，探测失败时作为 PYTHONPATH 兜底）',
    setHost: 'Run-once host',
    setCodexBin: 'codex 可执行文件路径',
    setHostJson: 'host-command-json（generic-cli 适配器 argv）',
    setValidationJson: 'validation-command-json（独立校验器 argv）',
    setTimeout: 'Run-once 超时（秒，≤240）',
    needProject: '执行 run-once 需要先选择项目目录',
    needAgent: '该目标没有已注册的 agent，请先填写 agent id',
    needHostJson: 'generic-cli host 需要在设置中填写 host-command-json（适配器 argv），或改用 codex-cli',
    detected: (v) => `已检测到 loopx：${v}`,
    copy: '复制',
    close: '关闭',
    raw: 'JSON',
    groupGated: '等你处理',
    groupRun: '可运行',
    groupWait: '监控中',
    groupPaused: '已停表',
    groupError: '异常',
    groupGatedHint: '这些目标由你或 controller 解锁后才能继续',
    groupRunHint: 'loopx 判定现在可以执行一次 turn',
    groupWaitHint: '按 loopx 推荐间隔静默轮询中',
    groupPausedHint: '达到未变化上限已停表，点击恢复重新开始',
    groupErrorHint: '轮询失败，按错误退避自动重试',
    colEmpty: '暂无',
    issueAdd: '＋ Issue',
    issueTitle: '从 GitHub Issue 开始修复',
    issueUrl: 'Issue / PR 链接',
    issueGoal: '写入到 goal',
    issueParse: '解析',
    issueParsing: '解析中…',
    issueWrite: (n) => `写入 ${n} 个 todos`,
    issueNoGoals: '当前注册表没有 goal——先选择项目目录，或在 loopx 中创建 goal',
    issueBranchLabel: '分支计划',
    issueTodosLabel: '将写入的 todos',
    issueWritten: (okN, n) => `已写入 ${okN}/${n} 个 todos`,
    presenceLive: '心跳运行中',
    presencePaused: '心跳已暂停',
    presenceIdle: '心跳未启动',
    presenceNoCli: 'loopx 不可用',
    hbNext: (t) => `下次心跳 ${t}`,
    hbChecking: '正在检查…',
    runCancelled: '运行已取消',
    groupBacklog: '待处理',
    groupReady: '待执行',
    groupActive: '进行中',
    groupReview: '人工确认',
    hiddenStates: '隐藏状态',
    groupDone: '已完成',
    detailOverview: '当前动作',
    detailStatus: '状态',
    detailState: '阶段',
    detailControls: '执行设置',
    detailAgent: 'Agent',
    detailHeartbeat: '心跳',
    detailLastRun: '最近执行',
    detailSchedule: '下次轮询',
    taskPlaceholder: '描述你想完成的目标，或粘贴 GitHub Issue / 仓库链接',
    taskCreate: '创建任务',
    taskCreating: '正在创建任务…',
    taskPendingLabel: '正在创建',
    taskStageCreating: '正在创建 LoopX 任务',
    taskStageStarting: '任务已创建，正在启动 Agent',
    taskStarted: (id) => `任务 ${id} 已创建并开始执行`,
    activityTitle: '实时活动',
    activityStarting: '正在启动 Agent…',
    activityRunning: (elapsed) => `Agent 正在执行 · 已用时 ${elapsed}`,
    activityCommitted: 'LoopX 已提交本次执行结果',
    activityValidationPassed: '独立校验已通过',
    activityValidationFailed: '独立校验未通过',
    activityStateUpdated: '目标状态已更新',
    activityCompleted: '执行已完成',
    activityCompletedValidated: '执行已完成 · 校验通过',
    activityFailed: '执行失败',
    taskGoal: '普通目标',
    taskRepository: 'GitHub 仓库',
    taskIssue: 'GitHub Issue',
    taskIssues: (n) => `${n} 个 Issue`,
    taskNeedProject: '请先选择这个任务对应的本地项目目录。',
    taskNeedAgent: '请先在设置中配置新任务默认 Agent。',
    taskCreated: (id) => `任务 ${id} 已创建`,
    taskRepoMismatch: (expected, actual) => `链接指向 ${expected}，当前项目是 ${actual}。请切换到正确的本地 checkout。`,
    taskMultipleRepos: '一个任务只能绑定一个本地仓库，请把不同仓库的链接拆成多个任务。',
    setDefaultAgent: '新任务默认 Agent',
  },
  'en-US': {
    title: 'LoopX Console',
    subtitle: 'Host heartbeat · Adaptive polling · One-shot turns',
    globalRegistry: 'Global registry',
    refresh: 'Refresh goals',
    settings: 'Settings',
    retry: 'Retry',
    notFoundTitle: 'loopx CLI not found',
    notFoundHint: 'Install loopx first (pip install -e on a source checkout), or set the invocation command / source directory in Settings, then retry.',
    goalsEmpty: 'No tasks yet',
    onboardTitle: 'Getting started',
    onboardStep1: 'Install loopx: run pip install -e <dir> on a source checkout (a red banner up top means it is not detected yet)',
    onboardStep2: 'Pick a data source: by default this reads the "global registry" — loopx aggregates every project\'s goals into ~/.codex/loopx/registry.global.json via sync-global; use the folder button above to read one project\'s .loopx/registry.json instead',
    onboardStep3: 'Once goals exist this becomes a board: Awaiting you (gates) / Should run / Monitoring — the heartbeat polls on loopx\'s scheduler hints',
    onboardStep4: 'Or click + Issue and paste a GitHub issue URL to start an auto-fix from a single issue',
    projectBtnHint: 'Pick a project directory containing .loopx/registry.json; without one, the console reads the global registry (~/.codex/loopx/registry.global.json, all projects\' goals aggregated by loopx)',
    logTitle: 'Heartbeat & execution log',
    monitor: 'Monitor',
    agent: 'Agent',
    agentFree: 'Type agent id…',
    plan: 'Plan',
    runOnce: 'Run once',
    cancelRun: 'Cancel run',
    running: (t) => `running ${t}`,
    lastRun: (code, s) => `last run exit=${code} · ${s}s`,
    lastRunCancelled: 'last run cancelled',
    resume: 'Paused · click to resume',
    nextPoll: (t) => `next poll in ${t}`,
    intervalMath: (iv, base, mult, n, cap) => `every ${iv}m (base ${base}m ×${mult}^${n}, cap ${cap}m)`,
    intervalPlain: (iv) => `every ${iv}m`,
    unchangedTimes: (n) => `unchanged ×${n}`,
    retryIn: (n, t) => `↻ poll failed ×${n} · retry in ${t}`,
    waitingOn: (w) => `waiting on: ${w}`,
    runConfirmTitle: 'Run one turn?',
    runConfirmNote: 'The following command will run (experimental):',
    runConfirm: 'Run',
    cancel: 'Cancel',
    save: 'Save',
    setPrefix: 'loopx invocation (JSON array, empty = auto-detect)',
    setSrcDir: 'loopx source checkout (optional PYTHONPATH fallback)',
    setHost: 'Run-once host',
    setCodexBin: 'codex binary path',
    setHostJson: 'host-command-json (generic-cli adapter argv)',
    setValidationJson: 'validation-command-json (independent validator argv)',
    setTimeout: 'Run-once timeout (seconds, ≤240)',
    needProject: 'Run-once requires a project directory',
    needAgent: 'This goal has no registered agent — type an agent id first',
    needHostJson: 'The generic-cli host needs host-command-json (adapter argv) in Settings — or switch to codex-cli',
    detected: (v) => `loopx detected: ${v}`,
    copy: 'Copy',
    close: 'Close',
    raw: 'JSON',
    groupGated: 'Awaiting you',
    groupRun: 'Should run',
    groupWait: 'Monitoring',
    groupPaused: 'Stopped',
    groupError: 'Errors',
    groupGatedHint: 'Blocked until you or the controller unlock them',
    groupRunHint: 'loopx says a turn can run now',
    groupWaitHint: 'Quietly polling at the loopx-recommended interval',
    groupPausedHint: 'Stopped by the unchanged-poll limit — click resume to re-arm',
    groupErrorHint: 'Polling failed — retrying automatically with backoff',
    colEmpty: 'Nothing here',
    issueAdd: '+ Issue',
    issueTitle: 'Start a fix from a GitHub issue',
    issueUrl: 'Issue / PR URL',
    issueGoal: 'Write into goal',
    issueParse: 'Parse',
    issueParsing: 'Parsing…',
    issueWrite: (n) => `Write ${n} todos`,
    issueNoGoals: 'No goals in the current registry — pick a project directory, or create a goal in loopx first',
    issueBranchLabel: 'Branch plan',
    issueTodosLabel: 'Todos to write',
    issueWritten: (okN, n) => `wrote ${okN}/${n} todos`,
    presenceLive: 'Heartbeat live',
    presencePaused: 'Heartbeat paused',
    presenceIdle: 'Heartbeat idle',
    presenceNoCli: 'loopx unavailable',
    hbNext: (t) => `next tick in ${t}`,
    hbChecking: 'checking now…',
    runCancelled: 'run cancelled',
    groupBacklog: 'Backlog',
    groupReady: 'Ready',
    groupActive: 'In progress',
    groupReview: 'Review',
    hiddenStates: 'Hidden states',
    groupDone: 'Done',
    detailOverview: 'Current action',
    detailStatus: 'Status',
    detailState: 'Stage',
    detailControls: 'Execution settings',
    detailAgent: 'Agent',
    detailHeartbeat: 'Heartbeat',
    detailLastRun: 'Last run',
    detailSchedule: 'Next poll',
    taskPlaceholder: 'Describe what you want to accomplish, or paste GitHub Issue / repository links',
    taskCreate: 'Create task',
    taskCreating: 'Creating task…',
    taskPendingLabel: 'Creating',
    taskStageCreating: 'Creating the LoopX task',
    taskStageStarting: 'Task created, starting the Agent',
    taskStarted: (id) => `Task ${id} created and started`,
    activityTitle: 'Live activity',
    activityStarting: 'Starting the Agent…',
    activityRunning: (elapsed) => `Agent is working · ${elapsed} elapsed`,
    activityCommitted: 'LoopX committed this run',
    activityValidationPassed: 'Independent validation passed',
    activityValidationFailed: 'Independent validation failed',
    activityStateUpdated: 'Goal state updated',
    activityCompleted: 'Run completed',
    activityCompletedValidated: 'Run completed · validation passed',
    activityFailed: 'Run failed',
    taskGoal: 'Goal',
    taskRepository: 'GitHub repository',
    taskIssue: 'GitHub Issue',
    taskIssues: (n) => `${n} Issues`,
    taskNeedProject: 'Select the local project directory for this task first.',
    taskNeedAgent: 'Configure the default Agent for new tasks in Settings first.',
    taskCreated: (id) => `Task ${id} created`,
    taskRepoMismatch: (expected, actual) => `The link targets ${expected}, but the current project is ${actual}. Select the matching local checkout.`,
    taskMultipleRepos: 'One task can bind only one local repository. Split links from different repositories into separate tasks.',
    setDefaultAgent: 'Default Agent for new tasks',
  },
};

function t(key, ...args) {
  const table = {};
  for (const [loc, entries] of Object.entries(I18N)) table[loc] = entries[key];
  const v = app.t(table, I18N['en-US'][key]);
  return typeof v === 'function' ? v(...args) : v;
}

// ── state ─────────────────────────────────────────────────
const DEFAULT_INTERVAL_MIN = 1;
const ERROR_BACKOFF_CAP_MIN = 30;

const S = {
  config: {
    projectDir: null, argvPrefix: null, srcDir: '', agentByGoal: {}, monitorByGoal: {},
    host: 'codex-cli', codexBin: '', hostCommandJson: '', validationCommandJson: '',
    defaultAgentId: '', timeoutSeconds: 120,
  },
  detect: null,
  goals: new Map(), // goalId -> G
  timer: null,
  countdownTimer: null,
  paused: false,
  renderPending: false,
  activeGoalId: null,
  intakeDraft: null,
  archiveOpen: new Set(),
  logs: [],
};

function newGoalState(goalId, info) {
  return {
    goalId,
    objective: info.objective || null,
    agents: info.agents || [],
    agentId: S.config.agentByGoal[goalId] || (info.agents && info.agents[0]) || '',
    state: info.state || null,
    waitingOn: info.waitingOn ?? null,
    monitoring: S.config.monitorByGoal[goalId] !== false,
    intervalMin: DEFAULT_INTERVAL_MIN,
    nextDueAt: 0,
    unchangedCount: 0,
    errorCount: 0,
    lastError: null,
    lastResetToken: null,
    lastDecisionKey: null,
    hint: null,          // { base, mult, cap } for the interval-math line
    stopped: false,
    polling: false,
    repollQueued: false,
    running: false,
    runStartedAt: 0,
    lastRun: null,       // { exitCode, durationMs, status, ok, cancelled }
    last: null,          // normalized shouldRun result
    activityLines: [],
    currentActivity: '',
  };
}

// ── logging ───────────────────────────────────────────────
function log(msg, isErr = false) {
  const time = new Date().toTimeString().slice(0, 8);
  S.logs.push({ time, msg, isErr });
  if (S.logs.length > 500) S.logs.splice(0, S.logs.length - 500);
  const body = document.getElementById('log-body');
  const div = document.createElement('div');
  div.className = 'log-line' + (isErr ? ' log-line--err' : '');
  const ts = document.createElement('span');
  ts.className = 't';
  ts.textContent = time;
  div.appendChild(ts);
  div.appendChild(document.createTextNode(msg));
  body.appendChild(div);
  while (body.children.length > 500) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
  document.getElementById('log-count').textContent = String(S.logs.length);
}

// ── config persistence ────────────────────────────────────
async function loadConfig() {
  try {
    const stored = await app.storage.get('config');
    if (stored && typeof stored === 'object') Object.assign(S.config, stored);
  } catch (_) {}
  // Older configs stored '' for a "loopx decides" host that upstream does not
  // have (run-once defaults to generic-cli and then hard-requires an adapter).
  if (S.config.host !== 'codex-cli' && S.config.host !== 'generic-cli') {
    S.config.host = 'codex-cli';
  }
  if (!S.config.defaultAgentId) {
    S.config.defaultAgentId = Object.values(S.config.agentByGoal || {}).find(Boolean) || '';
  }
}
async function saveConfig() {
  try { await app.storage.set('config', S.config); } catch (_) {}
}

// ── heartbeat scheduling ──────────────────────────────────
function rearmTimer() {
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  if (S.paused) return;
  let earliest = Infinity;
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt < earliest) earliest = g.nextDueAt;
  }
  if (earliest === Infinity) return;
  const delay = Math.max(0, earliest - Date.now());
  S.timer = setTimeout(onTimerFire, Math.min(delay, 2147000000));
}

function onTimerFire() {
  S.timer = null;
  const now = Date.now();
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt <= now) pollGoal(g);
  }
  rearmTimer();
}

function valueAtPath(obj, path) {
  return path.split('.').reduce((c, p) => (c && typeof c === 'object' ? c[p] : undefined), obj);
}

// Prefer the contract's unchanged_identity_keys over home-grown fields:
// free-text `reason` embeds live quota fractions and would defeat backoff.
function decisionKey(res) {
  const keys = res.scheduler?.unchangedIdentityKeys;
  if (keys && keys.length && res.raw) {
    return keys.map((k) => String(valueAtPath(res.raw, k))).join('|');
  }
  return [res.shouldRun, res.state, res.effectiveAction].map(String).join('|');
}

function applyPollError(g, message) {
  g.errorCount += 1;
  g.lastError = message;
  g.intervalMin = Math.min(Math.pow(2, g.errorCount), ERROR_BACKOFF_CAP_MIN);
  log(`[${g.goalId}] poll failed ×${g.errorCount}: ${message}`, true);
}

async function pollGoal(g) {
  if (g.polling) return;
  g.polling = true;
  renderGoal(g);
  try {
    const res = await app.call('loopx.shouldRun', {
      argvPrefix: S.config.argvPrefix,
      projectDir: S.config.projectDir,
      goalId: g.goalId,
      agentId: g.agentId || undefined,
    });
    if (res.raw) g.last = res; // keep partial payloads visible (reason, state)
    if (res.ok === false || res.error) {
      // CLI-level failure (bad exit / no JSON) is an error, not a decision.
      applyPollError(g, res.error || res.reason || 'loopx exited non-zero');
      return;
    }
    g.errorCount = 0;
    g.lastError = null;
    // shouldRun is authoritative for the gate: a cleared waiting_on (null)
    // must un-gate the goal rather than stick to the stale listGoals value.
    g.waitingOn = res.waitingOn ?? null;
    const sched = res.scheduler || {};
    const recommended = Number(sched.recommendedIntervalMinutes) || DEFAULT_INTERVAL_MIN;
    const maxIv = Number(sched.maxIntervalMinutes) || Math.max(recommended, 60);
    const backoff = Number(sched.backoffMultiplier) || 2;
    g.hint = { base: recommended, mult: backoff, cap: maxIv };
    const token = sched.resetToken || null;
    const key = decisionKey(res);

    if (token !== g.lastResetToken) {
      // loopx-side goal mutation → reset cadence to the fresh recommendation
      g.lastResetToken = token;
      g.intervalMin = recommended;
      g.unchangedCount = 0;
      g.stopped = false;
      log(`[${g.goalId}] reset_token changed → interval ${g.intervalMin}m`);
    } else if (key !== g.lastDecisionKey) {
      g.intervalMin = recommended;
      g.unchangedCount = 0;
      log(`[${g.goalId}] decision changed (${res.state ?? '?'}/${res.shouldRun}) → interval ${g.intervalMin}m`);
    } else {
      g.unchangedCount += 1;
      g.intervalMin = Math.min(g.intervalMin * backoff, maxIv);
      const limit = sched.unchangedPollLimit;
      if (limit != null && g.unchangedCount >= limit && sched.afterLimit === 'stop_tick_loop') {
        g.stopped = true;
        log(`[${g.goalId}] unchanged ×${g.unchangedCount} ≥ limit → tick loop stopped`);
      } else {
        log(`[${g.goalId}] unchanged ×${g.unchangedCount} → backoff to ${g.intervalMin.toFixed(1)}m`);
      }
    }
    g.lastDecisionKey = key;
    g.intervalMin = Math.min(Math.max(g.intervalMin, recommended), maxIv);
  } catch (err) {
    applyPollError(g, String(err.message || err));
  } finally {
    g.nextDueAt = Date.now() + g.intervalMin * 60000;
    g.polling = false;
    renderGoal(g);
    rearmTimer();
    if (g.repollQueued) {
      g.repollQueued = false;
      pollNow(g);
    }
  }
}

function pollNow(g) {
  if (g.polling) {
    // A poll is in flight; queue exactly one follow-up instead of silently
    // dropping the request (matters after run-once completes).
    g.repollQueued = true;
    return;
  }
  g.nextDueAt = 0;
  g.stopped = false;
  if (S.paused) return; // due immediately once the heartbeat resumes
  pollGoal(g).then(rearmTimer);
}

// ── pause / resume (lifecycle + visibility) ───────────────
function pauseHeartbeat() {
  if (S.paused) return;
  S.paused = true;
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
  updateHeaderStatus();
}

function resumeHeartbeat() {
  if (!S.paused) return;
  S.paused = false;
  const now = Date.now();
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && g.nextDueAt <= now) pollGoal(g);
  }
  rearmTimer();
  updateHeaderStatus();
}

// ── rendering ─────────────────────────────────────────────
function isGated(g) {
  // After a successful poll, its waiting_on is authoritative (may be null);
  // before one, fall back to the listGoals snapshot.
  const w = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
  if (w === 'user' || w === 'controller') return true;
  const s = String(g.last?.state || g.state || '').toLowerCase();
  return /gate|user_action|operator/.test(s);
}

// The board mirrors an issue tracker: active workflow stays in the main four
// columns while terminal and exceptional states remain reachable in a quiet
// side rail.
const PRIMARY_GROUPS = ['backlog', 'ready', 'active', 'review'];
const ARCHIVE_GROUPS = ['done', 'paused', 'error'];
const GROUP_I18N_KEY = {
  backlog: 'groupBacklog', ready: 'groupReady', active: 'groupActive', review: 'groupReview',
  done: 'groupDone', paused: 'groupPaused', error: 'groupError',
};

function isTerminal(g) {
  const state = String(g.last?.state || g.state || '').toLowerCase();
  return /(^|_)(terminal|completed|complete|done|cancelled|canceled|duplicate|merged|closed)(_|$)/.test(state)
    || state.includes('no_followup');
}

function goalGroup(g) {
  if (g.running) return 'active';
  if (isTerminal(g)) return 'done';
  if (g.errorCount > 0) return 'error';
  if (g.stopped) return 'paused';
  if (isGated(g)) return 'review';
  if (g.last?.shouldRun === true) return 'ready';
  return 'backlog';
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtInterval(iv) {
  return iv.toFixed(iv < 10 ? 1 : 0);
}

// Scheduler legibility: expose the interval arithmetic instead of a bare
// number, so "why hasn't it polled" is answerable from the card.
function goalMetaText(g) {
  const now = Date.now();
  if (g.polling) return '…';
  if (g.errorCount > 0) return t('retryIn', g.errorCount, fmtCountdown(g.nextDueAt - now));
  const cd = t('nextPoll', fmtCountdown(g.nextDueAt - now));
  if (g.hint && g.unchangedCount > 0) {
    return `${cd} · ${t('intervalMath', fmtInterval(g.intervalMin), fmtInterval(g.hint.base), g.hint.mult, g.unchangedCount, fmtInterval(g.hint.cap))}`;
  }
  return `${cd} · ${t('intervalPlain', fmtInterval(g.intervalMin))}`;
}

function showRawJson(g) {
  document.getElementById('raw-title').textContent = `${g.goalId} · ${t('raw')}`;
  document.getElementById('raw-body').textContent = g.last?.raw
    ? JSON.stringify(g.last.raw, null, 2)
    : JSON.stringify(g.last ?? {}, null, 2);
  document.getElementById('dlg-raw').showModal();
}

function renderGoal(_g) {
  renderAllGoals();
}

function shortScheduleText(g) {
  if (g.polling) return t('hbChecking');
  if (g.errorCount > 0) return t('retryIn', g.errorCount, fmtCountdown(g.nextDueAt - Date.now()));
  if (g.stopped) return t('resume');
  if (g.monitoring) return t('nextPoll', fmtCountdown(g.nextDueAt - Date.now()));
  return t('presenceIdle');
}

function goalNarration(g) {
  return g.objective || g.last?.recommendedAction || g.last?.reason || g.lastError
    || g.last?.state || g.state || g.goalId;
}

function activityText(line) {
  const text = String(line || '')
    .replace(/^\s*(?:\[[^\]]+\]\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function activityLineElement(entry) {
  const row = document.createElement('div');
  row.className = 'activity-stream__line' + (entry.isErr ? ' activity-stream__line--err' : '');
  const time = document.createElement('span');
  time.className = 'activity-stream__time';
  time.textContent = entry.time;
  const text = document.createElement('span');
  text.textContent = entry.line;
  row.append(time, text);
  return row;
}

function recordGoalActivity(g, line, isErr = false) {
  const summary = activityText(line);
  if (!summary) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const entry = { time: new Date().toTimeString().slice(0, 8), line: summary, isErr };
  g.activityLines.push(entry);
  if (g.activityLines.length > 240) g.activityLines.splice(0, g.activityLines.length - 240);
  g.currentActivity = summary;

  const cardText = document.querySelector(`.goal__activity-text[data-goal="${CSS.escape(g.goalId)}"]`);
  if (cardText) cardText.textContent = summary;

  const stream = document.querySelector(`.activity-stream[data-goal="${CSS.escape(g.goalId)}"]`);
  if (stream) {
    const followTail = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 32;
    stream.appendChild(activityLineElement(entry));
    while (stream.children.length > 240) stream.removeChild(stream.firstChild);
    if (followTail) stream.scrollTop = stream.scrollHeight;
  } else {
    const dlg = document.getElementById('dlg-goal');
    if (dlg.open && S.activeGoalId === g.goalId) renderGoalDetails(g);
  }
}

function buildIntakeCard(draft) {
  const el = document.createElement('div');
  el.className = 'goal goal--pending';
  const head = document.createElement('div');
  head.className = 'goal__head';
  const dot = document.createElement('span');
  dot.className = 'dot dot--ready';
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = t('taskPendingLabel');
  head.append(dot, id);
  const narration = document.createElement('div');
  narration.className = 'goal__reason';
  narration.textContent = draft.objective;
  const activity = document.createElement('div');
  activity.className = 'goal__activity goal__activity--live';
  const pulse = document.createElement('span');
  pulse.className = 'goal__activity-dot';
  const text = document.createElement('span');
  text.className = 'goal__activity-text';
  text.textContent = draft.stage;
  activity.append(pulse, text);
  el.append(head, narration, activity);
  return el;
}

function buildGoalCard(g, compact = false) {
  const group = goalGroup(g);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'goal' + (compact ? ' goal--terminal' : '');
  el.id = `goal-${g.goalId}`;
  el.setAttribute('aria-label', g.goalId);
  el.onclick = () => openGoalDetails(g);

  const head = document.createElement('div');
  head.className = 'goal__head';
  const dot = document.createElement('span');
  dot.className = `dot dot--${group}`;
  head.appendChild(dot);
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = g.goalId;
  head.appendChild(id);
  el.appendChild(head);

  const narration = document.createElement('div');
  narration.className = 'goal__reason' + (g.lastError ? ' goal__reason--err' : '');
  narration.textContent = goalNarration(g);
  if (g.last?.recommendedAction && g.last?.reason) narration.title = g.last.reason;
  el.appendChild(narration);

  if (g.running || g.currentActivity) {
    const activity = document.createElement('div');
    activity.className = 'goal__activity' + (g.running ? ' goal__activity--live' : '');
    const pulse = document.createElement('span');
    pulse.className = 'goal__activity-dot';
    const text = document.createElement('span');
    text.className = 'goal__activity-text';
    text.dataset.goal = g.goalId;
    text.textContent = g.currentActivity || t('activityStarting');
    activity.append(pulse, text);
    el.appendChild(activity);
  }

  const meta = document.createElement('div');
  meta.className = 'goal__meta';
  if (g.agentId) {
    const agent = document.createElement('span');
    agent.textContent = g.agentId;
    meta.appendChild(agent);
  }
  if (meta.children.length) el.appendChild(meta);
  return el;
}

function appendDetailRow(grid, key, value, className = '') {
  const k = document.createElement('div');
  k.className = 'detail__key';
  k.textContent = key;
  const v = document.createElement('div');
  v.className = `detail__value ${className}`.trim();
  v.textContent = value || '—';
  grid.append(k, v);
}

async function requestTurnPlan(g, button) {
  if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
  button.disabled = true;
  try {
    const res = await app.call('loopx.turnPlan', {
      argvPrefix: S.config.argvPrefix, projectDir: S.config.projectDir,
      goalId: g.goalId, agentId: g.agentId, host: S.config.host,
    });
    log(`[${g.goalId}] turn plan → ${res.route ?? JSON.stringify(res.raw)?.slice(0, 200)}`);
  } catch (err) {
    log(`[${g.goalId}] turn plan error: ${err.message || err}`, true);
  } finally { button.disabled = false; }
}

async function cancelGoalRun(g, button) {
  button.disabled = true;
  try {
    const res = await app.call('loopx.cancelRunOnce', { goalId: g.goalId });
    if (!res.ok) log(`[${g.goalId}] cancel: ${res.error}`, true);
  } catch (err) {
    log(`[${g.goalId}] cancel error: ${err.message || err}`, true);
    button.disabled = false;
  }
}

function renderGoalDetails(g) {
  const dlg = document.getElementById('dlg-goal');
  if (!dlg.open || S.activeGoalId !== g.goalId) return;
  if (!Array.isArray(g.activityLines)) g.activityLines = [];
  if (typeof g.currentActivity !== 'string') g.currentActivity = '';
  const active = document.activeElement;
  if (active && dlg.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;

  const group = goalGroup(g);
  document.getElementById('goal-detail-kicker').textContent = t(GROUP_I18N_KEY[group]);
  document.getElementById('goal-detail-title').textContent = g.goalId;
  const body = document.getElementById('goal-detail-body');
  body.replaceChildren();

  const overview = document.createElement('section');
  overview.className = 'detail__section';
  const overviewLabel = document.createElement('div');
  overviewLabel.className = 'detail__label';
  overviewLabel.textContent = t('detailOverview');
  const action = document.createElement('div');
  action.className = 'detail__action' + (g.lastError ? ' goal__reason--err' : '');
  action.textContent = goalNarration(g);
  overview.append(overviewLabel, action);
  const detailReason = g.objective
    ? (g.last?.recommendedAction || g.last?.reason)
    : (g.last?.recommendedAction && g.last?.reason ? g.last.reason : null);
  if (detailReason && detailReason !== goalNarration(g)) {
    const reason = document.createElement('div');
    reason.className = 'detail__reason';
    reason.textContent = detailReason;
    overview.appendChild(reason);
  }
  body.appendChild(overview);

  if (g.running || g.activityLines.length) {
    const activity = document.createElement('section');
    activity.className = 'detail__section';
    const activityLabel = document.createElement('div');
    activityLabel.className = 'detail__label';
    activityLabel.textContent = t('activityTitle');
    const stream = document.createElement('div');
    stream.className = 'activity-stream';
    stream.dataset.goal = g.goalId;
    for (const entry of g.activityLines) stream.appendChild(activityLineElement(entry));
    activity.append(activityLabel, stream);
    body.appendChild(activity);
    requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
  }

  const status = document.createElement('section');
  status.className = 'detail__section';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'detail__label';
  statusLabel.textContent = t('detailStatus');
  const grid = document.createElement('div');
  grid.className = 'detail__grid';
  const waiting = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
  appendDetailRow(grid, t('detailState'), waiting ? `${g.last?.state ?? g.state ?? '—'} · ${t('waitingOn', waiting)}` : (g.last?.state ?? g.state));
  appendDetailRow(grid, t('detailAgent'), g.agentId);
  appendDetailRow(grid, t('detailHeartbeat'), g.monitoring ? t('presenceLive') : t('presenceIdle'));
  appendDetailRow(grid, t('detailSchedule'), goalMetaText(g), g.errorCount ? 'countdown--err' : '');
  if (g.lastRun) {
    appendDetailRow(grid, t('detailLastRun'), g.lastRun.cancelled
      ? t('lastRunCancelled')
      : t('lastRun', g.lastRun.exitCode, Math.round((g.lastRun.durationMs || 0) / 1000)),
    !g.lastRun.ok && !g.lastRun.cancelled ? 'goal__lastrun--err' : '');
  }
  status.append(statusLabel, grid);
  body.appendChild(status);

  const controls = document.createElement('section');
  controls.className = 'detail__section detail__controls';
  const controlsLabel = document.createElement('div');
  controlsLabel.className = 'detail__label';
  controlsLabel.textContent = t('detailControls');
  controls.appendChild(controlsLabel);
  const agentField = document.createElement('label');
  agentField.className = 'field';
  const agentLabel = document.createElement('span');
  agentLabel.textContent = t('agent');
  agentField.appendChild(agentLabel);
  if (g.agents.length) {
    const select = document.createElement('select');
    const options = g.agentId && !g.agents.includes(g.agentId) ? [...g.agents, g.agentId] : g.agents;
    for (const agentId of options) {
      const option = document.createElement('option');
      option.value = agentId;
      option.textContent = agentId;
      option.selected = agentId === g.agentId;
      select.appendChild(option);
    }
    select.onchange = () => {
      g.agentId = select.value;
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
      renderAllGoals(true);
    };
    agentField.appendChild(select);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('agentFree');
    input.value = g.agentId;
    input.onchange = () => {
      g.agentId = input.value.trim();
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
      renderAllGoals(true);
    };
    agentField.appendChild(input);
  }
  controls.appendChild(agentField);
  const monitor = document.createElement('label');
  monitor.className = 'detail__toggle';
  monitor.appendChild(document.createTextNode(t('monitor')));
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = g.monitoring;
  checkbox.onchange = () => {
    g.monitoring = checkbox.checked;
    S.config.monitorByGoal[g.goalId] = checkbox.checked;
    saveConfig();
    if (checkbox.checked) pollNow(g); else rearmTimer();
    renderAllGoals(true);
  };
  monitor.appendChild(checkbox);
  controls.appendChild(monitor);
  body.appendChild(controls);

  const actions = document.createElement('div');
  actions.className = 'detail__actions';
  if (g.stopped) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn btn--primary';
    resume.textContent = t('resume');
    resume.onclick = () => pollNow(g);
    actions.appendChild(resume);
  }
  const run = document.createElement('button');
  run.type = 'button';
  run.className = g.running ? 'btn btn--danger' : 'btn btn--primary';
  run.textContent = g.running ? t('cancelRun') : t('runOnce');
  run.onclick = () => g.running ? cancelGoalRun(g, run) : confirmRunOnce(g);
  actions.appendChild(run);
  const plan = document.createElement('button');
  plan.type = 'button';
  plan.className = 'btn';
  plan.textContent = t('plan');
  plan.onclick = () => requestTurnPlan(g, plan);
  actions.appendChild(plan);
  const raw = document.createElement('button');
  raw.type = 'button';
  raw.className = 'btn';
  raw.textContent = t('raw');
  raw.disabled = !g.last;
  raw.onclick = () => showRawJson(g);
  actions.appendChild(raw);
  body.appendChild(actions);
}

function openGoalDetails(g) {
  S.activeGoalId = g.goalId;
  const dlg = document.getElementById('dlg-goal');
  if (!dlg.open) dlg.showModal();
  renderGoalDetails(g);
}

// Fingerprint of everything the goal list displays except per-second
// countdown text (the countdown loop patches those spans in place).
function displayFingerprint() {
  const parts = [
    String(S.goals.size), app.locale,
    S.intakeDraft ? `${S.intakeDraft.objective}|${S.intakeDraft.stage}` : '',
  ];
  for (const g of S.goals.values()) {
    parts.push([
      g.goalId, goalGroup(g), g.polling, g.running, g.stopped, g.monitoring,
      g.errorCount, g.unchangedCount, g.intervalMin.toFixed(2),
      g.agents.join(','), g.agentId,
      g.objective ?? '',
      g.last ? decisionKey(g.last) : '',
      g.last?.reason ?? '', g.last?.recommendedAction ?? '',
      g.last?.state ?? g.state ?? '', g.last?.waitingOn ?? g.waitingOn ?? '',
      g.lastError ?? '', g.currentActivity ?? '',
      g.lastRun ? `${g.lastRun.exitCode}|${g.lastRun.cancelled}|${g.lastRun.durationMs}` : '',
    ].join(''));
  }
  return parts.join('');
}

let lastFingerprint = '';

function renderAllGoals(force = false) {
  const list = document.getElementById('goal-list');
  const active = document.activeElement;
  if (!force && active && list.contains(active)
      && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) {
    // Never yank the DOM out from under the user's cursor; re-render on blur.
    S.renderPending = true;
    return;
  }
  const fp = displayFingerprint();
  if (!force && fp === lastFingerprint) {
    updateHeaderStatus();
    return;
  }
  lastFingerprint = fp;

  const empty = document.getElementById('goals-empty');
  for (const child of [...list.children]) {
    if (child.id !== 'goals-empty') child.remove();
  }
  const hasVisibleTasks = S.goals.size > 0 || !!S.intakeDraft;
  empty.hidden = hasVisibleTasks;
  if (!hasVisibleTasks) {
    updateHeaderStatus();
    return;
  }
  const buckets = new Map([...PRIMARY_GROUPS, ...ARCHIVE_GROUPS].map((k) => [k, []]));
  for (const g of S.goals.values()) buckets.get(goalGroup(g)).push(g);
  for (const key of PRIMARY_GROUPS) {
    const goals = buckets.get(key);
    const pendingCount = key === 'ready' && S.intakeDraft ? 1 : 0;
    const col = document.createElement('div');
    col.className = `col col--${key}`;

    const head = document.createElement('div');
    head.className = 'col__head';
    const dot = document.createElement('span');
    dot.className = `dot dot--${key}`;
    head.appendChild(dot);
    const title = document.createElement('span');
    title.className = 'col__title';
    title.textContent = t(GROUP_I18N_KEY[key]);
    head.appendChild(title);
    const count = document.createElement('span');
    count.className = 'col__count';
    count.textContent = String(goals.length);
    head.appendChild(count);
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'col__body';
    if (goals.length === 0 && pendingCount === 0) {
      const none = document.createElement('div');
      none.className = 'col__empty';
      none.textContent = t('colEmpty');
      body.appendChild(none);
    }
    if (key === 'ready' && S.intakeDraft) body.appendChild(buildIntakeCard(S.intakeDraft));
    for (const g of goals) body.appendChild(buildGoalCard(g));
    col.appendChild(body);
    list.appendChild(col);
  }
  const archive = document.createElement('aside');
  archive.className = 'archive';
  const archiveHead = document.createElement('div');
  archiveHead.className = 'archive__head';
  const archiveTitle = document.createElement('span');
  archiveTitle.textContent = t('hiddenStates');
  const archiveTotal = document.createElement('span');
  archiveTotal.className = 'archive__count';
  archiveTotal.textContent = String(ARCHIVE_GROUPS.reduce((sum, key) => sum + buckets.get(key).length, 0));
  archiveHead.append(archiveTitle, archiveTotal);
  archive.appendChild(archiveHead);
  const archiveBody = document.createElement('div');
  archiveBody.className = 'archive__body';
  for (const key of ARCHIVE_GROUPS) {
    const goals = buckets.get(key);
    if (goals.length === 0) continue;
    const group = document.createElement('section');
    group.className = 'archive__group' + (S.archiveOpen.has(key) ? ' is-open' : '');
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'archive__row';
    const chevron = document.createElement('span');
    chevron.className = 'archive__chevron';
    chevron.textContent = '⌄';
    const dot = document.createElement('span');
    dot.className = `dot dot--${key}`;
    const label = document.createElement('span');
    label.textContent = t(GROUP_I18N_KEY[key]);
    const count = document.createElement('span');
    count.className = 'archive__count';
    count.textContent = String(goals.length);
    row.append(chevron, dot, label, count);
    row.onclick = () => {
      if (S.archiveOpen.has(key)) S.archiveOpen.delete(key); else S.archiveOpen.add(key);
      group.classList.toggle('is-open', S.archiveOpen.has(key));
    };
    const cards = document.createElement('div');
    cards.className = 'archive__cards';
    for (const g of goals) cards.appendChild(buildGoalCard(g, true));
    group.append(row, cards);
    archiveBody.appendChild(group);
  }
  archive.appendChild(archiveBody);
  list.appendChild(archive);
  if (S.activeGoalId) {
    const activeGoal = S.goals.get(S.activeGoalId);
    if (activeGoal) renderGoalDetails(activeGoal);
  }
  updateHeaderStatus();
}

// Header presence badge + global next-tick countdown: the single bit that
// matters most for a console that owns the timer — is it armed right now?
function updateHeaderStatus() {
  const presence = document.getElementById('hb-presence');
  const text = document.getElementById('hb-presence-text');
  const next = document.getElementById('hb-next');
  let mode = 'live';
  if (S.detect && !S.detect.found) mode = 'nocli';
  else if (S.paused) mode = 'paused';
  else {
    let armed = false;
    for (const g of S.goals.values()) {
      if (g.monitoring && !g.stopped) { armed = true; break; }
    }
    if (!armed) mode = 'idle';
  }
  presence.className = `presence presence--${mode}`;
  text.textContent = t({ live: 'presenceLive', paused: 'presencePaused', idle: 'presenceIdle', nocli: 'presenceNoCli' }[mode]);

  let anyPolling = false;
  let earliest = Infinity;
  for (const g of S.goals.values()) {
    if (g.polling) anyPolling = true;
    if (g.monitoring && !g.stopped && !g.polling && g.nextDueAt < earliest) earliest = g.nextDueAt;
  }
  if (anyPolling) next.textContent = t('hbChecking');
  else if (mode === 'live' && earliest !== Infinity) next.textContent = t('hbNext', fmtCountdown(earliest - Date.now()));
  else next.textContent = '';
}

// countdown repaint only — no CLI calls, no DOM rebuild
function startCountdownLoop() {
  if (S.countdownTimer) clearInterval(S.countdownTimer);
  S.countdownTimer = setInterval(() => {
    for (const g of S.goals.values()) {
      const countdowns = document.querySelectorAll(`.countdown[data-goal="${CSS.escape(g.goalId)}"]`);
      for (const cd of countdowns) cd.textContent = shortScheduleText(g);
    }
    updateHeaderStatus();
  }, 1000);
}

// ── run once ──────────────────────────────────────────────
async function confirmRunOnce(g) {
  if (!S.config.projectDir) { log(t('needProject'), true); return; }
  if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
  if (S.config.host === 'generic-cli' && !S.config.hostCommandJson) {
    log(`[${g.goalId}] ${t('needHostJson')}`, true);
    return;
  }
  // Preview the exact argv the worker will spawn — single source of truth.
  let preview;
  try {
    preview = await app.call('loopx.runOnceArgv', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir,
      goalId: g.goalId,
      agentId: g.agentId,
      host: S.config.host,
      codexBin: S.config.codexBin || null,
      hostCommandJson: S.config.hostCommandJson || null,
      validationCommandJson: S.config.validationCommandJson || null,
      timeoutSeconds: S.config.timeoutSeconds,
    });
  } catch (err) {
    log(`[${g.goalId}] run-once preview error: ${err.message || err}`, true);
    return;
  }
  const shellish = preview.argv.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
  document.getElementById('run-argv').textContent = preview.label ? `${preview.label} ${shellish}` : shellish;
  const dlg = document.getElementById('dlg-run');
  // <dialog>.returnValue is sticky across opens: Esc keeps the previous
  // value, so a stale 'run' would execute a cancelled turn. Reset it.
  dlg.returnValue = 'cancel';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'run') return;
    executeRunOnce(g).catch((err) => {
      const message = String(err?.message || err);
      log(`[${g.goalId}] run-once error: ${message}`, true);
      g.running = false;
      recordGoalActivity(g, message, true);
      renderGoal(g);
    });
  };
  dlg.showModal();
}

async function executeRunOnce(g) {
  g.running = true;
  g.runStartedAt = Date.now();
  g.activityLines = [];
  g.currentActivity = '';
  recordGoalActivity(g, t('activityStarting'));
  renderGoal(g);
  log(`[${g.goalId}] run-once started (agent=${g.agentId})`);
  try {
    // Returns immediately ({started:true}); completion arrives on the
    // worker:runOnce:done event so cancel/heartbeat RPCs are not queued
    // behind a minutes-long call.
    await app.call('loopx.runOnce', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir,
      goalId: g.goalId,
      agentId: g.agentId,
      host: S.config.host,
      codexBin: S.config.codexBin || null,
      hostCommandJson: S.config.hostCommandJson || null,
      validationCommandJson: S.config.validationCommandJson || null,
      timeoutSeconds: S.config.timeoutSeconds,
    });
  } catch (err) {
    log(`[${g.goalId}] run-once error: ${err.message || err}`, true);
    g.running = false;
    recordGoalActivity(g, String(err.message || err), true);
    renderGoal(g);
  }
}

app.on('worker:runOnce:log', ({ goalId, line }) => {
  const g = S.goals.get(goalId);
  if (g) recordGoalActivity(g, line);
  log(`[${goalId}] ${line}`);
});
app.on('worker:runOnce:tick', ({ goalId, elapsedMs }) => {
  const g = S.goals.get(goalId);
  if (g) recordGoalActivity(g, t('activityRunning', fmtCountdown(elapsedMs)));
});
app.on('worker:runOnce:done', (d) => {
  const g = S.goals.get(d.goalId);
  if (g) {
    g.running = false;
    g.lastRun = {
      exitCode: d.exitCode, durationMs: d.durationMs || 0,
      status: d.status, ok: d.ok, cancelled: !!d.cancelled,
      raw: d.raw ?? null,
    };
    if (d.raw?.status === 'committed') recordGoalActivity(g, t('activityCommitted'));
    if (d.raw?.validation?.status === 'passed') recordGoalActivity(g, t('activityValidationPassed'));
    else if (d.raw?.validation?.status === 'failed') recordGoalActivity(g, t('activityValidationFailed'), true);
    if (d.raw?.effects?.state_written === true) recordGoalActivity(g, t('activityStateUpdated'));
    const completedLabel = d.raw?.validation?.status === 'passed'
      ? t('activityCompletedValidated')
      : t('activityCompleted');
    recordGoalActivity(g, d.ok ? completedLabel : (d.error || t('activityFailed')), !d.ok);
  }
  if (d.cancelled) log(`[${d.goalId}] ${t('runCancelled')}`);
  else if (d.error) log(`[${d.goalId}] run-once error: ${d.error}`, true);
  else log(`[${d.goalId}] run-once done: exit=${d.exitCode} status=${d.status ?? '-'}`, !d.ok);
  if (g) {
    renderGoal(g);
    pollNow(g); // fresh decision + interval reset via changed decision/reset token
  }
});

// ── bootstrap / detection / goals ─────────────────────────
function prefixLabel(p) {
  if (!p) return '';
  if (Array.isArray(p)) return p.join(' ');
  const base = (p.argv || []).join(' ');
  return p.env && p.env.PYTHONPATH ? `${base} (PYTHONPATH=${p.env.PYTHONPATH})` : base;
}

async function detect() {
  const banner = document.getElementById('banner-nodetect');
  try {
    S.detect = await app.call('loopx.detect', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
    });
  } catch (err) {
    S.detect = { found: false, probes: [{ error: String(err.message || err) }] };
  }
  updateHeaderStatus();
  if (S.detect.found) {
    banner.hidden = true;
    // Persist the working prefix — and heal a stale one: detect probes the
    // persisted prefix first, so if the winner differs, the persisted one is
    // broken (e.g. venv removed) and every poll would fail while the banner
    // says "detected".
    const detectedJson = JSON.stringify(S.detect.argvPrefix);
    if (!S.config.argvPrefix || JSON.stringify(S.config.argvPrefix) !== detectedJson) {
      S.config.argvPrefix = S.detect.argvPrefix;
      saveConfig();
    }
    log(t('detected', `${prefixLabel(S.detect.argvPrefix)} (${S.detect.version || '?'})`));
    return true;
  }
  banner.hidden = false;
  const detail = document.getElementById('probe-detail');
  detail.hidden = false;
  detail.textContent = (S.detect.probes || [])
    .map((p) => `${(p.argvPrefix || []).join(' ')} → ${p.ok ? p.version : p.error || 'failed'}`)
    .join('\n');
  return false;
}

async function refreshGoals() {
  try {
    const res = await app.call('loopx.listGoals', {
      argvPrefix: S.config.argvPrefix, projectDir: S.config.projectDir,
    });
    const fresh = new Set();
    for (const info of res.goals || []) {
      fresh.add(info.goalId);
      const existing = S.goals.get(info.goalId);
      if (existing) {
        existing.state = info.state ?? existing.state;
        existing.waitingOn = info.waitingOn ?? existing.waitingOn;
        existing.agents = info.agents?.length ? info.agents : existing.agents;
        existing.objective = info.objective ?? existing.objective;
      } else {
        S.goals.set(info.goalId, newGoalState(info.goalId, info));
      }
    }
    for (const goalId of [...S.goals.keys()]) {
      if (!fresh.has(goalId)) S.goals.delete(goalId);
    }
    renderAllGoals(true);
    for (const g of S.goals.values()) {
      if (g.monitoring && g.nextDueAt === 0) pollGoal(g);
    }
    rearmTimer();
    log(`goals refreshed: ${S.goals.size} (registry: ${res.registryPath})`);
  } catch (err) {
    log(`listGoals error: ${err.message || err}`, true);
  }
}

// ── toolbar / settings wiring ─────────────────────────────
function updateProjectLabel() {
  const label = document.getElementById('project-label');
  label.textContent = S.config.projectDir || t('globalRegistry');
  label.removeAttribute('data-i18n');
  if (!S.config.projectDir) label.setAttribute('data-i18n', 'globalRegistry');
}

document.getElementById('btn-project').addEventListener('click', async () => {
  try {
    const picked = await app.dialog.open({ directory: true });
    const dir = Array.isArray(picked) ? picked[0] : picked;
    if (!dir) return;
    S.config.projectDir = dir;
    await saveConfig();
    updateProjectLabel();
    S.goals.clear();
    renderAllGoals(true);
    await refreshGoals();
  } catch (err) {
    log(`dialog error: ${err.message || err}`, true);
  }
});

document.getElementById('btn-refresh').addEventListener('click', refreshGoals);
document.getElementById('btn-retry-detect').addEventListener('click', async () => {
  if (await detect()) refreshGoals();
});

document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('set-prefix').value = S.config.argvPrefix ? JSON.stringify(S.config.argvPrefix) : '';
  document.getElementById('set-srcdir').value = S.config.srcDir || '';
  document.getElementById('set-host').value = S.config.host;
  document.getElementById('set-codexbin').value = S.config.codexBin || '';
  document.getElementById('set-hostjson').value = S.config.hostCommandJson || '';
  document.getElementById('set-validatorjson').value = S.config.validationCommandJson || '';
  document.getElementById('set-default-agent').value = S.config.defaultAgentId || '';
  document.getElementById('set-timeout').value = String(S.config.timeoutSeconds);
  syncHostFields();
  const dlg = document.getElementById('dlg-settings');
  dlg.returnValue = 'cancel'; // avoid stale 'save' from a previous open
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'save') return;
    const prefixText = document.getElementById('set-prefix').value.trim();
    if (prefixText) {
      try {
        const parsed = JSON.parse(prefixText);
        const isArgvArray = Array.isArray(parsed) && parsed.every((x) => typeof x === 'string');
        const isPrefixObj = parsed && typeof parsed === 'object' && Array.isArray(parsed.argv);
        if (isArgvArray || isPrefixObj) S.config.argvPrefix = parsed;
      } catch (_) { log('invalid argvPrefix JSON, ignored', true); }
    } else {
      S.config.argvPrefix = null;
    }
    S.config.srcDir = document.getElementById('set-srcdir').value.trim();
    S.config.host = document.getElementById('set-host').value === 'generic-cli' ? 'generic-cli' : 'codex-cli';
    S.config.codexBin = document.getElementById('set-codexbin').value.trim();
    S.config.hostCommandJson = document.getElementById('set-hostjson').value.trim();
    S.config.validationCommandJson = document.getElementById('set-validatorjson').value.trim();
    S.config.defaultAgentId = document.getElementById('set-default-agent').value.trim();
    S.config.timeoutSeconds = Math.min(240, Math.max(10, Number(document.getElementById('set-timeout').value) || 120));
    await saveConfig();
    if (await detect()) refreshGoals();
  };
  dlg.showModal();
});

// Show only the adapter field the selected host actually uses.
function syncHostFields() {
  const host = document.getElementById('set-host').value;
  document.getElementById('field-codexbin').hidden = host !== 'codex-cli';
  document.getElementById('field-hostjson').hidden = host !== 'generic-cli';
}
document.getElementById('set-host').addEventListener('change', syncHostFields);

document.getElementById('btn-logs').addEventListener('click', () => {
  document.getElementById('dlg-logs').showModal();
});
document.getElementById('btn-close-logs').addEventListener('click', () => {
  document.getElementById('dlg-logs').close();
});
document.getElementById('btn-close-goal').addEventListener('click', () => {
  document.getElementById('dlg-goal').close();
});
document.getElementById('dlg-goal').addEventListener('close', () => {
  S.activeGoalId = null;
});

document.getElementById('btn-copy-raw').addEventListener('click', async (e) => {
  const text = document.getElementById('raw-body').textContent;
  try {
    if (app.clipboard?.writeText) await app.clipboard.writeText(text);
    else await navigator.clipboard.writeText(text);
    e.target.textContent = '✓';
    setTimeout(() => { e.target.textContent = t('copy'); }, 1200);
  } catch (err) {
    log(`copy failed: ${err.message || err}`, true);
  }
});

// ── task intake ───────────────────────────────────────────
function taskInputKind(text) {
  const urls = String(text || '').match(/https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) || [];
  const issues = urls.filter((url) => {
    try {
      const segments = new URL(url.replace(/[),.;:\]}]+$/g, '')).pathname.split('/').filter(Boolean);
      return /^(issues|pull)$/.test(segments[2] || '') && /^\d+$/.test(segments[3] || '');
    } catch (_) {
      return false;
    }
  });
  if (issues.length > 1) return t('taskIssues', issues.length);
  if (issues.length === 1) return t('taskIssue');
  if (urls.length) return t('taskRepository');
  return text.trim() ? t('taskGoal') : '';
}

function setTaskFeedback(message, mode = '') {
  const feedback = document.getElementById('task-feedback');
  feedback.textContent = message || '';
  feedback.hidden = !message;
  feedback.className = `composer__feedback${mode ? ` composer__feedback--${mode}` : ''}`;
}

function updateTaskKind() {
  const input = document.getElementById('task-input');
  const kind = taskInputKind(input.value);
  const badge = document.getElementById('task-kind');
  badge.textContent = kind;
  badge.hidden = !kind;
}

function resolveDefaultAgent() {
  if (S.config.defaultAgentId) return S.config.defaultAgentId;
  for (const goal of S.goals.values()) {
    if (goal.agentId) return goal.agentId;
    if (goal.agents.length) return goal.agents[0];
  }
  return Object.values(S.config.agentByGoal || {}).find(Boolean) || '';
}

async function createTaskFromInput() {
  const input = document.getElementById('task-input');
  const button = document.getElementById('btn-create-task');
  const objective = input.value.trim();
  if (!objective) { input.focus(); return; }
  if (!S.config.projectDir) {
    setTaskFeedback(t('taskNeedProject'), 'error');
    return;
  }
  const agentId = resolveDefaultAgent();
  if (!agentId) {
    setTaskFeedback(t('taskNeedAgent'), 'error');
    return;
  }

  button.disabled = true;
  input.disabled = true;
  S.intakeDraft = { objective, stage: t('taskStageCreating') };
  setTaskFeedback(t('taskCreating'));
  renderAllGoals(true);
  try {
    const result = await app.call('loopx.taskIntake', {
      argvPrefix: S.config.argvPrefix,
      srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir,
      objective,
      agentId,
    });
    if (!result.ok) {
      let message = result.error || 'task creation failed';
      if (result.code === 'repository_mismatch') {
        message = t('taskRepoMismatch', result.requestedRepo, result.projectRepo || '?');
      } else if (result.code === 'multiple_repositories') {
        message = t('taskMultipleRepos');
      }
      S.intakeDraft = null;
      renderAllGoals(true);
      setTaskFeedback(message, 'error');
      log(`task intake: ${message}`, true);
      return;
    }
    S.config.defaultAgentId = agentId;
    S.config.agentByGoal[result.goalId] = agentId;
    S.config.monitorByGoal[result.goalId] = true;
    S.intakeDraft.stage = t('taskStageStarting');
    renderAllGoals(true);
    await saveConfig();
    input.value = '';
    updateTaskKind();
    setTaskFeedback(t('taskStarted', result.goalId), 'ok');
    log(`[${result.goalId}] task created (${result.intakeKind}, ${result.written.length} todos)`);
    await refreshGoals();
    S.intakeDraft = null;
    const createdGoal = S.goals.get(result.goalId);
    if (createdGoal) {
      createdGoal.agentId = agentId;
      renderAllGoals(true);
      await executeRunOnce(createdGoal);
    } else {
      setTaskFeedback(t('taskCreated', result.goalId), 'ok');
      renderAllGoals(true);
    }
  } catch (err) {
    const message = String(err.message || err);
    S.intakeDraft = null;
    renderAllGoals(true);
    setTaskFeedback(message, 'error');
    log(`task intake error: ${message}`, true);
  } finally {
    input.disabled = false;
    button.disabled = false;
  }
}

document.getElementById('task-input').addEventListener('input', () => {
  updateTaskKind();
  setTaskFeedback('');
});
document.getElementById('task-input').addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    createTaskFromInput();
  }
});
document.getElementById('btn-create-task').addEventListener('click', createTaskFromInput);

// ── i18n ──────────────────────────────────────────────────
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = t(key);
    if (typeof value !== 'string') return;
    if (el.getAttribute('data-i18n-attr') === 'title') el.title = value;
    else el.textContent = value;
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const value = t(el.getAttribute('data-i18n-title'));
    if (typeof value === 'string') el.title = value;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const value = t(el.getAttribute('data-i18n-placeholder'));
    if (typeof value === 'string') el.placeholder = value;
  });
  updateProjectLabel();
  updateTaskKind();
}

app.onLocaleChange((locale) => {
  if (typeof locale === 'string') document.documentElement.setAttribute('lang', locale);
  applyI18n();
  renderAllGoals(true);
});

// ── lifecycle ─────────────────────────────────────────────
// The host documents onActivate/onDeactivate but does not emit them yet;
// keep the hooks (harmless, future-proof) and add two real signals:
// visibilitychange for window minimise, IntersectionObserver for the
// scene-tab display:none toggle (SceneViewport hides inactive tabs via CSS).
app.onDeactivate(pauseHeartbeat);
app.onActivate(resumeHeartbeat);
let intersecting = true;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseHeartbeat();
  else if (intersecting) resumeHeartbeat();
});
const visObserver = new IntersectionObserver((entries) => {
  intersecting = entries[entries.length - 1].isIntersecting;
  if (!intersecting) pauseHeartbeat();
  else if (!document.hidden) resumeHeartbeat();
});
visObserver.observe(document.body);

window.addEventListener('beforeunload', () => {
  if (S.timer) clearTimeout(S.timer);
  if (S.countdownTimer) clearInterval(S.countdownTimer);
});

// ── boot ──────────────────────────────────────────────────
(async function boot() {
  await loadConfig();
  applyI18n();
  startCountdownLoop();
  updateHeaderStatus();
  if (await detect()) await refreshGoals();
})();
