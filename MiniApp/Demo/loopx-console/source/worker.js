// LoopX Console MiniApp — Worker (Node.js/Bun).
// Wraps the loopx CLI (`loopx --format json …`). The host heartbeat lives in
// ui.js; this worker is stateless per call except for the cached invocation
// prefix and the per-goal run-once in-flight registry.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Invocation candidates, probed in order. `python -m loopx` does NOT work
// (loopx has no __main__.py) — the module form must target loopx.cli.
// A source checkout (srcDir, set in the UI settings) is the last resort,
// injected via PYTHONPATH.
function candidatePrefixes(srcDir) {
  const list = [
    { argv: ['loopx'] },
    { argv: ['python', '-m', 'loopx.cli'] },
    { argv: ['py', '-3', '-m', 'loopx.cli'] },
  ];
  if (srcDir && fs.existsSync(path.join(srcDir, 'loopx', 'cli.py'))) {
    list.push({ argv: ['python', '-m', 'loopx.cli'], env: { PYTHONPATH: srcDir } });
    list.push({ argv: ['py', '-3', '-m', 'loopx.cli'], env: { PYTHONPATH: srcDir } });
  }
  return list;
}

const DEFAULT_TIMEOUT_MS = 60000;

let cachedPrefix = null; // { argv, env }
const runOnceChildren = new Map(); // goalId -> { child, cancelled }

// loopx is a Python CLI; on zh-CN Windows its stdout defaults to GBK, which
// breaks both JSON.parse and any non-ASCII reason strings. Force UTF-8, and
// prepend (never clobber) PYTHONPATH from a source-checkout overlay.
function buildEnv(envOverlay) {
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  if (envOverlay) {
    for (const [key, value] of Object.entries(envOverlay)) {
      if (key === 'PYTHONPATH' && env.PYTHONPATH) {
        env.PYTHONPATH = value + path.delimiter + env.PYTHONPATH;
      } else {
        env[key] = value;
      }
    }
  }
  return env;
}

// child.kill() only terminates the direct child; on Windows the interesting
// work (python → codex …) lives in grandchildren. Kill the whole tree.
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      tk.on('error', () => child.kill());
    } catch (_) {
      child.kill();
    }
  } else {
    child.kill();
  }
}

function makeLineSplitter(onLine) {
  let buf = '';
  return {
    push(text) {
      buf += text;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.trim()) onLine(line);
      }
    },
    flush() {
      if (buf.trim()) onLine(buf.trim());
      buf = '';
    },
  };
}

// onStderrLine streams progress (loopx logs to stderr while running; in
// --format json mode stdout carries exactly one JSON document at exit, so
// streaming stdout lines would only replay the final payload as noise).
function spawnLoopx(prefix, args, { timeoutMs = DEFAULT_TIMEOUT_MS, onStderrLine = null, onSpawned = null } = {}) {
  const argv = Array.isArray(prefix) ? prefix : prefix.argv;
  const envOverlay = Array.isArray(prefix) ? null : prefix.env;
  return new Promise((resolve, reject) => {
    const [cmd, ...prefixArgs] = argv;
    const child = spawn(cmd, [...prefixArgs, ...args], {
      shell: false,
      windowsHide: true,
      env: buildEnv(envOverlay),
    });
    if (onSpawned) onSpawned(child);
    let stdout = '';
    let stderr = '';
    // setEncoding routes chunks through a StringDecoder, so multibyte UTF-8
    // sequences split across 64KB pipe chunks decode correctly (quota status
    // payloads run to hundreds of KB with CJK text).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const errSplitter = onStderrLine ? makeLineSplitter(onStderrLine) : null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      reject(new Error(`loopx timed out after ${timeoutMs}ms: ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (errSplitter) errSplitter.push(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (errSplitter) errSplitter.flush();
      resolve({ code, stdout, stderr });
    });
  });
}

// loopx prints one JSON document on stdout in --format json mode; tolerate
// noise before the document and (best-effort) after it.
function parseJsonPayload(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}
  const start = text.indexOf('{');
  if (start >= 0) {
    try {
      return JSON.parse(text.slice(start));
    } catch (_) {}
    const end = text.lastIndexOf('}');
    if (end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {}
    }
  }
  return null;
}

