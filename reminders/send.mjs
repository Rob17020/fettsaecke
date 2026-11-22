// Push-Erinnerungen für den Club der Fettsäcke (läuft per GitHub Actions, siehe .github/workflows/reminders.yml)
//   node send.mjs                 -> "auto": entscheidet anhand der Uhrzeit in Berlin
//   node send.mjs --kind=weigh    -> Montag: "Wiegen bis 14 Uhr" an alle, die noch nicht gewogen haben
//   node send.mjs --kind=habits   -> täglich: "Habits noch offen" an alle, deren Wochenziele noch offen sind
//   node send.mjs --kind=test     -> Testnachricht an alle registrierten Geräte
//   --dry-run   nur zählen, nichts senden      --force   Zeitfenster und Doppel-Schutz ignorieren
// Zugang: Umgebungsvariable FIREBASE_SERVICE_ACCOUNT = komplettes Service-Account-JSON (GitHub-Secret, nie committen).
// Lokal mit FIRESTORE_EMULATOR_HOST läuft es ohne Zugang gegen den Emulator und listet die Empfänger (tests/reminders.test.mjs).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { pathToFileURL } from 'node:url';

// Muss zu CONFIG in app.js passen.
const SEASON = { start: [2026, 11, 23], weeks: 24, etappeWeeks: 4, holdBand: 1, deadlineHour: 14, backfillDays: 2, strafe: 5, habitFee: 1 };
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

// Habits wie in app.js: 3 Stück mit Wochenziel (alte Einträge ohne Ziel = 7×), pro Etappe gespeichert
const normHabits = hs => [0, 1, 2].map(i => { const h = hs?.[i]; return typeof h === 'string' ? { name: h, target: 7 } : { name: String(h?.name || ''), target: Math.min(7, Math.max(1, Math.round(+h?.target) || 7)) }; });
export function habitsFor(p, w) {
  const sets = p.habitSets || {}, ks = Object.keys(sets).map(Number).filter(k => k > 0).sort((a, b) => a - b);
  if (!ks.length) return normHabits(p.habits);
  const e = Math.max(1, Math.ceil(w / SEASON.etappeWeeks)), k = ks.filter(x => x <= e).pop() ?? ks[0];
  return normHabits(sets[k]);
}
// Abwechslung: pro Spieler, Art und Tag eine feste, aber wechselnde Variante (beide Cron-Läufe würden dieselbe wählen)
export function pick(list, seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return list[(h >>> 0) % list.length]; }
const andJoin = xs => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' und ' + xs[xs.length - 1];
const first = p => String(p.name || '').trim().split(/\s+/)[0] || 'du';

// Montag: Wiegen. v = { name, k, dl, fee, done: [Namen, die schon gewogen haben], start, late }
export function weighMsg(v, seed) {
  // Startgewicht letzten Montag verpasst: die App verschiebt den Start beim Öffnen auf heute
  if (v.late) return pick([
    { title: `Neuer Start bis ${v.dl}`, body: `Letzten Montag hat's nicht geklappt, ${v.name}. Trag heute bis ${v.dl} dein Startgewicht ein, dann bist du dabei.` },
    { title: 'Zweite Chance', body: `Startgewicht verpasst? Heute geht's neu los. App öffnen und bis ${v.dl} eintragen.` },
    { title: 'Heute ist dein Start', body: `Nüchtern, nach dem Klo, gleiche Waage. Startgewicht bis ${v.dl}, dann zählt alles.` },
  ], seed);
  if (v.start) return pick([
    { title: `Startgewicht bis ${v.dl}`, body: `Heute geht's los, ${v.name}. Trag bis ${v.dl} dein Startgewicht ein.` },
    { title: 'Tag 1. Ab auf die Waage', body: `Nüchtern, nach dem Klo, gleiche Waage. Startgewicht bis ${v.dl}.` },
    { title: 'Der Club startet', body: `Ohne Startgewicht kein Start. Du hast bis ${v.dl}.` },
  ], seed);
  const others = v.done.length ? (v.done.length > 2 ? `${v.done.length} andere haben schon gewogen.` : `${andJoin(v.done)} ${v.done.length > 1 ? 'haben' : 'hat'} schon gewogen.`) : 'Noch hat keiner gewogen. Sei der Erste.';
  return pick([
    { title: `Wiegen bis ${v.dl}`, body: `Woche ${v.k} ist noch offen. Bis ${v.dl}, sonst ${v.fee} in den Topf.` },
    { title: 'Montag. Waage.', body: `${others} Du hast bis ${v.dl}.` },
    { title: `${v.fee} oder 30 Sekunden`, body: `Kurz auf die Waage und eintragen, ${v.name}. Schluss ist um ${v.dl}.` },
    { title: 'Die Waage wartet', body: `Egal was sie sagt: eintragen kostet nichts, vergessen kostet ${v.fee}. Bis ${v.dl}.` },
    { title: `Woche ${v.k} abschließen`, body: `${others} Wiegen bis ${v.dl}.` },
    { title: 'Nüchtern, Klo, Waage', body: `Die Reihenfolge kennst du. Eintragen bis ${v.dl}, sonst ${v.fee}.` },
  ], seed);
}

