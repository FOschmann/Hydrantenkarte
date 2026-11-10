# Hydrantenkarte Wien

Responsive Karte für **hydranten.oschmanndigital.at**, für den eigenen Server. Helle Oberfläche mit dunklem Grün und terrakottafarbenen Hydrantenmarkierungen.

- 12.736 amtliche Hydranten im beigefügten Datenabruf vom 06.11.2026
- GPS, Adresssuche oder manuelle Standortwahl
- Fünf nächste Hydranten nach Luftlinie; Marker werden auf der Übersicht gruppiert
- Fußgängernavigation über Google Maps oder Apple Karten
- Meldung fehlender Hydranten mit frei gewähltem Kartenpunkt und automatischer E-Mail
- SMTP mit TLS, Eingabevalidierung, Honeypot und Anfragelimits
- Docker Compose und Caddy für HTTPS auf einer Proxmox-VM

## Lokal starten

Node.js 24 oder neuer installieren, dann:

```sh
npm ci
npm start
```

http://localhost:3000 öffnen. Ohne SMTP bleibt die Karte funktionsfähig; Meldungen liefern ausdrücklich eine Fehlermeldung und gehen nicht stillschweigend verloren. Für lokalen SMTP-Test `.env.example` nach `.env` kopieren, `PUBLIC_URL=http://localhost:3000` setzen und `TRUST_PROXY` entfernen.

## Proxmox ab null

1. Debian-13-Installations-ISO von https://www.debian.org/distrib/ herunterladen und in Proxmox unter dem ISO-Speicher hochladen.
2. VM `hydrantenkarte` anlegen: 2 vCPU, 2 GB RAM, 16 GB Disk, Netzwerk-Bridge `vmbr0`. Das ist eine Startkonfiguration für geringe Last. Debian installieren, SSH-Server aktivieren, gewöhnlichen Benutzer mit sudo verwenden.
3. Der VM eine feste LAN-IP bzw. DHCP-Reservierung geben. SSH nur im LAN/VPN zugänglich machen. Die Proxmox-Verwaltung wird nicht für diese Website veröffentlicht.
4. Docker Engine und Compose-Plugin gemäß https://docs.docker.com/engine/install/debian/ installieren.
5. Projekt in die VM kopieren oder nach GitHub-Veröffentlichung klonen:

```sh
git clone https://github.com/FOschmann/Hydrantenkarte.git
cd Hydrantenkarte
cp .env.example .env
chmod 600 .env
nano .env
```

6. SMTP-Felder ausfüllen: Host, Port, Benutzer, Passwort und `MAIL_FROM`, z. B. `Hydrantenkarte <hydranten@oschmanndigital.at>`. Der Absender muss beim Mailanbieter erlaubt sein. Port 587 verwendet verpflichtendes STARTTLS, Port 465 implizites TLS. Empfänger ist fest `floh.schmann@icloud.com`.
7. DNS: A-Record `hydranten.oschmanndigital.at` auf die öffentliche IPv4-Adresse des Anschlusses setzen. AAAA nur setzen, wenn die VM über diese IPv6-Adresse tatsächlich erreichbar ist. Bei dynamischer IP DDNS vorsehen.
8. Router: TCP 80 und 443 auf die VM weiterleiten; UDP 443 optional für HTTP/3. Bei CGNAT/DS-Lite ohne eingehende Erreichbarkeit ist ein Tunnel oder eine andere öffentliche Anbindung erforderlich. Diese Compose-Datei setzt direkte Erreichbarkeit voraus.
9. Starten:

```sh
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs --tail=80 app caddy
```

Caddy beschafft das Zertifikat automatisch, sobald DNS und eingehende Ports stimmen. Der App-Port 3000 ist nur im Docker-Netz sichtbar. `TRUST_PROXY=1` ist für genau diesen einen Reverse Proxy vorgesehen.

## Abnahme auf dem Server

- `https://hydranten.oschmanndigital.at/api/health` liefert `ok: true`; `reporting: true` bedeutet nur, dass SMTP konfiguriert ist, noch nicht, dass die Zustellung geprüft ist.
- Karte öffnen, Standort/GPS und Adresssuche prüfen. GPS erfordert HTTPS oder localhost.
- Echte Testmeldung senden und den Eingang im iCloud-Postfach kontrollieren. Zustellung und Spam-Einstufung lassen sich erst mit den richtigen SMTP-Zugangsdaten prüfen.
- Betreiberangaben und die Datenschutzerklärung vor Veröffentlichung mit den tatsächlichen Angaben und Aufbewahrungsfristen ergänzen.

## Daten aktualisieren

```sh
npm run data:update
sudo docker compose up -d --build
```

Alternativ ohne Node auf dem Host:

```sh
sudo docker compose run --rm --user "$(id -u):$(id -g)" -v "$PWD/public/data:/app/public/data" app node scripts/update-data.mjs
sudo docker compose up -d --build
```

Das Update validiert Punktkoordinaten und die vom WFS gemeldete Gesamtzahl und ersetzt die Datei erst nach vollständigem Download. Kein automatischer Aktualisierungszeitplan ist eingerichtet. Die Website zeigt den Zeitstempel des Datenabrufs.

