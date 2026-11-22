// firestore.rules gegen den Emulator: jeder Schreibweg der App, erlaubt/verboten, mit TESTMODE false und true.
// Die Zeit lässt sich im Emulator nicht stellen, deshalb wird START_MS pro Szenario so verschoben, dass "jetzt" an der
// gewünschten Stelle der Saison liegt. TESTMODE und START_MS werden nur in der Kopie für den Emulator geändert.
//   cd tests && npm run rules       (startet den Emulator, braucht firebase-tools und Java)
//   ONLY=Ausstieg npm run rules      nur Fälle, deren Beschreibung "Ausstieg" enthält
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, deleteDoc, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const RULES = readFileSync(process.env.RULES || new URL('../firestore.rules', import.meta.url), 'utf8');
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8089').split(':').map((x, i) => i ? +x : x);
const PID = 'demo-fettsaecke';
const H = 3600e3, D = 864e5, WK = 7 * D;
const INV = RULES.match(/function INVITE\(\)\s*\{ return '([^']*)'/)[1];
const variant = (testmode, start) => {
  const r = RULES.replace(/function START_MS\(\) \{ return \d+; \}/, `function START_MS() { return ${Math.round(start)}; }`)
    .replace(/function TESTMODE\(\) \{ return (true|false); \}/, `function TESTMODE() { return ${testmode}; }`);
  if (r === RULES) throw new Error('Regel-Variante nicht erzeugt');
  return r;
};
async function loadRules(content) {
  const res = await fetch(`http://${HOST}:${PORT}/emulator/v1/projects/${PID}:securityRules`, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) });
  if (!res.ok) throw new Error('Regeln: ' + await res.text());
}

const env = await initializeTestEnvironment({ projectId: PID, firestore: { host: HOST, port: PORT, rules: RULES } });
const db = uid => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();
const hb = (n, t) => ({ name: n, target: t, confirm: false });
const HS = [hb('Kochen', 4), hb('Softdrinks', 7), hb('Laufen', 1)];
const pdoc = (o = {}) => ({ name: 'X', habits: HS, habitSets: { 1: HS }, extraHabits: [], maxLossPct: 5, joinedSlot: 0, joinedAt: Timestamp.fromMillis(1), lastActive: Timestamp.fromMillis(1), invite: INV, ...o });

async function seed(started = true) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const f = c.firestore();
    await setDoc(doc(f, 'players/alice'), pdoc({ name: 'Alice' }));
    await setDoc(doc(f, 'players/bob'), pdoc({ name: 'Bob' }));
    await setDoc(doc(f, 'players/carol'), pdoc({ name: 'Carol', status: 'finished', finishedWeek: 3, finishedAt: Timestamp.fromMillis(5) }));
    const legacy = pdoc({ name: 'Dave' }); delete legacy.maxLossPct; await setDoc(doc(f, 'players/dave'), legacy);
    await setDoc(doc(f, 'players/alice/private/weights'), { slots: { 0: 100 }, estKg: 100, targetKg: 95 });
    if (started) {
      for (const u of ['alice', 'bob', 'carol', 'dave']) await setDoc(doc(f, `weighins/${u}_0`), { uid: u, slot: 0, lossPct: 0 });
      await setDoc(doc(f, 'weighins/alice_3'), { uid: 'alice', slot: 3, lossPct: 4.5 });
      await setDoc(doc(f, 'weighins/bob_3'), { uid: 'bob', slot: 3, lossPct: 3.5 });
    }
    await setDoc(doc(f, 'tasks/e1_bob'), { etappe: 1, text: 'Schwimmen', createdBy: 'bob', createdByName: 'Bob', ts: Timestamp.fromMillis(Date.now() - 2 * D) });
    await setDoc(doc(f, 'taskDone/e1_bob_alice'), { uid: 'alice', taskId: 'e1_bob', confirmedBy: null, confirmedByName: null });
    await setDoc(doc(f, 'habitok/alice_6_0'), { uid: 'alice', day: 6, h: '0', by: 'bob', byName: 'Bob' });
    await setDoc(doc(f, 'weekly/1'), { text: 'Treppe', kind: 'daily', target: 7, setBy: 'bob', setByName: 'Bob' });
  });
}