// Abends: Habits. v = { name, open: ['Kochen 1/4', ...], left: Tage bis Sonntag inkl. morgen, fee, back, dl }
// Nachtragen geht bis zu back Tage, die Vorwoche aber nur bis Montag dl (Wiegeschluss, wie in app.js)
export function habitsMsg(v, seed) {
  const list = v.open.join(', ');
  if (v.left === 0) return pick([
    { title: 'Letzter Tag der Woche', body: `Noch offen: ${list}. Heute zählt, sonst ${v.fee}. Nachtragen geht nur noch bis morgen ${v.dl}.` },
    { title: 'Sonntag. Abrechnung.', body: `${list}. Was heute fehlt, kostet ${v.fee}, außer du trägst es bis morgen ${v.dl} nach.` },
    { title: `Jetzt oder nie (oder bis morgen ${v.dl})`, body: `${list} sind noch offen. Eine Woche ohne alle Ziele kostet ${v.fee}.` },
  ], seed);
  if (v.left <= 2) return pick([
    { title: 'Die Woche wird knapp', body: `Noch ${v.left === 1 ? 'morgen' : `${v.left} Tage`}: ${list}.` },
    { title: 'Endspurt', body: `${list}. Nicht bis Sonntag schieben, ${v.name}.` },
    { title: `${v.fee} sind ${v.fee}`, body: `Noch offen: ${list}. ${v.left === 1 ? 'Morgen' : 'In zwei Tagen'} ist die Woche rum.` },
  ], seed);
  return pick([
    { title: 'Habits noch offen', body: `Diese Woche fehlt noch: ${list}.` },
    { title: 'Kurzer Check', body: `${list}. Heute schon was davon gemacht? Dann abhaken.` },
    { title: `Na, ${v.name}?`, body: `${list} warten noch. Die Woche hat noch ${v.left} Tage.` },
    { title: 'Kleine Schritte zählen', body: `Ein Haken heute ist einer weniger am Sonntag. Offen: ${list}.` },
    { title: 'Haken setzen', body: `Noch offen: ${list}. Vergessen? Bis zu ${v.back} Tage nachtragen geht.` },
    { title: 'Noch wach?', body: `Dann kurz abhaken. Offen: ${list}.` },
  ], seed);
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

  const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa && !EMU) throw new Error('FIREBASE_SERVICE_ACCOUNT fehlt.');
  initializeApp(EMU ? { projectId: process.env.GCLOUD_PROJECT || 'demo-fettsaecke' } : { credential: cert(JSON.parse(sa)) });
  const db = getFirestore();
  const players = (await db.collection('players').get()).docs.map(d => ({ uid: d.id, ...d.data() }));

  // Wer bekommt welche Nachricht?
  const out = [];
  const exists = async path => (await db.doc(path).get()).exists;
  // wer diese Woche schon gewogen hat (für "Siggi hat schon gewogen")
  const wk = Number.isInteger(slot) ? slot : Math.ceil(slot);
  const weighedNow = KIND === 'weigh' ? new Set((await db.collection('weighins').where('slot', '==', wk).get()).docs.map(d => d.data().uid)) : new Set();
  for (const p of players) {
    const js = p.joinedSlot || 0;
    if (p.status === 'finished') continue; // mit erreichtem Ziel ausgestiegen: keine Erinnerungen mehr
    if (KIND === 'test') { out.push({ p, title: 'Test', body: 'Erinnerungen kommen auf diesem Gerät an.' }); continue; }
    if (KIND === 'weigh') {
      const k = FORCE && !Number.isInteger(slot) ? Math.ceil(slot) : slot;
      if (k < js) continue;
      if ((p.pausedWeeks || []).includes(k)) continue;                     // Woche pausiert: kein Wiegen nötig
      // Startgewicht verpasst: die App verschiebt den Start beim nächsten Öffnen auf heute -> neue Start-Erinnerung
      // (nicht am letzten Montag der Saison, da kann niemand mehr einsteigen)
      const late = k > js && !(await exists(`weighins/${p.uid}_${js}`));
      if (late && k >= SEASON.weeks) continue;
      if (await exists(`weighins/${p.uid}_${k}`)) continue;               // schon gewogen
      const dl = `${SEASON.deadlineHour}:00 Uhr`;
      const done = players.filter(x => x.uid !== p.uid && weighedNow.has(x.uid)).map(first);
      out.push({ p, ...weighMsg({ start: k === js || late, late, name: first(p), k, dl, fee: eur(SEASON.strafe), done }, `${p.uid}|weigh|${t.date}`) });
    }
    if (KIND === 'habits') {
      if (t.day < 7 * js || !(await exists(`weighins/${p.uid}_${js}`))) continue; // noch nicht gestartet
      if ((p.pausedWeeks || []).includes(Math.floor(t.day / 7) + 1)) continue;          // diese Woche pausiert
      // Haltephase: Habits bleiben Pflicht, also auch Erinnerungen
      // Haken dieser Woche zählen (Mo bis heute): offen = Wochenziel noch nicht erreicht und heute noch nicht abgehakt
      const w = Math.floor(t.day / 7) + 1, d0 = 7 * (w - 1), H = habitsFor(p, w);
      const logs = await db.getAll(...Array.from({ length: t.day - d0 + 1 }, (_, i) => db.doc(`habitlogs/${p.uid}_${d0 + i}`)));
      const cnt = [0, 0, 0]; let today = [];
      for (const s of logs) if (s.exists) { const x = s.data(); (x.done || []).slice(0, 3).forEach((v, i) => { if (v) cnt[i]++; }); if (x.day === t.day) today = x.done || []; }
      const open = H.map((h, i) => ({ h, i })).filter(({ h, i }) => h.name && cnt[i] < h.target && !today[i]);
      if (!open.length) continue;
      out.push({ p, ...habitsMsg({ name: first(p), open: open.map(({ h, i }) => `${h.name} ${cnt[i]}/${h.target}`), left: d0 + 6 - t.day, fee: eur(SEASON.habitFee), back: SEASON.backfillDays, dl: `${SEASON.deadlineHour}:00 Uhr` }, `${p.uid}|habits|${t.date}`) });
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
  // Nur Zahlen loggen: Actions-Logs sind bei öffentlichen Repos öffentlich. Empfänger nur im Emulator (lokale Tests).
  if (EMU) for (const o of out) console.log(`  -> ${o.p.uid} | ${o.title} | ${o.body}`);
  console.log(`${KIND} ${t.date}: ${out.length} Empfänger, ${devices} Geräte, ${DRY ? 'Testlauf, nichts gesendet' : `${sent} zugestellt, ${failed} Fehler, ${removed} alte Geräte entfernt`}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
