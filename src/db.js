// SQLite (node:sqlite) im Datenordner: Logins und Push-Abos. Die Mail-Tabellen legt mail-db.js an.
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATEN } from './config.js';

export const db = new DatabaseSync(join(DATEN, 'teampost.db'));
db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS nutzer (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, passwort_hash TEXT NOT NULL, name TEXT,
  rolle TEXT NOT NULL DEFAULT 'nutzer', aktiv INTEGER NOT NULL DEFAULT 1, erstellt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS push_abos (
  endpoint TEXT PRIMARY KEY, email TEXT NOT NULL, schluessel TEXT NOT NULL, geraet TEXT,
  erstellt TEXT NOT NULL DEFAULT (datetime('now')), zuletzt TEXT
);
CREATE TABLE IF NOT EXISTS push_themen (email TEXT PRIMARY KEY, themen TEXT NOT NULL);`);

// Alle aktiven Logins – für Zuweisen, @Erwähnungen und Namen in der Oberfläche
export const team = () => db.prepare('SELECT email, coalesce(name, email) AS name FROM nutzer WHERE aktiv = 1 ORDER BY name').all();