// Szenarien: wo liegt "jetzt" in der Saison?
const SC = {
  pre: { label: '2 Tage vor dem Start', off: -2 * D, started: false },
  mon9: { label: 'Mo Slot 1, 9:00 (Woche 2)', off: 1 * WK + 9 * H },
  mon20: { label: 'Mo Slot 1, 20:00', off: 1 * WK + 20 * H },
  e2tue: { label: 'Di Woche 5 (1. Woche Etappe 2)', off: 4 * WK + D + 10 * H },
};
const day = d => d; // Tag seit Start
const weighBatch = (f, uid, slot, lossPct, player) => { const b = writeBatch(f); if (player) b.update(doc(f, 'players', uid), player); b.set(doc(f, 'weighins', `${uid}_${slot}`), { uid, slot, lossPct, ts: serverTimestamp() }); b.set(doc(f, 'players', uid, 'private', 'weights'), { slots: { [slot]: 99 } }, { merge: true }); return b.commit(); };

// [Szenario, Beschreibung, erwartet bei TESTMODE false, erwartet bei TESTMODE true, Aktion]
const A = true, X = false; // A = erlaubt, X = verboten
const T = [
  // --- Spieler anlegen ---
  ['pre', 'register: eigener Spieler, richtiger Code', A, A, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ name: 'Eve', joinedAt: serverTimestamp(), lastActive: serverTimestamp() }))],
  ['pre', 'register: mit extraHabits (5)', A, A, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ extraHabits: Array(5).fill(hb('x', 2)) }))],
  ['pre', 'register: 6 extraHabits', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ extraHabits: Array(6).fill(hb('x', 2)) }))],
  ['pre', 'register: falscher Code', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ invite: 'falsch' }))],
  ['pre', 'register: Dokument eines anderen', X, X, () => setDoc(doc(db('eve'), 'players/mallory'), pdoc())],
  ['pre', 'register: gleich mit status finished', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ status: 'finished' }))],
  ['pre', 'register: Ziel 50 %', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ maxLossPct: 50 }))],
  ['pre', 'register: Wochenziel 8×', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ habits: [hb('a', 8), hb('b', 1), hb('c', 1)] }))],
  ['pre', 'register: joinedSlot −3 (früher Lücke)', X, X, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ joinedSlot: -3 }))],
  ['mon9', 'register: joinedSlot 0, obwohl Slot 0 schon vorbei (früher Lücke)', X, A, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ joinedSlot: 0 }))],
  ['mon9', 'register: joinedSlot 1 (heute, Fenster offen)', A, A, () => setDoc(doc(db('eve'), 'players/eve'), pdoc({ joinedSlot: 1 }))],
  // --- Lesen ---
  ['mon9', 'Nicht-Mitglied liest players', X, X, () => getDoc(doc(db('eve'), 'players/alice'))],
  ['mon9', 'Nicht angemeldet liest players', X, X, () => getDoc(doc(db(null), 'players/alice'))],
  ['mon9', 'Mitglied liest fremden Spieler', A, A, () => getDoc(doc(db('bob'), 'players/alice'))],
  ['mon9', 'Mitglied liest fremde kg (private/weights)', X, X, () => getDoc(doc(db('bob'), 'players/alice/private/weights'))],
  ['mon9', 'Mitglied schreibt fremde kg', X, X, () => setDoc(doc(db('bob'), 'players/alice/private/weights'), { slots: { 1: 50 } })],
  ['mon9', 'eigene kg lesen', A, A, () => getDoc(doc(db('alice'), 'players/alice/private/weights'))],
  ['mon9', 'fremde Push-Tokens lesen', X, X, () => getDoc(doc(db('bob'), 'players/alice/private/tokens'))],
  ['mon9', 'eigene Push-Tokens schreiben', A, A, () => setDoc(doc(db('alice'), 'players/alice/private/tokens'), { tokens: { abc: { ts: serverTimestamp(), ua: 'x' } } }, { merge: true })],
  ['mon9', 'reminderRuns schreiben (nur Admin)', X, X, () => setDoc(doc(db('alice'), 'reminderRuns/weigh_2026-11-30'), { at: 1 })],
  ['mon9', 'Nicht-Mitglied liest weighins', X, X, () => getDoc(doc(db('eve'), 'weighins/alice_0'))],
  // --- updatePlayer ---
  ['mon9', 'fremdes Spieler-Dokument ändern', X, X, () => updateDoc(doc(db('bob'), 'players/alice'), { name: 'Hack' })],
  ['mon9', 'lastActive (touch)', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { lastActive: serverTimestamp() })],
  ['mon9', 'onboardingDone true', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { onboardingDone: true })],
  ['mon9', 'onboardingDone "ja"', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { onboardingDone: 'ja' })],
  ['mon9', 'Einladungscode ändern', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { invite: 'neu' })],
  ['mon9', 'Name 21 Zeichen', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { name: 'x'.repeat(21) })],
  ['mon9', 'Name + extraHabits ändern (Profil, Habits gesperrt)', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { name: 'Ali', extraHabits: [hb('Lesen', 3)] })],
  ['mon9', 'Habits ändern außerhalb des Fensters', X, A, () => updateDoc(doc(db('alice'), 'players/alice'), { habits: [hb('a', 1), hb('b', 1), hb('c', 1)], habitSets: { 1: HS, 2: [hb('a', 1), hb('b', 1), hb('c', 1)] } })],
  ['e2tue', 'Habits ändern in Woche 1 der Etappe 2', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { habits: [hb('a', 1), hb('b', 1), hb('c', 1)], habitSets: { 1: HS, 2: [hb('a', 1), hb('b', 1), hb('c', 1)] } })],
  ['pre', 'Habits ändern vor dem Start', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { habits: [hb('a', 1), hb('b', 1), hb('c', 1)], habitSets: { 1: [hb('a', 1), hb('b', 1), hb('c', 1)] } })],
  ['mon20', 'joinedSlot 0 -> 2 nach verpasstem Start (automatisch verschoben)', A, A, async () => { await env.withSecurityRulesDisabled(c => deleteDoc(doc(c.firestore(), 'weighins/alice_0'))); return updateDoc(doc(db('alice'), 'players/alice'), { joinedSlot: 2 }); }],
  ['mon9', 'joinedSlot verringern', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { joinedSlot: 0 - 1 })],
  ['pre', 'joinedSlot vor dem Start auf Slot 1 (App macht das nicht)', X, A, () => updateDoc(doc(db('alice'), 'players/alice'), { joinedSlot: 1 })],
  ['mon9', 'joinedSlot erhöhen NACH dem Startgewicht (früher Lücke)', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { joinedSlot: 20 })],
  // Ziel
  ['pre', 'Ziel ändern vor dem Startgewicht', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { maxLossPct: 8 })],
  ['mon9', 'Ziel ändern nach dem Startgewicht', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { maxLossPct: 8 })],
  ['mon9', 'Ziel nachtragen (Altspieler ohne Ziel) nach dem Start', X, A, () => updateDoc(doc(db('dave'), 'players/dave'), { maxLossPct: 8 })],
  ['mon9', 'Ziel löschen', X, X, async () => { const { deleteField } = await import('firebase/firestore'); return updateDoc(doc(db('alice'), 'players/alice'), { maxLossPct: deleteField() }); }],
  // --- Wiegen ---
  ['mon9', 'Wiegen Slot 1 im Fenster (Mo 9:00)', A, A, () => weighBatch(db('alice'), 'alice', 1, 1.2)],
  ['mon20', 'Wiegen Slot 1 nach 14 Uhr (Mo 20:00)', X, A, () => weighBatch(db('alice'), 'alice', 1, 1.2)],
  ['mon9', 'Wiegen Slot 2 (nächste Woche) vorab', X, A, () => weighBatch(db('alice'), 'alice', 2, 1.2)],
  ['mon9', 'Wiegen für jemand anderen', X, X, () => setDoc(doc(db('alice'), 'weighins/bob_1'), { uid: 'bob', slot: 1, lossPct: 9 })],
  ['mon9', 'Wiegen mit falscher ID', X, X, () => setDoc(doc(db('alice'), 'weighins/alice_5'), { uid: 'alice', slot: 1, lossPct: 1 })],
  ['mon9', 'Wiegen lossPct als Text', X, X, () => setDoc(doc(db('alice'), 'weighins/alice_1'), { uid: 'alice', slot: 1, lossPct: '1' })],
  ['mon9', 'Wiegen als Ausgestiegene', X, X, () => weighBatch(db('carol'), 'carol', 1, 5)],
  ['mon9', 'Wiegen + Ziel im selben Batch nach Startgewicht', X, X, () => weighBatch(db('alice'), 'alice', 1, 1.2, { maxLossPct: 9 })],
  ['pre', 'Startgewicht vor dem Montag', X, A, () => weighBatch(db('alice'), 'alice', 0, 0, { maxLossPct: 7 })],
  ['mon9', 'Slot 0 nachträglich (eine Woche zu spät)', X, A, () => weighBatch(db('alice'), 'alice', 0, 0)],
  // Startgewicht mit Ziel-Neuberechnung im selben Batch (Spieler ohne Startgewicht, Fenster offen)
  ['mon9', 'Startgewicht Slot 1 + maxLossPct im Batch (Spätstarter js=1)', A, A, async () => {
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'players/frank'), pdoc({ name: 'Frank', joinedSlot: 1 })));
    return weighBatch(db('frank'), 'frank', 1, 0, { maxLossPct: 6.3 });
  }],
  ['mon9', 'Startgewicht ohne Ziel (Altspieler js=1)', X, X, async () => {
    const p = pdoc({ name: 'Gina', joinedSlot: 1 }); delete p.maxLossPct;
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'players/gina'), p));
    return weighBatch(db('gina'), 'gina', 1, 0);
  }],
  ['mon9', 'Startgewicht + Ziel im Batch (Altspieler js=1)', A, A, async () => {
    const p = pdoc({ name: 'Gina', joinedSlot: 1 }); delete p.maxLossPct;
    await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'players/gina'), p));
    return weighBatch(db('gina'), 'gina', 1, 0, { maxLossPct: 7 });
  }],
  // --- Ausstieg ---
  ['mon9', 'Ausstieg: Wiegen 4,5 % bei Ziel 5 % (im Band)', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { status: 'finished', finishedWeek: 3, finishedAt: serverTimestamp() })],
  ['mon9', 'Ausstieg: Wiegen 3,5 % bei Ziel 5 % (nicht erreicht)', X, X, () => updateDoc(doc(db('bob'), 'players/bob'), { status: 'finished', finishedWeek: 3, finishedAt: serverTimestamp() })],
  ['mon9', 'Ausstieg mit gefälschtem finishedAt', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { status: 'finished', finishedWeek: 3, finishedAt: Timestamp.fromMillis(1) })],
  ['e2tue', 'Ausstieg mit altem Wiegen (Slot 3, letzter Montag war Slot 4)', X, A, () => updateDoc(doc(db('alice'), 'players/alice'), { status: 'finished', finishedWeek: 3, finishedAt: serverTimestamp() })],
  ['e2tue', 'Ausstieg mit altem Wiegen, Slot 4 pausiert', A, A, async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'players/alice'), { pausedWeeks: [4] })); return updateDoc(doc(db('alice'), 'players/alice'), { status: 'finished', finishedWeek: 3, finishedAt: serverTimestamp() }); }],
  ['mon9', 'Ausstieg mit nicht gewogener Woche', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { status: 'finished', finishedWeek: 7, finishedAt: serverTimestamp() })],
  ['mon9', 'Ausstieg rückgängig machen', X, X, async () => { const { deleteField } = await import('firebase/firestore'); return updateDoc(doc(db('carol'), 'players/carol'), { status: deleteField() }); }],
  ['mon9', 'Ausgestiegene ändert Namen', A, A, () => updateDoc(doc(db('carol'), 'players/carol'), { name: 'Caro' })],
  ['mon9', 'Ausgestiegene pausiert', X, X, () => updateDoc(doc(db('carol'), 'players/carol'), { pausedWeeks: [3] })],
  // --- Pause ---
  ['mon9', 'Pause laufende Woche 2 (bis Mi)', A, A, () => updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [2] })],
  ['mon9', 'Pause vergangene Woche 1', X, A, () => updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [1] })],
  ['mon9', 'Pause 2 Wochen auf einmal', X, X, () => updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [3, 4] })],
  ['mon9', 'Pause dritte Woche', X, X, async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'players/alice'), { pausedWeeks: [3, 4] })); return updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [3, 4, 5] }); }],
  ['mon9', 'Pause Woche 2 zurücknehmen (hat begonnen)', X, A, async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'players/alice'), { pausedWeeks: [2] })); return updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [] }); }],
  ['mon9', 'Pause Woche 3 zurücknehmen (noch nicht begonnen)', A, A, async () => { await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'players/alice'), { pausedWeeks: [3] })); return updateDoc(doc(db('alice'), 'players/alice'), { pausedWeeks: [] }); }],
  // --- Habits abhaken (Tag 7 = heute) ---
  ['mon9', 'Haken heute', A, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_7'), { uid: 'alice', day: 7, done: [true, false, false, false], ts: serverTimestamp() })],
  ['mon9', 'Haken mit Extras', A, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_7'), { uid: 'alice', day: 7, done: [true, false, false], extra: [true, false, true], ts: serverTimestamp() })],
  ['mon9', 'Haken gestern (Tag 6, Vorwoche) vor 14 Uhr', A, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_6'), { uid: 'alice', day: 6, done: [true, false, false, false] })],
  ['mon20', 'Haken gestern (Tag 6, Vorwoche) nach 14 Uhr', X, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_6'), { uid: 'alice', day: 6, done: [true, false, false, false] })],
  ['mon20', 'Haken heute (Tag 7) nach 14 Uhr', A, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_7'), { uid: 'alice', day: 7, done: [true, false, false, false] })],
  ['mon9', 'Haken 2 Tage zurück (Tag 5)', A, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_5'), { uid: 'alice', day: 5, done: [true, false, false, false] })],
  ['mon9', 'Haken 3 Tage zurück (Tag 4)', X, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_4'), { uid: 'alice', day: 4, done: [true, false, false, false] })],
  ['mon9', 'Haken morgen (Tag 8)', X, A, () => setDoc(doc(db('alice'), 'habitlogs/alice_8'), { uid: 'alice', day: 8, done: [true, false, false, false] })],
  ['mon9', 'Haken für jemand anderen', X, X, () => setDoc(doc(db('alice'), 'habitlogs/bob_7'), { uid: 'bob', day: 7, done: [true, true, true, true] })],
  ['mon9', 'Haken: done mit 5 Einträgen', X, X, () => setDoc(doc(db('alice'), 'habitlogs/alice_7'), { uid: 'alice', day: 7, done: [true, true, true, true, true] })],
  ['mon9', 'Haken: 6 Extras', X, X, () => setDoc(doc(db('alice'), 'habitlogs/alice_7'), { uid: 'alice', day: 7, done: [true, true, true], extra: Array(6).fill(true) })],
  ['mon9', 'Haken als Ausgestiegene', X, X, () => setDoc(doc(db('carol'), 'habitlogs/carol_7'), { uid: 'carol', day: 7, done: [true, true, true, true] })],
  // --- Bestätigen (habitok) ---
  ['mon9', 'Bob bestätigt Alice (Tag 7)', A, A, () => setDoc(doc(db('bob'), 'habitok/alice_7_0'), { uid: 'alice', day: 7, h: '0', by: 'bob', byName: 'Bob', ts: serverTimestamp() })],
  ['mon9', 'Bob bestätigt Alice Tag 6 (gestern, Vorwoche, vor 14 Uhr)', A, A, () => setDoc(doc(db('bob'), 'habitok/alice_6_1'), { uid: 'alice', day: 6, h: '1', by: 'bob', byName: 'Bob' })],
  ['mon20', 'Bob bestätigt Alice Tag 6 (Vorwoche) nach 14 Uhr', X, A, () => setDoc(doc(db('bob'), 'habitok/alice_6_1'), { uid: 'alice', day: 6, h: '1', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Bob bestätigt Alice Tag 4 (3 Tage her, Fenster 2 Tage)', X, A, () => setDoc(doc(db('bob'), 'habitok/alice_4_x1'), { uid: 'alice', day: 4, h: 'x1', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Bob bestätigt Alice Tag 2 (5 Tage her)', X, A, () => setDoc(doc(db('bob'), 'habitok/alice_2_0'), { uid: 'alice', day: 2, h: '0', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Alice bestätigt sich selbst', X, X, () => setDoc(doc(db('alice'), 'habitok/alice_7_0'), { uid: 'alice', day: 7, h: '0', by: 'alice', byName: 'Alice' })],
  ['mon9', 'Alice bestätigt sich mit by = bob', X, X, () => setDoc(doc(db('alice'), 'habitok/alice_7_0'), { uid: 'alice', day: 7, h: '0', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Bestätigung mit ungültigem Schlüssel h=3 (Challenge)', X, X, () => setDoc(doc(db('bob'), 'habitok/alice_7_3'), { uid: 'alice', day: 7, h: '3', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Bestätigung für Nicht-Spieler', X, X, () => setDoc(doc(db('bob'), 'habitok/ghost_7_0'), { uid: 'ghost', day: 7, h: '0', by: 'bob', byName: 'Bob' })],
  ['mon9', 'Bestätigung mit HTML in byName (früher Lücke)', X, X, () => setDoc(doc(db('bob'), 'habitok/alice_7_1'), { uid: 'alice', day: 7, h: '1', by: 'bob', byName: '"><img src=x onerror=alert(1)>' })],
  ['mon9', 'Bestätigung als Ausgestiegene (Carol)', X, X, () => setDoc(doc(db('carol'), 'habitok/alice_7_0'), { uid: 'alice', day: 7, h: '0', by: 'carol', byName: 'Carol' })],
  ['mon9', 'Bestätiger nimmt Bestätigung zurück (Tag 6, Vorwoche, vor 14 Uhr)', A, A, () => deleteDoc(doc(db('bob'), 'habitok/alice_6_0'))],
  ['mon20', 'Bestätiger nimmt Bestätigung zurück (Tag 6, Vorwoche, nach 14 Uhr)', X, A, () => deleteDoc(doc(db('bob'), 'habitok/alice_6_0'))],
  ['mon9', 'Alice löscht Bestätigung von Bob', X, X, () => deleteDoc(doc(db('alice'), 'habitok/alice_6_0'))],
  ['e2tue', 'Bestätiger nimmt Bestätigung nach Wochen zurück (Tag 6, jetzt Tag 29) (früher Lücke)', X, A, () => deleteDoc(doc(db('bob'), 'habitok/alice_6_0'))],
  // --- Wochen-Challenge ---
  ['mon9', 'Challenge Woche 2 vor dem Wiegeschluss (App erlaubt es nicht)', X, A, () => setDoc(doc(db('alice'), 'weekly/2'), { text: 'Treppe', kind: 'daily', target: 7, setBy: 'alice', setByName: 'Alice', ts: serverTimestamp() })],
  ['mon20', 'Challenge Woche 2 nach dem Wiegen', A, A, () => setDoc(doc(db('alice'), 'weekly/2'), { text: 'Treppe', kind: 'daily', target: 7, setBy: 'alice', setByName: 'Alice', ts: serverTimestamp() })],
  ['mon9', 'Challenge überschreiben', X, X, () => setDoc(doc(db('alice'), 'weekly/1'), { text: 'Neu', kind: 'daily', target: 7, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Challenge target 8', X, X, () => setDoc(doc(db('alice'), 'weekly/2'), { text: 'x', kind: 'count', target: 8, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Challenge für Woche 20 vorab festlegen (früher Lücke)', X, A, () => setDoc(doc(db('alice'), 'weekly/20'), { text: 'x', kind: 'daily', target: 7, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Challenge als Ausgestiegene', X, X, () => setDoc(doc(db('carol'), 'weekly/2'), { text: 'x', kind: 'daily', target: 7, setBy: 'carol', setByName: 'Carol' })],
  ['mon9', 'weeklyDone eigener Eintrag (von der App nicht benutzt)', A, A, () => setDoc(doc(db('alice'), 'weeklyDone/alice_2'), { uid: 'alice', week: 2 })],
  // --- Aufgaben ---
  ['mon9', 'eigene Aufgabe direkt nach dem Stellen löschen', A, A, async () => { await setDoc(doc(db('alice'), 'tasks/e1_alice'), { etappe: 1, text: 'x', createdBy: 'alice', createdByName: 'Alice', ts: serverTimestamp() }); return deleteDoc(doc(db('alice'), 'tasks/e1_alice')); }],
  ['mon9', 'Aufgabe stellen (eigene ID)', A, A, () => setDoc(doc(db('alice'), 'tasks/e1_alice'), { etappe: 1, text: '1 h schwimmen', createdBy: 'alice', createdByName: 'Alice', ts: serverTimestamp() })],
  ['mon9', 'Aufgabe mit fremder ID', X, X, () => setDoc(doc(db('alice'), 'tasks/e1_bob2'), { etappe: 1, text: 'x', createdBy: 'alice', createdByName: 'Alice' })],
  ['mon9', 'Aufgabe für Etappe 6 vorab (früher Lücke)', X, A, () => setDoc(doc(db('alice'), 'tasks/e6_alice'), { etappe: 6, text: 'x', createdBy: 'alice', createdByName: 'Alice' })],
  ['mon9', 'fremde Aufgabe löschen', X, X, () => deleteDoc(doc(db('alice'), 'tasks/e1_bob'))],
  ['mon9', 'eigene Aufgabe löschen, obwohl Alice sie schon gemacht hat (früher Lücke)', X, A, () => deleteDoc(doc(db('bob'), 'tasks/e1_bob'))],
  ['mon9', 'Aufgabe als erledigt melden', A, A, () => setDoc(doc(db('bob'), 'taskDone/e1_bob_bob'), { uid: 'bob', taskId: 'e1_bob', confirmedBy: null, confirmedByName: null, ts: serverTimestamp() })],
  ['mon9', 'Aufgabe gleich bestätigt melden', X, X, () => setDoc(doc(db('bob'), 'taskDone/e1_bob_bob'), { uid: 'bob', taskId: 'e1_bob', confirmedBy: 'bob' })],
  ['mon9', 'eigene Aufgabe selbst bestätigen', X, X, () => updateDoc(doc(db('alice'), 'taskDone/e1_bob_alice'), { confirmedBy: 'alice', confirmedByName: 'Alice', confirmedAt: serverTimestamp() })],
  ['mon9', 'Bob bestätigt Alice (mit confirmedAt)', A, A, () => updateDoc(doc(db('bob'), 'taskDone/e1_bob_alice'), { confirmedBy: 'bob', confirmedByName: 'Bob', confirmedAt: serverTimestamp() })],
  ['mon9', 'Bob bestätigt mit falschem confirmedAt', X, X, () => updateDoc(doc(db('bob'), 'taskDone/e1_bob_alice'), { confirmedBy: 'bob', confirmedByName: 'Bob', confirmedAt: Timestamp.fromMillis(1) })],
  ['mon9', 'Bob bestätigt im Namen von Dave', X, X, () => updateDoc(doc(db('bob'), 'taskDone/e1_bob_alice'), { confirmedBy: 'dave', confirmedByName: 'Dave' })],
  ['e2tue', 'Aufgabe für Etappe 1 erst in Etappe 2 erledigt melden (früher Lücke)', X, A, () => setDoc(doc(db('bob'), 'taskDone/e1_bob_bob'), { uid: 'bob', taskId: 'e1_bob', confirmedBy: null })],
  // --- Team-Monat ---
  ['mon9', 'Vorschlag Etappe 2 (Fenster offen)', A, A, () => setDoc(doc(db('alice'), 'teamideas/e2_alice'), { text: 'Schritte', kind: 'sum', per: 8000, period: 'day', unit: 'Schritte', etappe: 2, setBy: 'alice', setByName: 'Alice', ts: serverTimestamp() })],
  ['mon9', 'Vorschlag Etappe 1 nach der Ziehung', X, A, () => setDoc(doc(db('alice'), 'teamideas/e1_alice'), { text: 'x', kind: 'count', per: 3, period: 'week', unit: '', etappe: 1, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Vorschlag Etappe 3 zu früh', X, A, () => setDoc(doc(db('alice'), 'teamideas/e3_alice'), { text: 'x', kind: 'count', per: 3, period: 'week', unit: '', etappe: 3, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Vorschlag per 0', X, X, () => setDoc(doc(db('alice'), 'teamideas/e2_alice'), { text: 'x', kind: 'sum', per: 0, period: 'day', unit: '', etappe: 2, setBy: 'alice', setByName: 'Alice' })],
  ['mon9', 'Team-Beitrag heute (Tag 7, Etappe 1)', A, A, () => setDoc(doc(db('alice'), 'teamlogs/alice_7'), { uid: 'alice', day: 7, etappe: 1, vals: { e1_bob: 1 } })],
  ['mon9', 'Team-Beitrag mit falscher Etappe', X, X, () => setDoc(doc(db('alice'), 'teamlogs/alice_7'), { uid: 'alice', day: 7, etappe: 2, vals: { e1_bob: 1 } })],
  ['mon9', 'Team-Beitrag mit 4 Werten', X, X, () => setDoc(doc(db('alice'), 'teamlogs/alice_7'), { uid: 'alice', day: 7, etappe: 1, vals: { a: 1, b: 1, c: 1, d: 1 } })],
  ['mon9', 'Team-Beitrag 5 Tage zurück', X, A, () => setDoc(doc(db('alice'), 'teamlogs/alice_2'), { uid: 'alice', day: 2, etappe: 1, vals: { e1_bob: 1 } })],
];

const ONLY = process.env.ONLY;
const rows = [];
for (const tm of [false, true]) {
  for (const [sc, label, expF, expT, fn] of T) {
    if (ONLY && !label.includes(ONLY)) continue;
    const s = SC[sc];
    await loadRules(variant(tm, Date.now() - s.off));
    await seed(s.started !== false);
    let ok, err = '';
    try { await fn(); ok = true; } catch (e) { ok = false; err = e.code || e.message; if (!/permission|PERMISSION/.test(String(err))) err = 'ANDERER FEHLER: ' + err; }
    const exp = tm ? expT : expF;
    rows.push({ tm, sc: s.label, label, ok, exp, err });
  }
}
let bad = 0;
for (const tm of [false, true]) {
  console.log(`\n=== TESTMODE() ${tm} ===`);
  for (const r of rows.filter(r => r.tm === tm)) {
    const pass = r.ok === r.exp; if (!pass) bad++;
    console.log(`${pass ? 'ok  ' : 'ABW '} ${r.ok ? 'erlaubt ' : 'verboten'} | ${r.label}  [${r.sc}]${pass ? '' : `  <- erwartet ${r.exp ? 'erlaubt' : 'verboten'}`}${r.err && r.err.startsWith('ANDERER') ? '  ' + r.err : ''}`);
  }
}
console.log(`\n${rows.length - bad} wie erwartet, ${bad} Abweichungen`);
await env.cleanup();
process.exit(bad ? 1 : 0);
