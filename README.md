# Hydrantenkarte Wien

Eine schlanke Web-App, die alle Hydranten in Wien auf einer Karte zeigt. Sie findet die nächstgelegenen Hydranten zu Fuß, funktioniert auch offline und lässt sich auf dem Smartphone wie eine App installieren. Grundlage ist der offene Hydrantendatensatz der Stadt Wien.

Kein Build-Schritt, keine Datenbank: ein kleiner Node.js-Server und statische Dateien.

## Funktionen

- **Karte aller Hydranten** (rund 12.700 Punkte), auf der Übersicht zu Gruppen zusammengefasst
- **Standort** per GPS, Adresssuche oder Tippen auf die Karte
- **Die fünf nächsten Hydranten nach Fußweg**, mit Gehzeit; ist der Routingdienst nicht erreichbar, wird die Luftlinie angezeigt
- **Bezirksauswahl** mit Grenze und Anzahl der Hydranten
- **Teilen-Links** für einzelne Hydranten (`/?h=<ID>`) und Bezirke (`/?bezirk=<Nr>`)
- **Navigation** zu Fuß über Google Maps oder Apple Karten
- **Offline-Modus und Installation (PWA)**: App, Hydrantendaten und bereits angesehene Kartenausschnitte bleiben auf dem Gerät
- **Mitmachen**: fehlende Hydranten melden (per E-Mail an den Betreiber) und **Notizen** zu bestehenden Hydranten ergänzen. Notizen erscheinen nach Freigabe für alle beim Hydranten; nichts wird ungeprüft veröffentlicht
- **Smartphone-Layout**: Karte im Vollbild, Suche und Ergebnisse in einem hochziehbaren Panel
- Impressum, Datenschutzerklärung und 404-Seite als eigene Seiten

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `server.mjs` | Express-Server: statische Dateien und API |
| `public/index.html`, `app.js`, `style.css` | Oberfläche mit [Leaflet](https://leafletjs.com) und Leaflet.markercluster |
| `public/sw.js`, `manifest.webmanifest`, `icons/` | Service Worker, Web-App-Manifest, Logo und App-Icons |
| `public/impressum.html`, `datenschutz.html`, `404.html` | Rechtliche Seiten und Fehlerseite |
| `public/data/hydrants.json` | Hydranten der Stadt Wien im kompakten Format `[id, lat, lng]` (~390 KB statt 2,6 MB GeoJSON) |
| `public/data/districts.geojson` | Bezirksgrenzen, auf ca. 10 m vereinfacht |
| `scripts/update-data.mjs` | Lädt beide Datensätze neu und prüft sie |
| `public/og-image.png` | Vorschaubild für geteilte Links |
| `deploy/` | systemd-Dienst, wöchentlicher Update-Timer und Installationsskript für den Betrieb ohne Docker |
| `compose.yaml`, `Dockerfile`, `Caddyfile` | Betrieb mit Docker Compose und Caddy als HTTPS-Proxy |

### API

| Route | Zweck |
| --- | --- |
| `GET /api/health` | Status; `reporting: true`, wenn SMTP konfiguriert ist |
| `GET /api/search?q=…` | Adresssuche über Nominatim (gedrosselt, mit Cache) |
| `GET /api/walk?from=lat,lng&to=lat,lng;…` | Fußwegdistanzen über OSRM (bis zu 15 Ziele, mit Cache) |
| `POST /api/report` | Meldung eines fehlenden Hydranten per E-Mail |
| `POST /api/note` | Notiz zu einem Hydranten: wird gespeichert, Betreiber bekommt eine E-Mail mit Prüf-Link |
| `GET /api/notes` | Veröffentlichte Notizen (Hydrant, Text, Datum; ohne E-Mail-Adressen) |
| `GET/POST /notiz/<id>?sig=…` | Prüfseite: veröffentlichen, ablehnen, wieder entfernen. Nur mit signiertem Link aus der E-Mail erreichbar |

## Lokal starten

Voraussetzung: Node.js 24 oder neuer.

```sh
npm ci
npm start
```

Dann http://localhost:3000 öffnen. Ohne SMTP-Konfiguration funktioniert die Karte vollständig; Meldungen und Notizen geben dann eine klare Fehlermeldung zurück und gehen nicht stillschweigend verloren.

GPS und Service Worker brauchen HTTPS oder `localhost`.

## Konfiguration

Die Konfiguration kommt aus Umgebungsvariablen bzw. einer `.env`-Datei (Vorlage: `.env.example`). Die `.env` gehört nie ins Repository.

| Variable | Bedeutung |
| --- | --- |
| `PUBLIC_URL` | Öffentliche Adresse der Seite, z. B. `https://karte.example.at`. Formulare werden nur von dieser Herkunft angenommen. Lokal weglassen. |
| `PORT` | Port des Servers (Standard `3000`) |
| `DATA_DIR` | Beschreibbarer Ordner für Notizen und aktualisierte Daten (Standard `./var`; systemd: `/var/lib/hydrantenkarte`; Docker: Volume unter `/data`). Ist eine Datendatei dort neuer als die im Repository, wird sie verwendet. |
| `HOST` | Adresse, an die der Server bindet (Standard `0.0.0.0`; hinter einem lokalen Proxy `127.0.0.1`) |
| `TRUST_PROXY` | Anzahl vorgeschalteter Proxys, z. B. `1` hinter Caddy oder einem Tunnel. Wichtig für korrekte Anfragelimits. |
| `SMTP_HOST`, `SMTP_PORT` | Mailserver; Port `587` mit verpflichtendem STARTTLS, `465` mit implizitem TLS |
| `SMTP_USER`, `SMTP_PASS` | Zugangsdaten des Mailkontos |
| `MAIL_FROM` | Absender, z. B. `Hydrantenkarte <karte@example.at>`; muss beim Mailanbieter erlaubt sein |
| `MAIL_TO` | Empfänger der Meldungen und Notizen. Leer lassen, um sie an das Postfach aus `MAIL_FROM` zu schicken. |

## Vor der Veröffentlichung anpassen

Einige Angaben sind betreiberspezifisch und müssen vor dem ersten Einsatz auf die eigenen Daten geändert werden:

- **User-Agent** für Nominatim und OSRM in `server.mjs`: eigene Seite bzw. Kontakt eintragen (von den Nutzungsbedingungen verlangt)
- **Impressum und Datenschutz** in `public/impressum.html` und `public/datenschutz.html`: Betreiber, Anschrift, Kontakt, eingesetzte Dienste (Hosting, Mailanbieter, Postfach) und Aufbewahrungsfristen
- **Kopfzeile**: Name unter dem Logo in `index.html` und den Unterseiten
- **Domain** im `Caddyfile` und in `PUBLIC_URL`

## Betrieb

### Mit Docker Compose und Caddy

Geeignet für eine kleine VM (z. B. 2 vCPU, 2 GB RAM, 16 GB Disk), etwa unter Proxmox mit Debian.

1. [Docker Engine und Compose-Plugin](https://docs.docker.com/engine/install/) installieren.
2. Projekt holen und konfigurieren:

   ```sh
   git clone <repository-url> hydrantenkarte
   cd hydrantenkarte
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

3. Im `Caddyfile` die eigene Domain eintragen.
4. DNS-Eintrag (A, ggf. AAAA) auf die öffentliche IP setzen und TCP 80/443 (optional UDP 443 für HTTP/3) auf den Server weiterleiten. Ohne eingehende Erreichbarkeit (z. B. CGNAT/DS-Lite) einen Tunnel verwenden, siehe unten.
5. Starten:

   ```sh
   sudo docker compose up -d --build
   sudo docker compose ps
   sudo docker compose logs --tail=80 app caddy
   ```

Caddy holt das TLS-Zertifikat automatisch, sobald DNS und Ports stimmen. Der App-Port ist nur im Docker-Netz erreichbar; der App-Container läuft schreibgeschützt und ohne zusätzliche Rechte.

### Ohne Docker als systemd-Dienst

Ein unprivilegierter Debian-Container (z. B. LXC unter Proxmox, 2 Kerne, 2 GB RAM, 8 GB Disk) reicht aus.

1. `nodejs`, `npm` und optional `caddy` installieren.
2. Projekt nach `/opt/hydrantenkarte` kopieren und als root `sh deploy/install-native.sh` ausführen. Der Dienst läuft als eigener Systembenutzer ohne Anmeldeshell.
3. Konfiguration ausschließlich in `/etc/hydrantenkarte.env` (Modus 600) pflegen, Änderungen mit `systemctl restart hydrantenkarte` übernehmen.
4. Bei Caddy auf demselben Host `reverse_proxy 127.0.0.1:3000` verwenden und in der App `HOST=127.0.0.1` und `TRUST_PROXY=1` setzen.

Updates: Dateien ersetzen, in `/opt/hydrantenkarte` `npm ci --omit=dev` ausführen, Dienst neu starten.

### Hinter einem Tunnel

Ohne öffentliche IP lässt sich die App über einen Tunnel-Dienst (z. B. Cloudflare Tunnel) veröffentlichen. Der Tunnel-Client läuft auf demselben Host und leitet auf `http://127.0.0.1:3000` weiter. In der App `HOST=127.0.0.1`, `TRUST_PROXY=1` und `PUBLIC_URL` auf die öffentliche Adresse setzen. Router-Portfreigaben sind dann nicht nötig; Tunnel-Zugangsschlüssel nur auf dem Server speichern. Wird ein solcher Dienst genutzt, gehört er in die Datenschutzerklärung.

### Updates ausrollen

`app.js` und `style.css` werden mit einer Versionsnummer eingebunden (`/app.js?v=3`) und dürfen deshalb lange im Browser-Cache bleiben; HTML, Service Worker und Daten werden immer neu geprüft. **Bei jeder Änderung an `app.js` oder `style.css`** die Nummer erhöhen, und zwar überall gleich:

- `?v=` in `public/index.html`, `impressum.html`, `datenschutz.html` und `404.html`
- `VERSION` und die beiden Einträge in `PRECACHE` in `public/sw.js`

`npm test` prüft, dass `index.html` und `sw.js` dieselbe Nummer verwenden. Liegt ein CDN wie Cloudflare davor, dort die Browser-Cache-Dauer auf „vorhandene Header respektieren“ stellen, sonst überschreibt es diese Header.

### Mailversand prüfen

Schlägt das Senden von Meldungen fehl, steht der Grund im Log (`journalctl -u hydrantenkarte` bzw. `docker compose logs app`), z. B. `EAUTH | 535 …` für falsche Zugangsdaten. Direkt testen, inklusive Testmail an den Empfänger:

```sh
# systemd
cd /opt/hydrantenkarte && node --env-file=/etc/hydrantenkarte.env scripts/smtp-check.mjs
# Docker
sudo docker compose exec app node scripts/smtp-check.mjs
# lokal
npm run mail:test
```

Häufige Ursachen: falsches Passwort (oder Anführungszeichen/Leerzeichen darum in der `.env`), `MAIL_FROM` weicht vom Mailkonto ab, ausgehender Port 587/465 ist gesperrt.

Meldet das Skript Erfolg, aber im Absender-Postfach landet „Mail delivery failed“, lehnt der Mailserver des Empfängers ab. Große Anbieter (iCloud, Gmail, Outlook) verlangen SPF, DKIM und DMARC für die Absender-Domain. Abhilfe: DKIM beim Mailanbieter aktivieren und den DNS-Eintrag setzen, oder `MAIL_TO` leer lassen, damit Meldungen im eigenen Postfach landen.

### Abnahme

- `/api/health` liefert `ok: true`. `reporting: true` heißt nur, dass SMTP konfiguriert ist; eine echte Testmeldung schicken und den Eingang prüfen.
- Standort per GPS und Adresssuche testen. Neben den Ergebnissen sollte „Fußweg“ stehen; steht dort „Luftlinie“, erreicht der Server den Routingdienst nicht.
- `/?h=<Hydranten-ID>` öffnet direkt den Hydranten.
- In den Entwicklertools prüfen, ob der Service Worker aktiv ist, dann im Flugmodus testen: Karte, Hydranten und Nächste-Suche funktionieren weiter.

## Daten aktualisieren

`scripts/update-data.mjs` lädt Hydranten (`ogdwien:HYDRANTOGD`) und Bezirksgrenzen (`ogdwien:BEZIRKSGRENZEOGD`) vom WFS der Stadt Wien. Es prüft Objekt-IDs, Koordinaten, die gemeldete Gesamtzahl und alle 23 Bezirke und ersetzt die Dateien erst nach vollständigem Download; bei Fehlern bleiben die alten Daten erhalten. Ein Neustart ist nicht nötig, der Server liefert neue Dateien sofort aus.

### Automatisch (systemd)

`deploy/install-native.sh` richtet den Timer `hydrantenkarte-update.timer` ein: jeden Sonntag gegen 4:30 Uhr (mit bis zu einer Stunde Zufallsverzögerung, verpasste Läufe werden nachgeholt). Die Daten landen in `/var/lib/hydrantenkarte`, nicht im Git-Ordner, damit `git pull` nie an lokalen Änderungen scheitert.

```sh
systemctl list-timers hydrantenkarte-update.timer   # nächster Lauf
systemctl start hydrantenkarte-update.service       # sofort aktualisieren
journalctl -u hydrantenkarte-update -n 20           # Ergebnis des letzten Laufs
```

Bei einer bestehenden Installation die neuen Dienstdateien einmalig übernehmen:

```sh
cp deploy/hydrantenkarte.service deploy/hydrantenkarte-update.* /etc/systemd/system/
systemctl daemon-reload
systemctl restart hydrantenkarte
systemctl enable --now hydrantenkarte-update.timer
```

### Manuell

```sh
npm run data:update                                  # schreibt nach public/data
DATA_DIR=/var/lib/hydrantenkarte npm run data:update # schreibt nach DATA_DIR
```

Mit Docker, ohne Node auf dem Host (z. B. als wöchentlicher Cronjob):

```sh
sudo docker compose run --rm --user "$(id -u):$(id -g)" -v "$PWD/public/data:/app/public/data" app node scripts/update-data.mjs
sudo docker compose up -d --build
```

Installierte Apps holen neue Daten beim nächsten Aufruf im Hintergrund.

Der Datensatz enthält nur Standort und Objekt-ID, keine Angaben zu Typ, Leistung oder Adresse. Den Bezirk berechnet der Browser aus den Bezirksgrenzen.

## Notizen freigeben

1. Jemand ergänzt im Popup eines Hydranten eine Notiz.
2. Die Notiz wird in `DATA_DIR/notes.json` gespeichert (Status „wartet“), und an `MAIL_TO` geht eine E-Mail mit einem Link „Veröffentlichen oder ablehnen“.
3. Der Link öffnet eine Prüfseite mit Text, Hydrant und Kontaktadresse. Ein Klick auf **Veröffentlichen** zeigt die Notiz sofort für alle beim Hydranten an (Popup, Ergebnisliste, eigenes Marker-Symbol). Über denselben Link lässt sie sich später **wieder entfernen**.

Die Links sind mit einem geheimen Schlüssel signiert (`DATA_DIR/notes.secret`, wird beim ersten Start erzeugt). Wer den Schlüssel löscht, macht alle bisherigen Prüf-Links ungültig. Freigegeben wird nur per Formular (POST), damit Link-Scanner von Mailprogrammen nichts versehentlich veröffentlichen. Veröffentlicht werden ausschließlich Text, Hydrant und Datum, nie die E-Mail-Adresse; bei abgelehnten Notizen wird sie gelöscht. `notes.json` und `notes.secret` gehören ins Backup.

## Externe Dienste

| Dienst | Wofür | Wer verbindet sich |
| --- | --- | --- |
| [basemap.at](https://basemap.at) | Grundkarte und Luftbild (CC BY 4.0, Namensnennung „Grundkarte: basemap.at“) | Browser der Nutzer |
| [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) | Adresssuche | Server (max. eine neue Anfrage je 1,1 s) |
| [FOSSGIS-Routing (OSRM)](https://routing.openstreetmap.de) | Fußwegdistanzen | Server (max. 20 Anfragen je Minute und IP) |
| Eigener SMTP-Server | Meldungen und Notizen | Server |

Nominatim und das FOSSGIS-Routing sind für geringe Last gedacht; ihre Nutzungsbedingungen gelten. Bei größerer Last eigene oder kommerzielle Dienste einsetzen. Der Service Worker speichert nur bereits angesehene Kartenkacheln (höchstens 600) und lädt keine vor.

## Datenschutz und Sicherheit

- Keine Cookies, kein Tracking, keine Datenbank, keine Zugriffsprotokolle in der App.
- GPS-Standort und Suche der nächsten Kandidaten laufen im Browser. Für Fußwege und Adresssuche fragt der Server die externen Dienste an; diese sehen nur die Server-IP.
- Meldungen werden ausschließlich per SMTP verschickt. Eingaben werden geprüft, ein Honeypot-Feld fängt einfache Bots ab, fremde Herkünfte werden abgewiesen, und es gibt Anfragelimits pro IP. Diese Limits liegen im Arbeitsspeicher und werden bei einem Neustart zurückgesetzt.
- Strenge Sicherheits-Header (Content-Security-Policy, `nosniff`, Referrer-Policy, Permissions-Policy).
- SMTP-Zugangsdaten nur in `.env` bzw. `/etc/hydrantenkarte.env`; beide sind von Git und dem Docker-Build ausgeschlossen. Server-Backups mit diesen Dateien geschützt aufbewahren.

## Tests

```sh
npm test
```

Die Tests prüfen Meldungen und Notizen (Speichern, Prüf-Link, Freigabe, Entfernen, keine E-Mail-Adressen in der öffentlichen Liste, Empfänger, Validierung, fremde Herkunft, fehlender oder fehlerhafter SMTP-Versand, Anfragelimits), den Fußweg-Proxy (Validierung, Cache, Fehlerfall), die Auslieferung von Impressum, Datenschutz, Manifest und 404-Seite sowie Vollständigkeit und Plausibilität der Hydranten- und Bezirksdaten. GitHub Actions führt sie bei jedem Push aus. Echter Mailversand und der Produktivbetrieb sind gesondert zu prüfen.

## Hinweis

Die Karte ist eine Orientierungshilfe. Für Vollständigkeit, Richtigkeit, Zugänglichkeit und Betriebsbereitschaft der Hydranten gibt es keine Gewähr. Im Notfall immer den Notruf wählen.

## Datenquellen und Lizenzen

- Hydranten und Bezirksgrenzen: Stadt Wien – [data.wien.gv.at](https://data.wien.gv.at), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de)
- Grundkarte und Luftbild: [basemap.at](https://basemap.at), CC BY 4.0
- Adresssuche und Fußwege: © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), ODbL
- Leaflet und Leaflet.markercluster: BSD-2-Clause bzw. MIT
