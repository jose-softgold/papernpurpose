#!/usr/bin/env bash
# Start Firebase emulators (local DB), seed if empty, and run the Vite app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RESET=0
FORCE_SEED=0
NO_SEED=0

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --seed) FORCE_SEED=1 ;;
    --no-seed) NO_SEED=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: npm run dev:up -- [--reset] [--seed] [--no-seed]

  (default)  Start emulators with persistence, seed only if empty, start Vite
  --reset    Wipe emulator-data/, start clean, always seed
  --seed     Seed even if data already exists (may duplicate business docs)
  --no-seed  Start emulators + app only; never seed
EOF
      exit 0
      ;;
    *)
      echo "Unknown flag: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (18+)." >&2
  exit 1
fi

EMU_PID=""
VITE_PID=""

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  echo ""
  echo "Shutting down…"
  if [[ -n "${VITE_PID}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  if [[ -n "${EMU_PID}" ]] && kill -0 "$EMU_PID" 2>/dev/null; then
    # SIGINT so firebase can --export-on-exit
    kill -INT "$EMU_PID" 2>/dev/null || true
    wait "$EMU_PID" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

if [[ ! -d node_modules ]]; then
  echo "Installing root dependencies…"
  npm install
fi
if [[ ! -d functions/node_modules ]]; then
  echo "Installing functions dependencies…"
  npm install --prefix functions
fi

echo "Building Cloud Functions…"
npm run build:functions

if [[ "$RESET" -eq 1 ]]; then
  echo "Resetting local emulator data…"
  rm -rf emulator-data
fi

# Skip hosting: firebase.json uses hosting target "app", which is only
# configured for the production project — starting it under demo-project
# kills the whole emulator suite. Vite serves the app locally.
EMU_ONLY="auth,functions,firestore,storage"
EMU_ARGS=(emulators:start --project demo-project --only "$EMU_ONLY" --export-on-exit=./emulator-data)
if [[ -d emulator-data ]] && [[ -n "$(ls -A emulator-data 2>/dev/null || true)" ]]; then
  EMU_ARGS+=(--import=./emulator-data)
  echo "Starting Firebase emulators (importing ./emulator-data)…"
else
  echo "Starting Firebase emulators (fresh; will export to ./emulator-data on exit)…"
fi

npx firebase "${EMU_ARGS[@]}" &
EMU_PID=$!

wait_for_port() {
  local port=$1
  local name=$2
  local i=0
  while ! (echo >/dev/tcp/127.0.0.1/"$port") 2>/dev/null; do
    i=$((i + 1))
    if [[ $i -ge 90 ]]; then
      echo "Timed out waiting for $name on port $port" >&2
      exit 1
    fi
    if ! kill -0 "$EMU_PID" 2>/dev/null; then
      echo "Emulators exited before $name was ready." >&2
      exit 1
    fi
    sleep 1
  done
  echo "  $name ready (port $port)"
}

echo "Waiting for emulators…"
wait_for_port 9099 "Auth"
wait_for_port 8180 "Firestore"
wait_for_port 5001 "Functions"
wait_for_port 9199 "Storage"
wait_for_port 4000 "Emulator UI"
# Brief settle so Admin SDK does not race a still-booting Firestore
sleep 1
if ! kill -0 "$EMU_PID" 2>/dev/null; then
  echo "Emulators exited unexpectedly after becoming ready." >&2
  exit 1
fi

if [[ "$NO_SEED" -eq 0 ]]; then
  if [[ "$FORCE_SEED" -eq 1 || "$RESET" -eq 1 ]]; then
    echo "Seeding sample data…"
    npm run seed
  else
    echo "Seeding sample data (if empty)…"
    FIRESTORE_EMULATOR_HOST=localhost:8180 \
      FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
      npx ts-node --project scripts/tsconfig.json scripts/seed.ts --if-empty
  fi
else
  echo "Skipping seed (--no-seed)."
fi

export VITE_USE_EMULATOR=true

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "============================================"
echo "  App (this machine):  http://localhost:5173"
if [[ -n "${LAN_IP}" ]]; then
  echo "  App (other device):  http://${LAN_IP}:5173"
fi
echo "  Emulator UI:         http://localhost:4000"
echo "  Login:               admin@craftbiz.local / password123"
echo "============================================"
echo "  Same Wi-Fi required. Ctrl-C to stop."
echo ""

# --host so phones / other laptops can reach Vite on the LAN
npm run dev -- --host &
VITE_PID=$!
wait "$VITE_PID"
