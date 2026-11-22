// Punkte- und Geldlogik aus app.js mit konstruierten Daten nachrechnen: compute(), fees(), pot(), rankWeek(), weekLosers(),
// streakOf(), teamMonth(), canExit(), weekFinal()/dayOpen(). Ohne Browser, ohne Firebase.
//   cd tests && npm run logic        (= TZ=Europe/Berlin node logic.test.mjs)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Logik-Teil von app.js (bis "DATENSCHICHT") als eigenes Modul laden
const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const logic = src.slice(0, src.indexOf('/* =====================================================================\n   DATENSCHICHT')) + '\n' + src.match(/^function rng\(seed\).*$/m)[0];
const gen = fileURLToPath(new URL('./.logic.gen.mjs', import.meta.url));
writeFileSync(gen, `globalThis.location ??= { search: '' };
${logic}
let S = { habitok: {}, teamideas: {}, member: true, me: 'a' };
export const setS = s => { S = s; };
export const setNow = t => { NOW_OVERRIDE = t ? new Date(t).getTime() : null; };
export { CONFIG, compute, fees, pot, rankWeek, rankTotal, rankEtappe, weekLosers, weekFinal, dayOpen, canExit, exitSlot, challengePoints, habitPts, teamMonth, seasonOver };
`);
const L = await import(pathToFileURL(gen).href);
rmSync(gen);
const { compute, fees, pot, rankWeek, rankTotal, rankEtappe, weekLosers, setS, setNow, weekFinal, dayOpen, canExit, exitSlot } = L;
if (process.env.TZ !== 'Europe/Berlin') console.log('Hinweis: mit TZ=Europe/Berlin starten (npm run logic), sonst stimmen die Uhrzeiten nicht.');

let fails = 0, oks = 0;
const eq = (label, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { oks++; console.log('  ok   ', label); } else { fails++; console.log('  FAIL ', label, '\n        erwartet', e, '\n        bekommen', g); }
};
const note = (label, v) => console.log('  info ', label, JSON.stringify(v));

// Zeit: Tag d (0 = Mo 23.11.2026) um h Uhr Ortszeit
const at = (d, h = 12, m = 0) => { const x = new Date(2026, 10, 23 + d); x.setHours(h, m); return x; };

function world() {
  const S = { players: {}, weighins: {}, habitlogs: {}, weekly: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, habitok: {}, member: true, me: 'a' };
  let n = 0;
  const api = {
    S,
    player(uid, o = {}) { S.players[uid] = { name: o.name || uid.toUpperCase(), habits: o.habits || [{ name: 'H1', target: 7 }, { name: 'H2', target: 3 }, { name: 'H3', target: 1 }], joinedSlot: o.js ?? 0, joinedAt: ++n, ...o }; delete S.players[uid].js; return api; },
    weigh(uid, slot, lossPct) { S.weighins[uid + '_' + slot] = { uid, slot, lossPct }; return api; },
    day(uid, d, done) { S.habitlogs[uid + '_' + d] = { uid, day: d, done }; return api; },
    // Woche w: die ersten n[i] Tage für Habit i abhaken, ch = Challenge-Tage
    week(uid, w, n, ch = 0) { for (let i = 0; i < 7; i++) { const d = 7 * (w - 1) + i; const done = [i < n[0], i < n[1], i < n[2], i < ch]; if (done.some(Boolean)) api.day(uid, d, done); } return api; },
    ok(uid, d, k, by = 'z') { S.habitok[`${uid}_${d}_${k}`] = { uid, day: d, h: k, by }; return api; },
    run(t) { setNow(t); setS(S); return compute(S); },
  };
  return api;
}
const W = w => ({ weigh: w.weigh, habits: w.habits, weekly: w.weekly, total: w.total, met: w.met });

