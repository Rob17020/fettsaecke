// Playwright: Zustände × Breiten × Tabs, Screenshots + automatische Prüfungen (Überlauf, Konsolenfehler, leere Spalten,
// gestreckte Karten). Demo-Modus mit vorbereiteten Daten, Anmelden/Beitreten/Einzelspieler über ein nachgebautes Firebase (fbmock.mjs).
//   im Repo-Ordner:  python3 -m http.server 8765
//   dann:            cd tests && npx playwright install chromium   (einmal)
//                    npm run ui -- [filter]     filter = Teil des Dateinamens, z. B. "heute-mid-1440"
// Bilder und report.json landen in tests/shots/ (nicht committen). Die Prüfungen "span.sr"/"span.hn abgeschnitten" sind gewollt.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODULES } from './fbmock.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
const OUT = process.env.OUT || fileURLToPath(new URL('./shots/', import.meta.url)); // fileURLToPath: Pfad mit Leerzeichen/Umlauten mkdirSync(OUT, { recursive: true });
const FILTER = process.argv[2] || '';
const START = new Date(2026, 10, 23);
const dayDate = d => new Date(START.getFullYear(), START.getMonth(), START.getDate() + d);
const iso = (d, h = 12, m = 0) => { const x = dayDate(d); x.setHours(h, m); return x.getTime(); };
function rng(seed) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

const HS = [{ name: 'Kochen statt Lieferdienst', target: 4, confirm: false }, { name: 'Keine Softdrinks', target: 7, confirm: false }, { name: '1× 10 km laufen', target: 1, confirm: true }];
const X = [{ name: 'Wohnung aufräumen', target: 3, confirm: true }, { name: '10 Min lesen', target: 5, confirm: false }];
// Eigener Demo-Spieler bis zum Zeitpunkt now (Tag today)
function mine({ now, goal = 8, loss = 0.55, js = 0, paused = [], finished = null, data = true, extras = true, confirmOld = true }) {
  const today = Math.round((new Date(new Date(now).toDateString()) - START) / 864e5);
  const m = { player: { name: 'Robbi', habits: HS, habitSets: { 1: HS }, extraHabits: extras ? X : [], maxLossPct: goal, joinedSlot: js, joinedAt: 0, invite: 'DEMO', onboardingDone: true, pausedWeeks: paused, lastActive: now },
    weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, habitok: {}, myWeights: {}, plan: { estKg: 98, targetKg: 98 * (1 - goal / 100) }, push: false };
  if (finished) Object.assign(m.player, { status: 'finished', finishedWeek: finished, finishedAt: iso(7 * finished, 10) });
  if (!data) return m;
  const r = rng('me'); let lossV = 0;
  for (let k = js; k <= 24; k++) {
    const t = iso(7 * k, 14); if (t > now && !(k * 7 === today && new Date(now).getHours() >= 9)) break;
    if (finished && k > finished) break;
    if (k > js) lossV = Math.max(0, lossV + loss + (r() - 0.5) * 0.5);
    if (k > js && !paused.includes(k) && r() < 0.06) continue;
    const kg = Math.round(98 * (1 - lossV / 100) * 10) / 10;
    m.weighins['demo-me_' + k] = { uid: 'demo-me', slot: k, lossPct: Math.round(lossV * 100) / 100, ts: iso(7 * k, 7, 30) };
    m.myWeights[k] = kg;
  }
  for (let d = 7 * js; d <= today && d < 168; d++) {
    if (finished && d >= 7 * finished) break;
    const w = Math.floor(d / 7) + 1; if (paused.includes(w)) continue;
    const rr = rng('d' + d);
    const done = [rr() < 0.62, rr() < 0.9, rr() < 0.2, rr() < 0.6];
    m.habitlogs['demo-me_' + d] = { uid: 'demo-me', day: d, done, extra: [rr() < 0.45, rr() < 0.7], ts: iso(d, 20) };
    if (confirmOld && d < today - 1) { if (done[2]) m.habitok[`demo-me_${d}_2`] = { uid: 'demo-me', day: d, h: '2', by: 'bot-julian', byName: 'Julian' }; if (m.habitlogs['demo-me_' + d].extra[0]) m.habitok[`demo-me_${d}_x0`] = { uid: 'demo-me', day: d, h: 'x0', by: 'bot-siggi', byName: 'Siggi' }; }
  }
  return m;
}
const mid = iso(79, 12);           // Mi 10.2.2027, Woche 12
const STATES = {
  pre: { now: iso(-1, 15), m: o => mine({ now: o, data: false }) },
  startmo: { now: iso(0, 9), m: o => mine({ now: o, data: false }) },
  mid: { now: mid, m: o => mine({ now: o }) },
  monpm: { now: iso(84, 15), m: o => mine({ now: o }) },             // Mo nach 14 Uhr: Wochenletzter
  mondue: { now: iso(84, 9), m: o => mine({ now: o }) },             // Mo 9 Uhr: Wiegen fällig
  bots8: { now: mid, m: o => mine({ now: o }), qs: '&bots=8' },
  bots20: { now: mid, m: o => mine({ now: o }), qs: '&bots=20' },
  goal: { now: mid, m: o => mine({ now: o, goal: 5, loss: 0.7 }) },
  hold: { now: mid, m: o => mine({ now: o, goal: 4, loss: 0.7 }), ls: { 'cdf-goalchoice-demo-me': 'AUTO' } },
  finished: { now: mid, m: o => mine({ now: o, goal: 4, loss: 0.7, finished: 9 }) },
  pause: { now: mid, m: o => mine({ now: o, paused: [12] }) },
  late: { now: mid, m: o => mine({ now: o, js: 10 }) },               // Spätstarter
  end: { now: iso(170, 12), m: o => mine({ now: o }) },              // Saisonende (Wrapped öffnet sich)
};
const WIDTHS = { 390: 844, 768: 1024, 1024: 768, 1100: 820, 1440: 900, 1920: 1080, 2560: 1440 }; // 1100 = Desktop mit Seitenleiste, 2 Spalten

