#!/usr/bin/env bash
# Ensure host bind-mount blob directories are writable by the unprivileged API
# container user. Docker creates missing bind-mount dirs as root:root, which
# makes upload endpoints fail with EACCES after a fresh host/bootstrap.
set -euo pipefail

ROOT_DIR="${CMC_BLOB_ROOT:-${PWD}/.data}"
API_UID="${CMC_API_UID:-100}"
API_GID="${CMC_API_GID:-101}"

PDF_DIR="${PDF_STORE_DIR:-${ROOT_DIR}/pdf}"
PHOTO_DIR="${SESSION_PHOTO_STORE_DIR:-${ROOT_DIR}/session-photos}"
GIFT_PHOTO_DIR="${GIFT_PHOTO_STORE_DIR:-${ROOT_DIR}/gift-photos}"

mkdir -p "$PDF_DIR" "$PHOTO_DIR" "$GIFT_PHOTO_DIR"
chown -R "${API_UID}:${API_GID}" "$PDF_DIR" "$PHOTO_DIR" "$GIFT_PHOTO_DIR" || {
  echo "FATAL: failed to chown blob dirs to ${API_UID}:${API_GID}" >&2
  exit 1
}
chmod 0755 "$PDF_DIR" "$PHOTO_DIR" "$GIFT_PHOTO_DIR" || {
  echo "FATAL: failed to chmod blob dirs" >&2
  exit 1
}

if stat -c '%u:%g' "$PDF_DIR" >/dev/null 2>&1; then
  for dir in "$PDF_DIR" "$PHOTO_DIR" "$GIFT_PHOTO_DIR"; do
    actual="$(stat -c '%u:%g' "$dir")"
    if [ "$actual" != "${API_UID}:${API_GID}" ]; then
      echo "FATAL: ${dir} owner is ${actual}, expected ${API_UID}:${API_GID}" >&2
      exit 1
    fi
  done
fi

echo "blob store dirs OK:"
ls -ld "$PDF_DIR" "$PHOTO_DIR" "$GIFT_PHOTO_DIR"
