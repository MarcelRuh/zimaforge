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

## Mods direkt auf dem Standardport (Port 80)

Damit die Mods unter der normalen Adresse `http://<ZIMAOS-IP>/` erscheinen, tauschen ZimaForge und ZimaOS die Ports: ZimaForge übernimmt Port 80, ZimaOS läuft dahinter auf 8081.

1. In ZimaOS unter **Einstellungen** den **Port des Dashboards auf `8081`** stellen und danach `http://<ZIMAOS-IP>:8081` öffnen.
2. ZimaForge wie oben importieren, aber mit **`zimaforge-docker-compose-standardport.yml`** (siehe *Assets* bzw. den Block unten). Sie unterscheidet sich nur in drei Werten:
   ```yaml
   ZIMAFORGE_PORT: "80"
   ZIMAFORGE_UPSTREAM: http://127.0.0.1:8081
   port_map: "80"
   ```
3. Nach der Installation `http://<ZIMAOS-IP>/` öffnen: Das ist jetzt dein Dashboard mit Mods.

**Notausgang:** Falls ZimaForge einmal nicht läuft, ist das Dashboard unverändert unter `http://<ZIMAOS-IP>:8081` erreichbar. Zum Zurückstellen ZimaForge deinstallieren und den ZimaOS-Port wieder auf 80 setzen.

Hast du ZimaOS schon auf einen anderen Port gelegt, setze diesen Port in `ZIMAFORGE_UPSTREAM` ein.
