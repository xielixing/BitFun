// LoopX Console — UI + host heartbeat.
// The heartbeat is a single setTimeout chain armed to the earliest per-goal
// due time; each poll's interval is dictated by loopx's scheduler_hint
// (recommended interval, unchanged-poll backoff, max clamp, reset_token).

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
    notFoundHint: '请先安装：pip install -e D:\\loopx（或保证 loopx / python -m loopx.cli 可用），然后点击重试。',
    goalsEmpty: '尚无目标。选择一个包含 .loopx/registry.json 的项目目录，或在 loopx 中创建目标。',
    logTitle: '心跳与执行日志',
    monitor: '监控',
    agent: 'Agent',
    agentFree: '手动输入 agent id…',
    plan: 'Plan',
    runOnce: '执行一次',
    resume: '已暂停 · 点击恢复',
    nextPoll: (t, iv) => `下次轮询 ${t} · 间隔 ${iv} 分钟`,
    unchangedTimes: (n) => `未变化 ×${n}`,
    pollError: (n) => `轮询失败 ×${n}`,
    stateUnknown: '未知',
    runConfirmTitle: '执行单次 Turn？',
    runConfirmNote: '将执行以下命令（experimental）：',
    runConfirm: '执行',
    cancel: '取消',
    save: '保存',
    setPrefix: 'loopx 调用命令（JSON 数组，留空自动探测）',
    setHost: 'Run-once host',
    hostDefault: '默认（loopx 自选）',
    setCodexBin: 'codex 可执行文件路径',
    setHostJson: 'host-command-json（generic-cli 适配器）',
    setTimeout: 'Run-once 超时（秒，≤240）',
    needProject: '执行 run-once 需要先选择项目目录',
    needAgent: '该目标没有已注册的 agent，请先填写 agent id',
    detected: (v) => `已检测到 loopx：${v}`,
    mMonitored: '监控中',
    mShouldRun: '可运行',
    mPaused: '已暂停',
    mErrors: '轮询错误',
    copy: '复制',
    close: '关闭',
    raw: 'JSON',
    groupRun: '可运行',
    groupWait: '等待中',
    groupPaused: '已暂停',
    groupError: '异常',
  },
  'en-US': {
    title: 'LoopX Console',
    subtitle: 'Host heartbeat · Adaptive polling · One-shot turns',
    globalRegistry: 'Global registry',
    refresh: 'Refresh goals',
    settings: 'Settings',
    retry: 'Retry',
    notFoundTitle: 'loopx CLI not found',
    notFoundHint: 'Install it first: pip install -e D:\\loopx (or make loopx / python -m loopx.cli available), then retry.',
    goalsEmpty: 'No goals yet. Pick a project directory containing .loopx/registry.json, or create goals in loopx.',
    logTitle: 'Heartbeat & execution log',
    monitor: 'Monitor',
    agent: 'Agent',
    agentFree: 'Type agent id…',
    plan: 'Plan',
    runOnce: 'Run once',
    resume: 'Paused · click to resume',
    nextPoll: (t, iv) => `next poll in ${t} · every ${iv} min`,
    unchangedTimes: (n) => `unchanged ×${n}`,
    pollError: (n) => `poll failed ×${n}`,
    stateUnknown: 'unknown',
    runConfirmTitle: 'Run one turn?',
    runConfirmNote: 'The following command will run (experimental):',
    runConfirm: 'Run',
    cancel: 'Cancel',
    save: 'Save',
    setPrefix: 'loopx invocation (JSON array, empty = auto-detect)',
    setHost: 'Run-once host',
    hostDefault: 'Default (loopx decides)',
    setCodexBin: 'codex binary path',
    setHostJson: 'host-command-json (generic-cli adapter)',
    setTimeout: 'Run-once timeout (seconds, ≤240)',
    needProject: 'Run-once requires a project directory',
    needAgent: 'This goal has no registered agent — type an agent id first',
    detected: (v) => `loopx detected: ${v}`,
    mMonitored: 'Monitored',
    mShouldRun: 'Should run',
    mPaused: 'Paused',
    mErrors: 'Poll errors',
    copy: 'Copy',
    close: 'Close',
    raw: 'JSON',
    groupRun: 'Should run',
    groupWait: 'Waiting',
    groupPaused: 'Paused',
    groupError: 'Errors',
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
  config: { projectDir: null, argvPrefix: null, agentByGoal: {}, monitorByGoal: {}, host: '', codexBin: '', hostCommandJson: '', timeoutSeconds: 120 },
  detect: null,
  goals: new Map(), // goalId -> G
  timer: null,
  countdownTimer: null,
  paused: false,
  logs: [],
};