console.log('\n1) Waage-Punkte gegen den bisherigen Tiefstwert, max. 30');
{
  const t = world().player('a').player('b');
  t.weigh('a', 0, 0).weigh('a', 1, 0.5).weigh('a', 2, 0.3).weigh('a', 3, 0.9).weigh('a', 4, 2.5).weigh('a', 5, 2.52);
  t.weigh('b', 0, 0);
  const C = t.run(at(35, 15)); // Mo Woche 6, nach 14 Uhr
  eq('W1 0,5 % -> 15', C.a.weeks[1].weigh, 15);
  eq('W2 zugenommen -> 0', C.a.weeks[2].weigh, 0);
  eq('W3 0,9 % (Tiefstwert 0,5) -> 4 Zehntel = 12', C.a.weeks[3].weigh, 12);
  eq('W4 +1,6 % -> gedeckelt 30', C.a.weeks[4].weigh, 30);
  eq('W5 +0,02 % -> 0', C.a.weeks[5].weigh, 0);
  eq('b verpasst 1–5 -> 5× Strafe', fees(C.b, null).missed, 5);
}

console.log('\n2) Habits: Wochenziel, anteilige Punkte, Bestätigung, Extras ohne Punkte');
{
  const t = world().player('a', { habits: [{ name: 'H1', target: 7 }, { name: 'H2', target: 3, confirm: true }, { name: 'H3', target: 1 }], extraHabits: [{ name: 'X', target: 2 }] });
  t.weigh('a', 0, 0);
  t.week('a', 1, [7, 3, 1]);               // H2 nicht bestätigt
  t.ok('a', 0, '1').ok('a', 1, '1');       // 2 von 3 bestätigt
  t.week('a', 2, [5, 2, 0]); t.ok('a', 7, '1').ok('a', 8, '1');
  t.S.habitlogs['a_14'] = { uid: 'a', day: 14, done: [false, false, false], extra: [true, true] }; // nur Extras
  const C = t.run(at(24, 12));
  eq('W1: H1 7/7=4, H2 2/3 bestätigt=3, H3 1/1=4 -> 11', C.a.weeks[1].habits, 11);
  eq('W1 nicht geschafft (H2 wartet)', C.a.weeks[1].met, false);
  eq('W2: 5/7=3, 2/3=3, 0/1=0 -> 6', C.a.weeks[2].habits, 6);
  eq('W3: nur Extras -> 0 Punkte', C.a.weeks[3].habits, 0);
  eq('Habit-Strafen W1..W3 (Tag 24 = Do W4: W3 endgültig)', C.a.missedHabitWeeks, [1, 2, 3]);
  eq('habitPts: 1/7=1, 2/7=1, 3/7=2, 5/7=3, 7/7=4, 2/3=3, 1/2=2', [L.habitPts(1, 7), L.habitPts(2, 7), L.habitPts(3, 7), L.habitPts(5, 7), L.habitPts(7, 7), L.habitPts(2, 3), L.habitPts(1, 2)], [1, 1, 2, 3, 4, 3, 2]);
}

console.log('\n3) Haltephase: volle Waage nur im Band, Habits bleiben Pflicht');
{
  const t = world().player('a', { maxLossPct: 5 }).player('b');
  [0, 1, 2, 3, 4, 5.2, 4.1, 3.9, 6].forEach((v, k) => t.weigh('a', k, v));
  for (let k = 0; k <= 8; k++) t.weigh('b', k, k * 0.1);
  for (let w = 1; w <= 8; w++) t.week('a', w, w === 6 ? [0, 0, 0] : [7, 3, 1]);
  const C = t.run(at(7 * 8 + 3, 12));
  eq('goalWeek = 5', C.a.goalWeek, 5);
  eq('W5 (Ziel erreicht, noch normal): 5,2−4 = 1,2 % -> 30', C.a.weeks[5].weigh, 30);
  eq('W6 4,1 % (>= 5−1) -> 30', C.a.weeks[6].weigh, 30);
  eq('W7 3,9 % (< 4) -> 0', C.a.weeks[7].weigh, 0);
  eq('W8 6 % -> 30', C.a.weeks[8].weigh, 30);
  eq('W6 Habits verfehlt -> Strafe trotz Haltephase', C.a.missedHabitWeeks, [6]);
  eq('kein Bonus', Object.values(C.a.weeks).reduce((s, w) => s + w.bonus, 0), 0);
  eq('Haltephase aktiv', C.a.hold, true);
}

