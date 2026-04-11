# ⛏ CKPool Solo for Umbrel

**Forked and packaged for Umbrel by [Gil Bechtel](https://solostrike.io) — SoloStrike.io**

Self-sovereign Bitcoin solo mining powered by [CKPool](https://bitbucket.org/ckolivas/ckpool)
(written by Con Kolivas), packaged as a one-click [Umbrel](https://umbrel.com) Community App.

---

## What is this?

CKPool is the battle-tested C-based mining pool software written by **Con Kolivas** that powers
`solo.ckpool.org` — one of the most trusted solo mining services in Bitcoin. This package forks
and containerizes CKPool so you can run your own instance on your personal Umbrel node with a
single click, connecting your miners directly to your own Bitcoin full node.

No third-party pool. No fees. No KYC. Your miners, your node, your blocks.

---

## Features

- ✅ **Native vardiff** — set `MIN_DIFF` / `MAX_DIFF` via config, no patching needed
- ✅ **Multi-arch builds** — AMD64 and ARM64 (Raspberry Pi, Umbrel Home)
- ✅ **Auto-connects** to your Umbrel Bitcoin node via internal RPC
- ✅ **Web dashboard** — live hashrate, workers, and blocks found
- ✅ **Stratum port 3333** — works with ASICs, BitAxe, Nerd Miners, and more
- ✅ **Zero fees** — this is your pool, not ours

---

## Miner Configuration

Point your miner to:

| Setting  | Value                              |
|----------|------------------------------------|
| Host     | `umbrel.local` or your Umbrel IP   |
| Port     | `3333`                             |
| Username | `YOUR_BTC_ADDRESS.workerName`      |
| Password | `x`                                |

**Example:** `bc1qxxxxx...yyyyy.MyAvalon`

---

## Installing on Umbrel (Community Store)

1. In your Umbrel dashboard go to **App Store → Community App Stores**
2. Add this store URL: `https://github.com/YOUR_GITHUB_USERNAME/ckpool-umbrel`
3. Find **CKPool Solo** and click Install
4. Make sure your **Bitcoin** app is running and synced first

---

## Repository Structure

```
ckpool-umbrel/
├── docker/
│   ├── ckpool/
│   │   ├── Dockerfile       # Compiles CKPool from source (Alpine Linux, multi-arch)
│   │   └── entrypoint.sh    # Generates ckpool.conf from env vars, starts ckpool
│   └── ui/
│       ├── Dockerfile       # Node.js dashboard server
│       ├── server.js        # CKPool log reader + REST API bridge
│       ├── package.json
│       └── public/
│           └── index.html   # Web dashboard UI
├── umbrel-package/
│   ├── umbrel-app.yml       # Umbrel app manifest
│   ├── docker-compose.yml   # Service definitions
│   └── exports.sh           # Internal IP assignments
├── .github/
│   └── workflows/
│       └── build.yml        # Multi-arch Docker build → GHCR on every push
├── AUTHORS                  # Full author credits (Gil Bechtel + Con Kolivas)
├── LICENSE                  # MIT (packaging) + GPLv3 notice (CKPool)
├── COPYING.GPL              # GPLv3 license reference for CKPool
└── README.md
```

---

## Environment Variables

| Variable       | Default                   | Description                           |
|----------------|---------------------------|---------------------------------------|
| `MIN_DIFF`     | `1000`                    | Minimum vardiff (Nerd Miners: ~1000)  |
| `START_DIFF`   | `1000`                    | Starting difficulty for new workers   |
| `MAX_DIFF`     | `0` (unlimited)           | Maximum vardiff cap                   |
| `POOL_SIG`     | `/SoloStrike.io/`  | Coinbase tag (visible in found blocks)|
| `STRATUM_PORT` | `3333`                    | Stratum listen port                   |

Bitcoin RPC variables (`BITCOIN_RPC_URL`, `BITCOIN_RPC_USER`, etc.) are injected
automatically by Umbrel from your running Bitcoin node.

---

## Building Locally

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/ckpool-umbrel
cd ckpool-umbrel

# Build CKPool image
docker build -t ckpool-solo-ckpool ./docker/ckpool

# Build UI image
docker build -t ckpool-solo-ui ./docker/ui

# Run locally (adjust env vars for your Bitcoin node)
docker-compose -f umbrel-package/docker-compose.yml up
```

---

## Credits & Licensing

### Umbrel Packaging
Forked, containerized, and packaged for Umbrel by:

**Gil Bechtel** · [SoloStrike.io](https://solostrike.io)

The Umbrel packaging, dashboard UI, Docker configuration, and entrypoint scripts
are original work licensed under the **MIT License**. See [LICENSE](./LICENSE).

### CKPool (the core mining software)
This package compiles and runs **CKPool**, written by:

**Con Kolivas** and **Andrew Smith**
- Source: https://bitbucket.org/ckolivas/ckpool
- License: **GNU General Public License v3.0 (GPLv3)**

CKPool is provided free of charge. Con Kolivas has maintained and developed this
software since 2014. If this software brings you value — especially a block find —
consider supporting the original authors. See [AUTHORS](./AUTHORS) for details.

> *"Please consider contributing to the authors listed in AUTHORS if you use this
> code to aid funding further development."* — Con Kolivas

---

## Disclaimer

This is an independent fork packaged by the SoloStrike.io community. It is not
officially affiliated with Con Kolivas or the CKPool project. Solo mining carries
no guarantee of finding a block. Mine responsibly and understand the odds.
