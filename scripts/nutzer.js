// Logins von der Kommandozeile verwalten (z. B. auf dem Server oder im Docker-Container).
//   npm run nutzer -- liste
//   npm run nutzer -- anlegen <email> "<Name>" [admin|nutzer]     Passwort per PASSWORT=… oder es wird eines erzeugt
//   npm run nutzer -- passwort <email>                            neues Passwort (PASSWORT=… oder erzeugt)
//   npm run nutzer -- sperren <email> | entsperren <email>
import crypto from 'node:crypto';
import { nutzerAktiv, nutzerListe, nutzerSpeichern } from '../src/auth.js';

const [befehl, email, name, rolle = 'nutzer'] = process.argv.slice(2);
const passwort = () => process.env.PASSWORT || crypto.randomBytes(9).toString('base64url');
const vorhanden = (e) => nutzerListe().find((n) => n.email === String(e).toLowerCase());

try {
  if (befehl === 'liste') {
    console.table(nutzerListe().map((n) => ({ email: n.email, name: n.name, rolle: n.rolle, aktiv: n.aktiv })));
  } else if (befehl === 'anlegen' && email) {
    const pw = passwort();
    nutzerSpeichern(email, pw, { name, rolle });
    console.log(`Angelegt: ${email} (${rolle})${process.env.PASSWORT ? '' : `\nPasswort: ${pw}`}`);
  } else if (befehl === 'passwort' && email) {
    const n = vorhanden(email);
    if (!n) throw new Error('Login nicht gefunden');
    const pw = passwort();
    nutzerSpeichern(n.email, pw, { rolle: n.rolle });
    console.log(`Passwort geändert für ${n.email}${process.env.PASSWORT ? '' : `\nPasswort: ${pw}`}`);
  } else if ((befehl === 'sperren' || befehl === 'entsperren') && email) {
    if (!nutzerAktiv(email, befehl === 'entsperren')) throw new Error('Login nicht gefunden');
    console.log(`${email}: ${befehl === 'sperren' ? 'gesperrt' : 'entsperrt'}`);
  } else {
    console.log('Befehle: liste · anlegen <email> "<Name>" [admin|nutzer] · passwort <email> · sperren <email> · entsperren <email>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
