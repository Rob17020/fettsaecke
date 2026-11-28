// Push-Erinnerungen für den Club der Fettsäcke (läuft per GitHub Actions, siehe .github/workflows/reminders.yml)
//   node send.mjs                 -> "auto": entscheidet anhand der Uhrzeit in Berlin
//   node send.mjs --kind=weigh    -> Montag: "Wiegen bis 14 Uhr" an alle, die noch nicht gewogen haben
//   node send.mjs --kind=habits   -> täglich: "Habits noch offen" an alle, deren Wochenziele noch offen sind
//   node send.mjs --kind=news     -> alle 30 Min. (8–22 Uhr): neue Extra-Aufgaben, Team-Vorschläge und Wochen-Challenges
//                                    an alle anderen; um 18 Uhr zusätzlich "Deine Aufgabe / dein Vorschlag fehlt noch"
//   node send.mjs --kind=test     -> Testnachricht an alle registrierten Geräte
//   --dry-run   nur zählen, nichts senden      --force   Zeitfenster und Doppel-Schutz ignorieren
// Zugang: Umgebungsvariable FIREBASE_SERVICE_ACCOUNT = komplettes Service-Account-JSON (GitHub-Secret, nie committen).
// Lokal mit FIRESTORE_EMULATOR_HOST läuft es ohne Zugang gegen den Emulator und listet die Empfänger (tests/reminders.test.mjs).
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { pathToFileURL } from 'node:url';

// Muss zu CONFIG in app.js passen.
const SEASON = { start: [2026, 11, 23], weeks: 24, etappeWeeks: 4, holdBand: 1, deadlineHour: 14, backfillDays: 2, strafe: 5, habitFee: 1, taskPts: 10 };
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
const normHabits = hs => [0, 1, 2].map(i => { const h = hs?.[i]; return typeof h === 'string' ? { name: h, target: 7 } : { name: String(h?.name || ''), target: Math.min(7, Math.max(1, Math.round(+h?.target) || 7)), confirm: h?.confirm === true }; });
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

/* ---------- Neues bei den Challenges ----------
   items: [{ k: 'task'|'team'|'weekly', by, text, e, rate, lbl, draw }], v: { name, task: Etappe|null (eigene Aufgabe fehlt), idea: { e, draw }|null } */
const q = t => `„${String(t || '').trim()}“`;
const cut = (s, n = 230) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
export function newsMsg(items, v, seed) {
  const onlyTeam = items.length === 1 && items[0].k === 'team'; // nennt die Ziehung schon selbst
  const miss = [v.task ? `Deine Aufgabe für Etappe ${v.task} fehlt noch.` : '', v.idea ? (onlyTeam ? 'Dein Vorschlag fehlt noch.' : `Dein Team-Vorschlag fehlt noch (Ziehung ${v.idea.draw}).`) : ''].filter(Boolean).join(' ');
  if (items.length === 1) {
    const x = items[0];
    if (x.k === 'task') { const m = pick([
      { title: `Neue Extra-Aufgabe von ${x.by}`, body: `${q(x.text)}. Wer's schafft und ein Foto schickt: +${SEASON.taskPts} P.` },
      { title: `${x.by} hat vorgelegt`, body: `Extra-Aufgabe für Etappe ${x.e}: ${q(x.text)}, +${SEASON.taskPts} P. für jeden, der sie macht.` },
      { title: `+${SEASON.taskPts} P. warten`, body: `${x.by} hat eine Extra-Aufgabe gestellt: ${q(x.text)}.` },
    ], seed); return { title: m.title, body: cut(m.body + (miss ? ' ' + miss : '')) }; }
    if (x.k === 'team') return { title: pick([`Team-Vorschlag von ${x.by}`, `${x.by} will was fürs Team`, 'Neuer Team-Vorschlag'], seed),
      body: cut(`${q(x.text)}, ${x.rate}. Ziehung ${x.draw}.${miss ? ' ' + miss : ''}`) };
    return { title: pick(['Wochen-Challenge steht', `${x.by} hat gewählt`, 'Neue Wochen-Challenge'], seed),
      body: cut(`${q(x.text)} (${x.lbl}), gewählt von ${x.by}. Abhaken im Habit-Raster.${miss ? ' ' + miss : ''}`) };
  }
  const line = x => x.k === 'task' ? `${x.by}: Extra-Aufgabe ${q(x.text)}` : x.k === 'team' ? `${x.by}: Team-Ziel ${q(x.text)}` : `Wochen-Challenge ${q(x.text)}`;
  return { title: `${items.length} Neuigkeiten bei den Challenges`, body: cut(`${items.map(line).join(' · ')}.${miss ? ' ' + miss : ''}`) };
}
// 18 Uhr: eigene Aufgabe / eigener Team-Vorschlag fehlt. v = { name, task: Etappe|null, idea: { e, draw, left }|null, done: [Namen, die ihre Aufgabe schon gestellt haben] }
export function nudgeMsg(v, seed) {
  const who = v.done.length ? (v.done.length > 2 ? `${v.done.length} andere haben ihre schon gestellt.` : `${andJoin(v.done)} ${v.done.length > 1 ? 'haben' : 'hat'} schon eine gestellt.`) : '';
  if (v.task && v.idea) return { title: 'Zwei Sachen fehlen noch', body: `Deine Extra-Aufgabe für Etappe ${v.task} und dein Team-Vorschlag für Etappe ${v.idea.e} (Ziehung ${v.idea.draw}).` };
  if (v.task) return pick([
    { title: 'Deine Extra-Aufgabe fehlt', body: `Etappe ${v.task} läuft, ${v.name}. Stell eine Aufgabe raus aus der Komfortzone. ${who}`.trim() },
    { title: `Etappe ${v.task}: deine Aufgabe?`, body: `Jeder stellt eine Extra-Aufgabe pro Etappe. ${who || 'Mach den Anfang.'}`.trim() },
    { title: 'Was macht ihr diese Etappe?', body: `Deine Extra-Aufgabe für Etappe ${v.task} fehlt noch. Geht direkt auf der Startseite.` },
  ], seed);
  return pick([
    { title: `Team-Vorschlag bis ${v.idea.draw}`, body: `Für Etappe ${v.idea.e} fehlt dein Vorschlag noch. ${v.idea.left}` },
    { title: 'Ziehung naht', body: `${v.idea.left} wird der Team-Monat für Etappe ${v.idea.e} ausgelost. Dein Vorschlag fehlt.` },
  ], seed);
}

