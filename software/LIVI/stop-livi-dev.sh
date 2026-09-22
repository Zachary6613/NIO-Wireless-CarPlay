#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"

# Stop only processes launched from this LIVI checkout.
patterns=(
  "^$PWD/node_modules/.*/electron/dist/electron( |$)"
  "^node $PWD/node_modules/.*/vite/bin/vite\\.js( |$)"
  "^$PWD/assets/gstreamer/linux-arm64/bin/gst-device-monitor-1\\.0( |$)"
)

matching_pids() {
  local pattern="$1"
  pgrep -f "$pattern" 2>/dev/null || true
}

signal_matching() {
  local signal="$1" pattern pids
  shift
  for pattern in "$@"; do
    pids="$(matching_pids "$pattern")"
    [ -z "$pids" ] || kill "-$signal" $pids 2>/dev/null || true
  done
}

echo "Stopping LIVI..."
signal_matching TERM "${patterns[@]}"

# helperd normally exits with Electron. Stop an orphaned root helper as well.
sudo -n pkill -TERM -f "^$HOME/.config/LIVI/driver/livi-helperd$" 2>/dev/null || true
sudo -n pkill -TERM -f "^$PWD/native/livi-helperd/target/release/livi-helperd$" 2>/dev/null || true

for _ in 1 2 3 4 5; do
  alive=false
  for pattern in "${patterns[@]}"; do
    if [ -n "$(matching_pids "$pattern")" ]; then
      alive=true
      break
    fi
  done
  $alive || break
  sleep 1
done

# Escalate only project-scoped processes that ignored SIGTERM.
signal_matching KILL "${patterns[@]}"

rm -f -- "$HOME/.config/LIVI/SingletonCookie" \
  "$HOME/.config/LIVI/SingletonLock" \
  "$HOME/.config/LIVI/SingletonSocket"

remaining="$(pgrep -af "^$HOME/.config/LIVI/driver/livi-helperd$|^$PWD/native/livi-helperd/target/release/livi-helperd$" 2>/dev/null || true)"
if [ -n "$remaining" ]; then
  echo "WARN: a privileged livi-helperd is still running:" >&2
  echo "$remaining" >&2
  echo "Run: sudo pkill -TERM -f 'livi-helperd$'" >&2
  exit 1
fi

echo "LIVI stopped."
