#!/usr/bin/env bash
# Puts `tabula` on your PATH and in the Plasma launcher. Re-run after moving the folder.
set -euo pipefail
here="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
mkdir -p ~/.local/bin ~/.local/share/applications
ln -sf "$here/bin/tabula" ~/.local/bin/tabula
cat > ~/.local/share/applications/tabula.desktop <<DESKTOP
[Desktop Entry]
Type=Application
Name=Tabula
Comment=Visual schema editor for SQLite
Exec=$HOME/.local/bin/tabula %f
Terminal=false
Categories=Development;Database;
MimeType=application/vnd.sqlite3;application/x-sqlite3;
Icon=database
DESKTOP
update-desktop-database ~/.local/share/applications 2>/dev/null || true
echo "installed: ~/.local/bin/tabula and the Tabula launcher entry"
