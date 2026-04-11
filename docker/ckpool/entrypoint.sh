#!/bin/bash
set -e

# ─────────────────────────────────────────────
# CKPool Solo - Umbrel Entrypoint
# Generates ckpool.conf from environment variables
# ─────────────────────────────────────────────

# Required env vars (provided by Umbrel)
BITCOIN_RPC_URL="${BITCOIN_RPC_URL:-http://10.21.21.8}"
BITCOIN_RPC_PORT="${BITCOIN_RPC_PORT:-8332}"
BITCOIN_RPC_USER="${BITCOIN_RPC_USER:-umbrel}"
BITCOIN_RPC_PASS="${BITCOIN_RPC_PASS:-umbrel}"
STRATUM_PORT="${STRATUM_PORT:-3333}"
POOL_SIG="${POOL_SIG:-/SoloStrike.io/}"
POOL_FEE="${POOL_FEE:-0}"
MIN_DIFF="${MIN_DIFF:-1000}"
START_DIFF="${START_DIFF:-1000}"
MAX_DIFF="${MAX_DIFF:-0}"

CONFIG_FILE="/ckpool/config/ckpool.conf"

echo "=============================================="
echo " CKPool Solo for Umbrel"
echo " Forked & packaged by Gil Bechtel"
echo " SoloStrike.io"
echo "----------------------------------------------"
echo " Powered by CKPool — Con Kolivas (GPLv3)"
echo " https://bitbucket.org/ckolivas/ckpool"
echo "----------------------------------------------"
echo " Bitcoin RPC : ${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}"
echo " Stratum Port: ${STRATUM_PORT}"
echo " Pool Sig    : ${POOL_SIG}"
echo "=============================================="

# Generate ckpool.conf from environment variables
cat > "${CONFIG_FILE}" << EOF
{
  "btcd" : [{
    "url"    : "${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}",
    "auth"   : "${BITCOIN_RPC_USER}",
    "pass"   : "${BITCOIN_RPC_PASS}",
    "notify" : true
  }],
  "btcsig"    : "${POOL_SIG}",
  "donation"  : ${POOL_FEE},
  "mindiff"   : ${MIN_DIFF},
  "startdiff" : ${START_DIFF},
  "maxdiff"   : ${MAX_DIFF},
  "logdir"    : "/ckpool/logs",
  "serverurl" : ["0.0.0.0:${STRATUM_PORT}"]
}
EOF

echo "Config written to ${CONFIG_FILE}"
echo ""

# Verify Bitcoin RPC is reachable before starting
echo "Waiting for Bitcoin node RPC..."
MAX_WAIT=120
WAITED=0
until curl -sf --max-time 5 \
    -u "${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASS}" \
    -d '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
    "${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}" > /dev/null 2>&1; do
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "ERROR: Bitcoin node not reachable after ${MAX_WAIT}s — check your Bitcoin app is running"
    exit 1
  fi
  echo "  Waiting for Bitcoin node... (${WAITED}s)"
  sleep 5
  WAITED=$((WAITED + 5))
done

echo "Bitcoin node is ready!"
echo ""

# Start CKPool
exec /usr/local/bin/ckpool -A -c "${CONFIG_FILE}" -s /ckpool/logs/ckpool.sock
