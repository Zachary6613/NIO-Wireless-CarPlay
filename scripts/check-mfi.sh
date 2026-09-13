#!/usr/bin/env bash
set -euo pipefail

bus="${1:-1}"

if [[ ! -e "/dev/i2c-${bus}" ]]; then
  echo "ERROR: /dev/i2c-${bus} does not exist. Enable I2C and reboot." >&2
  exit 1
fi

if ! command -v i2cdetect >/dev/null 2>&1; then
  echo "ERROR: install i2c-tools first: sudo apt install i2c-tools" >&2
  exit 1
fi

echo "Checking MFi candidate addresses on /dev/i2c-${bus}..."
found=0
for addr in 0x10 0x11; do
  if sudo i2cdetect -y "${bus}" "${addr}" "${addr}" | grep -Eiq '(^|[[:space:]])10([[:space:]]|$)|(^|[[:space:]])11([[:space:]]|$)'; then
    echo "Found an I2C device at ${addr}"
    found=1
  fi
done

if [[ "${found}" -eq 0 ]]; then
  echo "No device answered at 0x10 or 0x11." >&2
  echo "Check power-enable polarity, VCC, GND, SDA/SCL, pull-ups, bus number and chip provisioning." >&2
  exit 2
fi

echo "Electrical presence check passed. This does not prove that the certificate is valid."

