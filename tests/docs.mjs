// README aktuell halten: Tabellen aus CONFIG (app.js) und frische Screenshots aus dem Demo-Modus.
//   cd tests && npm run docs              Tabellen + Screenshots (braucht: python3 -m http.server 8765 im Repo-Ordner)
//   cd tests && npm run docs -- --tables  nur die Tabellen
// Die Tabellen stehen in README.md zwischen <!-- CONFIG:… --> und <!-- /CONFIG:… -->, nie von Hand ändern.
// Screenshots: nur erfundene Demo-Daten; die Demo-Mitspieler bekommen hier neutrale Namen (nur im Screenshot-Browser).
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const src = readFileSync(new URL('app.js', ROOT), 'utf8');
const gen = fileURLToPath(new URL('./.docs.gen.mjs', import.meta.url));
writeFileSync(gen, `globalThis.location ??= { search: '' };\n${src.slice(0, src.indexOf('/* ---------- Zeit ---------- */'))}\nexport { CONFIG };\n`);
const { CONFIG: C } = await import(pathToFileURL(gen).href);
rmSync(gen);

// Zahlen wie in der App: 20 € / 0,50 €, Kommas
const eur = x => { const c = Math.round(x * 100); return (c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €'; };
const num = x => x.toLocaleString('de-DE');
const wMax = C.weighMaxTenths * C.weighPerTenth;

const scoring = `| Was | Punkte | So zählt es |
| --- | --- | --- |
| Waage (montags ${C.weighStartHour}–${C.deadlineHour} Uhr) | ${C.weighPerTenth} pro 0,1 % unter dem bisherigen Tiefstwert | höchstens ${num(C.weighMaxTenths / 10)} % = **${wMax}** pro Woche; zunehmen kostet nichts |
| 3 Habits mit Wochenziel (1–7×) | bis **${C.habitMaxPts}** pro Habit, **${3 * C.habitMaxPts}** pro Woche | anteilig: ${C.habitMaxPts} × geschafft ÷ Ziel, gerundet; ${C.backfillDays} Tage nachtragen |
| Wochen-Challenge | bis **${C.challengePts}** pro Woche | täglich 1 pro Tag, 1× = ${C.challengePts}, 2× = je ${Math.round(C.challengePts / 2)}; der Wochenletzte wählt ${C.chooseHours} Std. lang allein |
| Extra-Aufgabe | **+${C.taskPts}** | jeder stellt 1 pro Etappe; zählt mit Foto-Beweis und Bestätigung durch jemand anderen |
| Team-Monat | **+${C.teamPts}** pro Etappe | ${C.teamDraw} gezogene Gruppenziele, nur wenn alle erreicht sind |
| Haltephase (Ziel erreicht) | **${wMax}** Waage-Punkte pro Woche | solange höchstens ${num(C.holdBand)} Prozentpunkt über dem Ziel, sonst 0 |

| Geld | Betrag |
| --- | --- |
| Einsatz (einmalig) | ${eur(C.einsatz)} |
| Wiegen verpasst | ${eur(C.strafe)} |
| Woche ohne alle 3 Wochenziele | ${eur(C.habitFee)} |
| Wochenletzter (nur wenn nicht alle gleich viele Punkte haben) | ${eur(C.loserFee)} |
| Aussteigen mit erreichtem Ziel | Einsatz zurück, frühere Strafen bleiben |

Saison: ${C.weeks} Wochen ab ${String(C.start.d).padStart(2, '0')}.${String(C.start.m).padStart(2, '0')}.${C.start.y}, ${C.weeks / C.etappeWeeks} Etappen à ${C.etappeWeeks} Wochen, bis zu ${C.pauseWeeks} Pausenwochen pro Person. Der Gesamtsieger bekommt den Topf.`;

const cfgRows = [
  ['firebase', C.firebase ? '{…}' : null, 'Web-App-Config aus der Firebase-Konsole; `null` = Demo-Modus. Steht auch in `firebase-messaging-sw.js`.'],
  ['testMode', C.testMode, 'Zeit per `?now=` simulierbar. **In der Saison `false`.**'],
  ['start', `${C.start.y}-${String(C.start.m).padStart(2, '0')}-${String(C.start.d).padStart(2, '0')}`, 'Erster Montag der Saison (muss zu `START_MS` in den Regeln passen)'],
  ['weeks / etappeWeeks', `${C.weeks} / ${C.etappeWeeks}`, 'Saisonlänge und Wochen pro Etappe'],
  ['weighStartHour / deadlineHour', `${C.weighStartHour} / ${C.deadlineHour}`, 'Wiegefenster am Montag (Uhr)'],
  ['weighPerTenth / weighMaxTenths', `${C.weighPerTenth} / ${C.weighMaxTenths}`, 'Waage-Punkte pro 0,1 % und Deckel in Zehntelprozent'],
  ['habitMaxPts', C.habitMaxPts, 'Punkte pro Habit und Woche'],
  ['challengePts / taskPts / teamPts', `${C.challengePts} / ${C.taskPts} / ${C.teamPts}`, 'Wochen-Challenge, Extra-Aufgabe, Team-Monat'],
  ['einsatz / strafe / habitFee / loserFee', `${C.einsatz} / ${C.strafe} / ${C.habitFee} / ${C.loserFee}`, 'Geld in Euro (Strafen auch in `reminders/send.mjs`)'],
  ['pauseWeeks / holdBand', `${C.pauseWeeks} / ${C.holdBand}`, 'Pausenwochen pro Saison, Puffer der Haltephase in Prozentpunkten'],
  ['backfillDays / chooseHours', `${C.backfillDays} / ${C.chooseHours}`, 'Tage zum Nachtragen, Stunden für den Wochenletzten'],
  ['vapidKey', C.vapidKey ? '(gesetzt)' : '', 'Web-Push-Schlüssel; leer = Erinnerungen aus'],
  ['adminUids / lateMaxDays', `${JSON.stringify(C.adminUids)} / ${C.lateMaxDays}`, 'Admins (Nachtrag erlauben, wie `ADMINS()` in den Regeln) und längste Nachtrag-Frist in Tagen'],
];
const config = `| Schlüssel | Wert | Bedeutung |\n| --- | --- | --- |\n` + cfgRows.map(([k, x, d]) => `| \`${k}\` | ${x === null ? '`null`' : x === '' ? '(leer)' : typeof x === 'string' && x.startsWith('(') ? x : '`' + x + '`'} | ${d} |`).join('\n');

const readmeUrl = new URL('README.md', ROOT);
let md = readFileSync(readmeUrl, 'utf8');
const put = (name, body) => {
  const re = new RegExp(`(<!-- CONFIG:${name} -->)[\\s\\S]*?(<!-- /CONFIG:${name} -->)`);
  if (!re.test(md)) throw new Error(`Marker CONFIG:${name} fehlt in README.md`);
  md = md.replace(re, `$1\n${body}\n$2`);
};
put('scoring', scoring); put('config', config);
writeFileSync(readmeUrl, md);
console.log('README.md: Tabellen aus CONFIG aktualisiert');

if (process.argv.includes('--tables')) process.exit(0);

// ---------- Screenshots ----------
const { chromium } = await import('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
const OUT = new URL('docs/screenshots/', ROOT); mkdirSync(OUT, { recursive: true });
const START = new Date(C.start.y, C.start.m - 1, C.start.d);
const at = (d, h = 12) => { const x = new Date(START); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.getTime(); };
function rng(seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
const HS = [{ name: 'Kochen statt Lieferdienst', target: 4 }, { name: 'Keine Softdrinks', target: 7 }, { name: '1× 10 km laufen', target: 1, confirm: true }];
function mine(now) { // erfundener Demo-Spieler bis zum Zeitpunkt now
  const today = Math.round((new Date(new Date(now).toDateString()) - START) / 864e5);
  const m = { player: { name: 'Alex', habits: HS, habitSets: { 1: HS }, extraHabits: [{ name: 'Wohnung aufräumen', target: 3, confirm: true }, { name: '10 Min lesen', target: 5 }], maxLossPct: 8, joinedSlot: 0, joinedAt: 0, invite: 'DEMO', onboardingDone: true, lastActive: now },
    weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, habitok: {}, myWeights: {}, plan: { estKg: 96, targetKg: 88 }, push: false };
  const r = rng('readme'); let loss = 0;
  for (let k = 0; k <= C.weeks && at(7 * k, 14) <= now; k++) {
    if (k) loss = Math.max(0, loss + 0.62 + (r() - 0.5) * 0.5);
    m.weighins['demo-me_' + k] = { uid: 'demo-me', slot: k, lossPct: Math.round(loss * 100) / 100, ts: at(7 * k, 7) }; m.myWeights[k] = Math.round(96 * (1 - loss / 100) * 10) / 10;
  }
  for (let d = 0; d <= today; d++) {
    const q = rng('d' + d), done = [q() < 0.6, q() < 0.9, q() < 0.2, q() < 0.6];
    m.habitlogs['demo-me_' + d] = { uid: 'demo-me', day: d, done, extra: [q() < 0.45, q() < 0.7], ts: at(d, 20) };
    if (d < today - 1) { if (done[2]) m.habitok[`demo-me_${d}_2`] = { uid: 'demo-me', day: d, h: '2', by: 'bot-julian', byName: 'Mo' }; if (m.habitlogs['demo-me_' + d].extra[0]) m.habitok[`demo-me_${d}_x0`] = { uid: 'demo-me', day: d, h: 'x0', by: 'bot-siggi', byName: 'Kai' }; }
  }
  return m;
}
const browser = await chromium.launch();
async function shot(file, { w, h, dsf = 1, now, tab = 'heute', prep }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  // neutrale Namen für die Demo-Mitspieler (nur in diesem Browser)
  await page.route(/\/app\.js(\?.*)?$/, async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replaceAll('Siggi', 'Kai').replaceAll('Julian', 'Mo') }); });
  await page.addInitScript(([m, now]) => { if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1'); localStorage.clear(); localStorage.setItem('cdf-demo-v1', JSON.stringify(m)); localStorage.setItem('cdf-demo-now', String(now)); for (const k of ['cdf-ms-demo-me', 'cdf-cel-demo-me']) localStorage.setItem(k, '["goal","l2","l5","l7","l10","w4","w10","w20","sw4","sw12","l5","goal8"]'); }, [mine(now), now]);
  await page.goto(`${BASE}?demo#${tab}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelector('.banner')?.remove()); // Demo-Hinweis gehört nicht ins Bild
  await page.waitForTimeout(1600);
  if (prep) { await prep(page); await page.waitForTimeout(900); }
  await page.screenshot({ path: fileURLToPath(new URL(file, OUT)) });
  await ctx.close();
  console.log('docs/screenshots/' + file);
}
const mid = at(79, 18); // Mittwoch, Woche 12
await shot('heute-mobil.png', { w: 390, h: 844, dsf: 2, now: mid });
await shot('ranking-mobil.png', { w: 390, h: 844, dsf: 2, now: mid, tab: 'ranking' });
await shot('foto-beweis-mobil.png', { w: 390, h: 844, dsf: 2, now: mid, tab: 'challenges', prep: async p => {
  await p.evaluate(() => { const b = document.querySelector('button.btn[data-act=proofOpen]') || document.querySelector('[data-act=proofOpen]'); b?.click(); });
  await p.waitForFunction(() => document.querySelector('.proofp img[data-proof]')?.naturalWidth > 0, null, { timeout: 5000 }).catch(() => { });
  await p.evaluate(() => document.querySelector('.proofp')?.closest('.task')?.scrollIntoView({ block: 'start' }));
} });
await shot('heute-desktop.png', { w: 1440, h: 900, now: mid });
await browser.close();
