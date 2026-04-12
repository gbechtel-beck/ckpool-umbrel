#!/bin/bash
set -e

BITCOIN_RPC_URL="${BITCOIN_RPC_URL:-http://10.21.21.8}"
BITCOIN_RPC_PORT="${BITCOIN_RPC_PORT:-8332}"
BITCOIN_RPC_USER="${BITCOIN_RPC_USER:-umbrel}"
BITCOIN_RPC_PASS="${BITCOIN_RPC_PASS:-umbrel}"
STRATUM_PORT="${STRATUM_PORT:-3333}"
POOL_SIG="${POOL_SIG:-/SoloStrike.io/}"
MIN_DIFF="${MIN_DIFF:-1000}"

echo "=============================================="
echo " CKPool Solo for Umbrel — SoloStrike.io"
echo " Bitcoin RPC : ${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}"
echo " Stratum Port: ${STRATUM_PORT}"
echo "=============================================="

# Clean up stale socket from previous run
rm -rf /ckpool/logs/ckpool.sock

cat > /ckpool/config/ckpool.conf << CONF
{
  "btcd" : [{
    "url"    : "${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}",
    "auth"   : "${BITCOIN_RPC_USER}",
    "pass"   : "${BITCOIN_RPC_PASS}",
    "notify" : true
  }],
  "btcsig"    : "${POOL_SIG}",
  "mindiff"   : ${MIN_DIFF},
  "startdiff" : ${MIN_DIFF},
  "logdir"    : "/ckpool/logs",
  "serverurl" : ["0.0.0.0:${STRATUM_PORT}"]
}
CONF

echo "Waiting for Bitcoin node RPC..."
until curl -sf --max-time 5 \
    -u "${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASS}" \
    -d '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
    "${BITCOIN_RPC_URL}:${BITCOIN_RPC_PORT}" > /dev/null 2>&1; do
  sleep 5
done

echo "Bitcoin node ready — starting CKPool in solo mode (-B)"
exec /usr/local/bin/ckpool -B -k -c /ckpool/config/ckpool.conf -s /ckpool/logs/ckpool.sock
