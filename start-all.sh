#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

FRONTEND_PORT=3000
BACKEND_PORT=3001

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" || true)
  if [ -n "$pids" ]; then
    echo "Stopping process(es) on port $port: $pids"
    kill -TERM $pids >/dev/null 2>&1 || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" || true)
    if [ -n "$pids" ]; then
      echo "Force killing remaining process(es) on port $port: $pids"
      kill -KILL $pids >/dev/null 2>&1 || true
    fi
  fi
}

echo "Ensuring fixed ports: frontend=$FRONTEND_PORT backend=$BACKEND_PORT"
kill_port "$FRONTEND_PORT"
kill_port "$BACKEND_PORT"

echo "Starting backend (server) on port $BACKEND_PORT..."
cd server
SERVER_PORT="$BACKEND_PORT" npm run dev &
backend_pid=$!
cd ..

echo "Starting frontend on port $FRONTEND_PORT..."
npm run dev -- --port "$FRONTEND_PORT" &
frontend_pid=$!

cleanup() {
  kill "$backend_pid" "$frontend_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

exit_code=0
if ! wait "$backend_pid"; then
  echo "Backend exited with an error." >&2
  exit_code=1
fi
if ! wait "$frontend_pid"; then
  echo "Frontend exited with an error." >&2
  exit_code=1
fi
exit "$exit_code"