const eur = x => x.toLocaleString('de-DE', { minimumFractionDigits: Math.round(x * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
// Ziehung Etappe e = erster Montag der Etappe, 14 Uhr (Tag (e-1)*28)
function drawStr(e) { const [y, m, d] = SEASON.start, dt = new Date(Date.UTC(y, m - 1, d + (e - 1) * SEASON.etappeWeeks * 7)); return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}.${dt.getUTCMonth() + 1}., ${SEASON.deadlineHour} Uhr`; }
const PER = { day: 'Tag', week: 'Woche', month: 'Monat' };
const nf = x => (+x || 0).toLocaleString('de-DE');
const ideaRate = x => `${x.kind === 'count' ? nf(x.per) + '×' : nf(x.per) + (x.unit ? ' ' + x.unit : '')} pro Person und ${PER[x.period] || 'Woche'}`;
const chLbl = ch => ch.kind === 'daily' ? 'täglich' : `${ch.target || 1}× diese Woche`;

// Neues bei den Challenges seit dem letzten Lauf (Stand in reminderRuns/news_state) + um 18 Uhr fehlende eigene Beiträge
async function collectNews(db, t, players) {
  const out = [], stateRef = db.doc('reminderRuns/news_state'), st = await stateRef.get(), runAt = Date.now();
  const etDay = SEASON.etappeWeeks * 7, ce = t.day < 0 ? 1 : Math.min(Math.floor(t.day / etDay) + 1, SEASON.weeks / SEASON.etappeWeeks);
  const all = { tasks: (await db.collection('tasks').get()).docs, teamideas: (await db.collection('teamideas').get()).docs };
  const active = players.filter(p => p.status !== 'finished');
  const hasTask = (uid, e) => all.tasks.some(d => d.id === `e${e}_${uid}`), hasIdea = (uid, e) => all.teamideas.some(d => d.id === `e${e}_${uid}`);
  const taskOpen = e => t.day < e * etDay;                                          // Aufgaben gehen bis zum Ende der Etappe
  const nextDraw = t.day < 0 ? null : ce + 1 <= SEASON.weeks / SEASON.etappeWeeks ? ce + 1 : null; // Ziehung am Montag nach der Etappe
  let state = st.exists ? st.data() : null, fresh = [];
  if (!state) state = { lastTs: runAt, ids: {} };                                    // erster Lauf: nur merken, nichts verschicken
  else {
    const since = Timestamp.fromMillis(state.lastTs - 10 * 60e3);                    // 10 Min. Überlappung, doppelte über ids raus
    const q = async c => (await db.collection(c).where('ts', '>', since).get()).docs.filter(d => !state.ids?.[c + '/' + d.id]);
    for (const d of await q('tasks')) { const x = d.data(); if (x.text && x.etappe >= ce) fresh.push({ id: 'tasks/' + d.id, k: 'task', uid: x.createdBy, by: first({ name: x.createdByName }), text: x.text, e: x.etappe }); }
    for (const d of await q('teamideas')) { const x = d.data(); if (x.text) fresh.push({ id: 'teamideas/' + d.id, k: 'team', uid: x.setBy, by: first({ name: x.setByName }), text: x.text, e: x.etappe, rate: ideaRate(x), draw: drawStr(x.etappe) }); }
    for (const d of await q('weekly')) { const x = d.data(); if (x.text && +d.id >= Math.floor(Math.max(0, t.day) / 7) + 1) fresh.push({ id: 'weekly/' + d.id, k: 'weekly', uid: x.setBy, by: first({ name: x.setByName }), text: x.text, lbl: chLbl(x) }); }
  }
  for (const p of active) {
    const items = fresh.filter(x => x.uid !== p.uid); if (!items.length) continue;
    const task = items.some(x => x.k === 'task') && taskOpen(ce) && !hasTask(p.uid, ce) ? ce : null;
    const ie = items.find(x => x.k === 'team')?.e, idea = ie && !hasIdea(p.uid, ie) ? { e: ie, draw: drawStr(ie) } : null;
    out.push({ p, tag: 'news', ...newsMsg(items, { name: first(p), task, idea }, `${p.uid}|news|${t.date}|${t.hour}`) });
  }
  // 18 Uhr: fehlt die eigene Aufgabe (Etappentag 2, 6, 13, 20) oder der Team-Vorschlag (6, 2, 1 Tag vor der Ziehung)?
  const nudge = [];
  if (t.hour === 18 && t.day >= 0 && t.day < SEASON.weeks * 7) {
    const de = t.day - (ce - 1) * etDay, toDraw = nextDraw ? nextDraw * etDay - etDay - t.day : null;
    for (const p of active) {
      if (t.day < 7 * (p.joinedSlot || 0)) continue;                                // noch nicht gestartet
      const task = [2, 6, 13, 20].includes(de) && !hasTask(p.uid, ce) ? ce : null;
      const idea = nextDraw && [6, 2, 1].includes(toDraw) && !hasIdea(p.uid, nextDraw) ? { e: nextDraw, draw: drawStr(nextDraw), left: toDraw === 1 ? 'Morgen um 14 Uhr' : `In ${toDraw} Tagen` } : null;
      if (!task && !idea) continue;
      const done = active.filter(x => x.uid !== p.uid && hasTask(x.uid, ce)).map(first);
      nudge.push({ p, tag: 'nudge', ...nudgeMsg({ name: first(p), task, idea, done }, `${p.uid}|nudge|${t.date}`) });
    }
  }
  const ids = Object.fromEntries(Object.entries(state.ids || {}).filter(([, ts]) => ts > runAt - 2 * 864e5)); // 2 Tage merken
  for (const x of fresh) ids[x.id] = runAt;
  return { out, nudge, save: () => stateRef.set({ lastTs: runAt, ids }), fresh: fresh.length, first: !st.exists };
}

async function main() {
  const t = berlin();
  if (KIND === 'auto') {
    if (t.weekday === 'Mon' && t.hour >= 8 && t.hour < SEASON.deadlineHour) KIND = 'weigh';
    else if (t.hour >= 21 && t.hour < 23) KIND = 'habits';
    else return console.log(`Nichts zu tun (Berlin ${t.date} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}).`);
  }
  if (!['weigh', 'habits', 'test', 'news'].includes(KIND)) throw new Error('Unbekannte Art: ' + KIND);
  if (KIND === 'news' && !FORCE && (t.hour < 8 || t.hour >= 22)) return console.log('Nachtruhe: Neuigkeiten kommen ab 8 Uhr.');
  const slot = t.day / 7;
  if (KIND === 'weigh' && !FORCE && !(t.day >= 0 && t.day % 7 === 0 && slot <= SEASON.weeks)) return console.log('Heute ist kein Wiege-Montag der Saison.');
  if (KIND === 'habits' && !FORCE && !(t.day >= 0 && t.day < SEASON.weeks * 7)) return console.log('Außerhalb der Saison.');

  const EMU = !!process.env.FIRESTORE_EMULATOR_HOST;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa && !EMU) throw new Error('FIREBASE_SERVICE_ACCOUNT fehlt.');
  initializeApp(EMU ? { projectId: process.env.GCLOUD_PROJECT || 'demo-fettsaecke' } : { credential: cert(JSON.parse(sa)) });
  const db = getFirestore();
  const players = (await db.collection('players').get()).docs.map(d => ({ uid: d.id, ...d.data() }));
  let news = null;

  // Wer bekommt welche Nachricht?
  const out = [];
  const exists = async path => (await db.doc(path).get()).exists;
  // wer diese Woche schon gewogen hat (für "Siggi hat schon gewogen")
  const wk = Number.isInteger(slot) ? slot : Math.ceil(slot);
  const weighedNow = KIND === 'weigh' ? new Set((await db.collection('weighins').where('slot', '==', wk).get()).docs.map(d => d.data().uid)) : new Set();
  if (KIND === 'news') {
    news = await collectNews(db, t, players);
    out.push(...news.out);
    // fehlende eigene Beiträge nur einmal pro Tag (zwei Läufe um 18 Uhr)
    if (news.nudge.length) {
      if (DRY || FORCE) out.push(...news.nudge);
      else try { await db.collection('reminderRuns').doc(`nudge_${t.date}`).create({ at: FieldValue.serverTimestamp(), recipients: news.nudge.length }); out.push(...news.nudge); }
      catch (e) { if (e.code !== 6) throw e; }
    }
  }
  for (const p of KIND === 'news' ? [] : players) {
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
      // Habits mit "Gruppe bestätigt" zählen wie in der App erst mit habitok/<uid>_<Tag>_<i>
      const need = logs.filter(s => s.exists).flatMap(s => { const x = s.data(); return [0, 1, 2].filter(i => H[i]?.confirm && x.done?.[i]).map(i => `${p.uid}_${x.day}_${i}`); });
      const ok = new Set(need.length ? (await db.getAll(...need.map(id => db.doc('habitok/' + id)))).filter(s => s.exists).map(s => s.id) : []);
      const cnt = [0, 0, 0]; let today = [];
      for (const s of logs) if (s.exists) { const x = s.data(); (x.done || []).slice(0, 3).forEach((v, i) => { if (v && (!H[i]?.confirm || ok.has(`${p.uid}_${x.day}_${i}`))) cnt[i]++; }); if (x.day === t.day) today = x.done || []; }
      const open = H.map((h, i) => ({ h, i })).filter(({ h, i }) => h.name && cnt[i] < h.target && !today[i]);
      if (!open.length) continue;
      out.push({ p, ...habitsMsg({ name: first(p), open: open.map(({ h, i }) => `${h.name} ${cnt[i]}/${h.target}`), left: d0 + 6 - t.day, fee: eur(SEASON.habitFee), back: SEASON.backfillDays, dl: `${SEASON.deadlineHour}:00 Uhr` }, `${p.uid}|habits|${t.date}`) });
    }
  }

  // Neuigkeiten: Stand speichern (auch ohne Empfänger), damit nichts doppelt kommt
  if (news && !DRY) await news.save();
  // Doppelt verschicken verhindern (zwei Cron-Läufe wegen Sommer-/Winterzeit)
  if (!DRY && !FORCE && KIND !== 'news') {
    try { await db.collection('reminderRuns').doc(`${KIND}_${t.date}`).create({ at: FieldValue.serverTimestamp(), recipients: out.length }); }
    catch (e) { if (e.code === 6) return console.log(`${KIND} für ${t.date} wurde schon verschickt.`); throw e; }
  }

  const messaging = getMessaging();
  let devices = 0, sent = 0, failed = 0, removed = 0;
  for (const { p, title, body, tag } of out) {
    const ref = db.doc(`players/${p.uid}/private/tokens`);
    const snap = await ref.get();
    const tokens = Object.keys(snap.exists ? snap.data().tokens || {} : {});
    devices += tokens.length;
    if (!tokens.length || DRY) continue;
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: APP_URL }, notification: { icon: APP_URL + 'icons/icon-192.png', tag: tag ? `${tag}-${t.date}-${t.hour}` : KIND, lang: 'de' } },
    });
    sent += res.successCount; failed += res.failureCount;
    // abgemeldete Geräte aufräumen
    const dead = tokens.filter((_, i) => ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(res.responses[i].error?.code));
    for (const tk of dead) { await ref.update(new FieldPath('tokens', tk), FieldValue.delete()); removed++; }
  }
  // Nur Zahlen loggen: Actions-Logs sind bei öffentlichen Repos öffentlich. Empfänger nur im Emulator (lokale Tests).
  if (EMU) for (const o of out) console.log(`  -> ${o.p.uid} | ${o.title} | ${o.body}`);
  if (news) console.log(news.first ? 'Neuigkeiten: erster Lauf, Stand gemerkt.' : `Neuigkeiten: ${news.fresh} neue Einträge.`);
  console.log(`${KIND} ${t.date}: ${out.length} Empfänger, ${devices} Geräte, ${DRY ? 'Testlauf, nichts gesendet' : `${sent} zugestellt, ${failed} Fehler, ${removed} alte Geräte entfernt`}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
