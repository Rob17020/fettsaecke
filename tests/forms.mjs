// Regressionstest: Eingaben dürfen beim Neuzeichnen nicht verschwinden (render() baut #app bei jedem Snapshot und jede Minute neu).
// Füllt Formulare im Demo-Modus (und die Anmeldung mit dem Firebase-Mock), löst 3 Daten-Updates und den Minuten-Takt aus
// und prüft Werte, Fokus und Cursor. Dazu: Daten um ein halb ausgefülltes Formular herum werden trotzdem aktualisiert,
// und nach dem Speichern ist der Entwurf weg.
//   im Repo-Ordner:  python3 -m http.server 8765
//   dann:            cd tests && npm run forms
import { chromium } from 'playwright';
import { MODULES } from './fbmock.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
const at = (d, h = 9, m = 0) => new Date(2026, 10, 23 + d, h, m).getTime();
const HS = [{ name: 'Kochen statt Lieferdienst', target: 4 }, { name: 'Keine Softdrinks', target: 7 }, { name: '1× 10 km laufen', target: 1 }];
const me = (o = {}) => ({ player: { name: 'Robbi', habits: HS, habitSets: { 1: HS }, extraHabits: [], maxLossPct: 8, joinedSlot: 0, joinedAt: 0, invite: 'DEMO', onboardingDone: true, ...o },
  weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, habitok: {}, myWeights: {}, plan: { estKg: 98, targetKg: 90 }, push: false });

const browser = await chromium.launch();
let fails = 0, oks = 0;
const ok = (label, cond, info = '') => { if (cond) { oks++; console.log('  ok   ', label); } else { fails++; console.log('  FAIL ', label, info); } };

async function open({ now, mine, tab = 'heute', w = 390, fb }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (fb) {
    await page.addInitScript(fb => { window.__FBM = fb; }, fb);
    await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: MODULES[r.request().url().split('/').pop()] || 'export {}' }));
    await page.goto(`${BASE}#${tab}`, { waitUntil: 'networkidle' });
  } else {
    await page.addInitScript(([m, now]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('cdf-demo-v1', JSON.stringify(m)); localStorage.setItem('cdf-demo-now', String(now));
    }, [mine, now]);
    await page.goto(`${BASE}?demo#${tab}`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(500);
  return { page, ctx, errs };
}
// 3 Daten-Updates + der Minuten-Takt (im Firebase-Mock: Snapshots aller Listener)
async function storm(page, fb) {
  for (let i = 0; i < 3; i++) { await page.evaluate(fb => fb ? window.__FBM.listeners.slice().forEach(f => f()) : window.__cdf.emit(), fb); await page.waitForTimeout(60); }
  await page.evaluate(() => window.__cdf?.tick()); await page.waitForTimeout(60);
}
const vals = (page, ids) => page.evaluate(ids => Object.fromEntries(ids.map(id => [id, (el => !el ? null : el.type === 'checkbox' ? el.checked : el.value)(document.getElementById(id))])), ids);
const blur = page => page.evaluate(() => { document.activeElement?.blur(); document.body.focus(); });
const clk = (page, sel) => page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(e => e.getClientRects().length); if (!e) throw new Error('nicht gefunden: ' + sel); e.click(); }, sel);

