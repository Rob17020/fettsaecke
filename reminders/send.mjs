// Push-Erinnerungen für den Club der Fettsäcke (läuft per GitHub Actions, siehe .github/workflows/reminders.yml)
//   node send.mjs                 -> "auto": entscheidet anhand der Uhrzeit in Berlin
//   node send.mjs --kind=weigh    -> Montag: "Wiegen bis 14 Uhr" an alle, die noch nicht gewogen haben
//   node send.mjs --kind=habits   -> täglich: "Gewohnheiten noch offen" an alle, deren Wochenziele noch offen sind
//   node send.mjs --kind=test     -> Testnachricht an alle registrierten Geräte
//   --dry-run   nur zählen, nichts senden      --force   Zeitfenster und Doppel-Schutz ignorieren
// Zugang: Umgebungsvariable FIREBASE_SERVICE_ACCOUNT = komplettes Service-Account-JSON (GitHub-Secret, nie committen).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { pathToFileURL } from 'node:url';

// Muss zu CONFIG in app.js passen.
const SEASON = { start: [2026, 11, 23], weeks: 24, etappeWeeks: 4, deadlineHour: 14, backfillDays: 2, strafe: 1, habitFee: 0.5 };
const APP_URL = process.env.APP_URL || 'https://rob17020.github.io/fettsaecke/';
const TZ = 'Europe/Berlin';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const DRY = args['dry-run'] === true || process.env.DRY_RUN === 'true';
const FORCE = args.force === true || process.env.FORCE === 'true';
let KIND = args.kind || process.env.KIND || 'auto';

// Ortszeit Berlin (Sommer-/Winterzeit macht Intl richtig)
export function berlin(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
  const [y, m, dd] = [+p.year, +p.month, +p.day];
  const [sy, sm, sd] = SEASON.start;
  return { y, m, d: dd, hour: +p.hour, minute: +p.minute, weekday: p.weekday, date: `${p.year}-${p.month}-${p.day}`, day: Math.round((Date.UTC(y, m - 1, dd) - Date.UTC(sy, sm - 1, sd)) / 864e5) };
}

