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
