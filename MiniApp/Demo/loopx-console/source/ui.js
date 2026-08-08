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
    goalsEmpty: '尚无目标。选择一个包含 .loopx/registry.json 的项目目录，或在 loopx 中创建目标。',
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
    goalsEmpty: 'No goals yet. Pick a project directory containing .loopx/registry.json, or create goals in loopx.',
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
    host: 'codex-cli', codexBin: '', hostCommandJson: '', timeoutSeconds: 120,
  },
  detect: null,
  goals: new Map(), // goalId -> G
  timer: null,
  countdownTimer: null,
  paused: false,
  renderPending: false,
  logs: [],
};

function newGoalState(goalId, info) {
  return {
    goalId,
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
  // Errors must be visible even though the panel boots collapsed.
  if (isErr) document.getElementById('log-panel').classList.remove('collapsed');
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

// Symphony-style board: blocked-on-human first, then most actionable.
const GROUP_ORDER = ['gated', 'run', 'wait', 'paused', 'error'];
// The first three columns are the product ("what state, what needs me") and
// stay visible even when empty; paused/error appear only with members.
const ALWAYS_VISIBLE_COLUMNS = new Set(['gated', 'run', 'wait']);
function goalGroup(g) {
  if (isGated(g)) return 'gated'; // gated outranks error: the human unlock is the story
  if (g.errorCount > 0) return 'error';
  if (g.stopped) return 'paused';
  if (g.last?.shouldRun === true) return 'run';
  return 'wait';
}
const GROUP_I18N_KEY = { gated: 'groupGated', run: 'groupRun', wait: 'groupWait', paused: 'groupPaused', error: 'groupError' };
const GROUP_HINT_KEY = { gated: 'groupGatedHint', run: 'groupRunHint', wait: 'groupWaitHint', paused: 'groupPausedHint', error: 'groupErrorHint' };

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
  // Group membership can change with every poll result; renderAllGoals is
  // fingerprint-throttled so unchanged results cost nothing.
  renderAllGoals();
}

function buildGoalCard(g) {
  const group = goalGroup(g);
  const el = document.createElement('div');
  el.className = 'goal';
  el.id = `goal-${g.goalId}`;

  const head = document.createElement('div');
  head.className = 'goal__head';
  const dot = document.createElement('span');
  dot.className = `dot dot--${group}`;
  head.appendChild(dot);
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = g.goalId;
  head.appendChild(id);

  const spacer = document.createElement('span');
  spacer.className = 'goal__spacer';
  head.appendChild(spacer);

  const toggle = document.createElement('label');
  toggle.className = 'toggle';
  toggle.title = t('monitor');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = g.monitoring;
  cb.onchange = () => {
    g.monitoring = cb.checked;
    S.config.monitorByGoal[g.goalId] = cb.checked;
    saveConfig();
    if (cb.checked) pollNow(g);
    else rearmTimer();
    renderGoal(g);
  };
  toggle.appendChild(cb);
  toggle.appendChild(document.createTextNode(t('monitor')));
  head.appendChild(toggle);
  el.appendChild(head);

  // Narration first (what to do / why); the raw payload stays behind JSON.
  const narration = g.last?.recommendedAction || g.last?.reason || g.lastError;
  if (narration) {
    const line = document.createElement('div');
    line.className = 'goal__reason' + (g.lastError ? ' goal__reason--err' : '');
    line.textContent = narration;
    if (g.last?.recommendedAction && g.last?.reason) line.title = g.last.reason;
    el.appendChild(line);
  }

  const meta = document.createElement('div');
  meta.className = 'goal__meta';
  const stateText = g.last?.state ?? g.state;
  if (stateText) {
    const st = document.createElement('span');
    st.className = 'goal__state';
    const waiting = g.last && g.last.ok !== false ? g.last.waitingOn : g.waitingOn;
    st.textContent = waiting ? `${stateText} · ${t('waitingOn', waiting)}` : stateText;
    meta.appendChild(st);
  }
  if (g.monitoring && !g.stopped) {
    const cd = document.createElement('span');
    cd.className = 'countdown' + (g.errorCount > 0 ? ' countdown--err' : '');
    cd.dataset.goal = g.goalId;
    cd.textContent = goalMetaText(g);
    meta.appendChild(cd);
  }
  if (g.unchangedCount > 0) {
    const un = document.createElement('span');
    un.textContent = t('unchangedTimes', g.unchangedCount);
    meta.appendChild(un);
  }
  if (g.running) {
    const run = document.createElement('span');
    run.className = 'badge badge--run';
    run.dataset.runGoal = g.goalId;
    run.textContent = t('running', fmtCountdown(Date.now() - g.runStartedAt));
    meta.appendChild(run);
  } else if (g.lastRun) {
    const lr = document.createElement('span');
    lr.textContent = g.lastRun.cancelled
      ? t('lastRunCancelled')
      : t('lastRun', g.lastRun.exitCode, Math.round((g.lastRun.durationMs || 0) / 1000));
    if (!g.lastRun.ok && !g.lastRun.cancelled) lr.className = 'goal__lastrun--err';
    meta.appendChild(lr);
  }
  el.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'goal__actions';

  if (g.stopped) {
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn btn--primary';
    resume.textContent = t('resume');
    resume.onclick = () => pollNow(g);
    actions.appendChild(resume);
  }

  if (g.agents.length > 0) {
    const sel = document.createElement('select');
    sel.title = t('agent');
    // A persisted agentId can fall out of the registered list; keep it as an
    // explicit option so the display matches what CLI calls actually use.
    const options = g.agentId && !g.agents.includes(g.agentId)
      ? [...g.agents, g.agentId]
      : g.agents;
    for (const a of options) {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      if (a === g.agentId) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      g.agentId = sel.value;
      S.config.agentByGoal[g.goalId] = sel.value;
      saveConfig();
    };
    actions.appendChild(sel);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('agentFree');
    input.title = t('agent');
    input.value = g.agentId;
    input.onchange = () => {
      g.agentId = input.value.trim();
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
    };
    actions.appendChild(input);
  }

  if (g.running) {
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = t('cancelRun');
    cancelBtn.onclick = async () => {
      cancelBtn.disabled = true;
      try {
        const res = await app.call('loopx.cancelRunOnce', { goalId: g.goalId });
        if (!res.ok) log(`[${g.goalId}] cancel: ${res.error}`, true);
      } catch (err) {
        log(`[${g.goalId}] cancel error: ${err.message || err}`, true);
      }
    };
    actions.appendChild(cancelBtn);
  } else {
    const runBtn = document.createElement('button');
    runBtn.className = 'btn' + (g.last?.shouldRun === true ? ' btn--primary' : '');
    runBtn.type = 'button';
    runBtn.textContent = t('runOnce');
    runBtn.onclick = () => confirmRunOnce(g);
    actions.appendChild(runBtn);
  }

  const planBtn = document.createElement('button');
  planBtn.className = 'btn';
  planBtn.type = 'button';
  planBtn.textContent = t('plan');
  planBtn.onclick = async () => {
    if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
    planBtn.disabled = true;
    try {
      const res = await app.call('loopx.turnPlan', {
        argvPrefix: S.config.argvPrefix, projectDir: S.config.projectDir,
        goalId: g.goalId, agentId: g.agentId, host: S.config.host,
      });
      log(`[${g.goalId}] turn plan → ${res.route ?? JSON.stringify(res.raw)?.slice(0, 200)}`);
    } catch (err) {
      log(`[${g.goalId}] turn plan error: ${err.message || err}`, true);
    } finally { planBtn.disabled = false; }
  };
  actions.appendChild(planBtn);

  const rawBtn = document.createElement('button');
  rawBtn.className = 'btn';
  rawBtn.type = 'button';
  rawBtn.textContent = t('raw');
  rawBtn.disabled = !g.last;
  rawBtn.onclick = () => showRawJson(g);
  actions.appendChild(rawBtn);

  el.appendChild(actions);
  return el;
}

// Fingerprint of everything the goal list displays except per-second
// countdown text (the countdown loop patches those spans in place).
function displayFingerprint() {
  const parts = [String(S.goals.size), app.locale];
  for (const g of S.goals.values()) {
    parts.push([
      g.goalId, goalGroup(g), g.polling, g.running, g.stopped, g.monitoring,
      g.errorCount, g.unchangedCount, g.intervalMin.toFixed(2),
      g.agents.join(','), g.agentId,
      g.last ? decisionKey(g.last) : '',
      g.last?.reason ?? '', g.last?.recommendedAction ?? '',
      g.last?.state ?? g.state ?? '', g.last?.waitingOn ?? g.waitingOn ?? '',
      g.lastError ?? '',
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
  empty.hidden = S.goals.size > 0;
  if (S.goals.size === 0) {
    updateHeaderStatus();
    return;
  }
  const buckets = new Map(GROUP_ORDER.map((k) => [k, []]));
  for (const g of S.goals.values()) buckets.get(goalGroup(g)).push(g);
  for (const key of GROUP_ORDER) {
    const goals = buckets.get(key);
    if (goals.length === 0 && !ALWAYS_VISIBLE_COLUMNS.has(key)) continue;
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

    const hint = document.createElement('div');
    hint.className = 'col__hint';
    hint.textContent = t(GROUP_HINT_KEY[key]);
    col.appendChild(hint);

    const body = document.createElement('div');
    body.className = 'col__body';
    if (goals.length === 0) {
      const none = document.createElement('div');
      none.className = 'col__empty';
      none.textContent = t('colEmpty');
      body.appendChild(none);
    }
    for (const g of goals) body.appendChild(buildGoalCard(g));
    col.appendChild(body);
    list.appendChild(col);
  }
  updateHeaderStatus();
}

document.getElementById('goal-list').addEventListener('focusout', () => {
  if (!S.renderPending) return;
  S.renderPending = false;
  // Not setTimeout(0): a focusout fired by mousedown on a card button would
  // rebuild the DOM before mouseup, swallowing that click.
  setTimeout(() => renderAllGoals(), 250);
});

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
      const cd = document.querySelector(`.countdown[data-goal="${CSS.escape(g.goalId)}"]`);
      if (cd && !g.polling) cd.textContent = goalMetaText(g);
      if (g.running) {
        const run = document.querySelector(`[data-run-goal="${CSS.escape(g.goalId)}"]`);
        if (run) run.textContent = t('running', fmtCountdown(Date.now() - g.runStartedAt));
      }
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
    executeRunOnce(g);
  };
  dlg.showModal();
}

async function executeRunOnce(g) {
  g.running = true;
  g.runStartedAt = Date.now();
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
      timeoutSeconds: S.config.timeoutSeconds,
    });
  } catch (err) {
    log(`[${g.goalId}] run-once error: ${err.message || err}`, true);
    g.running = false;
    renderGoal(g);
  }
}

