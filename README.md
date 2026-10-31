# Teampost

Gemeinsame Postfächer fürs Team – selbst gehostet. Teampost verbindet beliebig viele IMAP/SMTP-Postfächer
(IONOS, Gmail, Outlook/Office 365, Strato, jeder andere Anbieter) und macht daraus einen geteilten Posteingang:
wer hat welche Mail geöffnet, wer kümmert sich, was ist erledigt.

- **Drei-Spalten-Oberfläche** mit Handy-Ansicht, Hell/Dunkel, Befehlspalette (Strg+K) und Tastenkürzeln (`?`)
- **Ansichten**: Posteingang, Mir zugewiesen, Markiert, Zurückgestellt, Entwürfe, Geplant, Gesendet, Mit Anhang, Spam, Labels
- **Suche** mit Operatoren: `von:` `an:` `betreff:` `label:` `hat:anhang` `ist:ungelesen` `vor:` `nach:`
- **Team**: Zuweisen, interne Notizen mit @Erwähnung, gemeinsame Labels, Verlauf „wer hat wann geöffnet“, Status-Knöpfe (Bearbeitet, Unnötig, Spam …)
- **Schreiben**: Entwürfe auf dem Server, Anhänge, Signaturen je Postfach, Vorlagen mit `;kürzel` und Platzhaltern, Rückgängig-Frist, später senden
- **Abgleich mit dem Postfach**: gelesen, beantwortet, markiert und Spam werden zurückgeschrieben; Antworten aus Outlook/Handy werden erkannt
- **Rechte je Postfach**: lesen < schreiben < verwalten
- **Handy-App** (PWA) mit Push-Mitteilungen – ohne App Store
- Alles in einer SQLite-Datei, Postfach-Passwörter AES-256-GCM-verschlüsselt

## Schnellstart mit Docker

```bash
git clone <repo-url> teampost && cd teampost
cp .env.example .env        # optional: Name, Farbe, Port anpassen
docker compose up -d
```

Dann `http://<server>:3000` öffnen – beim ersten Aufruf legst du den ersten Admin an.

## Ohne Docker

Voraussetzung: Node.js 24 oder neuer.

```bash
npm install
npm start
```

## Benutzer

- **Admin**: sieht alle Postfächer, verwaltet unter *Konto-Menü → Team verwalten* die Logins.
- **Nutzer**: sieht eigene Postfächer und solche, die ihm freigegeben wurden (in der Mail-App beim Postfach unter *Rechte*).

Jeder Login kann Postfächer verknüpfen; wer verknüpft, ist Besitzer und vergibt Rechte. Logins lassen sich auch von der Kommandozeile verwalten:

```bash
npm run nutzer -- liste
npm run nutzer -- anlegen anna@firma.de "Anna Beispiel" nutzer     # erzeugt ein Passwort
PASSWORT='…' npm run nutzer -- passwort anna@firma.de
npm run nutzer -- sperren anna@firma.de
```

Im Docker-Container: `docker compose exec teampost node scripts/nutzer.js liste`

## Einstellungen

Alle optional, siehe [.env.example](.env.example).

| Variable | Bedeutung | Standard |
|---|---|---|
| `APP_NAME` | Name in der Oberfläche | `Teampost` |
| `APP_FARBE` | Markenfarbe (Hex) | `#2563EB` |
| `PORT`, `HOST` | Adresse des Servers | `3000`, `0.0.0.0` |
| `DATA_DIR` | Datenbank, Anhänge, Schlüssel | `./data` (Docker: `/data`) |
| `JWT_SECRET` | Sitzungs-Geheimnis | wird erzeugt (`DATA_DIR/geheimnis.txt`) |
| `MAIL_SCHLUESSEL` | Schlüssel für Postfach-Passwörter | aus `JWT_SECRET` abgeleitet |
| `COOKIE_SECURE` | `true` hinter HTTPS | `false` |
| `TRUST_PROXY` | `true` hinter Reverse-Proxy (für die Login-Sperre je IP) | aus |
| `VAPID_KONTAKT` | Kontakt für Web-Push | `mailto:admin@example.com` |

> `JWT_SECRET` bzw. `MAIL_SCHLUESSEL` nach dem Einrichten nicht mehr ändern – sonst lassen sich die gespeicherten Postfach-Passwörter nicht mehr entschlüsseln.

## HTTPS

Für den Betrieb im Internet einen Reverse-Proxy mit HTTPS davorsetzen (Push-Mitteilungen und die Handy-App brauchen HTTPS)
und `COOKIE_SECURE=true` sowie `TRUST_PROXY=true` setzen. Beispiel mit Caddy:

```
mail.firma.de {
  reverse_proxy 127.0.0.1:3000
}
```

## Sicherung

Alles Wichtige liegt in `DATA_DIR`: `teampost.db` (+ `-wal`/`-shm`), `mail-anhaenge/`, `geheimnis.txt`, `vapid.json`.
Zum Sichern den Dienst kurz stoppen und den Ordner kopieren. Ohne `geheimnis.txt` sind die Postfach-Passwörter verloren,
ohne `vapid.json` müssen alle Geräte Mitteilungen neu einschalten.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/server.js` | Express + Socket.io, Login, Einrichten, Team-Verwaltung |
| `src/mail.js` | API der Mail-App |
| `src/mail-db.js` | Tabellen, Verschlüsselung, Rechte |
| `src/mail-abgleich.js` | IMAP-Abgleich im Hintergrund |
| `src/push.js` | Web-Push |
| `public/mail.html`, `public/js/mail.js` | Oberfläche |

## Lizenz

MIT
