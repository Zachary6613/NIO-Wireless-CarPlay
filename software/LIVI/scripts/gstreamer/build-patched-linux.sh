#!/usr/bin/env bash
set -euo pipefail

REPO="$(pwd)"
PATCHES="$REPO/scripts/gstreamer/patches"
MULTIARCH="$(dpkg-architecture -qDEB_HOST_MULTIARCH)"

echo "Building patched GStreamer for $MULTIARCH"

for f in /etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] && sed -i 's/^Types: deb$/Types: deb deb-src/' "$f"
done
if [ -f /etc/apt/sources.list ]; then
  sed -n 's/^deb \(.*\)/deb-src \1/p' /etc/apt/sources.list > /tmp/deb-src.list
  cat /tmp/deb-src.list >> /etc/apt/sources.list
fi

apt-get update
apt-get install -y --no-install-recommends \
  meson ninja-build pkgconf build-essential linux-libc-dev

apt-get build-dep -y gstreamer1.0-plugins-base gstreamer1.0-plugins-bad

apply_series() {
  local sub="$1"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    patch -p1 -i "$PATCHES/$sub/$p"
  done < "$PATCHES/$sub/series"
}

build_install() {
  local srcpkg="$1" sub="$2"
  shift 2
  local work
  work="$(mktemp -d)"
  (
    cd "$work"
    apt-get source -o APT::Sandbox::User=root "$srcpkg"
    cd "$(find . -mindepth 1 -maxdepth 1 -type d | head -1)"
    apply_series "$sub"
    grep -rq GST_VIDEO_FORMAT_NV12_128C8 . || {
      echo "patches did not apply: NV12_128C8 absent in $srcpkg source" >&2
      exit 1
    }
    meson setup _build \
      --prefix=/usr \
      --libdir="lib/$MULTIARCH" \
      -Dtests=disabled \
      -Dexamples=disabled \
      -Ddoc=disabled \
      "$@"
    meson compile -C _build
    meson install -C _build
  )
  ldconfig
}

build_install gstreamer1.0-plugins-base gst-plugins-base \
  -Dgl=enabled

build_install gstreamer1.0-plugins-bad gst-plugins-bad \
  -Dauto_features=disabled \
  -Dv4l2codecs=enabled \
  -Dwayland=enabled

echo "Patched GStreamer libraries installed:"
gst-inspect-1.0 --version | head -1
