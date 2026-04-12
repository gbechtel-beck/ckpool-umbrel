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

let cache = { pool: {}, users: {}, workers: {}, network: {}, lastUpdated: null };

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); }
  catch(e) { return null; }
}

function parseHR(hr) {
  if (!hr) return 0;
  const s = String(hr);
  const n = parseFloat(s);
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
        catch(e) { reject(e); }
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
      blocksInEpoch,
      blocksUntilRetarget,
      retargetBlock,
      estRetargetSeconds
    };
  } catch(e) {
    console.error("RPC error:", e.message);
  }
}

function refreshLogs() {
  try {
    const pd = path.join(LOG_DIR, "pool");
    if (fs.existsSync(pd)) {
      let p = {};
      for (const f of fs.readdirSync(pd)) {
        const d = readJson(path.join(pd, f));
        if (d) Object.assign(p, d);
      }
      cache.pool = p;
    }
    const ud = path.join(LOG_DIR, "users");
    cache.users = {};
    cache.workers = {};
    if (fs.existsSync(ud)) {
      for (const file of fs.readdirSync(ud)) {
        const fp = path.join(ud, file);
        if (fs.statSync(fp).isFile()) {
          const d = readJson(fp);
          if (d) {
            cache.users[file] = { address: file, ...d };
            if (d.worker) {
              for (const w of d.worker) cache.workers[w.workername] = w;
            }
          }
        }
      }
    }
    cache.lastUpdated = new Date().toISOString();
  } catch(e) { console.error(e); }
}

refreshLogs();
fetchNetwork();
setInterval(refreshLogs, 10000);
setInterval(fetchNetwork, 60000);

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
    blocks: [],
    lastUpdated: cache.lastUpdated
  });
});

app.get("/api/pool", (req, res) => res.json(cache.pool));
app.get("/api/users", (req, res) => res.json(cache.users));
app.get("/api/workers", (req, res) => res.json(cache.workers));
app.get("/api/network", (req, res) => res.json(cache.network));
app.get("/api/status", (req, res) => res.json({ status: "ok", lastUpdated: cache.lastUpdated }));

app.listen(PORT, "0.0.0.0", () => {
  console.log("CKPool Solo Dashboard running on port " + PORT);
  console.log("Reading logs from: " + LOG_DIR);
});
