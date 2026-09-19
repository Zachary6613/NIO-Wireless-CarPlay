#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Install the OS-level packages required to build, run and package LIVI from
# source in this repository.
#
# Sections:
#   1. runtime packages from software/LIVI/scripts/install/packages.txt
#      (bluez, hostapd, dnsmasq, avahi, pulseaudio, libva, ...)
#   2. build host packages needed to compile native modules and produce the
#      AppImage (compiler toolchain, patchelf, libfuse2, compression libs).
#
# Unlike software/LIVI/scripts/install/install.sh this script does NOT
# download a prebuilt AppImage, create autostart entries, or reconfigure I2C.
# The MFi board here is wired to hardware /dev/i2c-1 with 3.3V always-on power.
#
# Re-runnable. Run as a regular user; sudo is invoked internally.
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="$REPO_ROOT/software/LIVI/scripts/install"

# shellcheck source=../software/LIVI/scripts/install/common.sh
. "$INSTALL_DIR/common.sh"

livi_require_regular_user

echo "== 1/2 Runtime packages (from $INSTALL_DIR/packages.txt)"
# shellcheck disable=SC2046
livi_pm_install $(livi_packages core | tr '\n' ' ')

# Resolve the apt package name for FUSE 2: 'libfuse2t64' on Debian 13/Ubuntu
# 24.04+ time64 releases, plain 'libfuse2' elsewhere.
livi_apt_pick() {
  for name in "$@"; do
    if apt-cache show "$name" >/dev/null 2>&1; then printf '%s\n' "$name"; return 0; fi
  done
  return 1
}

echo
echo "== 2/2 Build & packaging host packages"
case "$(livi_pm)" in
  apt)
    fuse_pkg="$(livi_apt_pick libfuse2t64 libfuse2)"
    # shellcheck disable=SC2086
    livi_pm_install \
      build-essential patchelf desktop-file-utils file "$fuse_pkg" \
      zlib1g libzstd1 liblz4-1 liblzma5 liblzo2-2
    ;;
  dnf)
    livi_pm_install \
      gcc gcc-c++ make patchelf desktop-file-utils file fuse-libs \
      zlib libzstd lz4-libs xz-libs lzo
    ;;
esac

echo
echo "== Toolchain check"
missing=0
for tool in node pnpm cargo; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "   found:   $tool -> $(command -v "$tool")"
  else
    echo "   MISSING: $tool"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  cat <<'EOF'

Install the missing toolchain before continuing:

  # Node.js + pnpm (Debian/Raspberry Pi OS 13 ships Node 20)
  sudo apt-get install -y nodejs npm
  sudo corepack enable

  # Rust toolchain (for livi-helperd and the native modules)
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
EOF
  exit 1
fi

cat <<'EOF'

System dependencies ready.

Notes:
  - On the first `pnpm run build:linux:arm64`, electron-builder downloads its
    own AppImage toolset (mksquashfs + static runtime); internet access is
    required once. A pre-downloaded toolset directory can be supplied with
    APPIMAGE_TOOLS_PATH=/path/to/toolset.
  - Next steps: pnpm install, then pnpm run build:helperd in software/LIVI.
EOF
