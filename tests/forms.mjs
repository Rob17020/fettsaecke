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

console.log('\n6) Extra-Aufgabe mit Foto: verkleinern, melden, prüfen, ablehnen, neu melden, Galerie');
{
  // Tag 12 (Etappe 1): Siggis Aufgabe ist bestätigt, Julians wartet (Demo-Bots)
  const m6 = me(); m6.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m6.myWeights[0] = 98;
  const { page, ctx, errs } = await open({ now: at(12, 18), mine: m6, tab: 'challenges' });
  // großes, verrauschtes Foto (schwer zu komprimieren) als Datei in das Galerie-Feld
  const pick = sel => page.evaluate(async sel => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const g = c.getContext('2d'), d = g.createImageData(3000, 2000);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([blob], 'beweis.png', { type: 'image/png' }));
    const inp = document.querySelector(sel); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return blob.size;
  }, sel);
  await clk(page, '[data-act=report][data-id="e1_bot-siggi"]'); await page.waitForTimeout(200);
  ok('Meldeformular: Kamera + Galerie, Melden gesperrt ohne Foto', await page.evaluate(() => !!document.querySelector('[data-proofin][capture=environment]') && !!document.querySelector('[data-proofin]:not([capture])') && document.querySelector('[data-act=reportSend]').disabled));
  const raw = await pick('[data-proofin]:not([capture])'); await page.waitForFunction(() => !!document.querySelector('.report .proofbox.prev img'), null, { timeout: 15000 });
  await page.fill('#tdNote-e1_bot-siggi', '5,1 km in 29 Min');
  await storm(page);
  ok('Vorschau + Notiz überleben das Neuzeichnen', await page.evaluate(() => !!document.querySelector('.report .proofbox.prev img') && document.getElementById('tdNote-e1_bot-siggi')?.value === '5,1 km in 29 Min'));
  await clk(page, '[data-act=reportSend]'); await page.waitForTimeout(400);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  const pr = st.proofs['e1_bot-siggi_demo-me'];
  ok(`verkleinert: ${Math.round(raw / 1024)} KB PNG -> ${Math.round(pr.img.length / 1024)} KB, ${pr.w}×${pr.h}`, pr.img.length <= 200000 && Math.max(pr.w, pr.h) <= 1080 && /^data:image\/(webp|jpeg);base64,/.test(pr.img));
  ok('Meldung mit Foto und Notiz', st.taskDone['e1_bot-siggi_demo-me']?.proof === true && st.taskDone['e1_bot-siggi_demo-me'].note === '5,1 km in 29 Min');
  ok('Status „Wartet auf Bestätigung“', /Wartet auf Bestätigung/.test(await page.evaluate(() => document.querySelector('[data-form=tasks]').innerText)));
  // Julians Meldung prüfen: Foto wird erst jetzt geladen, dann ablehnen mit Grund
  ok('Fotos vorher nicht geladen', await page.evaluate(() => !document.querySelector('img[data-proof="e1_bot-julian_bot-julian"]')));
  await clk(page, '[data-act=proofOpen][data-id="e1_bot-julian_bot-julian"]');
  await page.waitForFunction(() => document.querySelector('img[data-proof="e1_bot-julian_bot-julian"]')?.naturalWidth > 0, null, { timeout: 5000 });
  ok('Foto geladen, Bestätigen und Ablehnen da', await page.evaluate(() => !!document.querySelector('[data-act=confirm][data-id="e1_bot-julian_bot-julian"]') && !!document.querySelector('[data-act=rejectTd]')));
  ok('eigene Meldung: kein Bestätigen-Knopf', await page.evaluate(() => !document.querySelector('[data-act=confirm][data-id="e1_bot-siggi_demo-me"]')));
  await page.fill('#rjReason-e1_bot-julian_bot-julian', 'Man sieht nur das Dach'); await clk(page, '[data-act=rejectTd]'); await page.waitForTimeout(300);
  st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  ok('abgelehnt mit Grund', st.taskDone['e1_bot-julian_bot-julian']?.rejectedBy === 'demo-me' && st.taskDone['e1_bot-julian_bot-julian'].rejectReason === 'Man sieht nur das Dach');
  ok('Liveticker zeigt die Ablehnung', await page.evaluate(() => { window.location.hash = '#heute'; return true; }) && await page.waitForTimeout(300).then(() => page.evaluate(() => /hat die Aufgabe von Julian abgelehnt/.test(document.body.innerText))));
  // Julian hat meine Aufgabe inzwischen bestätigt (Demo) -> Galerie mit 3 Fotos, Großansicht
  await page.waitForTimeout(2500); await clk(page, '[data-tab=challenges]'); await page.waitForTimeout(300);
  ok('meine Aufgabe bestätigt', /\+10 · bestätigt von Julian/.test(await page.evaluate(() => document.querySelector('[data-form=tasks]').innerText)));
  await page.evaluate(() => { const d = document.querySelector('details[data-gal]'); d.open = true; }); await page.waitForTimeout(400);
  await page.waitForFunction(() => [...document.querySelectorAll('.galg img[data-proof]')].every(i => i.naturalWidth > 0), null, { timeout: 5000 });
  ok('Galerie: alle Fotos der Etappe geladen', await page.evaluate(() => document.querySelectorAll('.galg .galitem').length) >= 3);
  await clk(page, '.galitem'); await page.waitForTimeout(400);
  ok('Großansicht', await page.evaluate(() => document.querySelector('#modal .sheet.photo img[data-proof]')?.naturalWidth > 0));
  await page.screenshot({ path: new URL('./shots/forms-proof-photo-390.png', import.meta.url).pathname.replace(/%20/g, ' ') });
  await page.keyboard.press('Escape');
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}
{
  // abgelehnte eigene Meldung: Grund sehen, neu melden
  const m7 = me(); m7.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m7.myWeights[0] = 98;
  m7.taskDone['e1_bot-siggi_demo-me'] = { uid: 'demo-me', taskId: 'e1_bot-siggi', confirmedBy: null, ts: at(11, 9), proof: true, note: 'alt', rejectedBy: 'bot-julian', rejectedByName: 'Julian', rejectedAt: at(11, 12), rejectReason: 'Datum fehlt' };
  m7.proofs = { 'e1_bot-siggi_demo-me': { uid: 'demo-me', taskId: 'e1_bot-siggi', img: 'data:image/jpeg;base64,/9j/', w: 1, h: 1, ts: at(11, 9) } };
  const { page, ctx, errs } = await open({ now: at(12, 18), mine: m7, tab: 'challenges' });
  ok('abgelehnt: Grund sichtbar', /Abgelehnt von Julian: „Datum fehlt“/.test(await page.evaluate(() => document.querySelector('[data-form=tasks]').innerText)));
  await clk(page, '[data-act=report][data-id="e1_bot-siggi"]'); await page.waitForTimeout(200);
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 800; c.height = 600; c.getContext('2d').fillRect(0, 0, 400, 300); const b = await new Promise(r => c.toBlob(r, 'image/jpeg')), dt = new DataTransfer(); dt.items.add(new File([b], 'x.jpg', { type: 'image/jpeg' })); const i = document.querySelector('[data-proofin][capture]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => !document.querySelector('[data-act=reportSend]')?.disabled, null, { timeout: 10000 });
  await clk(page, '[data-act=reportSend]'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('cdf-demo-v1')));
  ok('neu gemeldet: Ablehnung weg, neues Foto', !st.taskDone['e1_bot-siggi_demo-me'].rejectedBy && st.proofs['e1_bot-siggi_demo-me'].img.length > 100);
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}
{
  // Heute: offene Prüfungen in der Bestätigen-Karte, „Prüfen“ springt zur Aufgabe mit offenem Foto
  const m8 = me(); m8.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m8.myWeights[0] = 98;
  const { page, ctx, errs } = await open({ now: at(12, 18), mine: m8 });
  ok('Bestätigen-Karte nennt Julians Aufgabe', await page.evaluate(() => /Julian.*1 Stunde schwimmen/.test(document.querySelector('.okc')?.innerText.replace(/\n/g, ' ') || '')));
  await clk(page, '.okc [data-act=toProof]'); await page.waitForTimeout(400);
  ok('springt zu Challenges, Foto offen', await page.evaluate(() => location.hash === '#challenges' && !!document.querySelector('.proofp img[data-proof="e1_bot-julian_bot-julian"]')));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}
{
  // Firebase-Mock: Foto und Meldung in einem Batch, Foto per getDoc erst beim Ansehen
  const HSx = HS.map(h => ({ ...h, confirm: false }));
  const pl = n => ({ name: n, habits: HSx, habitSets: { 1: HSx }, extraHabits: [], maxLossPct: 8, joinedSlot: 0, joinedAt: 1, lastActive: Date.now(), invite: 'X', onboardingDone: true });
  const store = { 'players/me': pl('Robbi'), 'players/sig': pl('Siggi'), 'weighins/me_0': { uid: 'me', slot: 0, lossPct: 0 }, 'weighins/sig_0': { uid: 'sig', slot: 0, lossPct: 0 }, 'players/me/private/weights': { slots: { 0: 98 } },
    'tasks/e1_sig': { etappe: 1, text: 'Schwimmen', createdBy: 'sig', createdByName: 'Siggi', ts: 1 }, 'taskDone/e1_sig_sig': { uid: 'sig', taskId: 'e1_sig', confirmedBy: null, ts: 2, proof: true, note: 'Bahn 3' },
    'proofs/e1_sig_sig': { uid: 'sig', taskId: 'e1_sig', img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', w: 1, h: 1, ts: 2 } };
  const { page, ctx, errs } = await open({ fb: { user: { uid: 'me', displayName: 'Robbi' }, store }, tab: 'challenges', w: 1440 });
  await clk(page, '[data-act=proofOpen][data-id="e1_sig_sig"]');
  await page.waitForFunction(() => document.querySelector('img[data-proof="e1_sig_sig"]')?.naturalWidth > 0, null, { timeout: 5000 });
  ok('Foto per getDoc geladen', true);
  await clk(page, '[data-act=report][data-id="e1_sig"]');
  await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; c.getContext('2d').fillRect(0, 0, 800, 600); const b = await new Promise(r => c.toBlob(r, 'image/png')), dt = new DataTransfer(); dt.items.add(new File([b], 'x.png', { type: 'image/png' })); const i = document.querySelector('[data-proofin]:not([capture])'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => !document.querySelector('[data-act=reportSend]')?.disabled, null, { timeout: 10000 });
  await clk(page, '[data-act=reportSend]'); await page.waitForTimeout(400);
  const w = await page.evaluate(() => window.__FBM.writes.filter(x => /proofs|taskDone/.test(x.path)).map(x => ({ op: x.op, path: x.path, len: x.data?.img?.length, proof: x.data?.proof })));
  ok('Batch: proofs + taskDone', w.length === 2 && w[0].path === 'proofs/e1_sig_me' && w[0].len < 200000 && w[1].path === 'taskDone/e1_sig_me' && w[1].proof === true, JSON.stringify(w));
  await clk(page, '[data-act=proofOpen][data-id="e1_sig_sig"]'); await clk(page, '[data-act=confirm][data-id="e1_sig_sig"]'); await page.waitForTimeout(300);
  ok('Bestätigen schreibt confirmedBy', await page.evaluate(() => window.__FBM.store['taskDone/e1_sig_sig'].confirmedBy === 'me'));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n7) Erklärungen: ?-Knöpfe, Bottom Sheet (Handy), Popover (Desktop), Regeln aus denselben Texten');
{
  const m9 = me({ extraHabits: [{ name: '10 Min lesen', target: 5 }] }); m9.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m9.myWeights[0] = 98;
  const { page, ctx, errs } = await open({ now: at(9, 18), mine: m9 });
  const qs = await page.evaluate(() => [...document.querySelectorAll('#app .qbtn')].map(b => b.getAttribute('aria-label')));
  ok(`Heute: ${qs.length} ?-Knöpfe, alle mit „Erklärung: …“`, qs.length >= 6 && qs.every(l => /^Erklärung: \S/.test(l)), qs.join(' | '));
  await clk(page, '[data-form=habits] .hd .qbtn'); await page.waitForTimeout(200);
  ok('Handy: Bottom Sheet mit Titel', await page.evaluate(() => !!document.querySelector('#help.sheetm .helpbox[role=dialog]') && document.getElementById('helpT')?.textContent === 'Habits und Wochenziele'));
  ok('Fokus im Sheet', await page.evaluate(() => !!document.activeElement?.closest('#help')));
  await storm(page);
  ok('bleibt beim Neuzeichnen offen', await page.evaluate(() => !!document.querySelector('#help .helpbox')));
  await page.keyboard.press('Escape');
  ok('Escape schließt, Fokus zurück auf ?', await page.evaluate(() => !document.querySelector('#help .helpbox') && document.activeElement?.classList.contains('qbtn')));
  await clk(page, '[data-act=profile]'); await page.waitForTimeout(300);
  await clk(page, '#modal .qbtn[data-k=pause]'); await page.waitForTimeout(200);
  ok('im Profil: Pause erklärt, über dem Profil', await page.evaluate(() => document.getElementById('helpT')?.textContent === 'Pause' && !!document.querySelector('#modal .sheet')));
  await page.keyboard.press('Escape');
  ok('Escape schließt nur die Erklärung', await page.evaluate(() => !document.querySelector('#help .helpbox') && !!document.querySelector('#modal .sheet')));
  await page.keyboard.press('Escape');
  // Regeln: jeder Eintrag 2–5 Sätze + Beispiel mit Zahlen
  await clk(page, '[data-tab=regeln]'); await page.waitForTimeout(300);
  const secs = await page.evaluate(() => [...document.querySelectorAll('.rules .rs[id^=r-]')].map(r => ({ k: r.id, n: r.querySelectorAll('.hl > li').length, ex: r.querySelector('.hx')?.textContent || '' })));
  const bad = secs.filter(x => x.n < 2 || x.n > 5 || !/^Beispiel: .*\d/.test(x.ex));
  ok(`Regeln: ${secs.length} Abschnitte aus HELP, je 2–5 Sätze + Beispiel mit Zahlen`, secs.length >= 19 && !bad.length, JSON.stringify(bad));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}
{
  const m10 = me(); m10.weighins['demo-me_0'] = { uid: 'demo-me', slot: 0, lossPct: 0, ts: at(0, 8) }; m10.myWeights[0] = 98;
  const { page, ctx, errs } = await open({ now: at(9, 18), mine: m10, w: 1440 });
  await clk(page, '[data-form=weekly] .qbtn'); await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const b = document.querySelector('#help.pop .helpbox')?.getBoundingClientRect(); return b && { l: b.left, r: b.right, t: b.top, b: b.bottom, w: innerWidth, h: innerHeight }; });
  ok('Desktop: Popover im Fenster', !!r && r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h, JSON.stringify(r));
  ok('Popover-Text aus CONFIG (Wochenletzter, 12 Std.)', /Wochenletzte 12 Stunden lang allein/.test(await page.evaluate(() => document.querySelector('#help').innerText)));
  await page.mouse.click(700, 120); await page.waitForTimeout(150);
  ok('Klick daneben schließt', await page.evaluate(() => !document.querySelector('#help .helpbox')));
  // Einführung nutzt dieselben Texte
  await clk(page, '[data-tab=regeln]'); await clk(page, '[data-act=obOpen]'); await page.waitForTimeout(300);
  ok('Einführung: Punkte-Text aus HELP', /Jede Woche zählt neu: Waage bis/.test(await page.evaluate(() => document.querySelector('#modal').innerText)));
  ok('keine Skriptfehler', !errs.length, errs.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\n${oks} ok, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