// A prefix from the UI may be a plain argv array (settings input) or a
// {argv, env} object persisted from a previous detect.
function normalizePrefix(p) {
  if (!p) return null;
  if (Array.isArray(p)) return p.length > 0 ? { argv: p } : null;
  if (typeof p === 'object' && Array.isArray(p.argv) && p.argv.length > 0) return p;
  return null;
}

async function resolvePrefix(argvPrefix, srcDir = null) {
  const normalized = normalizePrefix(argvPrefix);
  if (normalized) return normalized;
  if (cachedPrefix) return cachedPrefix;
  const detected = await detectLoopx(null, srcDir);
  if (!detected.found) {
    throw new Error(
      'loopx CLI not found. Install it (pip install -e <checkout>), '
      + 'or set the invocation command or source directory in Settings.'
    );
  }
  return normalizePrefix(detected.argvPrefix) || { argv: detected.argvPrefix };
}

function registryArgs(projectDir) {
  if (!projectDir) return []; // loopx falls back to its global registry
  return ['--registry', path.join(projectDir, '.loopx', 'registry.json')];
}

async function runJson(argvPrefix, projectDir, args, opts = {}) {
  const prefix = await resolvePrefix(argvPrefix, opts.srcDir || null);
  let result;
  try {
    result = await spawnLoopx(prefix, ['--format', 'json', ...registryArgs(projectDir), ...args], opts);
  } catch (err) {
    // A cached prefix can go stale (venv removed, PATH change): drop it so
    // the next call re-probes instead of failing forever.
    if (err && err.code === 'ENOENT' && prefix === cachedPrefix) cachedPrefix = null;
    throw err;
  }
  const payload = parseJsonPayload(result.stdout);
  return { result, payload, prefix };
}

async function detectLoopx(customPrefix, srcDir = null) {
  const custom = normalizePrefix(customPrefix);
  const candidates = custom ? [custom, ...candidatePrefixes(srcDir)] : candidatePrefixes(srcDir);
  const probes = [];
  for (const prefix of candidates) {
    try {
      const { code, stdout, stderr } = await spawnLoopx(prefix, ['--version'], { timeoutMs: 15000 });
      const version = (stdout + stderr).trim().split(/\r?\n/)[0] || '';
      const label = prefix.env ? [...prefix.argv, `(PYTHONPATH=${prefix.env.PYTHONPATH})`] : prefix.argv;
      probes.push({ argvPrefix: label, ok: code === 0, version });
      if (code === 0) {
        cachedPrefix = prefix;
        return { found: true, argvPrefix: prefix, version, probes };
      }
    } catch (err) {
      probes.push({ argvPrefix: prefix.argv, ok: false, error: String(err.message || err) });
    }
  }
  return { found: false, argvPrefix: null, version: null, probes };
}

function resolveRegistryPath(projectDir) {
  if (projectDir) return path.join(projectDir, '.loopx', 'registry.json');
  // Mirror the CLI: LOOPX_REGISTRY wins only if the file exists; otherwise
  // loopx itself falls back to the global registry.
  if (process.env.LOOPX_REGISTRY && fs.existsSync(process.env.LOOPX_REGISTRY)) {
    return process.env.LOOPX_REGISTRY;
  }
  return path.join(os.homedir(), '.codex', 'loopx', 'registry.global.json');
}

function readRegistry(projectDir) {
  const registryPath = resolveRegistryPath(projectDir);
  try {
    return { registryPath, registry: JSON.parse(fs.readFileSync(registryPath, 'utf8')) };
  } catch (_) {
    return { registryPath, registry: null };
  }
}

