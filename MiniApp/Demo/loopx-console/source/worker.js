// LoopX Console MiniApp — Worker (Node.js/Bun).
// Wraps the loopx CLI (`loopx --format json …`). The host heartbeat lives in
// ui.js; this worker is stateless per call except for the cached invocation
// prefix and the per-goal run-once in-flight guard.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Invocation candidates, probed in order. `python -m loopx` does NOT work
// (loopx has no __main__.py) — the module form must target loopx.cli.
// Entries may carry an env overlay: when loopx isn't pip-installed, running
// from a source checkout via PYTHONPATH is the last resort.
const DEFAULT_LOOPX_SRC_DIR = 'D:\\loopx';
function candidatePrefixes(srcDir) {
  const list = [
    { argv: ['loopx'] },
    { argv: ['python', '-m', 'loopx.cli'] },
    { argv: ['py', '-3', '-m', 'loopx.cli'] },
  ];
  const src = srcDir || DEFAULT_LOOPX_SRC_DIR;
  if (src && fs.existsSync(path.join(src, 'loopx', 'cli.py'))) {
    list.push({ argv: ['python', '-m', 'loopx.cli'], env: { PYTHONPATH: src } });
    list.push({ argv: ['py', '-3', '-m', 'loopx.cli'], env: { PYTHONPATH: src } });
  }
  return list;
}

const DEFAULT_TIMEOUT_MS = 60000;

let cachedPrefix = null; // { argv, env }
const runOnceInFlight = new Set(); // goalIds with an active run-once