function newGoalState(goalId, info) {
  return {
    goalId,
    agents: info.agents || [],
    agentId: S.config.agentByGoal[goalId] || (info.agents && info.agents[0]) || '',
    state: info.state || null,
    monitoring: S.config.monitorByGoal[goalId] !== false,
    intervalMin: DEFAULT_INTERVAL_MIN,
    nextDueAt: 0,
    unchangedCount: 0,
    errorCount: 0,
    lastResetToken: null,
    lastDecisionKey: null,
    stopped: false,
    polling: false,
    running: false,
    last: null, // normalized shouldRun result
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

function decisionKey(res) {
  return [res.shouldRun, res.state, res.effectiveAction, res.reason].map(String).join('|');
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
    g.last = res;
    g.errorCount = 0;
    const sched = res.scheduler || {};
    const recommended = Number(sched.recommendedIntervalMinutes) || DEFAULT_INTERVAL_MIN;
    const maxIv = Number(sched.maxIntervalMinutes) || Math.max(recommended, 60);
    const backoff = Number(sched.backoffMultiplier) || 2;
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
    g.errorCount += 1;
    g.intervalMin = Math.min(Math.pow(2, g.errorCount), ERROR_BACKOFF_CAP_MIN);
    log(`[${g.goalId}] poll error: ${err.message || err}`, true);
  } finally {
    g.nextDueAt = Date.now() + g.intervalMin * 60000;
    g.polling = false;
    renderGoal(g);
    rearmTimer();
  }
}

function pollNow(g) {
  g.nextDueAt = 0;
  g.stopped = false;
  pollGoal(g).then(rearmTimer);
}

// ── rendering ─────────────────────────────────────────────
function routeBadgeClass(res) {
  if (!res) return 'badge--wait';
  if (res.ok === false || res.error) return 'badge--error';
  if (res.shouldRun === true) return 'badge--run';
  const s = String(res.state || res.effectiveAction || '').toUpperCase();
  if (/BLOCK|REPAIR|USER_ACTION|ERROR/.test(s)) return 'badge--warn';
  return 'badge--wait';
}

// Symphony-style grouping: goals bucketed by status, most actionable first.
const GROUP_ORDER = ['run', 'error', 'paused', 'wait'];
function goalGroup(g) {
  if (g.errorCount > 0 || g.last?.ok === false) return 'error';
  if (g.stopped) return 'paused';
  if (g.last?.shouldRun === true) return 'run';
  return 'wait';
}
const GROUP_I18N_KEY = { run: 'groupRun', wait: 'groupWait', paused: 'groupPaused', error: 'groupError' };

function updateMetrics() {
  const metrics = document.getElementById('metrics');
  if (S.goals.size === 0) { metrics.hidden = true; return; }
  metrics.hidden = false;
  let monitored = 0, shouldRun = 0, paused = 0, errors = 0;
  for (const g of S.goals.values()) {
    if (g.monitoring) monitored += 1;
    if (g.last?.shouldRun === true) shouldRun += 1;
    if (g.stopped) paused += 1;
    if (g.errorCount > 0) errors += 1;
  }
  document.getElementById('m-monitored').textContent = String(monitored);
  document.getElementById('m-shouldrun').textContent = String(shouldRun);
  const mPaused = document.getElementById('m-paused');
  mPaused.textContent = String(paused);
  mPaused.className = 'metric__value' + (paused > 0 ? ' metric__value--warn' : '');
  const mErrors = document.getElementById('m-errors');
  mErrors.textContent = String(errors);
  mErrors.className = 'metric__value' + (errors > 0 ? ' metric__value--error' : '');
}

function fmtCountdown(ms) {
  if (ms <= 0) return '0:00';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showRawJson(g) {
  document.getElementById('raw-title').textContent = `${g.goalId} · ${t('raw')}`;
  document.getElementById('raw-body').textContent = g.last?.raw
    ? JSON.stringify(g.last.raw, null, 2)
    : JSON.stringify(g.last ?? {}, null, 2);
  document.getElementById('dlg-raw').showModal();
}

function renderGoal(g) {
  // Group membership can change with every poll result, so re-render the
  // whole grouped list; N is small (goals per registry).
  renderAllGoals();
}

function buildGoalCard(g) {
  const el = document.createElement('div');
  el.className = 'goal';
  el.id = `goal-${g.goalId}`;

  const head = document.createElement('div');
  head.className = 'goal__head';
  const id = document.createElement('span');
  id.className = 'goal__id';
  id.textContent = g.goalId;
  head.appendChild(id);

  const stateBadge = document.createElement('span');
  stateBadge.className = 'badge';
  stateBadge.textContent = g.last?.state ?? g.state ?? t('stateUnknown');
  head.appendChild(stateBadge);

  const routeBadge = document.createElement('span');
  routeBadge.className = 'badge ' + routeBadgeClass(g.last);
  routeBadge.textContent = g.last
    ? (g.last.shouldRun === true ? 'should-run' : g.last.effectiveAction || 'wait')
    : '…';
  head.appendChild(routeBadge);

  if (g.stopped) {
    const paused = document.createElement('span');
    paused.className = 'badge badge--paused';
    paused.textContent = t('resume');
    paused.onclick = () => pollNow(g);
    head.appendChild(paused);
  }

  const spacer = document.createElement('span');
  spacer.className = 'goal__spacer';
  head.appendChild(spacer);

  const toggle = document.createElement('label');
  toggle.className = 'toggle';
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

  if (g.last?.reason) {
    const reason = document.createElement('div');
    reason.className = 'goal__reason';
    reason.textContent = g.last.reason;
    el.appendChild(reason);
  }

  const meta = document.createElement('div');
  meta.className = 'goal__meta';
  if (g.monitoring && !g.stopped) {
    const cd = document.createElement('span');
    cd.className = 'countdown';
    cd.dataset.goal = g.goalId;
    cd.textContent = g.polling ? '…' : t('nextPoll', fmtCountdown(g.nextDueAt - Date.now()), g.intervalMin.toFixed(g.intervalMin < 10 ? 1 : 0));
    meta.appendChild(cd);
  }
  if (g.unchangedCount > 0) {
    const un = document.createElement('span');
    un.textContent = t('unchangedTimes', g.unchangedCount);
    meta.appendChild(un);
  }
  if (g.errorCount > 0) {
    const errSpan = document.createElement('span');
    errSpan.className = 'badge badge--error';
    errSpan.textContent = t('pollError', g.errorCount);
    meta.appendChild(errSpan);
  }
  el.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'goal__actions';

  const agentLabel = document.createElement('span');
  agentLabel.textContent = t('agent') + ':';
  agentLabel.style.fontSize = '11.5px';
  actions.appendChild(agentLabel);
  if (g.agents.length > 0) {
    const sel = document.createElement('select');
    for (const a of g.agents) {
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
    input.value = g.agentId;
    input.onchange = () => {
      g.agentId = input.value.trim();
      S.config.agentByGoal[g.goalId] = g.agentId;
      saveConfig();
    };
    actions.appendChild(input);
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
        goalId: g.goalId, agentId: g.agentId,
      });
      log(`[${g.goalId}] turn plan → ${res.route ?? JSON.stringify(res.raw)?.slice(0, 200)}`);
    } catch (err) {
      log(`[${g.goalId}] turn plan error: ${err.message || err}`, true);
    } finally { planBtn.disabled = false; }
  };
  actions.appendChild(planBtn);

  const runBtn = document.createElement('button');
  runBtn.className = 'btn' + (g.last?.shouldRun === true ? ' btn--primary' : '');
  runBtn.type = 'button';
  runBtn.textContent = t('runOnce');
  runBtn.disabled = g.running;
  runBtn.onclick = () => confirmRunOnce(g);
  actions.appendChild(runBtn);

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

function renderAllGoals() {
  const list = document.getElementById('goal-list');
  const empty = document.getElementById('goals-empty');
  for (const child of [...list.children]) {
    if (child.id !== 'goals-empty') child.remove();
  }
  const buckets = new Map(GROUP_ORDER.map((k) => [k, []]));
  for (const g of S.goals.values()) buckets.get(goalGroup(g)).push(g);
  for (const key of GROUP_ORDER) {
    const goals = buckets.get(key);
    if (goals.length === 0) continue;
    const header = document.createElement('div');
    header.className = 'group-header';
    header.textContent = `${t(GROUP_I18N_KEY[key])} · ${goals.length}`;
    list.appendChild(header);
    for (const g of goals) list.appendChild(buildGoalCard(g));
  }
  empty.hidden = S.goals.size > 0;
  updateMetrics();
}

// countdown repaint only — no CLI calls
function startCountdownLoop() {
  if (S.countdownTimer) clearInterval(S.countdownTimer);
  S.countdownTimer = setInterval(() => {
    for (const g of S.goals.values()) {
      const cd = document.querySelector(`.countdown[data-goal="${CSS.escape(g.goalId)}"]`);
      if (cd && !g.polling) {
        cd.textContent = t('nextPoll', fmtCountdown(g.nextDueAt - Date.now()), g.intervalMin.toFixed(g.intervalMin < 10 ? 1 : 0));
      }
    }
  }, 1000);
}

// ── run once ──────────────────────────────────────────────
function confirmRunOnce(g) {
  if (!S.config.projectDir) { log(t('needProject'), true); return; }
  if (!g.agentId) { log(`[${g.goalId}] ${t('needAgent')}`, true); return; }
  const argv = ['loopx', '--format', 'json',
    '--registry', `${S.config.projectDir}/.loopx/registry.json`,
    'turn', 'run-once', '--execute',
    '--project', S.config.projectDir,
    '--goal-id', g.goalId, '--agent-id', g.agentId];
  if (S.config.host === 'codex-cli') {
    argv.push('--host', 'codex-cli');
    if (S.config.codexBin) argv.push('--codex-bin', S.config.codexBin);
  } else if (S.config.host === 'generic-cli') {
    argv.push('--host', 'generic-cli');
    if (S.config.hostCommandJson) argv.push('--host-command-json', S.config.hostCommandJson);
  }
  argv.push('--timeout-seconds', String(S.config.timeoutSeconds));

  document.getElementById('run-argv').textContent = argv.join(' ');
  const dlg = document.getElementById('dlg-run');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'run') return;
    executeRunOnce(g);
  };
  dlg.showModal();
}

