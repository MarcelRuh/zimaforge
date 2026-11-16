#!/usr/bin/env sh
# Erzeugt die Release-Notizen: Installationsanleitung, Compose-Dateien zum
# Einfügen und den passenden Abschnitt aus dem CHANGELOG.
#   sh dev/release-notes.sh 0.1.0 > notes.md
set -eu
version="$1"
cd "$(dirname "$0")/.."

cat docs/release-install.md
printf '\n### docker-compose.yml zum Einfügen (Port 8077)\n\n```yaml\n'
cat docker-compose.yml
printf '```\n\n<details>\n<summary><b>Variante für den Standardport 80</b> (ZimaOS auf 8081)</summary>\n\n```yaml\n'
cat docker-compose.standardport.yml
printf '```\n\n</details>\n\n## Änderungen in %s\n' "$version"
changes="$(awk -v h="## [$version]" 'index($0,h)==1 {f=1; next} /^## / && f {exit} f' CHANGELOG.md)"
printf '%s\n' "${changes:-Siehe CHANGELOG.md}"