const browser = await chromium.launch();
const report = [];
const clk = (p, s) => p.evaluate(s => { const e = [...document.querySelectorAll(s)].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!e) throw new Error('nicht gefunden: ' + s); e.click(); }, s);
async function shoot(name, o) { if (FILTER && !name.includes(FILTER)) return; try { return await shoot1(name, o); } catch (e) { report.push({ name, errs: ['SKRIPT: ' + e.message.split('\n')[0]], chk: [] }); } }
async function shoot1(name, { state, w, tab = 'heute', qs = '', prep, fb, full = true, reduced = false }) {
  const S = STATES[state];
  const ctx = await browser.newContext({ viewport: { width: w, height: WIDTHS[w] || 900 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  if (fb) {
    await page.addInitScript(fb => { window.__FBM = fb; }, fb);
    await page.route('https://www.gstatic.com/firebasejs/**', r => { const f = r.request().url().split('/').pop(); r.fulfill({ contentType: 'text/javascript', body: MODULES[f] || 'export {}' }); });
  } else {
    const m = S.m(S.now);
    const ls = { ...(S.ls || {}) };
    await page.addInitScript(([m, now, ls]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('cdf-demo-v1', JSON.stringify(m)); localStorage.setItem('cdf-demo-now', String(now));
      for (const k of ['cdf-ms-demo-me', 'cdf-cel-demo-me']) localStorage.setItem(k, '["l2","l5","l7","l10","goal","w4","w10","w20","sw4","sw12","l5","goal4","goal5","goal8"]');
      for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    }, [m, S.now, ls]);
  }
  const url = fb ? `${BASE}${qs}#${tab}` : `${BASE}?demo${S.qs || ''}${qs}#${tab}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (S.ls?.['cdf-goalchoice-demo-me'] === 'AUTO') { await page.evaluate(() => document.querySelector('[data-act=goalStay]')?.click()); await page.waitForTimeout(400); }
  if (prep) { await prep(page); await page.waitForTimeout(700); }
  // Prüfungen
  const chk = await page.evaluate(() => {
    const vw = innerWidth, out = [];
    if (document.documentElement.scrollWidth > vw + 1) out.push(`Seite breiter als Fenster: ${document.documentElement.scrollWidth} > ${vw}`);
    for (const el of document.querySelectorAll('#app *, #modal *, #tabs *')) {
      const b = el.getBoundingClientRect(); if (!b.width || getComputedStyle(el).visibility === 'hidden') continue;
      if (b.right > vw + 1 && !el.closest('.tscroll, .chart, .hm, .heatbox, .tsl, .seg, .fx')) { out.push(`ragt rechts raus: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} (${Math.round(b.right)} > ${vw}) "${(el.textContent || '').trim().slice(0, 40)}"`); }
      const cs = getComputedStyle(el);
      if (el.children.length === 0 && el.textContent.trim() && (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) out.push(`Text abgeschnitten: ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 50)}"`);
    }
    for (const p of document.querySelectorAll('#app .pane')) { if (!p.querySelector('section, .card')) out.push('leere Spalte: .' + [...p.classList].join('.')); }
    for (const c of document.querySelectorAll('#app section.card')) { const b = c.getBoundingClientRect(); const inner = [...c.children].reduce((s, x) => s + x.getBoundingClientRect().height, 0); if (b.height > 260 && inner < b.height * 0.35) out.push(`gestreckte Karte (${Math.round(inner)}/${Math.round(b.height)} px Inhalt): ${c.querySelector('h2')?.textContent?.trim()}`); }
    return [...new Set(out)].slice(0, 25);
  });
  const file = `${OUT}${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  const res = { name, errs: [...new Set(errs)].filter(e => !/Service Worker|favicon/.test(e)), chk };
  if (fb) res.writes = await page.evaluate(() => window.__FBM.writes);
  report.push(res);
  await ctx.close();
  return res;
}

const W = Object.keys(WIDTHS).map(Number);
// 1) Heute in allen Zuständen und Breiten
for (const st of Object.keys(STATES)) for (const w of W) await shoot(`heute-${st}-${w}`, { state: st, w, full: w < 1025 });
// 2) Tabs in der Saisonmitte
const tabs = { ranking: null, challenges: null, verlauf: null, ich: null, regeln: null };
for (const t of Object.keys(tabs)) for (const w of [390, 768, 1440, 2560]) await shoot(`${t}-mid-${w}`, { state: 'mid', w, tab: t, full: w < 1025 });
for (const m of ['woche', 'etappe', 'kasse']) for (const w of [390, 1440]) await shoot(`ranking-${m}-mid-${w}`, { state: 'mid', w, tab: 'ranking', full: w < 1025, prep: p => clk(p, `[data-act=rmode][data-m=${m}]`) });
await shoot('ranking-kasse-finished-1440', { state: 'finished', w: 1440, tab: 'ranking', full: false, prep: p => clk(p, '[data-act=rmode][data-m=kasse]') });
await shoot('ranking-gesamt-finished-1440', { state: 'finished', w: 1440, tab: 'ranking', full: false });
for (const st of ['pre', 'bots20', 'end']) for (const w of [390, 1440]) for (const t of ['ranking', 'ich', 'challenges']) await shoot(`${t}-${st}-${w}`, { state: st, w, tab: t, full: w < 1025 });
// 3) Overlays
for (const w of [390, 1440]) {
  await shoot(`ov-profil-mid-${w}`, { state: 'mid', w, prep: p => clk(p, '[data-act=profile]'), full: false });
  await shoot(`ov-onboarding-mid-${w}`, { state: 'mid', w, prep: async p => { await clk(p, '[data-tab=regeln]'); await clk(p, '[data-act=obOpen]'); }, full: false });
  await shoot(`ov-onboarding2-mid-${w}`, { state: 'mid', w, prep: async p => { await clk(p, '[data-tab=regeln]'); await clk(p, '[data-act=obOpen]'); await clk(p, '[data-act=obNav][data-d="1"]'); }, full: false });
  await shoot(`ov-exit-goal-${w}`, { state: 'goal', w, prep: p => clk(p, '[data-act=exitAsk]'), full: false });
  await shoot(`ov-wrapped-end-${w}`, { state: 'end', w, full: false });
}
await shoot('ov-feed-mid-1440', { state: 'mid', w: 1440, prep: p => clk(p, '[data-act=feedOpen]'), full: false });
await shoot('ov-profil-pause-390', { state: 'pause', w: 390, prep: p => clk(p, '[data-act=profile]'), full: true });
// 4) Anmelden / Beitreten (Firebase-Mock), einzelner Spieler vor dem Start, Testmodus-Banner
for (const w of [390, 1024, 1920]) {
  await shoot(`login-${w}`, { state: 'pre', w, fb: { user: null, store: {} }, full: w < 1025 });
  await shoot(`register-${w}`, { state: 'pre', w, fb: { user: { uid: 'me', displayName: 'Robbi Test' }, store: {} }, full: w < 1025 });
}
const solo = { user: { uid: 'me', displayName: 'Robbi' }, store: { 'players/me': { name: 'Robbi', habits: HS, habitSets: { 1: HS }, extraHabits: [], maxLossPct: 8, joinedSlot: 0, joinedAt: 1, lastActive: Date.now(), invite: 'X', onboardingDone: true }, 'players/me/private/weights': { estKg: 98, targetKg: 90 } } };
for (const w of W) await shoot(`solo-pre-${w}`, { state: 'pre', w, fb: structuredClone(solo), full: w < 1025 });
// Verdacht: simulierte Zukunftszeit vor dem Startgewicht -> joinedSlot wird verschoben (Schreibvorgang!)
await shoot('solo-future-bump-1440', { state: 'pre', w: 1440, fb: structuredClone(solo), qs: '?now=2026-12-01T10:00', full: false });
await shoot('register-future-1440', { state: 'pre', w: 1440, fb: { user: { uid: 'me', displayName: 'Robbi' }, store: {} }, qs: '?now=2026-12-08T10:00', full: false });
// 5) Bewegung reduziert, Tastatur
await shoot('heute-mid-390-reduced', { state: 'mid', w: 390, reduced: true });
await shoot('heute-mid-1440-keyboard', { state: 'mid', w: 1440, full: false, prep: async p => { for (let i = 0; i < 14; i++) await p.keyboard.press('Tab'); } });

writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
for (const r of report) if (r.errs.length || r.chk.length || r.writes?.length) console.log(`\n# ${r.name}\n` + [...r.errs.map(e => '  ERR ' + e), ...r.chk.map(c => '  CHK ' + c), ...(r.writes || []).map(x => '  WRITE ' + JSON.stringify(x).slice(0, 200))].join('\n'));
console.log(`\n${report.length} Screenshots in ${OUT}`);
await browser.close();
