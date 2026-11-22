// reminders/send.mjs gegen den Firestore-Emulator mit gestellter Uhr: wer bekommt wann welche Erinnerung?
//   cd tests && npm run reminders     (braucht vorher einmal: cd reminders && npm install)
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Nur mit Emulator: npm run reminders'); process.exit(1); }
const SEND = fileURLToPath(new URL('../reminders/send.mjs', import.meta.url));
const FAKE = fileURLToPath(new URL('./fakedate.mjs', import.meta.url));
if (!existsSync(new URL('../reminders/node_modules/firebase-admin', import.meta.url))) { console.error('Erst: cd reminders && npm install'); process.exit(1); }

initializeApp({ projectId: 'demo-fettsaecke' });
const db = getFirestore();
async function seed() {
  for (const c of await db.listCollections()) await db.recursiveDelete(c);
  const hb = (n, t, confirm = false) => ({ name: n, target: t, confirm });
  const HS = [hb('Kochen', 4), hb('Softdrinks', 7), hb('Laufen', 1)];
  const P = {
    alice: { name: 'Alice Muster' }, bob: { name: 'Bob' }, carol: { name: 'Carol', status: 'finished', finishedWeek: 0 },
    dave: { name: 'Dave', pausedWeeks: [1] }, paula: { name: 'Paula', pausedWeeks: [2] }, erin: { name: 'Erin', joinedSlot: 1, extraHabits: [hb('Lesen', 3)] },
    fritz: { name: 'Fritz' }, gina: { name: 'Gina', maxLossPct: 1 }, harald: { name: 'Harald', habits: [hb('Kochen', 1, true), hb('Softdrinks', 7), hb('Laufen', 1)] },
  };
  for (const [u, o] of Object.entries(P)) await db.doc('players/' + u).set({ habits: HS, habitSets: { 1: o.habits || HS }, joinedSlot: 0, maxLossPct: 5, ...o });
  for (const u of ['alice', 'bob', 'carol', 'dave', 'paula', 'gina', 'harald']) await db.doc(`weighins/${u}_0`).set({ uid: u, slot: 0, lossPct: 0 });
  await db.doc('weighins/bob_1').set({ uid: 'bob', slot: 1, lossPct: 1 });
  await db.doc('weighins/gina_1').set({ uid: 'gina', slot: 1, lossPct: 1.5 }); // Ziel erreicht -> Haltephase
  await db.doc('weighins/erin_1').set({ uid: 'erin', slot: 1, lossPct: 0 });
  // Woche 2 = Tage 7..13, Mittwoch = Tag 9
  const log = (u, d, done, extra) => db.doc(`habitlogs/${u}_${d}`).set({ uid: u, day: d, done, ...(extra ? { extra } : {}) });
  await log('alice', 7, [true, true, false, false]); await log('alice', 8, [true, true, false, false]); await log('alice', 9, [false, true, false, false]);
  for (let d = 7; d <= 9; d++) await log('bob', d, [true, true, d === 7, false]);
  await log('bob', 10, [true, true, false, false]);
  await log('erin', 9, [false, false, false], [true]);
  await log('harald', 7, [true, false, false, false]);
  for (let d = 7; d <= 13; d++) await log('gina', d, [d < 9, d < 9, false, false]);
}
// send.mjs zu einer festen Zeit; Ergebnis: { text, to: { uid: 'Titel | Text' } }
function run(when, ...args) {
  const text = execFileSync(process.execPath, ['--import', FAKE, SEND, ...args], { env: { ...process.env, FAKE_NOW: when, FIREBASE_SERVICE_ACCOUNT: '', KIND: '', DRY_RUN: '', FORCE: '' }, encoding: 'utf8' });
  const to = {}; for (const m of text.matchAll(/^ {2}-> (\S+) \| (.*)$/gm)) to[m[1]] = m[2];
  return { text, to };
}
let fails = 0, oks = 0;
const eq = (label, got, exp) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g === e) { oks++; console.log('  ok   ', label); } else { fails++; console.log('  FAIL ', label, '\n        erwartet', e, '\n        bekommen', g); } };
const has = (label, s, part) => eq(label, String(s).includes(part), true);

await seed();
console.log('\nMontag 30.11., 8:05 Uhr: Wiegen');
let r = run('2026-11-30T08:05:00+01:00', '--dry-run');
eq('Empfänger: wer nicht gewogen hat (ohne Pause, ohne Ausgestiegene), plus Fritz (Start verpasst)', Object.keys(r.to).sort(), ['alice', 'fritz', 'harald', 'paula']);
eq('Fritz bekommt eine neue Start-Erinnerung', /Neuer Start|Zweite Chance|Heute ist dein Start/.test(r.to.fritz), true);
has('nennt, wer schon gewogen hat', r.to.alice + r.to.harald + r.to.paula, 'gewogen');
eq('Winter 7:05 (erster Cron-Lauf): nichts', run('2026-11-30T07:05:00+01:00', '--dry-run').text.includes('Nichts zu tun'), true);

console.log('\nMittwoch 2.12., 21:05 Uhr: Habits');
r = run('2026-12-02T21:05:00+01:00', '--dry-run');
eq('Empfänger (Bob fertig, Paula pausiert, Carol ausgestiegen, Fritz nie gestartet; Gina in der Haltephase bekommt sie)', Object.keys(r.to).sort(), ['alice', 'dave', 'erin', 'gina', 'harald']);
eq('Alice: offene Ziele, heute Abgehaktes fehlt', [r.to.alice.includes('Kochen 2/4'), r.to.alice.includes('Laufen 0/1'), r.to.alice.includes('Softdrinks')], [true, true, false]);
eq('Erin: Extra-Habit wird ignoriert', r.to.erin.includes('Lesen'), false);

console.log('\nSonntag 6.12., 21:05 Uhr: letzter Tag der Woche');
r = run('2026-12-06T21:05:00+01:00', '--dry-run');
eq('Sonntag nennt Montag 14 Uhr, nicht Dienstag', [Object.values(r.to).every(x => x.includes('14:00 Uhr')), Object.values(r.to).some(x => x.includes('Dienstag'))], [true, false]);

console.log('\nDoppelschutz (zwei echte Läufe am selben Montag)');
run('2026-11-30T08:05:00+01:00');
has('zweiter Lauf schickt nichts', run('2026-11-30T09:05:00+01:00').text, 'schon verschickt');

console.log('\nSommerzeit und Saisonende');
has('Mo 29.3.2027 8:05 Sommerzeit (6:05 UTC): Wiegen', run('2027-03-29T06:05:00Z', '--dry-run').text, 'weigh 2027-03-29');
r = run('2027-05-10T08:05:00+02:00', '--dry-run');
eq('letzter Montag (Slot 24): keine Start-Erinnerung mehr für Fritz', 'fritz' in r.to, false);
has('Mo 17.5.2027: kein Wiege-Montag mehr', run('2027-05-17T08:05:00+02:00', '--dry-run').text, 'kein Wiege-Montag');
has('Mo 10.5.2027 21:05: Habits außerhalb der Saison', run('2027-05-10T21:05:00+02:00', '--dry-run').text, 'Außerhalb der Saison');

console.log(`\n${oks} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
