#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

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

# ---- Kiosk mode ----
export LIVI_KIOSK="${LIVI_KIOSK:-1}"

# ---- Web bridge with HTTPS (auto-enabled when the certs exist) ----
TLS_DIR="$HOME/.config/LIVI/web-bridge"
if [ -z "${LIVI_WEB_BRIDGE:-}" ] && [ -f "$TLS_DIR/cert.pem" ] && [ -f "$TLS_DIR/key.pem" ]; then
  export LIVI_WEB_BRIDGE=1
  export LIVI_WEB_TLS_CERT="$TLS_DIR/cert.pem"
  export LIVI_WEB_TLS_KEY="$TLS_DIR/key.pem"
fi

exec pnpm run dev
