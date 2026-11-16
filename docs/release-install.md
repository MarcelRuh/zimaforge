## Installation auf ZimaOS (benutzerdefinierte App)

1. **`zimaforge-docker-compose.yml`** unten unter *Assets* herunterladen.
2. In ZimaOS den **App Store** öffnen, dann **⋯ / „+“ → Benutzerdefinierte App installieren**.
3. Oben rechts auf **Import** klicken und die heruntergeladene Datei auswählen. Alternativ zum Reiter **YAML** wechseln und den Inhalt einfügen.
4. Das Formular füllt sich von selbst (Titel *ZimaForge*, Image `ghcr.io/marcelruh/zimaforge`, Netzwerk *host*, Port *8077*). Dann **Installieren** klicken.
5. Die ZimaForge-Kachel öffnen (oder `http://<ZIMAOS-IP>:8077`) und bei ZimaOS anmelden. Der Mod-Store öffnet sich automatisch. Später erreichst du ihn über das Sechseck unten rechts oder mit <kbd>Alt</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd>.

Das normale Dashboard auf Port 80 bleibt unverändert. Images gibt es für `amd64` und `arm64`.
