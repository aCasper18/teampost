#!/usr/bin/env bash
# Teampost installieren oder aktualisieren (Ubuntu/Debian, als root).
#
#   curl -fsSL https://raw.githubusercontent.com/aCasper18/teampost/main/install.sh | sudo bash
#
# Ohne Rückfragen:
#   curl -fsSL …/install.sh | sudo DOMAIN=mail.firma.de EMAIL=it@firma.de APP_NAME="Firma Mail" bash
#
# Installiert Docker (falls nötig), legt Teampost nach /opt/teampost und startet es hinter Caddy mit HTTPS für DOMAIN.
# Erneut ausführen = Update auf den neuesten Stand; .env, Caddyfile und alle Daten (Docker-Volume) bleiben erhalten.
set -euo pipefail

REPO="aCasper18/teampost"
ZWEIG="${ZWEIG:-main}"
ZIEL="${ZIEL:-/opt/teampost}"

blau() { printf '\033[1;34m%s\033[0m\n' "$*"; }
fehler() { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
# Rückfragen auch bei „curl | bash“ (stdin ist dann das Skript, nicht die Tastatur)
frage() {
  local text="$1" vorgabe="${2:-}" antwort=""
  [ -r /dev/tty ] || { echo "$vorgabe"; return; }
  if [ -n "$vorgabe" ]; then printf '%s [%s]: ' "$text" "$vorgabe" >/dev/tty; else printf '%s: ' "$text" >/dev/tty; fi
  read -r antwort </dev/tty || true
  echo "${antwort:-$vorgabe}"
}

[ "$(id -u)" -eq 0 ] || fehler "Bitte als root ausführen (… | sudo bash)"
command -v apt-get >/dev/null || fehler "Dieses Skript unterstützt Ubuntu/Debian. Andere Systeme: siehe README (docker compose up -d)."

blau "==> Teampost-Installation"

# ---------- Docker ----------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  blau "==> Docker wird installiert"
  apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------- Programm holen (ohne git) ----------
blau "==> Neueste Version wird geladen"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/${REPO}/tar.gz/refs/heads/${ZWEIG}" | tar -xz -C "$TMP" --strip-components=1
mkdir -p "$ZIEL"
# Eigene Einstellungen nie überschreiben
for f in .env Caddyfile; do [ -f "$ZIEL/$f" ] && cp "$ZIEL/$f" "$TMP/$f"; done
cp -a "$TMP/." "$ZIEL/"
cd "$ZIEL"

# ---------- Einstellungen (nur beim ersten Mal) ----------
if [ ! -f .env ]; then
  DOMAIN="${DOMAIN:-$(frage 'Domain für Teampost (DNS muss schon auf diesen Server zeigen), z. B. mail.firma.de')}"
  [ -n "$DOMAIN" ] || fehler "Ohne Domain kein HTTPS. Mit DOMAIN=… erneut starten."
  EMAIL="${EMAIL:-$(frage 'E-Mail für Let’s-Encrypt-Zertifikat und Push' "admin@${DOMAIN#*.}")}"
  APP_NAME="${APP_NAME:-$(frage 'Name der App' 'Teampost')}"
  APP_FARBE="${APP_FARBE:-#2563EB}"
  # Geheimnisse hier erzeugen und in .env festhalten – nie wieder ändern, sonst sind die Postfach-Passwörter unlesbar
  umask 077
  cat > .env <<EOF
APP_NAME="${APP_NAME//\"/}"
APP_FARBE="${APP_FARBE}"
DOMAIN=${DOMAIN}
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')
COOKIE_SECURE=true
TRUST_PROXY=true
TEAMPOST_BIND=127.0.0.1
VAPID_KONTAKT=mailto:${EMAIL}
EOF
  cat > Caddyfile <<EOF
{
	email ${EMAIL}
}

${DOMAIN} {
	encode zstd gzip
	reverse_proxy teampost:3000
}
EOF
  umask 022
fi
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"

# ---------- Start ----------
blau "==> Teampost wird gebaut und gestartet (dauert beim ersten Mal 1–2 Minuten)"
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

for _ in $(seq 1 30); do
  docker compose exec -T teampost wget -qO- http://127.0.0.1:3000/gesund >/dev/null 2>&1 && break
  sleep 2
done

blau "==> Fertig"
echo
echo "  Öffnen:        https://${DOMAIN}"
echo "  Beim ersten Aufruf legst du dort den ersten Admin an."
echo
echo "  Update:        dieses Installationsskript erneut ausführen"
echo "  Logins:        cd ${ZIEL} && docker compose exec teampost node scripts/nutzer.js liste"
echo "  Logs:          cd ${ZIEL} && docker compose logs -f teampost"
echo
echo "  Wichtig: ${ZIEL}/.env sicher aufbewahren – ohne JWT_SECRET lassen sich die Postfach-Passwörter nicht mehr lesen."