async function executeRunOnce(g) {
  g.running = true;
  renderGoal(g);
  log(`[${g.goalId}] run-once started (agent=${g.agentId})`);
  try {
    await app.call('loopx.runOnce', {
      argvPrefix: S.config.argvPrefix,
      projectDir: S.config.projectDir,
      goalId: g.goalId,
      agentId: g.agentId,
      host: S.config.host || null,
      codexBin: S.config.codexBin || null,
      hostCommandJson: S.config.hostCommandJson || null,
      timeoutSeconds: S.config.timeoutSeconds,
    });
  } catch (err) {
    log(`[${g.goalId}] run-once error: ${err.message || err}`, true);
  } finally {
    g.running = false;
    renderGoal(g);
    pollNow(g); // fresh decision + interval reset via changed decision/reset token
  }
}

app.on('worker:runOnce:log', ({ goalId, line }) => log(`[${goalId}] ${line}`));
app.on('worker:runOnce:done', (d) => log(`[${d.goalId}] run-once done: exit=${d.exitCode} status=${d.status ?? '-'}`, !d.ok));

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
    S.detect = await app.call('loopx.detect', { argvPrefix: S.config.argvPrefix });
  } catch (err) {
    S.detect = { found: false, probes: [{ error: String(err.message || err) }] };
  }
  if (S.detect.found) {
    banner.hidden = true;
    if (!S.config.argvPrefix) { S.config.argvPrefix = S.detect.argvPrefix; saveConfig(); }
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
        existing.agents = info.agents?.length ? info.agents : existing.agents;
      } else {
        S.goals.set(info.goalId, newGoalState(info.goalId, info));
      }
    }
    for (const goalId of [...S.goals.keys()]) {
      if (!fresh.has(goalId)) S.goals.delete(goalId);
    }
    renderAllGoals();
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
    renderAllGoals();
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
  document.getElementById('set-host').value = S.config.host || '';
  document.getElementById('set-codexbin').value = S.config.codexBin || '';
  document.getElementById('set-hostjson').value = S.config.hostCommandJson || '';
  document.getElementById('set-timeout').value = String(S.config.timeoutSeconds);
  const dlg = document.getElementById('dlg-settings');
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
    S.config.host = document.getElementById('set-host').value;
    S.config.codexBin = document.getElementById('set-codexbin').value.trim();
    S.config.hostCommandJson = document.getElementById('set-hostjson').value.trim();
    S.config.timeoutSeconds = Math.min(240, Math.max(10, Number(document.getElementById('set-timeout').value) || 120));
    await saveConfig();
    if (await detect()) refreshGoals();
  };
  dlg.showModal();
});

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

// ── i18n ──────────────────────────────────────────────────
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const value = t(key);
    if (typeof value !== 'string') return;
    if (el.getAttribute('data-i18n-attr') === 'title') el.title = value;
    else el.textContent = value;
  });
  updateProjectLabel();
}

app.onLocaleChange(() => {
  applyI18n();
  renderAllGoals();
});

// ── lifecycle ─────────────────────────────────────────────
app.onDeactivate(() => {
  S.paused = true;
  if (S.timer) { clearTimeout(S.timer); S.timer = null; }
});
app.onActivate(() => {
  if (!S.paused) return;
  S.paused = false;
  const now = Date.now();
  for (const g of S.goals.values()) {
    if (g.monitoring && !g.stopped && g.nextDueAt <= now) pollGoal(g);
  }
  rearmTimer();
});
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
  if (await detect()) await refreshGoals();
})();
