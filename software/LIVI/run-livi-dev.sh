#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# ---- Clean up a previous interrupted development instance ----
# Match only processes launched from this checkout; do not touch unrelated Electron apps.
stop_matching() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  [ -z "$pids" ] || kill -TERM $pids 2>/dev/null || true
}

stop_matching "^$PWD/node_modules/.*/electron/dist/electron( |$)"
stop_matching "^node $PWD/node_modules/.*/vite/bin/vite\.js( |$)"
stop_matching "^$PWD/assets/gstreamer/linux-arm64/bin/gst-device-monitor-1\.0( |$)"
# helperd normally runs through sudo; the installed sudoers rule makes this non-interactive.
sudo -n pkill -TERM -f "^$HOME/.config/LIVI/driver/livi-helperd$" 2>/dev/null || true
sudo -n pkill -TERM -f "^$PWD/native/livi-helperd/target/release/livi-helperd$" 2>/dev/null || true
sleep 2

# Escalate only processes from this checkout that ignored TERM.
for pattern in \
  "^$PWD/node_modules/.*/electron/dist/electron( |$)" \
  "^node $PWD/node_modules/.*/vite/bin/vite\.js( |$)" \
  "^$PWD/assets/gstreamer/linux-arm64/bin/gst-device-monitor-1\.0( |$)"; do
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  [ -z "$pids" ] || kill -KILL $pids 2>/dev/null || true
done

# Chromium locks can survive a hard reboot/crash. They are safe to remove now that this
# checkout has no Electron process.
rm -f -- "$HOME/.config/LIVI/SingletonCookie" \
  "$HOME/.config/LIVI/SingletonLock" \
  "$HOME/.config/LIVI/SingletonSocket"

# A crashed helper can leave its BlueZ Profile UUID registered. Restart BlueZ when
# passwordless sudo (or a fresh sudo timestamp) permits it; otherwise continue normally.
if sudo -n systemctl restart bluetooth.service 2>/dev/null; then
  sleep 1
else
  echo "WARN: BlueZ was not reset (run sudo -v before this script if UUID already registered)" >&2
fi

# ---- Display ----
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# ---- GStreamer (bundled runtime) ----
GST_ROOT="$PWD/assets/gstreamer/linux-arm64"
export GST_PLUGIN_SCANNER="${GST_PLUGIN_SCANNER:-$(find "$GST_ROOT" -name gst-plugin-scanner -type f | head -n 1)}"

# ---- livi-helperd (CarPlay/MFi daemon) ----
# Without this the dev build cannot find the helper and CarPlay never connects.
if [ -z "${LIVI_HELPER_BIN:-}" ]; then
  for candidate in \
    "$HOME/.config/LIVI/driver/livi-helperd" \
    "$PWD/native/livi-helperd/target/release/livi-helperd"; do
    if [ -x "$candidate" ]; then
      export LIVI_HELPER_BIN="$candidate"
      break
    fi
  done
fi
if [ -z "${LIVI_HELPER_BIN:-}" ]; then
  echo "ERROR: livi-helperd not found. Build it with 'pnpm run build:helperd'" >&2
  exit 1
fi

# ---- Headless web-managed mode (no visible Raspberry Pi desktop window) ----
export LIVI_HEADLESS="${LIVI_HEADLESS:-1}"

# ---- Kiosk mode (used only when LIVI_HEADLESS=0) ----
export LIVI_KIOSK="${LIVI_KIOSK:-1}"

# ---- LAN web bridge: use the existing certificate for HTTPS when available ----
export LIVI_WEB_BRIDGE="${LIVI_WEB_BRIDGE:-1}"
WEB_CERT="$HOME/.config/LIVI/web-bridge/cert.pem"
WEB_KEY="$HOME/.config/LIVI/web-bridge/key.pem"
if [ -z "${LIVI_WEB_TLS_CERT:-}" ] && [ -z "${LIVI_WEB_TLS_KEY:-}" ] &&
   [ -f "$WEB_CERT" ] && [ -f "$WEB_KEY" ]; then
  export LIVI_WEB_TLS_CERT="$WEB_CERT"
  export LIVI_WEB_TLS_KEY="$WEB_KEY"
fi

exec pnpm run dev