function normalizeScheduler(schedulerHint) {
  if (!schedulerHint || typeof schedulerHint !== 'object') return null;
  // Hot path: reset token + codex_app fallback. Cold path
  // (--include-scheduler-detail): the local_scheduler block the heartbeat
  // actually wants.
  const cold = schedulerHint.cold_path_detail && schedulerHint.cold_path_detail.local_scheduler;
  const codexApp = schedulerHint.codex_app || {};
  const local = cold || {};
  const resetPolicy = schedulerHint.reset_policy || {};
  const unchangedPoll = schedulerHint.unchanged_poll || {};
  const limits = unchangedPoll.limits || {};
  const afterLimits = unchangedPoll.after_limits || {};
  return {
    recommendedIntervalMinutes:
      local.recommended_interval_minutes ?? codexApp.recommended_interval_minutes ?? null,
    maxIntervalMinutes: local.max_interval_minutes ?? codexApp.max_interval_minutes ?? null,
    backoffMultiplier: local.unchanged_poll_backoff_multiplier ?? null,
    unchangedPollLimit: local.unchanged_poll_limit ?? limits.local_scheduler ?? null,
    afterLimit: local.after_limit ?? afterLimits.local_scheduler ?? null,
    exampleProgression: local.example_progression_minutes ?? null,
    resetToken: resetPolicy.reset_token ?? null,
    cadenceClass: schedulerHint.cadence_class ?? null,
    action: schedulerHint.action ?? null,
    unchangedIdentityKeys: Array.isArray(schedulerHint.unchanged_identity_keys)
      ? schedulerHint.unchanged_identity_keys
      : null,
    source: cold ? 'local_scheduler' : 'codex_app_fallback',
  };
}

// The mini-app's own execution path is the outer-controller variant; plan for
// the same context so the previewed route matches what run-once will do.
function turnContextArgs(host) {
  return [
    '--host', host === 'codex-cli' ? 'codex-cli' : 'generic-cli',
    '--execution-mode', 'isolated-headless',
    '--scheduler-owner', 'outer_controller',
  ];
}

// Single source of truth for run-once argv: the confirmation dialog previews
// exactly what runOnce will spawn.
function buildRunOnceArgs({
  projectDir, goalId, agentId, host, codexBin, hostCommandJson,
  validationCommandJson, timeoutSeconds,
}) {
  const args = [
    '--format', 'json',
    ...registryArgs(projectDir),
    'turn', 'run-once', '--execute',
    '--project', projectDir,
    '--goal-id', goalId,
    '--agent-id', agentId,
  ];
  if (host === 'codex-cli') {
    args.push('--host', 'codex-cli');
    if (codexBin) args.push('--codex-bin', codexBin);
  } else {
    // loopx defaults turn run-once to generic-cli anyway; make it explicit.
    args.push('--host', 'generic-cli');
    if (hostCommandJson) args.push('--host-command-json', hostCommandJson);
  }
  if (validationCommandJson) {
    args.push('--validation-command-json', validationCommandJson);
  }
  // The mini-app IS the outer controller for both hosts. Without this flag,
  // run-once under codex-cli resolves scheduler_owner=agent_cli_loop and the
  // recorded execution context / cadence-ownership hints diverge from what
  // plan and the heartbeat use.
  args.push('--scheduler-owner', 'outer_controller');
  if (timeoutSeconds) args.push('--timeout-seconds', String(timeoutSeconds));
  return args;
}

function validateRunOnceParams({ projectDir, goalId, agentId, host, hostCommandJson }) {
  if (!goalId || !agentId) throw new Error('loopx.runOnce: goalId and agentId are required');
  if (!projectDir) throw new Error('loopx.runOnce: projectDir is required (--project)');
  if (host !== 'codex-cli' && !hostCommandJson) {
    throw new Error(
      'loopx.runOnce: host generic-cli requires host-command-json (a JSON argv array for the adapter). '
      + 'Pick codex-cli or configure the adapter in Settings.'
    );
  }
}

