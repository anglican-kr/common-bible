#!/usr/bin/env bash
# deploy.sh — Build and deploy to seoul.anglican.kr (dev or prod).
#
# Subcommands:
#   dev      Build current code, deploy to /var/www/bible-{version}-{shortsha},
#            atomically swap /var/www/dev to point at it.
#   prod     Same as dev but swap /var/www/bible. Prompts for confirmation.
#   promote  Point /var/www/bible at the same target as /var/www/dev (no rebuild,
#            no upload). Use after verifying a build on https://dev.anglican.kr.
#
# Build directory naming: bible-{version}-{shortsha} so that dev iterations
# without a version bump don't overwrite each other and so that promote can
# point prod at the exact dir already validated on dev.
#
# A dirty working tree is allowed but appends "-dirty" to the shortsha so
# uncommitted deploys are auditable from the directory listing.
#
# Audio files are shared between dev and prod via /var/www/audio (a single
# directory on the server). Each new build directory gets a symlink
# data/audio -> /var/www/audio created at unzip time.
#
# Prerequisites:
#   - ~/.ssh/config entry "seoul" with the correct user/host/key
#   - Remote user has passwordless sudo for mkdir/unzip/ln/chown on /var/www
#   - /var/www/audio exists on the server
#   - nginx vhosts for bible.anglican.kr and dev.anglican.kr serve from
#     /var/www/bible and /var/www/dev respectively

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: deploy.sh <subcommand>

Subcommands:
  dev       Build + deploy + swap /var/www/dev
  prod      Build + deploy + swap /var/www/bible (with confirmation)
  promote   Swap /var/www/bible -> $(readlink /var/www/dev) (no rebuild)
EOF
  exit 1
}

TARGET="${1:-}"
case "$TARGET" in
  dev|prod|promote) ;;
  *) usage ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── promote: no build, no upload — just repoint /var/www/bible ────────────────
if [ "$TARGET" = "promote" ]; then
  echo "==> Promote: /var/www/bible -> (current target of /var/www/dev)"
  read -rp "Promote current dev target to prod? [y/N] " ans
  case "$ans" in
    y|Y) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
  ssh seoul bash <<'REMOTE'
set -euo pipefail
target="$(readlink /var/www/dev || true)"
if [ -z "$target" ]; then
  echo "ERROR: /var/www/dev does not exist or is not a symlink" >&2
  exit 1
fi
echo "==> Pointing /var/www/bible -> $target"
sudo ln -sfn "$target" /var/www/bible
REMOTE
  echo "==> Done."
  exit 0
fi

# ── dev / prod: build + upload + swap ─────────────────────────────────────────

VERSION="$(python3 -c "import json; print(json.load(open('version.json'))['version'])")"
SHORTSHA="$(git rev-parse --short HEAD)"
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  SHORTSHA="${SHORTSHA}-dirty"
  echo "WARNING: working tree is dirty — deploying as ${SHORTSHA}"
fi

REMOTE_DIR="bible-${VERSION}-${SHORTSHA}"
SYMLINK_NAME="dev"
[ "$TARGET" = "prod" ] && SYMLINK_NAME="bible"

echo "==> Deploying ${VERSION} (${SHORTSHA}) to ${TARGET} (/var/www/${SYMLINK_NAME})"

if [ "$TARGET" = "prod" ]; then
  read -rp "This will swap /var/www/bible to a new build. Continue? [y/N] " ans
  case "$ans" in
    y|Y) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# Step 1: build local zip
"$SCRIPT_DIR/build-deploy.sh"

ZIP_PATH="$(ls -1t "${PROJECT_ROOT}"/deploy-*.zip | head -n1)"
ZIP_NAME="$(basename "${ZIP_PATH}")"
echo "==> Built ${ZIP_NAME}"

# Step 2: upload to seoul:~/
echo "==> Uploading to seoul:~/${ZIP_NAME}"
scp "${ZIP_PATH}" seoul:~/

# Steps 3–5: remote deployment
echo "==> Deploying on seoul: /var/www/${REMOTE_DIR}"
ssh seoul bash <<REMOTE
set -euo pipefail
ZIP_REMOTE="\$HOME/${ZIP_NAME}"
sudo mkdir -p "/var/www/${REMOTE_DIR}"
sudo unzip -oq "\$ZIP_REMOTE" -d "/var/www/${REMOTE_DIR}"
sudo ln -sfn /var/www/audio "/var/www/${REMOTE_DIR}/data/audio"
sudo chown -R www-data:www-data "/var/www/${REMOTE_DIR}"
sudo ln -sfn "/var/www/${REMOTE_DIR}" /var/www/${SYMLINK_NAME}
rm -f "\$ZIP_REMOTE"
echo "Linked: /var/www/${SYMLINK_NAME} -> /var/www/${REMOTE_DIR}"
REMOTE

echo "==> Done."