app.on('worker:runOnce:log', ({ goalId, line }) => log(`[${goalId}] ${line}`));
app.on('worker:runOnce:done', (d) => {
  const g = S.goals.get(d.goalId);
  if (g) {
    g.running = false;
    g.lastRun = {
      exitCode: d.exitCode, durationMs: d.durationMs || 0,
      status: d.status, ok: d.ok, cancelled: !!d.cancelled,
    };
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

document.getElementById('btn-toggle-log').addEventListener('click', () => {
  document.getElementById('log-panel').classList.toggle('collapsed');
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

// ── issue intake (paste a GitHub issue URL → todos into a goal) ──
function openIssueDialog() {
  const dlg = document.getElementById('dlg-issue');
  const goalSel = document.getElementById('issue-goal');
  goalSel.replaceChildren();
  for (const id of S.goals.keys()) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    goalSel.appendChild(opt);
  }
  const noGoals = S.goals.size === 0;
  document.getElementById('issue-nogoals').hidden = !noGoals;
  goalSel.disabled = noGoals;
  const box = document.getElementById('issue-preview');
  box.hidden = true;
  box.replaceChildren();
  const writeBtn = document.getElementById('btn-issue-write');
  writeBtn.disabled = true;
  writeBtn.textContent = t('issueWrite', 0);
  dlg.returnValue = 'cancel';
  dlg.showModal();
}

function renderIssuePreview(res) {
  const box = document.getElementById('issue-preview');
  box.replaceChildren();
  box.hidden = false;
  const sig = res.issueSignal || {};
  const sigLine = document.createElement('div');
  sigLine.className = 'issue-preview__signal';
  sigLine.textContent = [sig.repo, sig.issue_ref, sig.kind, sig.state].filter(Boolean).join(' · ')
    + (Array.isArray(sig.labels) && sig.labels.length ? ` · ${sig.labels.join(', ')}` : '');
  box.appendChild(sigLine);
  const bp = res.branchPlan || {};
  if (bp.issue_branch) {
    const b = document.createElement('div');
    b.className = 'issue-preview__line';
    b.textContent = `${t('issueBranchLabel')}: ${bp.base_branch ?? '?'} → ${bp.issue_branch}`;
    box.appendChild(b);
  }
  const todos = res.todosPreview || [];
  if (todos.length) {
    const label = document.createElement('div');
    label.className = 'issue-preview__label';
    label.textContent = `${t('issueTodosLabel')} · ${todos.length}`;
    box.appendChild(label);
    for (const td of todos) {
      const row = document.createElement('div');
      row.className = 'issue-preview__todo';
      row.textContent = td.text;
      row.title = `${td.taskClass} / ${td.actionKind ?? '-'}`;
      box.appendChild(row);
    }
  }
}

async function parseIssueUrl() {
  const url = document.getElementById('issue-url').value.trim();
  if (!url) return;
  const parseBtn = document.getElementById('btn-issue-parse');
  parseBtn.disabled = true;
  parseBtn.textContent = t('issueParsing');
  try {
    const res = await app.call('loopx.issueIntake', {
      argvPrefix: S.config.argvPrefix, srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir, url,
    });
    renderIssuePreview(res);
    const n = (res.todosPreview || []).length;
    const writeBtn = document.getElementById('btn-issue-write');
    writeBtn.textContent = t('issueWrite', n);
    writeBtn.disabled = !res.ok || n === 0 || S.goals.size === 0;
    if (res.error) log(`issue intake: ${res.error}`, true);
  } catch (err) {
    log(`issue intake error: ${err.message || err}`, true);
  } finally {
    parseBtn.disabled = false;
    parseBtn.textContent = t('issueParse');
  }
}

async function writeIssueTodos() {
  const goalId = document.getElementById('issue-goal').value;
  const url = document.getElementById('issue-url').value.trim();
  if (!goalId || !url) { log(t('issueNoGoals'), true); return; }
  const writeBtn = document.getElementById('btn-issue-write');
  writeBtn.disabled = true;
  try {
    const res = await app.call('loopx.issueIntake', {
      argvPrefix: S.config.argvPrefix, srcDir: S.config.srcDir || null,
      projectDir: S.config.projectDir, url, goalId, execute: true,
    });
    const written = res.written || [];
    const okN = written.filter((w) => w.ok).length;
    log(`[${goalId}] ${t('issueWritten', okN, written.length)}`, okN !== written.length);
    for (const w of written.filter((x) => !x.ok)) {
      log(`[${goalId}] todo add failed (${w.actionKind}): ${w.error}`, true);
    }
    document.getElementById('dlg-issue').close('done');
    const g = S.goals.get(goalId);
    if (g) pollNow(g); // heartbeat takes over from here
  } catch (err) {
    log(`issue intake error: ${err.message || err}`, true);
    writeBtn.disabled = false;
  }
}

document.getElementById('btn-issue').addEventListener('click', openIssueDialog);
document.getElementById('btn-issue-parse').addEventListener('click', parseIssueUrl);
document.getElementById('btn-issue-write').addEventListener('click', writeIssueTodos);

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
  updateProjectLabel();
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
  document.getElementById('log-panel').classList.add('collapsed');
  await loadConfig();
  applyI18n();
  startCountdownLoop();
  updateHeaderStatus();
  if (await detect()) await refreshGoals();
})();
