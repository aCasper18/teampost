// Einstellungen aus der Umgebung bzw. aus .env im Projektordner. Fehlt das Sitzungs-Geheimnis, wird beim ersten Start
// eines erzeugt und im Datenordner abgelegt – so läuft Teampost ohne Vorarbeit, übersteht aber Neustarts.
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(WURZEL, '.env'))) process.loadEnvFile(join(WURZEL, '.env'));
export const env = process.env;

export const DATEN = resolve(WURZEL, env.DATA_DIR || 'data');
mkdirSync(DATEN, { recursive: true });

const GEHEIM_DATEI = join(DATEN, 'geheimnis.txt');
if (!env.JWT_SECRET?.trim()) {
  if (!existsSync(GEHEIM_DATEI)) writeFileSync(GEHEIM_DATEI, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
  env.JWT_SECRET = readFileSync(GEHEIM_DATEI, 'utf8').trim();
}

export const APP = {
  name: env.APP_NAME || 'Teampost',
  farbe: /^#[0-9a-f]{6}$/i.test(env.APP_FARBE || '') ? env.APP_FARBE : '#2563EB',
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  // hinter HTTPS (Reverse-Proxy) auf true setzen → Cookie nur über HTTPS; ohne HTTPS (lokal, im LAN) aus lassen
  sicher: env.COOKIE_SECURE === 'true',
  kontakt: env.VAPID_KONTAKT || 'mailto:admin@example.com',
};
