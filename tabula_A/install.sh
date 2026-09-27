#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"
mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"
ln -sfn "$ROOT/tabula" "$BIN_DIR/tabula"
cp "$ROOT/packaging/tabula.svg" "$ICON_DIR/tabula.svg"
sed "s|@EXEC@|$BIN_DIR/tabula|g" "$ROOT/packaging/tabula.desktop.in" > "$APP_DIR/tabula.desktop"
chmod +x "$ROOT/tabula" "$BIN_DIR/tabula" "$APP_DIR/tabula.desktop"
command -v update-desktop-database >/dev/null && update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
printf 'Installed Tabula. Launch it from your app menu or run: tabula /path/to/file.db\n'