Datenquelle: **Stadt Wien – data.wien.gv.at**, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de), [Datensatzbeschreibung](https://www.data.gv.at/datasets/e8b9bb31-5ad1-4cc3-a0ae-177c93671d0b?locale=de), WFS-Layer `ogdwien:HYDRANTOGD`. Vollständigkeit bezieht sich auf den gelieferten Datensatz, nicht auf alle tatsächlich existierenden oder betriebsbereiten Hydranten. Die Daten enthalten Standort und Objekt-ID, keine bestätigte Leistungsangabe oder Adresse. Nutzerhinweise werden per E-Mail geprüft und nicht automatisch in den amtlichen Datenbestand aufgenommen.

## Betrieb und Datenschutz

GPS-Auswertung und Distanzberechnung erfolgen lokal im Browser. Die Adresssuche verwendet einen Server-Proxy mit maximal einer neuen Anfrage je 1,1 Sekunden, kurzem In-Memory-Cache und ohne Autovervollständigung. Kartenausschnitte werden direkt von OpenStreetMap geladen. Es gelten die [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) und die [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/). Bei größerer Last eigenen oder kommerziellen Karten-/Geocoding-Dienst einsetzen.

Berichte werden ausschließlich per SMTP übertragen und nicht in einer zusätzlichen Datenbank gespeichert. Mail-Aufbewahrung wird im Postfach geregelt. Das Meldeformular ist auf fünf Versuche je IP und Stunde begrenzt; diese Grenze ist pro Serverprozess und wird bei Neustart zurückgesetzt. Keine SMTP-Geheimnisse in Git committen. `.env` ist von Git und dem Docker-Build ausgeschlossen. Proxmox-Backups der VM einschließlich Caddy-Zertifikatsvolumes und `.env` geschützt aufbewahren.

## Prüfung

```sh
npm test
```

Tests prüfen gültige Meldungen, festen Empfänger, fehlerhafte Eingaben, fremde Origins, fehlenden/fehlerhaften SMTP-Versand, Ratenbegrenzung und Vollständigkeit/Plausibilität des eingebundenen Datensatzes. Echter SMTP-Versand und Produktivbereitstellung sind separat zu prüfen.

## Direkter Betrieb als Dienst im Proxmox-CT

Alternativ zu Docker ist ein unprivilegierter Debian-13-CT ausreichend (2 Kerne, 2 GB RAM, 8 GB Disk, DHCP auf vmbr0). Installiere dort `nodejs npm unzip curl caddy`, entpacke das Projekt nach `/opt/hydrantenkarte` und führe als root `sh deploy/install-native.sh` aus. Der Dienst läuft als eigener Systembenutzer ohne Anmeldeshell. Konfiguration/SMTP liegt ausschließlich in `/etc/hydrantenkarte.env` (Modus 600). Änderungen mit `systemctl restart hydrantenkarte` übernehmen.

Für Caddy auf diesem CT gilt `reverse_proxy 127.0.0.1:3000` statt `app:3000`. In der App-Konfiguration `TRUST_PROXY=1` verwenden. Bei einem Test über HTTP im LAN `PUBLIC_URL=http://<CT-IP>` setzen; für die öffentliche Domain anschließend `PUBLIC_URL=https://hydranten.oschmanndigital.at` und den passenden Caddy-Host setzen. GPS ist beim HTTP-LAN-Test browserbedingt nicht verfügbar.

Updates: Projektdateien ersetzen, in `/opt/hydrantenkarte` `npm ci --omit=dev` ausführen und `systemctl restart hydrantenkarte`. Proxmox-Backups des CT umfassen Daten und Konfiguration. Zugangsdaten weder ins Repository noch in ein öffentliches Archiv aufnehmen.

## Cloudflare Tunnel im CT

Der eingerichtete Betrieb verwendet einen eigenen Cloudflare-Tunnel. Installiere `cloudflared` aus dem offiziellen Cloudflare-Paketrepository und verbinde den Tunnel als systemd-Dienst. Den Zugangsschlüssel ausschließlich auf dem Server speichern, niemals im Repository.

Veröffentlichte Anwendung: `hydranten.oschmanndigital.at` → `http://127.0.0.1:3000`. Cloudflared und App laufen im selben CT; `HOST=127.0.0.1`, `TRUST_PROXY=1` und `PUBLIC_URL=https://hydranten.oschmanndigital.at` setzen. Diese Route führt direkt zur App. Caddy wird nur für den optionalen LAN-Zugriff verwendet. Es sind keine eingehenden Router-Portfreigaben erforderlich. Cloudflare erstellt den DNS-Eintrag und terminiert öffentliches HTTPS.

World4You: `SMTP_HOST=smtp.world4you.com`, `SMTP_PORT=587`, `SMTP_USER=hydranten@oschmanndigital.at`, `MAIL_FROM=hydranten@oschmanndigital.at`. Das Passwort gehört ausschließlich in die geschützte Serverkonfiguration.


## Hydrantenhinweise

Auf jedem Hydrantenmarker können Nutzer eine Notiz ergänzen. Sie wird mit Hydranten-ID und Standort an den Betreiber gemailt und erscheint erst nach manueller Prüfung. Es gibt keine ungeprüfte öffentliche Veröffentlichung und keine Notizdatenbank.
