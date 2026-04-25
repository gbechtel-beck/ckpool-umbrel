const express = require("express");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const http = require("http");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const LOG_DIR = process.env.CKPOOL_LOG_DIR || "/ckpool/logs";
const PORT = process.env.PORT || 4040;
const BTC_RPC_URL = process.env.BITCOIN_RPC_URL || "http://10.21.21.8";
const BTC_RPC_PORT = process.env.BITCOIN_RPC_PORT || "8332";
const BTC_RPC_USER = process.env.BITCOIN_RPC_USER || "umbrel";
const BTC_RPC_PASS = process.env.BITCOIN_RPC_PASS || "umbrel";

// In-memory cache
let cache = {
  pool: {},          // raw pool.status merged dict
  users: {},         // address -> user object (with worker[] array)
  workers: {},       // workername -> worker object
  network: {},       // bitcoin core network info
  blocks: [],        // discovered blocks (parsed from ckpool.log)
  poolHashrateHistory: [],  // [{label: ISO, data: H/s}, ...] last 24h, 20-min buckets
  clientHashrateHistory: {}, // address -> [{label, data}]
  workerSessions: {},  // workername -> { startTs, lastShareTs, bestDiff, secondBestDiff, hashrateSamples: [{ts, hr}], peakHashrate }
  startTime: new Date().toISOString(),
  lastUpdated: null
};

const HISTORY_MAX = 1440;      // 24h at 1-min sampling
const HISTORY_INTERVAL = 60;   // 60 seconds between samples
const STALE_THRESHOLD = 300;   // seconds — workers with no share in this window are dropped from active counts

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { return null; }
}

function parseHR(hr) {
  if (!hr) return 0;
  const s = String(hr);
  const n = parseFloat(s);
  if (isNaN(n)) return 0;
  if (s.indexOf("E") > -1) return n * 1e18;
  if (s.indexOf("P") > -1) return n * 1e15;
  if (s.indexOf("T") > -1) return n * 1e12;
  if (s.indexOf("G") > -1) return n * 1e9;
  if (s.indexOf("M") > -1) return n * 1e6;
  if (s.indexOf("K") > -1) return n * 1e3;
  return n;
}

function rpcCall(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "1.0", id: method, method, params: params || [] });
    const auth = Buffer.from(BTC_RPC_USER + ":" + BTC_RPC_PASS).toString("base64");
    const urlParts = BTC_RPC_URL.replace("http://", "").split(":");
    const options = {
      hostname: urlParts[0],
      port: parseInt(BTC_RPC_PORT),
      path: "/",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + auth,
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data).result); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

async function fetchNetwork() {
  try {
    const [chainInfo, miningInfo] = await Promise.all([
      rpcCall("getblockchaininfo"),
      rpcCall("getmininginfo")
    ]);
    const blocks = chainInfo.blocks;
    const difficulty = chainInfo.difficulty;
    const networkhashps = miningInfo.networkhashps;
    const blocksInEpoch = blocks % 2016;
    const blocksUntilRetarget = 2016 - blocksInEpoch;
    const retargetBlock = blocks + blocksUntilRetarget;
    const estRetargetSeconds = blocksUntilRetarget * 10 * 60;
    cache.network = {
      blocks,
      difficulty,
      networkhashps,
      // Aliases the new dashboard expects
      networkHashrate: networkhashps,
      height: blocks,
      blocksInEpoch,
      blocksUntilRetarget,
      retargetBlock,
      estRetargetSeconds
    };
  } catch (e) {
    console.error("RPC error:", e.message);
  }
}

function refreshLogs() {
  try {
    // Pool status (merged from all files in logs/pool)
    const pd = path.join(LOG_DIR, "pool");
    if (fs.existsSync(pd)) {
      let p = {};
      for (const f of fs.readdirSync(pd)) {
        const d = readJson(path.join(pd, f));
        if (d) Object.assign(p, d);
      }
      cache.pool = p;
    }

    // Users + workers
    const ud = path.join(LOG_DIR, "users");
    cache.users = {};
    cache.workers = {};
    if (fs.existsSync(ud)) {
      for (const file of fs.readdirSync(ud)) {
        const fp = path.join(ud, file);
        try {
          if (fs.statSync(fp).isFile()) {
            const d = readJson(fp);
            if (d) {
              cache.users[file] = { address: file, ...d };
              if (d.worker) {
                for (const w of d.worker) cache.workers[w.workername] = w;
              }
            }
          }
        } catch (e) { /* skip unreadable */ }
      }
    }

    cache.lastUpdated = new Date().toISOString();
    updateSessions();
    maybeSampleHistory();
  } catch (e) {
    console.error("refreshLogs error:", e);
  }
}

