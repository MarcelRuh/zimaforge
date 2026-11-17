#!/usr/bin/env sh
# Erzeugt die Release-Notizen: Installationsanleitung, Compose-Dateien zum
# Einfügen und den passenden Abschnitt aus dem CHANGELOG.
#   sh dev/release-notes.sh 0.1.0 > notes.md
# Bricht mit Exit-Code 1 ab, wenn CHANGELOG.md keinen Abschnitt "## [<version>]" hat.
set -eu
version="${1:?Aufruf: sh dev/release-notes.sh <version>}"
cd "$(dirname "$0")/.."

changes="$(awk -v h="## [$version]" 'index($0,h)==1 {f=1; next} /^## / && f {exit} f' CHANGELOG.md)"
if [ -z "$(printf '%s' "$changes" | tr -d '[:space:]')" ]; then
  echo "release-notes.sh: Abschnitt \"## [$version]\" fehlt in CHANGELOG.md oder ist leer" >&2
  exit 1
fi

cat docs/release-install.md
printf '\n### docker-compose.yml zum Einfügen (Port 8077)\n\n```yaml\n'
cat docker-compose.yml
printf '```\n\n<details>\n<summary><b>Variante für den Standardport 80</b> (ZimaOS auf 8081)</summary>\n\n```yaml\n'
cat docker-compose.standardport.yml
printf '```\n\n</details>\n\n## Änderungen in %s\n' "$version"
printf '%s\n' "$changes"
