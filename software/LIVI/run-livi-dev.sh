#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
GST_ROOT="$PWD/assets/gstreamer/linux-arm64"
export GST_PLUGIN_SCANNER="$(find "$GST_ROOT" -name gst-plugin-scanner -type f | head -n 1)"
export DISPLAY="${DISPLAY:-:0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
exec pnpm run dev
