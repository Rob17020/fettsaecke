// Backup (von backup.mjs) in eine LEERE Firestore-Datenbank zurückspielen.
//   node restore.mjs <datei> --dry-run           nur lesen und zählen, nichts schreiben (geht auch ohne Zugang)
//   node restore.mjs <datei> --key=sa.json       zurückspielen (Ziel-Projekt = Projekt des Service-Accounts)
//   --force                                       auch in eine nicht leere Datenbank schreiben (überschreibt gleiche Pfade)
// Verschlüsselte Dateien (.fsbak) brauchen BACKUP_PASSPHRASE. Zugang wie bei send.mjs: --key=… oder FIREBASE_SERVICE_ACCOUNT.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { FORMAT, decrypt, dec, connect, args, countByCollection } from './backup-format.mjs';

export async function importAll(db, docs) {
  const w = db.bulkWriter(); let n = 0;
  w.onWriteError(e => e.failedAttempts < 5); // vorübergehende Fehler wiederholen
  for (const [p, data] of Object.entries(docs)) { w.set(db.doc(p), dec(data, db)); n++; }
  await w.close();
  return n;
}

async function main() {
  const a = args(process.argv.slice(2)), file = process.argv.slice(2).find(x => !x.startsWith('--'));
  if (!file) throw new Error('Aufruf: node restore.mjs <backup-datei> [--dry-run] [--key=service-account.json] [--force]');
  const data = decrypt(readFileSync(file), process.env.BACKUP_PASSPHRASE);
  if (data.format !== FORMAT || !data.docs) throw new Error('Keine Backup-Datei des Clubs der Fettsäcke.');
  const n = Object.keys(data.docs).length;
  console.log(`Backup vom ${data.createdAt} (Projekt ${data.projectId}): ${n} Dokumente`);
  for (const [k, c] of Object.entries(countByCollection(data.docs))) console.log(`  ${k}: ${c}`);

  const c = connect(a.key);
  if (!c) { if (a['dry-run']) return console.log('Testlauf ohne Zugang: Datei ist lesbar, nichts geschrieben.'); throw new Error('Kein Zugang: --key=datei.json oder FIREBASE_SERVICE_ACCOUNT.'); }
  const existing = (await c.db.listCollections()).map(x => x.id);
  console.log(`Ziel: Projekt ${c.projectId}, ${existing.length ? `NICHT leer (${existing.join(', ')})` : 'leer'}`);
  if (a['dry-run']) return console.log('Testlauf: nichts geschrieben.');
  if (existing.length && !a.force) throw new Error('Die Ziel-Datenbank ist nicht leer. Abbruch (mit --force trotzdem schreiben).');
  const t0 = Date.now(), done = await importAll(c.db, data.docs);
  console.log(`${done} Dokumente geschrieben in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
