// Gemeinsames Format für backup.mjs und restore.mjs.
// Datei = JSON { format, version, createdAt, projectId, docs: { "<pfad>": { ...felder } } }, gzip-komprimiert und verschlüsselt:
//   "FSBK1" | salt (16) | iv (12) | tag (16) | AES-256-GCM(gzip(json))   – Schlüssel = scrypt(BACKUP_PASSPHRASE, salt)
// Firestore-Typen werden als { "__t": ... } kodiert, damit sie beim Zurückspielen wieder echte Typen werden.
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

export const FORMAT = 'fettsaecke-backup', VERSION = 1;
const MAGIC = Buffer.from('FSBK1');
const kdf = (pass, salt) => scryptSync(pass, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function encrypt(obj, pass) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kdf(pass, salt), iv);
  const ct = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}
export function decrypt(buf, pass) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return JSON.parse(buf.toString('utf8')); // unverschlüsselt (--plain)
  if (!pass) throw new Error('Datei ist verschlüsselt: BACKUP_PASSPHRASE setzen.');
  let o = MAGIC.length;
  const salt = buf.subarray(o, o += 16), iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16);
  const d = createDecipheriv('aes-256-gcm', kdf(pass, salt), iv); d.setAuthTag(tag);
  try { return JSON.parse(gunzipSync(Buffer.concat([d.update(buf.subarray(o)), d.final()])).toString('utf8')); }
  catch { throw new Error('Entschlüsseln fehlgeschlagen: falsche Passphrase oder beschädigte Datei.'); }
}

// Firestore-Werte <-> JSON
export function enc(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', p: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __t: 'bytes', b64: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(enc);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]));
}
export function dec(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => dec(x, db));
  switch (v.__t) {
    case 'ts': return new Timestamp(v.s, v.n);
    case 'geo': return new GeoPoint(v.lat, v.lng);
    case 'ref': return db.doc(v.p);
    case 'bytes': return Buffer.from(v.b64, 'base64');
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x, db)]));
}

// Zugang: Emulator (FIRESTORE_EMULATOR_HOST), --key=datei.json oder FIREBASE_SERVICE_ACCOUNT (JSON-Inhalt, z. B. GitHub-Secret)
export function connect(keyFile) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const projectId = process.env.GCLOUD_PROJECT || 'demo-fettsaecke';
    initializeApp({ projectId }); return { db: getFirestore(), projectId };
  }
  const raw = keyFile ? readFileSync(keyFile, 'utf8') : process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const sa = JSON.parse(raw);
  initializeApp({ credential: cert(sa) });
  return { db: getFirestore(), projectId: sa.project_id };
}

export const args = argv => Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
// Pfade zählen: "players/x/private/weights" -> "players/private"
export function countByCollection(docs) {
  const c = {};
  for (const p of Object.keys(docs)) { const k = p.split('/').filter((_, i) => i % 2 === 0).join('/'); c[k] = (c[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(c).sort());
}