// ===== Session tracking =====
// A "session" starts when a worker reconnects after going stale (>STALE_THRESHOLD).
// Per session we track: start time, best diff, peak hashrate, rolling hashrate avg.
const HR_SAMPLE_LIMIT = 200;     // ~33 min at 10s refresh — enough for stable session avg
function updateSessions() {
  const nowSec = Math.floor(Date.now() / 1000);

  for (const wname of Object.keys(cache.workers)) {
    const w = cache.workers[wname];
    const lastShare = w.lastshare || 0;
    if (!lastShare) continue;
    const ageSec = nowSec - lastShare;

    let s = cache.workerSessions[wname];

    // Brand new worker, OR worker was stale and just reconnected → start a new session
    if (!s || (s.lastShareTs && (lastShare - s.lastShareTs) > STALE_THRESHOLD)) {
      s = {
        startTs: lastShare,
        lastShareTs: lastShare,
        bestDiff: 0,
        peakHashrate: 0,
        hashrateSamples: []
      };
      cache.workerSessions[wname] = s;
    }

    // Update last-share watermark
    if (lastShare > s.lastShareTs) s.lastShareTs = lastShare;

    // Update session best.
    // ckpool's user file only ever reports the highest share difficulty seen since
    // ckpool started — there's no per-share event stream in the log file.
    const curBest = w.bestshare || 0;
    if (curBest > s.bestDiff) s.bestDiff = curBest;

    // Sample hashrate (5m window — what ckpool considers stable)
    if (ageSec <= STALE_THRESHOLD) {
      const hr5m = parseHR(w.hashrate5m || w.hashrate1m || 0);
      if (hr5m > 0) {
        s.hashrateSamples.push({ ts: nowSec, hr: hr5m });
        if (s.hashrateSamples.length > HR_SAMPLE_LIMIT) s.hashrateSamples.shift();
        if (hr5m > s.peakHashrate) s.peakHashrate = hr5m;
      }
    }
  }
}

function getSessionAvgHashrate(s) {
  if (!s || !s.hashrateSamples.length) return 0;
  const sum = s.hashrateSamples.reduce((a, x) => a + x.hr, 0);
  return sum / s.hashrateSamples.length;
}

// Sample hashrate every HISTORY_INTERVAL seconds for the chart
let lastHistorySample = 0;
function maybeSampleHistory() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - lastHistorySample < HISTORY_INTERVAL) return;
  lastHistorySample = nowSec;

  const label = new Date().toISOString();

  // Pool-wide: parse "hashrate5m" from cache.pool (line 2 of pool.status)
  const poolHR = parseHR(cache.pool.hashrate5m || cache.pool.hashrate1m || 0);
  cache.poolHashrateHistory.push({ label, data: poolHR });
  if (cache.poolHashrateHistory.length > HISTORY_MAX) {
    cache.poolHashrateHistory.shift();
  }

  // Per-client hashrate history
  for (const addr of Object.keys(cache.users)) {
    const u = cache.users[addr];
    const myHR = parseHR(u.hashrate5m || u.hashrate1m || 0);
    if (!cache.clientHashrateHistory[addr]) cache.clientHashrateHistory[addr] = [];
    cache.clientHashrateHistory[addr].push({ label, data: myHR });
    if (cache.clientHashrateHistory[addr].length > HISTORY_MAX) {
      cache.clientHashrateHistory[addr].shift();
    }
  }
}

// Parse discovered blocks from ckpool.log (best-effort)
function refreshBlocks() {
  try {
    const logPath = path.join(LOG_DIR, "ckpool.log");
    if (!fs.existsSync(logPath)) return;
    // Read last 64KB only to keep parsing fast
    const stat = fs.statSync(logPath);
    const len = Math.min(65536, stat.size);
    const fd = fs.openSync(logPath, "r");
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, stat.size - len);
    fs.closeSync(fd);
    const text = buf.toString("utf8");

    const blocks = [];
    // Match lines like "BLOCK ACCEPTED" or "found block at height N"
    const re = /(BLOCK ACCEPTED|block.*?height[: ]+(\d+)|Solved block at height (\d+))/gi;
    let m;
    while ((m = re.exec(text)) !== null && blocks.length < 50) {
      const height = m[2] || m[3] || null;
      blocks.push({
        height: height ? parseInt(height) : null,
        address: null,
        reward: null,
        createdAt: new Date().toISOString()
      });
    }
    cache.blocks = blocks;
  } catch (e) {
    // non-fatal
  }
}

