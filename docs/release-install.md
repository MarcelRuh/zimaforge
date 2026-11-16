## Installation auf ZimaOS per Docker-Compose-Import

So installierst du ZimaForge als **benutzerdefinierte App**, ohne SSH:

1. Öffne in ZimaOS den **App Store** und klicke oben rechts auf **„+“ → Benutzerdefinierte App installieren**.
2. Klicke im Dialog oben rechts auf **Import** (Symbol mit Pfeil nach unten).
3. Wähle **Docker Compose** und gib die Compose-Datei an. Es gibt zwei Wege:
   - **Einfügen:** den kompletten YAML-Block unten kopieren (Kopier-Symbol oben rechts am Block) und in das Textfeld einfügen.
   - **Datei hochladen:** `zimaforge-docker-compose.yml` unten unter *Assets* herunterladen und auswählen.
4. Bestätige mit **Absenden** bzw. **Importieren**. Das Formular füllt sich dann von selbst. Prüfe kurz diese Werte:
   | Feld | Wert |
   |---|---|
   | App-Titel | ZimaForge |
   | Bildname | `ghcr.io/marcelruh/zimaforge` |
   | Tag | die Version dieses Releases |
   | Netzwerktyp | **host** (wichtig, nicht *bridge*) |
   | Web-URL Port | 8077 |
5. Klicke unten rechts auf **Installieren** und warte, bis die Kachel *ZimaForge* erscheint.
6. Öffne die Kachel (oder `http://<ZIMAOS-IP>:8077`) und melde dich wie gewohnt bei ZimaOS an. Der Mod-Store öffnet sich automatisch. Später erreichst du ihn über das Sechseck unten rechts oder mit <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd>.

**Alternative per SSH:** `docker compose -f zimaforge-docker-compose.yml up -d`

Das normale Dashboard auf Port 80 bleibt unverändert. Images gibt es für `amd64` und `arm64`.