console.log('\n4) Pause: keine Punkte/Strafen, Wiegen in der Pause zählt nicht zum Tiefstwert');
{
  const t = world().player('a', { pausedWeeks: [2] }).player('b');
  t.weigh('a', 0, 0).weigh('a', 1, 1.0).weigh('a', 2, 3.0).weigh('a', 3, 1.5);
  for (let k = 0; k <= 3; k++) t.weigh('b', k, 0);
  t.week('a', 1, [7, 3, 1]); t.week('a', 3, [7, 3, 1]); t.week('a', 4, [7, 3, 1]); t.week('b', 4, [7, 3, 1]); t.week('b', 1, [7, 3, 1]); t.week('b', 2, [7, 3, 1]); t.week('b', 3, [7, 3, 1]);
  const C = t.run(at(7 * 4 + 3, 12));
  eq('W2 pausiert, 0 Punkte', [C.a.weeks[2].paused, C.a.weeks[2].total], [true, 0]);
  eq('W3 1,5 % gegen Tiefstwert 1,0 -> 15', C.a.weeks[3].weigh, 15);
  eq('keine Habit-Strafe für W2', C.a.missedHabitWeeks, []);
  eq('nicht im Wochenranking W2', rankWeek(C, 2).map(x => x.uid), ['b']);
  eq('W2: nur 1 Spieler -> kein Wochenletzter', weekLosers(C, 2), []);
  eq('Streak läuft über Pause weiter', C.a.streak.cur, 3);
}

console.log('\n5) Wochenletzter: nur wenn nicht alle gleich; Gleichstand; Strafen in fees/pot');
{
  const t = world().player('a').player('b').player('c');
  for (const u of ['a', 'b', 'c']) { t.weigh(u, 0, 0).weigh(u, 1, 0.5); t.week(u, 1, [7, 3, 1]); }
  t.weigh('a', 2, 1.0).weigh('b', 2, 1.0).weigh('c', 2, 0.6); for (const u of ['a', 'b', 'c']) t.week(u, 2, [7, 3, 1]);
  const C = t.run(at(14 + 3, 12));
  eq('W1 alle gleich -> kein Letzter', weekLosers(C, 1), []);
  eq('W2 c Letzter', weekLosers(C, 2), ['c']);
  eq('c zahlt 20 + 0,5', fees(C.c, null).total, 20.5);
  eq('Topf 60,5', pot(C).total, 60.5);
}

console.log('\n6) Spätstarter: Einsatz in seiner Etappe, keine Strafen vor dem Start');
{
  const t = world().player('a').player('c', { js: 5 });
  for (let k = 0; k <= 7; k++) t.weigh('a', k, k * 0.3);
  t.weigh('c', 5, 0).weigh('c', 7, 1);
  const C = t.run(at(7 * 7 + 3, 12));
  eq('c: Einsatz in Etappe 2', [fees(C.c, 1).einsatz, fees(C.c, 2).einsatz], [0, 20]);
  eq('c: Woche 6 verpasst', C.c.missedSlots, [6]);
  eq('c im Ranking Etappe 1? (js 5 < Etappenende 4? nein)', rankEtappe(C, 1).map(x => x.uid), ['a']);
}

