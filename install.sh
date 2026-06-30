#!/bin/sh
# install.sh — install the tls_fetch opencode custom tool.
# Copies the tool files into the opencode global tools directory using `install`.
# Re-run after `git pull` to update.

set -e

PREFIX="${PREFIX:-$HOME/.config/opencode/tools}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SRC_DIR/tls_fetch.ts" ]; then
    echo "error: tls_fetch.ts not found in $SRC_DIR" >&2
    exit 1
fi

mkdir -p "$PREFIX"

install -m 0644 "$SRC_DIR/tls_fetch.ts"          "$PREFIX/tls_fetch.ts"
install -m 0755 "$SRC_DIR/tls_fetch.py"           "$PREFIX/tls_fetch.py"
install -m 0644 "$SRC_DIR/requirements.txt"       "$PREFIX/requirements.txt"

echo "Installed tls_fetch tool to: $PREFIX"
echo ""
echo "The curl_cffi virtualenv will be auto-created on first tool use at:"
echo "  ~/.local/share/opencode/tls-impersonation/venv"
echo ""
echo "To install project-scoped instead (current dir):"
echo "  PREFIX=./.opencode/tools ./install.sh"
