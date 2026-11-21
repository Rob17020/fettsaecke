// Wöchentliches Backup aller Firestore-Daten (inkl. Unter-Sammlungen wie players/{uid}/private) in EINE verschlüsselte Datei.
// Läuft per GitHub Actions (Sonntagnacht, siehe .github/workflows/reminders.yml) und wird dort als Artefakt (90 Tage) abgelegt.
//   node backup.mjs [--out=ordner]   Zugang wie bei send.mjs (FIREBASE_SERVICE_ACCOUNT) oder --key=service-account.json
//   BACKUP_PASSPHRASE muss gesetzt sein: die Datei enthält die privaten kg-Werte, und Artefakte öffentlicher Repos
//   kann jeder angemeldete GitHub-Nutzer herunterladen. Nur lokal und bewusst: --plain schreibt unverschlüsseltes JSON.
// Die Datei NIE ins Repo legen (.gitignore fängt backup/ und *.fsbak ab).
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FORMAT, VERSION, encrypt, enc, connect, args, countByCollection } from './backup-format.mjs';

// alle Dokumente einer Sammlung, dann rekursiv deren Unter-Sammlungen (mit begrenzter Parallelität)
async function dumpCollection(col, docs) {
  const snap = await col.get();
  for (const d of snap.docs) docs[d.ref.path] = enc(d.data());
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 25) {
    await Promise.all(refs.slice(i, i + 25).map(async ref => { for (const sub of await ref.listCollections()) await dumpCollection(sub, docs); }));
  }
}

export async function exportAll(db) {
  const docs = {};
  for (const col of await db.listCollections()) await dumpCollection(col, docs);
  return docs;
}

async function main() {
  const a = args(process.argv.slice(2));
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!pass && !a.plain) throw new Error('BACKUP_PASSPHRASE fehlt (GitHub-Secret). Ohne Verschlüsselung wird nichts hochgeladen.');
  const c = connect(a.key); if (!c) throw new Error('Kein Zugang: FIREBASE_SERVICE_ACCOUNT setzen oder --key=datei.json angeben.');
  const t0 = Date.now(), docs = await exportAll(c.db);
  const data = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), projectId: c.projectId, docs };
  const out = a.out || 'backup', date = data.createdAt.slice(0, 10);
  const file = path.join(out, `firestore-${date}.${a.plain ? 'json' : 'fsbak'}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(file, a.plain ? JSON.stringify(data, null, 1) : encrypt(data, pass));
  // Nur Zahlen loggen: Actions-Logs sind bei öffentlichen Repos öffentlich.
  console.log(`Backup ${date}: ${Object.keys(docs).length} Dokumente in ${((Date.now() - t0) / 1000).toFixed(1)} s${a.plain ? ', UNVERSCHLÜSSELT' : ', verschlüsselt'}.`);
  for (const [k, n] of Object.entries(countByCollection(docs))) console.log(`  ${k}: ${n}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `file=${file}\ndate=${date}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