console.log('\n7) Ausstieg nur mit dem aktuellen Wiegen (sonst fielen spätere Strafen weg)');
{
  const mk = fin => { const t = world().player('a', { maxLossPct: 3, ...(fin ? { status: 'finished', finishedWeek: 3, finishedAt: 1 } : {}) }).player('b');
    t.weigh('a', 0, 0).weigh('a', 1, 1).weigh('a', 2, 2).weigh('a', 3, 3.1); // 4 und 5 verpasst
    for (let k = 0; k <= 5; k++) t.weigh('b', k, k * 0.2);
    for (let w = 1; w <= 5; w++) { t.week('a', w, w <= 3 ? [7, 3, 1] : [0, 0, 0]); t.week('b', w, [7, 3, 1]); }
    return t.run(at(7 * 6 + 1, 9)); }; // Di Woche 7 (Slot 6 Mo vorbei)
  const before = mk(false);
  eq('Strafen bis jetzt (3× Wiegen, 3× Habits, 2× Letzter)', fees(before.a, null).strafen, 19);
  eq('Aussteigen mit altem Wiegen (W3) nicht möglich', canExit(before.a), false);
  // mit aktuellem Wiegen geht es
  const t = world().player('a', { maxLossPct: 3 }).player('b');
  [0, 1, 2, 3.1, 3.0, 2.5].forEach((v, k) => t.weigh('a', k, v)); for (let k = 0; k <= 5; k++) t.weigh('b', k, 0);
  eq('Di: letztes Wiegen = letzter Montag, im Band -> geht', canExit(t.run(at(7 * 5 + 1, 9)).a), true);
  eq('Mo 9 Uhr, heute noch nicht gewogen -> erst wiegen', canExit(t.run(at(7 * 6, 9)).a), false);
  t.weigh('a', 6, 2.4);
  eq('Mo 9 Uhr, heute gewogen -> geht, finishedWeek = 6', [canExit(t.run(at(7 * 6, 9)).a), exitSlot(t.run(at(7 * 6, 9)).a)], [true, 6]);
  const p = world().player('a', { maxLossPct: 3, pausedWeeks: [6] }).player('b');
  [0, 1, 2, 3.1, 3.0, 2.5].forEach((v, k) => p.weigh('a', k, v)); for (let k = 0; k <= 6; k++) p.weigh('b', k, 0);
  eq('letzter Montag pausiert -> Wiegen davor zählt als aktuell', exitSlot(p.run(at(7 * 6 + 2, 9)).a), 5);
}

console.log('\n8) Ausstieg am letzten Montag (fw = 24): Gesamtwertung?');
{
  const t = world().player('a', { maxLossPct: 3, status: 'finished', finishedWeek: 24, finishedAt: 1 }).player('b');
  for (let k = 0; k <= 24; k++) { t.weigh('a', k, Math.min(4, k * 0.5)); t.weigh('b', k, k * 0.05); }
  const C = t.run(at(168, 15));
  eq('ausgestiegene a nicht in der Gesamtwertung', rankTotal(C).map(x => x.uid), ['b']);
  eq('Einsatz zurück für a', fees(C.a, null).refund, 20);
}

console.log('\n9) Vorwoche nur bis Montag 14 Uhr nachtragen/bestätigen, danach steht die Woche fest');
{
  world().run(at(7, 9));   // Mo 9 Uhr
  eq('Mo 9 Uhr: Sonntag und Samstag der Vorwoche offen, Freitag nicht (2 Tage)', [dayOpen(6), dayOpen(5), dayOpen(4)], [true, true, false]);
  eq('Mo 9 Uhr: Woche 1 noch nicht abgeschlossen', weekFinal(1), false);
  world().run(at(7, 15));  // Mo 15 Uhr
  eq('Mo 15 Uhr: Vorwoche zu, heute offen', [dayOpen(6), dayOpen(5), dayOpen(7)], [false, false, true]);
  eq('Mo 15 Uhr: Woche 1 abgeschlossen', weekFinal(1), true);
  world().run(at(9, 12));  // Mi
  eq('Mi: Mo und Di offen, So der Vorwoche zu', [dayOpen(7), dayOpen(8), dayOpen(9), dayOpen(6)], [true, true, true, false]);
  eq('Zukunft nie offen', dayOpen(10), false);
}