function githubReferences(text) {
  const refs = [];
  const seen = new Set();
  const pattern = /https:\/\/github\.com\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const rawUrl = match[0].replace(/[),.;:\]}]+$/g, '');
    let parsed;
    try { parsed = new URL(rawUrl); } catch (_) { continue; }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) continue;
    const owner = segments[0];
    const repoName = segments[1].replace(/\.git$/i, '');
    if (!owner || !repoName) continue;
    const type = segments[2];
    const number = /^(issues|pull)$/.test(type || '') && /^\d+$/.test(segments[3] || '')
      ? Number(segments[3])
      : null;
    const kind = number ? (type === 'issues' ? 'issue' : 'pr') : 'repository';
    const repo = `${owner}/${repoName}`;
    const url = number
      ? `https://github.com/${repo}/${type}/${number}`
      : `https://github.com/${repo}`;
    if (seen.has(url)) continue;
    seen.add(url);
    refs.push({
      url,
      repo,
      kind,
      number,
    });
  }
  return refs;
}

function normalizeGithubRemote(value) {
  const text = String(value || '').trim();
  const match = text.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function projectGithubRepository(projectDir) {
  if (!projectDir) return null;
  try {
    const config = fs.readFileSync(path.join(projectDir, '.git', 'config'), 'utf8');
    const origin = config.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/i);
    if (origin) return normalizeGithubRemote(origin[1]);
    const anyRemote = config.match(/\n\s*url\s*=\s*([^\r\n]+)/i);
    return anyRemote ? normalizeGithubRemote(anyRemote[1]) : null;
  } catch (_) {
    return null;
  }
}

function uniqueGoalId(projectDir, objective, refs) {
  const { registry } = readRegistry(projectDir);
  const existing = new Set(((registry && registry.goals) || [])
    .map((goal) => goal.goal_id || goal.id)
    .filter(Boolean));
  const issueRefs = refs.filter((ref) => ref.kind !== 'repository');
  let base;
  if (issueRefs.length === 1) {
    const repo = issueRefs[0].repo.split('/')[1];
    base = `${repo}-issue-${issueRefs[0].number}`;
  } else if (issueRefs.length > 1) {
    base = `${issueRefs[0].repo.split('/')[1]}-issues`;
  } else {
    base = String(objective)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42);
  }
  if (!base) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    base = `task-${stamp}`;
  }
  let goalId = base;
  let suffix = 2;
  while (existing.has(goalId)) goalId = `${base}-${suffix++}`;
  return goalId;
}

