/**
 * CKPool Solo — Umbrel Dashboard Server
 * Reads CKPool log directory structure and serves:
 *   GET /api/pool      — pool-wide stats
 *   GET /api/users     — all user (address) stats
 *   GET /api/workers   — all worker stats
 *   GET /api/blocks    — found blocks
 *   GET /api/status    — health check
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs-extra');
const path    = require('path');
const chokidar = require('chokidar');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const LOG_DIR = process.env.CKPOOL_LOG_DIR || '/ckpool/logs';
const PORT    = process.env.PORT || 4040;

// ─── Cache ───────────────────────────────────────────────────────────────────
let cache = {
  pool:    {},
  users:   {},
  workers: {},
  blocks:  [],
  lastUpdated: null
};

// ─── Log File Readers ─────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    // CKPool log files may have multiple JSON objects — take the last valid one
    const lines = raw.split('\n').filter(l => l.trim().startsWith('{'));
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function readPoolStats() {
  const poolDir = path.join(LOG_DIR, 'pool');
  if (!fs.existsSync(poolDir)) return {};
  try {
    const files = fs.readdirSync(poolDir);
    let latest = {};
    for (const f of files) {
      const data = readJsonFile(path.join(poolDir, f));
      if (data) Object.assign(latest, data);
    }
    return latest;
  } catch {
    return {};
  }
}

function readUserStats() {
  const usersDir = path.join(LOG_DIR, 'users');
  if (!fs.existsSync(usersDir)) return {};
  const result = {};
  try {
    const dirs = fs.readdirSync(usersDir);
    for (const userDir of dirs) {
      const userPath = path.join(usersDir, userDir);
      if (!fs.statSync(userPath).isDirectory()) continue;
      const files = fs.readdirSync(userPath);
      let stats = { address: userDir };
      for (const f of files) {
        const data = readJsonFile(path.join(userPath, f));
        if (data) Object.assign(stats, data);
      }
      result[userDir] = stats;
    }
  } catch {}
  return result;
}

function readWorkerStats() {
  const workersDir = path.join(LOG_DIR, 'workers');
  if (!fs.existsSync(workersDir)) return {};
  const result = {};
  try {
    const dirs = fs.readdirSync(workersDir);
    for (const wDir of dirs) {
      const wPath = path.join(workersDir, wDir);
      if (!fs.statSync(wPath).isDirectory()) continue;
      const files = fs.readdirSync(wPath);
      let stats = { worker: wDir };
      for (const f of files) {
        const data = readJsonFile(path.join(wPath, f));
        if (data) Object.assign(stats, data);
      }
      result[wDir] = stats;
    }
  } catch {}
  return result;
}

function readBlocks() {
  const blocksFile = path.join(LOG_DIR, 'pool', 'blocks.log');
  if (!fs.existsSync(blocksFile)) return [];
  try {
    const lines = fs.readFileSync(blocksFile, 'utf8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // newest first
    return lines.slice(0, 50); // last 50 blocks
  } catch {
    return [];
  }
}

// ─── Refresh Cache ────────────────────────────────────────────────────────────

function refreshCache() {
  cache.pool    = readPoolStats();
  cache.users   = readUserStats();
  cache.workers = readWorkerStats();
  cache.blocks  = readBlocks();
  cache.lastUpdated = new Date().toISOString();
}

// Initial load + watch for changes
refreshCache();
setInterval(refreshCache, 10000); // refresh every 10s

chokidar.watch(LOG_DIR, { ignoreInitial: true, depth: 3 })
  .on('change', () => refreshCache())
  .on('add',    () => refreshCache());

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    logDir: LOG_DIR,
    lastUpdated: cache.lastUpdated,
    poolRunning: Object.keys(cache.pool).length > 0
  });
});

app.get('/api/pool', (req, res) => {
  res.json(cache.pool);
});

app.get('/api/users', (req, res) => {
  res.json(cache.users);
});

app.get('/api/workers', (req, res) => {
  res.json(cache.workers);
});

app.get('/api/blocks', (req, res) => {
  res.json(cache.blocks);
});

// Combined summary endpoint — used by the dashboard
app.get('/api/summary', (req, res) => {
  const users   = Object.values(cache.users);
  const workers = Object.values(cache.workers);

  const totalHashrate = workers.reduce((acc, w) => {
    return acc + (parseFloat(w.hashrate5m) || 0);
  }, 0);

  res.json({
    pool:         cache.pool,
    users,
    workers,
    blocks:       cache.blocks,
    totalWorkers: workers.length,
    totalUsers:   users.length,
    totalHashrate,
    lastUpdated:  cache.lastUpdated
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CKPool Solo Dashboard running on port ${PORT}`);
  console.log(`Reading logs from: ${LOG_DIR}`);
});