console.log('\n10) Unbestätigter Haken: Strafe ab Montag 14 Uhr');
{
  const t = world().player('a', { habits: [{ name: 'H1', target: 1, confirm: true }, { name: 'H2', target: 1 }, { name: 'H3', target: 1 }] }).player('b');
  t.weigh('a', 0, 0); t.weigh('b', 0, 0);
  t.day('a', 6, [true, true, true, false]); // So W1, wartet auf Bestätigung
  eq('Mo 9 Uhr: noch keine Strafe (Bestätigung geht noch)', t.run(at(7, 9)).a.missedHabitWeeks, []);
  eq('Mo 15 Uhr: unbestätigt -> Strafe', t.run(at(7, 15)).a.missedHabitWeeks, [1]);
  t.ok('a', 6, '0');
  eq('vor 14 Uhr bestätigt -> keine Strafe', t.run(at(7, 15)).a.missedHabitWeeks, []);
}

console.log('\n11) Letzte Woche der Saison: mit dem Saisonende (Mo 14 Uhr) endgültig');
{
  const t = world().player('a').player('b');
  for (let k = 0; k <= 24; k++) { t.weigh('a', k, k * 0.1); t.weigh('b', k, k * 0.1); }
  for (let w = 1; w <= 23; w++) { t.week('a', w, [7, 3, 1]); t.week('b', w, [7, 3, 1]); }
  t.week('b', 24, [7, 3, 1]); // a schafft W24 nicht
  const C1 = t.run(at(168, 15));
  eq('Mo 10.5. 15 Uhr: Saison vorbei, Strafe W24 steht schon fest', [L.seasonOver(), C1.a.missedHabitWeeks], [true, [24]]);
  eq('Mo 10.5. 15 Uhr: So 9.5. nicht mehr nachtragbar', dayOpen(167), false);
}

console.log('\n12) Streak + Joker');
{
  const t = world().player('a').player('b');
  for (let k = 0; k <= 9; k++) { t.weigh('a', k, 0); t.weigh('b', k, 0); }
  const met = [1, 1, 0, 1, 0, 1, 1, 1, 0, 1]; // W3 verpasst (Joker E1), W5 verpasst (Joker E2), W9 verpasst (Joker E3)
  met.forEach((m, i) => t.week('a', i + 1, m ? [7, 3, 1] : [0, 0, 0]));
  const C = t.run(at(7 * 10 + 3, 12));
  eq('W3 + W5 + W9 je durch Joker gerettet -> 7 Wochen am Stück', C.a.streak.cur, 7);
}

console.log('\n13) Challenge-Punkte');
{
  const ch = (k, t) => ({ kind: k, target: t });
  eq('täglich 3 Tage -> 3', L.challengePoints(ch('daily'), 3), 3);
  eq('täglich 7 Tage -> 4', L.challengePoints(ch('daily'), 7), 4);
  eq('1× -> 4', L.challengePoints(ch('count', 1), 3), 4);
  eq('2×, 1 Mal -> 2', L.challengePoints(ch('count', 2), 1), 2);
}

console.log('\n14) Team-Monat');
{
  const t = world().player('a').player('b', { pausedWeeks: [2] });
  for (let k = 0; k <= 5; k++) { t.weigh('a', k, 0); t.weigh('b', k, 0); }
  t.S.teamideas = { e1_a: { etappe: 1, text: 'Sport', kind: 'count', per: 2, period: 'week', unit: '', setBy: 'a', setByName: 'A' } };
  for (let d = 0; d < 28; d++) if (d % 3 === 0) t.S.teamlogs['a_' + d] = { uid: 'a', day: d, etappe: 1, vals: { e1_a: 1 } };
  for (let d = 0; d < 28; d++) if (d % 4 === 0) t.S.teamlogs['b_' + d] = { uid: 'b', day: d, etappe: 1, vals: { e1_a: 1 } };
  t.run(at(29, 12));
  const tm = L.teamMonth(t.S, compute(t.S), 1);
  eq('Spielerwochen (a 4 + b 3, Pause zählt nicht)', tm.pw, 7);
  eq('Ziel 2 × 7 = 14', tm.items[0].target, 14);
  eq('Summe der Haken (a 10 + b 7)', tm.items[0].sum, 17);
  eq('Ziel erreicht', tm.items[0].reached, true);
}

console.log(`\n${oks} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