// Helpers for synthesized endpoints

// Filter: only workers with a share within STALE_THRESHOLD seconds count as active
function isActive(w) {
  if (!w || !w.lastshare) return false;
  const ageSec = Math.floor(Date.now() / 1000) - w.lastshare;
  return ageSec <= STALE_THRESHOLD;
}

function getActiveWorkers() {
  return Object.values(cache.workers).filter(isActive);
}

function getUserAgents() {
  // Group ACTIVE workers only by detected device family
  const groups = {};
  for (const w of getActiveWorkers()) {
    const wname = w.workername || "";
    const tail = (wname.split(".").pop() || "").toLowerCase();
    let family = "Unknown";
    if (tail.includes("bitax")) family = "Bitaxe";
    else if (tail.includes("bitforge")) family = "BitForge";
    else if (tail.includes("qmoney") || tail.includes("avalon")) family = "Avalon";
    else if (tail.includes("nerdqaxe") || tail.includes("nerd")) family = "NerdQaxe";
    else if (tail.includes("antminer") || tail.startsWith("s") || tail.startsWith("t")) family = "Antminer";
    else family = tail.replace(/[0-9-]+$/, "") || "Worker";

    if (!groups[family]) groups[family] = { userAgent: family, count: 0, totalHashRate: 0, bestDifficulty: 0 };
    groups[family].count += 1;
    groups[family].totalHashRate += parseHR(w.hashrate5m || w.hashrate1m);
    if ((w.bestever || 0) > groups[family].bestDifficulty) {
      groups[family].bestDifficulty = w.bestever || 0;
    }
  }
  return Object.values(groups);
}