// Gewohnheiten wie in app.js: 3 Stück mit Wochenziel (alte Einträge ohne Ziel = 7×), pro Etappe gespeichert
const normHabits = hs => [0, 1, 2].map(i => { const h = hs?.[i]; return typeof h === 'string' ? { name: h, target: 7 } : { name: String(h?.name || ''), target: Math.min(7, Math.max(1, Math.round(+h?.target) || 7)) }; });
export function habitsFor(p, w) {
  const sets = p.habitSets || {}, ks = Object.keys(sets).map(Number).filter(k => k > 0).sort((a, b) => a - b);
  if (!ks.length) return normHabits(p.habits);
  const e = Math.max(1, Math.ceil(w / SEASON.etappeWeeks)), k = ks.filter(x => x <= e).pop() ?? ks[0];
  return normHabits(sets[k]);
}
const eur = x => x.toLocaleString('de-DE', { minimumFractionDigits: Math.round(x * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

async function main() {
  const t = berlin();
  if (KIND === 'auto') {
    if (t.weekday === 'Mon' && t.hour >= 8 && t.hour < SEASON.deadlineHour) KIND = 'weigh';
    else if (t.hour >= 21 && t.hour < 23) KIND = 'habits';
    else return console.log(`Nichts zu tun (Berlin ${t.date} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}).`);
  }
  if (!['weigh', 'habits', 'test'].includes(KIND)) throw new Error('Unbekannte Art: ' + KIND);
  const slot = t.day / 7;
  if (KIND === 'weigh' && !FORCE && !(t.day >= 0 && t.day % 7 === 0 && slot <= SEASON.weeks)) return console.log('Heute ist kein Wiege-Montag der Saison.');
  if (KIND === 'habits' && !FORCE && !(t.day >= 0 && t.day < SEASON.weeks * 7)) return console.log('Außerhalb der Saison.');

  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT fehlt.');
  initializeApp({ credential: cert(JSON.parse(sa)) });
  const db = getFirestore();
  const players = (await db.collection('players').get()).docs.map(d => ({ uid: d.id, ...d.data() }));

  // Wer bekommt welche Nachricht?
  const out = [];
  const exists = async path => (await db.doc(path).get()).exists;
  for (const p of players) {
    const js = p.joinedSlot || 0;
    if (KIND === 'test') { out.push({ p, title: 'Test', body: 'Erinnerungen kommen auf diesem Gerät an.' }); continue; }
    if (KIND === 'weigh') {
      const k = FORCE && !Number.isInteger(slot) ? Math.ceil(slot) : slot;
      if (k < js) continue;
      if (k > js && !(await exists(`weighins/${p.uid}_${js}`))) continue; // nie gestartet
      if (await exists(`weighins/${p.uid}_${k}`)) continue;               // schon gewogen
      const dl = `${SEASON.deadlineHour}:00 Uhr`;
      out.push({ p, title: k === js ? `Startgewicht bis ${dl}` : `Wiegen bis ${dl}`,
        body: k === js ? `Trag heute bis ${dl} dein Startgewicht ein.` : `Woche ${k} ist noch nicht eingetragen. Bis ${dl}, sonst ${eur(SEASON.strafe)} in den Topf.` });
    }
    if (KIND === 'habits') {
      if (t.day < 7 * js || !(await exists(`weighins/${p.uid}_${js}`))) continue; // noch nicht gestartet
      // Haken dieser Woche zählen (Mo bis heute): offen = Wochenziel noch nicht erreicht und heute noch nicht abgehakt
      const w = Math.floor(t.day / 7) + 1, d0 = 7 * (w - 1), H = habitsFor(p, w);
      const logs = await db.getAll(...Array.from({ length: t.day - d0 + 1 }, (_, i) => db.doc(`habitlogs/${p.uid}_${d0 + i}`)));
      const cnt = [0, 0, 0]; let today = [];
      for (const s of logs) if (s.exists) { const x = s.data(); (x.done || []).slice(0, 3).forEach((v, i) => { if (v) cnt[i]++; }); if (x.day === t.day) today = x.done || []; }
      const open = H.map((h, i) => ({ h, i })).filter(({ h, i }) => h.name && cnt[i] < h.target && !today[i]);
      if (!open.length) continue;
      out.push({ p, title: 'Gewohnheiten noch offen', body: `Diese Woche fehlt noch: ${open.map(({ h, i }) => `${h.name} ${cnt[i]}/${h.target}`).join(', ')}. Nachtragen geht bis zu ${SEASON.backfillDays} Tage, eine Woche ohne alle Ziele kostet ${eur(SEASON.habitFee)}.` });
    }
  }

  // Doppelt verschicken verhindern (zwei Cron-Läufe wegen Sommer-/Winterzeit)
  if (!DRY && !FORCE) {
    try { await db.collection('reminderRuns').doc(`${KIND}_${t.date}`).create({ at: FieldValue.serverTimestamp(), recipients: out.length }); }
    catch (e) { if (e.code === 6) return console.log(`${KIND} für ${t.date} wurde schon verschickt.`); throw e; }
  }

  const messaging = getMessaging();
  let devices = 0, sent = 0, failed = 0, removed = 0;
  for (const { p, title, body } of out) {
    const ref = db.doc(`players/${p.uid}/private/tokens`);
    const snap = await ref.get();
    const tokens = Object.keys(snap.exists ? snap.data().tokens || {} : {});
    devices += tokens.length;
    if (!tokens.length || DRY) continue;
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: APP_URL }, notification: { icon: APP_URL + 'icons/icon-192.png', tag: KIND, lang: 'de' } },
    });
    sent += res.successCount; failed += res.failureCount;
    // abgemeldete Geräte aufräumen
    const dead = tokens.filter((_, i) => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(res.responses[i].error?.code));
    for (const tk of dead) { await ref.update(new FieldPath('tokens', tk), FieldValue.delete()); removed++; }
  }
  // Nur Zahlen loggen: Actions-Logs sind bei öffentlichen Repos öffentlich.
  console.log(`${KIND} ${t.date}: ${out.length} Empfänger, ${devices} Geräte, ${DRY ? 'Testlauf, nichts gesendet' : `${sent} zugestellt, ${failed} Fehler, ${removed} alte Geräte entfernt`}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