console.log('\n1) Heute, Montag 9:00: Startgewicht (Fokus bleibt), danach ohne Fokus');
{
  const { page, ctx, errs } = await open({ now: at(0, 9), mine: me() });
  await page.click('#kg'); await page.keyboard.type('91.4');
  await storm(page);
  ok('Wert bleibt mit Fokus', (await vals(page, ['kg'])).kg === '91.4');
  ok('Fokus bleibt im Feld', await page.evaluate(() => document.activeElement?.id === 'kg'));
  await blur(page); await storm(page);
  ok('Wert bleibt ohne Fokus', (await vals(page, ['kg'])).kg === '91.4');
  // Daten drumherum laufen weiter: Haken setzen, während das Gewicht halb eingetragen ist
  await clk(page, '.hc[data-act=habit][data-day="0"][data-h="1"]'); await page.waitForTimeout(300); await storm(page);
  ok('Haken daneben wird gespeichert und angezeigt', await page.evaluate(() => document.querySelector('.hc[data-day="0"][data-h="1"]')?.classList.contains('on')));
  ok('Habit-Zähler aktualisiert (1/7)', await page.evaluate(() => [...document.querySelectorAll('.hp')].some(x => x.textContent === '1/7')));
  ok('Gewicht steht immer noch da', (await vals(page, ['kg'])).kg === '91.4');
  await clk(page, '[data-act=weigh]'); await page.waitForTimeout(400);
  ok('nach dem Speichern: Entwurf gelöscht', await page.evaluate(() => !Object.keys(window.__cdf.drafts()).some(k => k.startsWith('kg'))));
  ok('nach dem Speichern: Karte zeigt den neuen Stand', /Startgewicht gespeichert/.test(await page.evaluate(() => document.querySelector('#app').innerText)));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n2) Challenges: Aufgabe + Team-Vorschlag (mehrere Felder), Cursor mitten im Text');
{
  const { page, ctx, errs } = await open({ now: at(1, 18), mine: me({}), tab: 'challenges' });
  await page.fill('#tText', '1 Stunde schwimmen');
  await page.fill('#iText', 'Liegestütze'); await page.selectOption('#iKind', 'sum'); await page.fill('#iPer', '300'); await page.selectOption('#iPeriod', 'week');
  await page.click('#iUnit'); await page.keyboard.type('Stck'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await storm(page);
  const v = await vals(page, ['tText', 'iText', 'iKind', 'iPer', 'iUnit', 'iPeriod']);
  ok('alle Felder behalten ihren Wert', JSON.stringify(v) === JSON.stringify({ tText: '1 Stunde schwimmen', iText: 'Liegestütze', iKind: 'sum', iPer: '300', iUnit: 'Stck', iPeriod: 'week' }), JSON.stringify(v));
  ok('Fokus und Cursor bleiben (iUnit, Position 2)', await page.evaluate(() => document.activeElement?.id === 'iUnit' && document.activeElement.selectionStart === 2));
  await page.keyboard.type('ü'); ok('Weitertippen an der Cursor-Stelle', (await vals(page, ['iUnit'])).iUnit === 'Stück');
  await blur(page); await storm(page);
  ok('ohne Fokus: alles noch da', JSON.stringify(await vals(page, ['tText', 'iText', 'iPer', 'iUnit', 'iPeriod'])) === JSON.stringify({ tText: '1 Stunde schwimmen', iText: 'Liegestütze', iPer: '300', iUnit: 'Stück', iPeriod: 'week' }));
  // Tab wechseln und zurück: Karte wird neu gebaut, Entwürfe kommen zurück
  await clk(page, '[data-tab=heute]'); await page.waitForTimeout(300); await clk(page, '[data-tab=challenges]'); await page.waitForTimeout(300);
  ok('nach Tab-Wechsel: Entwürfe wieder eingesetzt', (await vals(page, ['tText', 'iUnit'])).tText === '1 Stunde schwimmen' && (await vals(page, ['iUnit'])).iUnit === 'Stück');
  await clk(page, '[data-act=addTask]'); await page.waitForTimeout(400);
  ok('Aufgabe gestellt, Entwurf weg', !(await page.evaluate(() => 'tText' in window.__cdf.drafts())) && /1 Stunde schwimmen/.test(await page.evaluate(() => document.querySelector('[data-form=tasks]').innerText)));
  ok('Team-Vorschlag-Entwurf bleibt dabei stehen', (await vals(page, ['iText'])).iText === 'Liegestütze');
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n3) Profil: Name + neue Extra-Habit-Zeile, Neuzeichnen ohne Fokus');
{
  const { page, ctx, errs } = await open({ now: at(1, 18), mine: me({ extraHabits: [{ name: '10 Min lesen', target: 5 }] }) });
  await clk(page, '[data-act=profile]'); await page.waitForTimeout(300);
  await page.fill('#pName', 'Robbi B');
  await clk(page, '[data-act=xAdd][data-pre=p]'); await page.keyboard.type('Wohnung aufräumen');
  await blur(page); await storm(page);
  ok('Name bleibt', (await vals(page, ['pName'])).pName === 'Robbi B');
  ok('neue Extra-Zeile bleibt', await page.evaluate(() => [...document.querySelectorAll('#pX .xrow input.inp')].map(i => i.value).join('|')) === '10 Min lesen|Wohnung aufräumen');
  // Profil schließen und wieder öffnen: der ungespeicherte Entwurf ist noch da
  await clk(page, '.sheet [data-act=closeModal]'); await page.waitForTimeout(200); await storm(page);
  await clk(page, '[data-act=profile]'); await page.waitForTimeout(300);
  ok('wieder geöffnet: Entwurf da', (await vals(page, ['pName'])).pName === 'Robbi B' && await page.evaluate(() => document.querySelectorAll('#pX .xrow').length === 2));
  await clk(page, '[data-act=saveProfile]'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')).player);
  ok('gespeichert', st.name === 'Robbi B' && st.extraHabits.length === 2);
  ok('Entwürfe gelöscht', await page.evaluate(() => !Object.keys(window.__cdf.drafts()).length));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n4) Beitreten (Firebase-Mock): viele Felder, 3 Snapshots');
{
  const { page, ctx, errs } = await open({ fb: { user: { uid: 'me', displayName: 'Robbi Test' }, store: {} }, w: 1024 });
  await page.fill('#rName', 'Robbi'); await page.fill('#rKg', '98');
  for (let i = 0; i < 3; i++) await page.fill('#rH' + i, 'Habit ' + (i + 1));
  await page.selectOption('#rT1', '3'); await page.check('#rC2');
  await clk(page, '[data-act=xAdd][data-pre=r]'); await page.keyboard.type('Lesen');
  await page.fill('#rCode', 'GEHEIM');
  await storm(page, true);
  const v = await vals(page, ['rName', 'rKg', 'rH0', 'rH1', 'rH2', 'rT1', 'rC2', 'rCode']);
  ok('alle Felder behalten ihren Wert', JSON.stringify(v) === JSON.stringify({ rName: 'Robbi', rKg: '98', rH0: 'Habit 1', rH1: 'Habit 2', rH2: 'Habit 3', rT1: '3', rC2: true, rCode: 'GEHEIM' }), JSON.stringify(v));
  ok('Extra-Zeile bleibt', await page.evaluate(() => document.querySelector('#rX .xrow input.inp')?.value === 'Lesen'));
  await blur(page); await storm(page, true);
  ok('ohne Fokus: alles noch da', JSON.stringify(await vals(page, ['rName', 'rH2', 'rCode'])) === JSON.stringify({ rName: 'Robbi', rH2: 'Habit 3', rCode: 'GEHEIM' }));
  ok('Ziel-Rad behält das Gewicht', await page.evaluate(() => !document.querySelector('#dial-r')?.classList.contains('off')));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n5) Habit-Karte: Extra-Habit direkt anlegen, abhaken, bearbeiten, entfernen');
{
  const m5 = me({ extraHabits: [{ name: '10 Min lesen', target: 5 }] }); // mit Startgewicht, sonst verschiebt die App den Start
  m5.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m5.myWeights[0] = 98;
  const { page, ctx, errs } = await open({ now: at(2, 19), mine: m5 });
  const grid = () => page.evaluate(() => [...document.querySelectorAll('[data-form=habits] .hrow.xr .hn')].map(x => x.textContent));
  ok('Trenner „Extra, ohne Punkte“ mit Aktionen', await page.evaluate(() => /Extra, ohne Punkte/.test(document.querySelector('.hsep')?.textContent) && !!document.querySelector('.hsep [data-act=xOpen][data-new]')));
  await clk(page, '.hsep [data-act=xOpen][data-new]'); await page.waitForTimeout(200);
  ok('Editor offen, neue Zeile hat den Fokus', await page.evaluate(() => !!document.querySelector('[data-form=habits] .xedit') && document.activeElement?.closest('#hX .xrow:last-child') !== null));
  await page.keyboard.type('Wohnung aufräumen');
  await page.evaluate(() => { const s = document.querySelector('#hX .xrow:last-child select'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await storm(page); await blur(page); await storm(page);
  ok('Entwurf im Editor überlebt 2× Neuzeichnen', await page.evaluate(() => document.querySelector('#hX .xrow:last-child input.inp')?.value === 'Wohnung aufräumen'));
  await clk(page, '[data-act=xSave]'); await page.waitForTimeout(400);
  ok('gespeichert: zweite Extra-Zeile im Raster', JSON.stringify(await grid()) === JSON.stringify(['10 Min lesen', 'Wohnung aufräumen']));
  ok('Editor wieder zu', await page.evaluate(() => !document.querySelector('.xedit')));
  await clk(page, '.hc[data-act=habitx][data-x="1"][data-day="2"]'); await page.waitForTimeout(300);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  ok('Haken auf Platz 1 (Tag 2)', st.habitlogs['demo-me_2']?.extra?.[1] === true && !st.habitlogs['demo-me_2']?.extra?.[0]);
  ok('Zähler 1/2', await page.evaluate(() => [...document.querySelectorAll('.hrow.xr .hp')].map(x => x.textContent).join('|') === '0/5|1/2'));
  // das erste Extra entfernen: der Haken von „Wohnung aufräumen“ bleibt bei ihm
  await clk(page, '.hsep [data-act=xOpen]:not([data-new])'); await page.waitForTimeout(200);
  await clk(page, '#hX .xrow:first-child [data-act=xDel]'); await clk(page, '[data-act=xSave]'); await page.waitForTimeout(400);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  ok('entfernt: Platz 0 nur markiert', st.player.extraHabits[0].off === true && st.player.extraHabits[1].name === 'Wohnung aufräumen');
  ok('Raster zeigt nur noch Wohnung aufräumen mit 1/2', JSON.stringify(await grid()) === JSON.stringify(['Wohnung aufräumen']) && await page.evaluate(() => document.querySelector('.hrow.xr .hp')?.textContent === '1/2'));
  // Profil zeigt dieselbe Liste und speichert ohne Plätze zu verschieben
  await clk(page, '[data-act=profile]'); await page.waitForTimeout(300);
  ok('Profil zeigt nur aktive Extras', await page.evaluate(() => [...document.querySelectorAll('#pX .xrow input.inp')].map(i => i.value).join('|') === 'Wohnung aufräumen'));
  await clk(page, '[data-act=saveProfile]'); await page.waitForTimeout(300);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  ok('Profil speichern lässt die Plätze stehen', st.player.extraHabits.length === 2 && st.player.extraHabits[1].name === 'Wohnung aufräumen');
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await page.screenshot({ path: new URL('./shots/forms-habits-390.png', import.meta.url).pathname.replace(/%20/g, ' ') });
  await ctx.close();
}

await browser.close();
console.log(`\n${oks} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