function getHighScores() {
  // Pool-wide top-N best ever shares across all workers (lifetime, all workers — active or stale)
  // Dedupe: same bestDifficulty value is the same physical share, even if it appears
  // on multiple worker entries (e.g. when a worker is renamed mid-life).
  const seen = new Set();
  const all = Object.values(cache.workers)
    .map(w => ({
      bestDifficulty: w.bestever || w.bestshare || 0,
      bestDifficultyUserAgent: (w.workername || "unknown").split(".").pop() || "unknown",
      updatedAt: w.lastshare ? new Date(w.lastshare * 1000).toISOString() : null
    }))
    .filter(x => x.bestDifficulty > 0)
    .sort((a, b) => b.bestDifficulty - a.bestDifficulty)
    .filter(x => {
      const key = Math.round(x.bestDifficulty);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
  return all;
}

function getSessionScores() {
  // Per-session top-N for ACTIVE workers only.
  // Each entry includes session best, 2nd-best, current 1m HR, current 5m HR, session avg HR, peak HR.
  const out = [];
  for (const w of getActiveWorkers()) {
    const wname = w.workername || "";
    const s = cache.workerSessions[wname];
    if (!s || s.bestDiff <= 0) continue;
    out.push({
      workername: wname,
      device: (wname.split(".").pop() || "unknown"),
      bestDiff: s.bestDiff,
      secondBestDiff: s.secondBestDiff,
      hashrate1m: parseHR(w.hashrate1m || 0),
      hashrate5m: parseHR(w.hashrate5m || 0),
      hashrateAvg: getSessionAvgHashrate(s),
      hashratePeak: s.peakHashrate,
      sessionStart: s.startTs ? new Date(s.startTs * 1000).toISOString() : null,
      sessionDurationSec: s.startTs ? Math.floor(Date.now() / 1000) - s.startTs : 0,
      lastShare: s.lastShareTs ? new Date(s.lastShareTs * 1000).toISOString() : null
    });
  }
  return out.sort((a, b) => b.bestDiff - a.bestDiff).slice(0, 10);
}

// Initial population
refreshLogs();
refreshBlocks();
fetchNetwork();
maybeSampleHistory();

// Periodic refresh
setInterval(refreshLogs, 10000);
setInterval(refreshBlocks, 30000);
setInterval(fetchNetwork, 60000);
setInterval(maybeSampleHistory, 10000);

// ========= API endpoints expected by the new dashboard =========

// Top-level pool info: shape mirrors public-pool's /api/info, plus per-session scores
app.get("/api/info", (req, res) => {
  const userAgents = getUserAgents();
  const highScores = getHighScores();
  const sessionScores = getSessionScores();

  // Pool-wide responsiveness — average time since last share across active workers
  const active = getActiveWorkers();
  const lastShareGaps = [];
  for (const w of active) {
    if (w.lastshare) lastShareGaps.push(Math.floor(Date.now() / 1000) - w.lastshare);
  }
  const stratumStats = {
    activeWorkers: active.length,
    avgLastShareSec: lastShareGaps.length ? Math.round(lastShareGaps.reduce((a, b) => a + b, 0) / lastShareGaps.length) : null
  };

  res.json({
    userAgents,
    highScores,
    sessionScores,
    stratumStats,
    blockData: cache.blocks,
    uptime: cache.startTime
  });
});

// Pool-wide hashrate timeseries
app.get("/api/info/chart", (req, res) => {
  res.json(cache.poolHashrateHistory);
});

// Per-client info (workers for one address) — only ACTIVE workers (share within STALE_THRESHOLD)
app.get("/api/client/:addr", (req, res) => {
  const addr = req.params.addr;
  const u = cache.users[addr];
  if (!u || !u.worker) {
    return res.json({ workers: [] });
  }
  const workers = u.worker
    .filter(isActive)
    .map(w => {
      const lastSeen = w.lastshare ? new Date(w.lastshare * 1000).toISOString() : null;
      const s = cache.workerSessions[w.workername] || null;
      const hr5m = parseHR(w.hashrate5m || 0);
      const hr1m = parseHR(w.hashrate1m || 0);
      const lastShareSec = w.lastshare ? Math.floor(Date.now() / 1000) - w.lastshare : null;
      return {
        name: (w.workername || "").split(".").pop() || w.workername,
        sessionId: w.workername || "",
        // Hashrate windows
        hashRate: hr5m || hr1m,  // back-compat default
        hashrate1m: hr1m,
        hashrate5m: hr5m,
        hashrateAvg: s ? getSessionAvgHashrate(s) : 0,
        hashratePeak: s ? s.peakHashrate : 0,
        // Difficulty stats
        bestDifficulty: w.bestever || w.bestshare || 0,  // lifetime, back-compat
        sessionBestDiff: s ? s.bestDiff : 0,
        // Responsiveness
        lastShareSec,                            // seconds since last share
        sharesTotal: Number(w.shares) || 0,      // cumulative session work units
        // Timing
        startTime: s && s.startTs ? new Date(s.startTs * 1000).toISOString()
                   : (u.authorised ? new Date(u.authorised * 1000).toISOString() : lastSeen),
        sessionDurationSec: s && s.startTs ? Math.floor(Date.now() / 1000) - s.startTs : 0,
        lastSeen
      };
    });
  res.json({ workers });
});

// Per-client hashrate chart
app.get("/api/client/:addr/chart", (req, res) => {
  const addr = req.params.addr;
  res.json(cache.clientHashrateHistory[addr] || []);
});

// ========= Existing endpoints (kept for backward compat) =========

app.get("/api/network", (req, res) => res.json(cache.network));

app.get("/api/summary", (req, res) => {
  const users = Object.values(cache.users);
  const workers = Object.values(cache.workers);
  const totalHashrate = workers.reduce((a, w) => a + parseHR(w.hashrate5m || w.hashrate1m), 0);
  const totalShares = users.reduce((a, u) => a + (u.shares || 0), 0);
  res.json({
    pool: cache.pool,
    users,
    workers,
    network: cache.network,
    totalWorkers: workers.length,
    totalUsers: users.length,
    totalHashrate,
    totalShares,
    blocks: cache.blocks,
    lastUpdated: cache.lastUpdated
  });
});

app.get("/api/pool", (req, res) => res.json(cache.pool));
app.get("/api/users", (req, res) => res.json(cache.users));
app.get("/api/workers", (req, res) => res.json(cache.workers));
app.get("/api/status", (req, res) => res.json({ status: "ok", lastUpdated: cache.lastUpdated }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("CKPool Solo Dashboard running on port " + PORT);
  console.log("Reading logs from: " + LOG_DIR);
});