function readGoalObjective(projectDir, goal) {
  const stateFile = goal && goal.state_file;
  if (!stateFile) return null;
  const root = projectDir || goal.repo;
  if (!root) return null;
  try {
    const content = fs.readFileSync(path.resolve(root, stateFile), 'utf8');
    const yaml = content.match(/^objective:\s*(.+)$/m);
    if (yaml) {
      const raw = yaml[1].trim();
      if (raw.startsWith('"')) {
        try { return JSON.parse(raw); } catch (_) {}
      }
      return raw.replace(/^['"]|['"]$/g, '');
    }
    const section = content.match(/## Objective\s+([\s\S]*?)(?:\n## |$)/);
    return section ? section[1].trim() : null;
  } catch (_) {
    return null;
  }
}

async function planIssueIntake({ argvPrefix, srcDir, projectDir, url }) {
  const planArgsBase = ['issue-fix', 'workflow-plan', '--url', String(url).trim()];
  if (projectDir) planArgsBase.push('--repo-path', projectDir);
  let result, payload;
  ({ result, payload } = await runJson(argvPrefix, projectDir, [
    ...planArgsBase, '--fetch-metadata', '--fetch-timeout-seconds', '20',
  ], { srcDir, timeoutMs: 90000 }));
  let fetchedMetadata = true;
  const planEmpty = (value) => !value || value.ok === false
    || !(value.ordered_loopx_todo_writeback_preview || []).length;
  if (planEmpty(payload)) {
    fetchedMetadata = false;
    ({ result, payload } = await runJson(argvPrefix, projectDir, planArgsBase, {
      srcDir, timeoutMs: 90000,
    }));
  }
  if (!payload) {
    return { ok: false, error: result.stderr.trim() || 'loopx returned no JSON payload', raw: null };
  }
  const preview = (payload.ordered_loopx_todo_writeback_preview || [])
    .filter((entry) => entry && entry.task_class && entry.text)
    .map((entry) => ({
      order: entry.planner_order ?? null,
      role: entry.role || 'agent',
      priority: entry.priority ?? null,
      taskClass: entry.task_class,
      actionKind: entry.action_kind ?? null,
      text: entry.text,
    }));
  return {
    ok: result.code === 0 && payload.ok !== false,
    fetchedMetadata,
    issueSignal: payload.issue_signal ?? null,
    branchPlan: payload.branch_plan ?? null,
    feasibilityRoutes: payload.feasibility_checkpoint_plan?.routes ?? null,
    todosPreview: preview,
    raw: payload,
  };
}

async function writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId, agentId, intake }) {
  const preview = intake.todosPreview || [];
  if (!preview.length) return { ...intake, ok: false, error: 'workflow-plan produced no writable todos' };
  const repoLabel = intake.issueSignal?.repo || null;
  const written = [];
  for (const todo of preview) {
    const args = [
      'todo', 'add', '--goal-id', goalId, '--role', todo.role,
      '--task-class', todo.taskClass, '--text', todo.text,
    ];
    if (todo.actionKind) args.push('--action-kind', todo.actionKind);
    if (repoLabel) args.push('--task-repository', `git:github.com/${repoLabel}`);
    if (todo.role === 'agent' && agentId) args.push('--claimed-by', agentId);
    try {
      const response = await runJson(argvPrefix, projectDir, args, { srcDir });
      const ok = response.result.code === 0 && response.payload?.ok !== false;
      written.push({
        actionKind: todo.actionKind,
        ok,
        todoId: response.payload?.todo_id ?? null,
        error: ok ? null : (response.payload?.error || response.result.stderr.slice(0, 200) || 'todo add failed'),
      });
    } catch (err) {
      written.push({ actionKind: todo.actionKind, ok: false, todoId: null, error: String(err.message || err) });
    }
  }
  return { ...intake, written, ok: intake.ok && written.every((entry) => entry.ok) };
}

module.exports = {
  async 'loopx.detect'({ argvPrefix = null, srcDir = null } = {}) {
    return detectLoopx(argvPrefix, srcDir);
  },

  async 'loopx.doctor'({ argvPrefix = null, projectDir = null } = {}) {
    const { result, payload } = await runJson(argvPrefix, projectDir, ['doctor']);
    return { ok: result.code === 0, payload, stderr: result.stderr };
  },

  // "Paste an issue URL" glue: preview via `issue-fix workflow-plan
  // --fetch-metadata`, then (execute=true) materialize the ordered todo
  // preview into a goal with plain `loopx todo add` calls. Uses only
  // shipped loopx CLI surface — no loopx-side changes.
  async 'loopx.issueIntake'({
    argvPrefix = null,
    srcDir = null,
    projectDir = null,
    url,
    goalId = null,
    execute = false,
  } = {}) {
    if (!url || !/^https:\/\/github\.com\//.test(String(url).trim())) {
      throw new Error('loopx.issueIntake: url must be a public https://github.com/ issue or PR link');
    }
    const intake = await planIssueIntake({ argvPrefix, srcDir, projectDir, url });
    if (!execute) return intake;
    if (!goalId) throw new Error('loopx.issueIntake: goalId is required to write todos');
    return writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId, agentId: null, intake });
  },

  // Product-level task intake. This adapts natural-language goals, repository
  // URLs, and one or more Issue/PR URLs onto LoopX's public CLI without
  // changing LoopX itself.
  async 'loopx.taskIntake'({
    argvPrefix = null,
    srcDir = null,
    projectDir = null,
    objective,
    agentId,
  } = {}) {
    const text = String(objective || '').trim();
    if (!projectDir) throw new Error('loopx.taskIntake: a local project directory is required');
    if (!text) throw new Error('loopx.taskIntake: objective is required');
    if (text.length > 4000) throw new Error('loopx.taskIntake: objective is too long (max 4000 characters)');
    if (!agentId) throw new Error('loopx.taskIntake: agentId is required');

    const refs = githubReferences(text);
    const issueRefs = refs.filter((ref) => ref.kind === 'issue' || ref.kind === 'pr');
    const requestedRepos = [...new Set(refs.map((ref) => ref.repo.toLowerCase()))];
    const projectRepo = projectGithubRepository(projectDir);
    if (requestedRepos.length > 1) {
      return {
        ok: false,
        code: 'multiple_repositories',
        error: 'One LoopX goal must target a single local repository. Split links from different repositories into separate tasks.',
        requestedRepos,
      };
    }
    if (requestedRepos.length === 1 && projectRepo && requestedRepos[0] !== projectRepo) {
      return {
        ok: false,
        code: 'repository_mismatch',
        error: `The selected checkout is ${projectRepo}, but the task targets ${requestedRepos[0]}.`,
        requestedRepo: requestedRepos[0],
        projectRepo,
      };
    }

    const goalId = uniqueGoalId(projectDir, text, refs);
    const bootstrap = await runJson(argvPrefix, projectDir, [
      'bootstrap', '--project', projectDir, '--goal-id', goalId,
      '--objective', text,
      '--adapter-kind', 'read_only_project_map_v0',
      '--adapter-status', 'connected-read-only',
      '--no-onboarding-scan', '--codex-app-heartbeat', 'ask',
    ], { srcDir, timeoutMs: 90000 });
    if (bootstrap.result.code !== 0 || bootstrap.payload?.ok === false) {
      return {
        ok: false,
        code: 'bootstrap_failed',
        goalId,
        error: bootstrap.payload?.error || bootstrap.result.stderr.trim() || 'loopx bootstrap failed',
      };
    }

    const registration = await runJson(argvPrefix, projectDir, [
      'register-agent', '--goal-id', goalId, '--agent-id', agentId, '--execute',
    ], { srcDir, timeoutMs: 60000 });
    if (registration.result.code !== 0 || registration.payload?.ok === false) {
      return {
        ok: false,
        code: 'agent_registration_failed',
        goalId,
        created: true,
        error: registration.payload?.error || registration.result.stderr.trim() || 'agent registration failed',
      };
    }

    const issueResults = [];
    const written = [];
    if (issueRefs.length) {
      for (const ref of issueRefs) {
        const intake = await planIssueIntake({ argvPrefix, srcDir, projectDir, url: ref.url });
        const result = intake.ok
          ? await writePlannedTodos({ argvPrefix, srcDir, projectDir, goalId, agentId, intake })
          : intake;
        issueResults.push({ url: ref.url, ...result });
        written.push(...(result.written || []));
      }
    } else {
      const args = [
        'todo', 'add', '--goal-id', goalId, '--role', 'agent',
        '--task-class', 'advancement_task', '--action-kind', 'deliver_user_goal',
        '--claimed-by', agentId, '--text', `[P0] ${text}`,
      ];
      const repository = requestedRepos[0] || projectRepo;
      if (repository) args.push('--task-repository', `git:github.com/${repository}`);
      const todo = await runJson(argvPrefix, projectDir, args, { srcDir, timeoutMs: 60000 });
      const ok = todo.result.code === 0 && todo.payload?.ok !== false;
      written.push({
        ok,
        todoId: todo.payload?.todo_id ?? null,
        actionKind: 'deliver_user_goal',
        error: ok ? null : (todo.payload?.error || todo.result.stderr.trim() || 'todo add failed'),
      });
    }

    await runJson(argvPrefix, projectDir, [
      'refresh-state', '--goal-id', goalId, '--project', projectDir,
    ], { srcDir, timeoutMs: 60000 });
    const ok = written.length > 0 && written.every((entry) => entry.ok)
      && issueResults.every((entry) => entry.ok);
    return {
      ok,
      code: ok ? 'created' : 'todo_write_failed',
      created: true,
      goalId,
      objective: text,
      intakeKind: issueRefs.length ? 'issues' : (refs.length ? 'repository' : 'goal'),
      issueCount: issueRefs.length,
      repository: requestedRepos[0] || projectRepo,
      written,
      issueResults,
      error: ok ? null : (written.find((entry) => !entry.ok)?.error
        || issueResults.find((entry) => !entry.ok)?.error
        || 'task creation did not produce runnable todos'),
    };
  },

  async 'loopx.listGoals'({ argvPrefix = null, projectDir = null } = {}) {
    const { registryPath, registry } = readRegistry(projectDir);
    const agentsByGoal = {};
    const objectivesByGoal = {};
    const registryGoals = (registry && registry.goals) || [];
    for (const goal of registryGoals) {
      const goalId = goal.goal_id || goal.id;
      if (!goalId) continue;
      const coordination = goal.coordination || {};
      agentsByGoal[goalId] = (coordination.registered_agents || [])
        .map((a) => (typeof a === 'string' ? a : a.agent_id || a.id))
        .filter(Boolean);
      objectivesByGoal[goalId] = readGoalObjective(projectDir, goal);
    }

    const { result, payload } = await runJson(argvPrefix, projectDir, ['quota', 'status']);
    const goals = [];
    const seen = new Set();
    const groups = (payload && payload.groups) || payload || {};
    const pushGoal = (goalId, state, extra = {}) => {
      if (!goalId || seen.has(goalId)) return;
      seen.add(goalId);
      goals.push({
        goalId,
        state: state || null,
        agents: agentsByGoal[goalId] || [],
        objective: objectivesByGoal[goalId] || null,
        ...extra,
      });
    };
    // quota status groups goals by state; shapes vary by schema version, so
    // walk any {state: [goal…]} mapping and any flat goals list defensively.
    if (groups && typeof groups === 'object') {
      for (const [state, entries] of Object.entries(groups)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          if (typeof entry === 'string') pushGoal(entry, state);
          else if (entry && typeof entry === 'object') {
            pushGoal(entry.goal_id || entry.id, entry.state || state, {
              waitingOn: entry.waiting_on ?? null,
              status: entry.status ?? null,
            });
          }
        }
      }
    }
    for (const goalId of Object.keys(agentsByGoal)) pushGoal(goalId, null);
    return { ok: result.code === 0, registryPath, goals, raw: payload };
  },

  async 'loopx.status'({ argvPrefix = null, projectDir = null, goalId = null, agentId = null } = {}) {
    const args = ['status'];
    if (goalId) args.push('--goal-id', goalId);
    if (agentId) args.push('--agent-id', agentId);
    const { result, payload } = await runJson(argvPrefix, projectDir, args);
    return { ok: result.code === 0, payload, stderr: result.stderr };
  },

  async 'loopx.shouldRun'({ argvPrefix = null, projectDir = null, goalId, agentId } = {}) {
    if (!goalId) throw new Error('loopx.shouldRun: goalId is required');
    const args = [
      'quota', 'should-run',
      '--goal-id', goalId,
      '--runtime-profile', 'outer_controller',
      '--include-scheduler-detail',
    ];
    if (agentId) args.push('--agent-id', agentId);
    const { result, payload } = await runJson(argvPrefix, projectDir, args);
    if (!payload) {
      return { ok: false, error: result.stderr.trim() || 'loopx returned no JSON payload', raw: null };
    }
    return {
      ok: result.code === 0,
      shouldRun: payload.should_run ?? null,
      decision: payload.decision ?? null,
      state: payload.state ?? null,
      effectiveAction: payload.effective_action ?? null,
      reason: payload.reason ?? null,
      recommendedAction: payload.recommended_action ?? null,
      waitingOn: payload.waiting_on ?? null,
      scheduler: normalizeScheduler(payload.scheduler_hint),
      raw: payload,
    };
  },

  async 'loopx.turnPlan'({ argvPrefix = null, projectDir = null, goalId, agentId, host = null } = {}) {
    if (!goalId || !agentId) throw new Error('loopx.turnPlan: goalId and agentId are required');
    const { result, payload } = await runJson(argvPrefix, projectDir, [
      'turn', 'plan', '--goal-id', goalId, '--agent-id', agentId,
      ...turnContextArgs(host),
    ]);
    const route = payload && (payload.route?.kind ?? payload.route ?? null);
    return { ok: result.code === 0, route, raw: payload, stderr: result.stderr };
  },

  // Returns the exact argv runOnce would spawn, for the confirmation dialog.
  async 'loopx.runOnceArgv'(params = {}) {
    validateRunOnceParams(params);
    const prefix = await resolvePrefix(params.argvPrefix, params.srcDir);
    const argv = [...prefix.argv, ...buildRunOnceArgs(params)];
    return {
      argv,
      label: prefix.env && prefix.env.PYTHONPATH ? `PYTHONPATH=${prefix.env.PYTHONPATH}` : null,
    };
  },

  async 'loopx.cancelRunOnce'({ goalId } = {}) {
    const entry = runOnceChildren.get(goalId);
    if (!entry) return { ok: false, error: `no run in flight for goal "${goalId}"` };
    if (entry.child && entry.child.exitCode !== null) {
      return { ok: false, error: 'run already finished' };
    }
    entry.cancelled = true;
    killTree(entry.child); // no-op while child is null; onSpawned re-checks
    return { ok: true };
  },

  // Starts the turn and returns immediately. The host serializes worker RPCs
  // per app behind a mutex, so holding this RPC open for the whole turn would
  // queue cancelRunOnce — and every heartbeat poll — behind it for minutes.
  // Completion is reported on the runOnce:done event channel (stderr events
  // bypass the RPC mutex).
  async 'loopx.runOnce'({
    argvPrefix = null,
    projectDir = null,
    goalId,
    agentId,
    host = null,          // 'codex-cli' | 'generic-cli'
    codexBin = null,
    hostCommandJson = null,
    validationCommandJson = null,
    timeoutSeconds = null,
    srcDir = null,
  } = {}) {
    const params = {
      projectDir, goalId, agentId, host, codexBin, hostCommandJson,
      validationCommandJson, timeoutSeconds,
    };
    validateRunOnceParams(params);
    if (runOnceChildren.has(goalId)) {
      throw new Error(`loopx.runOnce: a run for goal "${goalId}" is already in flight`);
    }
    const entry = { child: null, cancelled: false };
    runOnceChildren.set(goalId, entry);
    const startedAt = Date.now();
    // With no RPC held open, the host's 3-minute idle reaper could kill this
    // worker mid-turn if loopx stays quiet; every event is a stderr line and
    // refreshes the host's last-activity clock. The UI also uses these ticks
    // as quiet progress feedback while a buffered host adapter is running.
    const keepalive = setInterval(() => {
      global.rpcEmit('runOnce:tick', { goalId, elapsedMs: Date.now() - startedAt });
    }, 10000);
    (async () => {
      try {
        const args = buildRunOnceArgs(params);
        const prefix = await resolvePrefix(argvPrefix, srcDir);
        if (entry.cancelled) throw new Error('cancelled before spawn');
        const cliTimeoutMs = ((Number(timeoutSeconds) || 120) + 60) * 1000;
        const result = await spawnLoopx(prefix, args, {
          timeoutMs: cliTimeoutMs,
          onStderrLine: (line) => global.rpcEmit('runOnce:log', { goalId, line }),
          onSpawned: (child) => {
            entry.child = child;
            if (entry.cancelled) killTree(child); // cancel raced the spawn
          },
        });
        const payload = parseJsonPayload(result.stdout);
        global.rpcEmit('runOnce:done', {
          ok: result.code === 0 && !entry.cancelled,
          goalId,
          exitCode: result.code,
          cancelled: entry.cancelled,
          durationMs: Date.now() - startedAt,
          status: payload?.status ?? null,
          raw: payload,
          stderr: result.stderr.slice(-4000),
        });
      } catch (err) {
        global.rpcEmit('runOnce:done', {
          ok: false,
          goalId,
          exitCode: null,
          cancelled: entry.cancelled,
          durationMs: Date.now() - startedAt,
          status: null,
          raw: null,
          error: String(err.message || err),
        });
      } finally {
        clearInterval(keepalive);
        runOnceChildren.delete(goalId);
      }
    })();
    return { started: true, goalId };
  },
};