function spawnLoopx(prefix, args, { timeoutMs = DEFAULT_TIMEOUT_MS, onLine = null } = {}) {
  const argv = Array.isArray(prefix) ? prefix : prefix.argv;
  const envOverlay = Array.isArray(prefix) ? null : prefix.env;
  return new Promise((resolve, reject) => {
    const [cmd, ...prefixArgs] = argv;
    const child = spawn(cmd, [...prefixArgs, ...args], {
      shell: false,
      windowsHide: true,
      env: envOverlay ? { ...process.env, ...envOverlay } : process.env,
    });
    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`loopx timed out after ${timeoutMs}ms: ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (onLine) {
        lineBuf += text;
        let idx;
        while ((idx = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, idx).replace(/\r$/, '');
          lineBuf = lineBuf.slice(idx + 1);
          if (line.trim()) onLine(line);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
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
      if (onLine && lineBuf.trim()) onLine(lineBuf.trim());
      resolve({ code, stdout, stderr });
    });
  });
}

// loopx prints one JSON document on stdout in --format json mode; tolerate
// leading log noise by scanning for the first parseable top-level object.
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

async function resolvePrefix(argvPrefix) {
  const normalized = normalizePrefix(argvPrefix);
  if (normalized) return normalized;
  if (cachedPrefix) return cachedPrefix;
  const detected = await detectLoopx(null);
  if (!detected.found) {
    throw new Error('loopx CLI not found. Install with: pip install -e D:\\loopx');
  }
  return normalizePrefix(detected.argvPrefix) || { argv: detected.argvPrefix };
}

function registryArgs(projectDir) {
  if (!projectDir) return []; // fall back to loopx's global registry
  return ['--registry', path.join(projectDir, '.loopx', 'registry.json')];
}

async function runJson(argvPrefix, projectDir, args, opts = {}) {
  const prefix = await resolvePrefix(argvPrefix);
  const result = await spawnLoopx(prefix, ['--format', 'json', ...registryArgs(projectDir), ...args], opts);
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
  // Hot path: reset token + codex_app fallback. Cold path (--include-detail
  // scheduler): the local_scheduler block the heartbeat actually wants.
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
    source: cold ? 'local_scheduler' : 'codex_app_fallback',
  };
}

module.exports = {
  async 'loopx.detect'({ argvPrefix = null, srcDir = null } = {}) {
    return detectLoopx(argvPrefix, srcDir);
  },

  async 'loopx.doctor'({ argvPrefix = null, projectDir = null } = {}) {
    const { result, payload } = await runJson(argvPrefix, projectDir, ['doctor']);
    return { ok: result.code === 0, payload, stderr: result.stderr };
  },

  async 'loopx.listGoals'({ argvPrefix = null, projectDir = null } = {}) {
    const { registryPath, registry } = readRegistry(projectDir);
    const agentsByGoal = {};
    const registryGoals = (registry && registry.goals) || [];
    for (const goal of registryGoals) {
      const goalId = goal.goal_id || goal.id;
      if (!goalId) continue;
      const coordination = goal.coordination || {};
      agentsByGoal[goalId] = (coordination.registered_agents || [])
        .map((a) => (typeof a === 'string' ? a : a.agent_id || a.id))
        .filter(Boolean);
    }

    const { result, payload } = await runJson(argvPrefix, projectDir, ['quota', 'status']);
    const goals = [];
    const seen = new Set();
    const groups = (payload && payload.groups) || payload || {};
    const pushGoal = (goalId, state, extra = {}) => {
      if (!goalId || seen.has(goalId)) return;
      seen.add(goalId);
      goals.push({ goalId, state: state || null, agents: agentsByGoal[goalId] || [], ...extra });
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
      '--include-detail', 'scheduler',
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
      scheduler: normalizeScheduler(payload.scheduler_hint),
      raw: payload,
    };
  },

  async 'loopx.turnPlan'({ argvPrefix = null, projectDir = null, goalId, agentId } = {}) {
    if (!goalId || !agentId) throw new Error('loopx.turnPlan: goalId and agentId are required');
    const { result, payload } = await runJson(argvPrefix, projectDir, [
      'turn', 'plan', '--goal-id', goalId, '--agent-id', agentId,
    ]);
    const route = payload && (payload.route?.kind ?? payload.route ?? null);
    return { ok: result.code === 0, route, raw: payload, stderr: result.stderr };
  },

  async 'loopx.runOnce'({
    argvPrefix = null,
    projectDir = null,
    goalId,
    agentId,
    host = null,          // 'codex-cli' | 'generic-cli'
    codexBin = null,
    hostCommandJson = null,
    timeoutSeconds = null,
  } = {}) {
    if (!goalId || !agentId) throw new Error('loopx.runOnce: goalId and agentId are required');
    if (!projectDir) throw new Error('loopx.runOnce: projectDir is required (--project)');
    if (runOnceInFlight.has(goalId)) {
      throw new Error(`loopx.runOnce: a run for goal "${goalId}" is already in flight`);
    }
    runOnceInFlight.add(goalId);
    try {
      const args = [
        'turn', 'run-once', '--execute',
        '--project', projectDir,
        '--goal-id', goalId,
        '--agent-id', agentId,
      ];
      if (host === 'codex-cli') {
        args.push('--host', 'codex-cli');
        if (codexBin) args.push('--codex-bin', codexBin);
      } else if (host === 'generic-cli') {
        args.push('--host', 'generic-cli');
        if (hostCommandJson) args.push('--host-command-json', hostCommandJson);
      }
      if (timeoutSeconds) args.push('--timeout-seconds', String(timeoutSeconds));

      const cliTimeoutMs = ((Number(timeoutSeconds) || 120) + 60) * 1000;
      const { result, payload } = await runJson(argvPrefix, projectDir, args, {
        timeoutMs: cliTimeoutMs,
        onLine: (line) => global.rpcEmit('runOnce:log', { goalId, line }),
      });
      const done = {
        ok: result.code === 0,
        goalId,
        exitCode: result.code,
        status: payload?.status ?? null,
        raw: payload,
        stderr: result.stderr.slice(-4000),
      };
      global.rpcEmit('runOnce:done', done);
      return done;
    } finally {
      runOnceInFlight.delete(goalId);
    }
  },
};
