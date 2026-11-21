/* Club der Fettsäcke – App (ES-Modul, kein Build). Styles: style.css, Hülle: index.html.
   Nach Änderungen an app.js/style.css in index.html die ?v=… Nummer hochzählen, sonst laden Browser bis zu 10 Min. die alte Datei. */

/* =====================================================================
   KONFIGURATION – hier anpassen
   ===================================================================== */
const CONFIG = {
  firebase: {
    apiKey: "AIzaSyBurXm-bT9lu_O_QddU_eUO2MwkjgmXUmo",
    authDomain: "club-der-fettsaecke.firebaseapp.com",
    projectId: "club-der-fettsaecke",
    storageBucket: "club-der-fettsaecke.firebasestorage.app",
    messagingSenderId: "121079785562",
    appId: "1:121079785562:web:a808ec1074af013dd49063"
  },
  testMode: true,    // TEST: true = Zeit per URL ?now=2026-11-30T09:00 simulierbar. VOR DEM START WIEDER AUF false!
  start: { y: 2026, m: 11, d: 23 }, // Montag, 23.11.2026 (muss ein Montag sein!)
  weeks: 24,          // Saisonlänge in Wochen (24 = ca. 6 Monate)
  etappeWeeks: 4,     // Wochen pro Etappe ("Monat")
  einsatz: 5,         // € Einsatz pro Person (einmalig)
  strafe: 1,          // € pro verpasstem Wiegen
  habitFee: 0.5,      // € pro Woche, in der nicht alle 3 Wochenziele erreicht sind (zählt, sobald die Woche nicht mehr nachgetragen werden kann)
  loserFee: 0.5,      // € für den Letzten im Wochenranking
  habitMaxPts: 4,     // Punkte pro Gewohnheit und Woche, wenn ihr Wochenziel erreicht ist (anteilig darunter)
  pauseWeeks: 2,      // so viele Wochen darf jeder pro Saison pausieren (krank, Urlaub)
  holdBand: 1,        // Haltephase (Ziel erreicht): Woche zählt, wenn das Wiegen höchstens so viele Prozentpunkte vom Ziel abweicht
  weighStartHour: 3,  // Wiegen montags ab 3:00 Uhr …
  deadlineHour: 14,   // … bis 14:00 Uhr
  chooseHours: 12,    // so lange darf NUR der Wochenletzte die Challenge wählen, danach jeder
  backfillDays: 2,    // Gewohnheiten bis zu 2 Tage nachtragen
  weighPerTenth: 3,   // Waage-Punkte pro 0,1 % unter dem bisherigen Tiefstwert
  weighMaxTenths: 10, // max. 1 % pro Woche zählt (= 30 Punkte, ca. 60 % einer realistischen Woche)
  challengePts: 4,    // max. Punkte Wochen-Challenge (täglich: 1 pro Tag bis 4; 1×: 4; 2×: je 2)
  taskPts: 10,        // Punkte pro Extra-Aufgabe (jeder stellt 1 Aufgabe pro Etappe)
  teamPts: 5,         // Team-Monat: Punkte für jeden, der etwas eingetragen hat, wenn ALLE gezogenen Ziele erreicht sind
  teamDraw: 3,        // so viele Vorschläge werden pro Etappe für den Team-Monat gezogen
  activeEveryMin: 10, // "zuletzt aktiv" höchstens alle 10 Min. speichern
  vapidKey: '',       // Web-Push-Schlüssel (Firebase-Konsole → Projekteinstellungen → Cloud Messaging → Web-Push-Zertifikate). Leer = Erinnerungen aus.
};
// Wenn du start/weeks änderst: auch START_MS in firestore.rules und SEASON in reminders/send.mjs anpassen.
// Zum Ausprobieren ohne Firebase: ?demo an die URL hängen (lokale Daten), ?demo&bots=18 simuliert bis zu 20 Spieler.

/* ===================================================================== */
const DAY = 864e5;
const START = new Date(CONFIG.start.y, CONFIG.start.m - 1, CONFIG.start.d);
const QS = new URLSearchParams(location.search);
const DEMO = !CONFIG.firebase || QS.has('demo');
// Spielerfarben: 10 feste, danach im goldenen Winkel verteilt (beliebig viele Spieler)
const colorOf = i => i < 10 ? `var(--p${i + 1})` : `hsl(${Math.round((i * 137.508) % 360)} 90% 68%)`;

/* ---------- Zeit ---------- */
let NOW_OVERRIDE = null;
const now = () => NOW_OVERRIDE ? new Date(NOW_OVERRIDE) : new Date();
const dayDate = d => new Date(START.getFullYear(), START.getMonth(), START.getDate() + d);
const dayIdx = (t = now()) => Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - START) / DAY);
const slotStart = k => dayDate(7 * k);
const slotOpen = k => { const x = dayDate(7 * k); x.setHours(CONFIG.weighStartHour); return x; };
const slotDeadline = k => { const x = dayDate(7 * k); x.setHours(CONFIG.deadlineHour); return x; };
const weighHours = `${CONFIG.weighStartHour}–${CONFIG.deadlineHour} Uhr`;
const weekOfDay = d => d < 0 ? 0 : Math.floor(d / 7) + 1;
const curWeek = () => Math.min(weekOfDay(dayIdx()), CONFIG.weeks + 1); // 0 = vor Start, weeks+1 = vorbei
const etappeOf = w => Math.max(1, Math.ceil(w / CONFIG.etappeWeeks));
const NUM_ETAPPEN = Math.ceil(CONFIG.weeks / CONFIG.etappeWeeks);
function lastClosedSlot() { const t = now(); let k = -1; for (let i = 0; i <= CONFIG.weeks; i++) { if (slotDeadline(i) <= t) k = i; else break; } return k; }
function openSlot() { const t = now(), d = dayIdx(t); if (d >= 0 && d % 7 === 0 && d / 7 <= CONFIG.weeks && t >= slotOpen(d / 7) && t < slotDeadline(d / 7)) return d / 7; return null; }
function nextJoinSlot() { const t = now(); for (let k = 0; k < CONFIG.weeks; k++) if (slotDeadline(k) > t) return k; return null; }
const seasonOver = () => lastClosedSlot() >= CONFIG.weeks;

/* ---------- Helfer ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmt1 = x => x.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = x => Math.round(x).toLocaleString('de-DE');
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const fmtD = d => `${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
const fmtLong = d => `${WDL[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
const lossStr = x => (x > 0.049 ? '−' : x < -0.049 ? '+' : '±') + fmt1(Math.abs(x)) + ' %';
// 5 € / 0,50 € / 2,50 €: Cent nur, wenn es welche gibt
const eur = x => { const c = Math.round(x * 100); return (c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }).replace('-', '−') + ' €'; };
const ptsStr = n => n === 1 ? '1 Punkt' : n + ' Punkte';
const tn = s => String(s).replace(/[,.]/g, m => `<span class="pp">${m}</span>`);
const andJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' und ' + a[a.length - 1];
function countdown(to) {
  let s = Math.max(0, Math.floor((to - now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60);
  return d > 0 ? `${d} T ${h} Std` : h > 0 ? `${h} Std ${m} Min` : `${m} Min`;
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 3600); }
function safeLS() { try { const k = '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; } catch { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k] }; } }
const LS = safeLS();
// Strich-Icons (24er Raster, 1,5 px)
const I = {
  heute: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15.2l2 2 4-4"/>',
  ranking: '<path d="M3 20.5h18M5 20.5v-6h4v6M10 20.5v-12h4v12M15 20.5v-4h4v4"/>',
  challenges: '<path d="M5.5 21V4M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  verlauf: '<path d="M3.5 4v16.5H21"/><path d="M7 8.5l4 4 3-3 5 5.5"/>',
  regeln: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5M9 12.5h7M9 16.5h7"/>',
  check: '<path d="M5.5 12.5l4 4 9-9.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  prev: '<path d="M14.5 6l-6 6 6 6"/>',
  next: '<path d="M9.5 6l6 6-6 6"/>',
  flame: '<path d="M12 3c.7 3.3 5.5 5.2 5.5 10.3a5.5 5.5 0 0 1-11 0c0-2.5 1.2-4.1 2.5-5.3.2 1.8 1.1 3 2.2 3.4C10.9 8.7 11.1 5.6 12 3z"/>',
};
const svg = (k, c = 'ico') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${I[k]}</svg>`;
Object.assign(I, {
  ich: '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20.5c.9-4 3.8-6.25 7.5-6.25s6.6 2.25 7.5 6.25"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7.5 10.5a5 5 0 0 1 9 0M12 10.5l1.75-2.5"/>',
  double: '<path d="M2.5 12.5l4 4 8.5-9M11.5 16l.5.5 8.5-9"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  team: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5c.6-3.2 2.7-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.5"/><path d="M15.7 14.6c2.5-.2 4.2 1.5 4.8 4.9"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  spark: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2L18 18M6 18l2.8-2.8M15.2 8.8L18 6"/>',
});

/* =====================================================================
   PUNKTE-LOGIK
   ===================================================================== */
/* Gewohnheiten: 3 Stück, jede mit eigenem Wochenziel (1–7×). Alte Einträge (nur Text) gelten als 7×.
   Gespeichert pro Etappe in habitSets { <Etappe>: [...] }, weil Änderungen (1. Woche einer Etappe) nicht rückwirkend gelten dürfen. */
const HABIT_DEFAULT_T = 7;
const habitMax = () => 3 * CONFIG.habitMaxPts;
function normHabits(hs) {
  return [0, 1, 2].map(i => { const h = hs?.[i]; return typeof h === 'string' ? { name: h, target: HABIT_DEFAULT_T } : { name: String(h?.name || ''), target: clamp(Math.round(+h?.target) || HABIT_DEFAULT_T, 1, 7) }; });
}
function habitsFor(p, w) { // gültige Gewohnheiten für Woche w: Satz der Etappe (oder der letzte davor)
  const sets = p?.habitSets || {}, ks = Object.keys(sets).map(Number).filter(k => k > 0).sort((a, b) => a - b);
  if (!ks.length) return normHabits(p?.habits);
  const e = etappeOf(Math.max(1, w)), k = ks.filter(x => x <= e).pop() ?? ks[0];
  return normHabits(sets[k]);
}
const habitPts = (done, t) => Math.round(CONFIG.habitMaxPts * Math.min(done, t) / t);
const tickCounts = (hl, w) => { const c = [0, 0, 0, 0]; for (let d = 7 * (w - 1); d < 7 * w; d++) if (hl[d]) for (let i = 0; i < 4; i++) if (hl[d][i]) c[i]++; return c; };
const weekFinal = w => 7 * w - 1 + CONFIG.backfillDays < dayIdx(); // letzter Tag der Woche kann nicht mehr nachgetragen werden

let TEAM = {}; // Etappe -> Stand des Team-Monats (wird in compute() gesetzt)
function compute(S) {
  const C = {};
  const lc = lastClosedSlot();
  const ordered = Object.entries(S.players).sort((a, b) => (tsNum(a[1].joinedAt) - tsNum(b[1].joinedAt)) || a[0].localeCompare(b[0]));
  const hlBy = {};
  for (const h of Object.values(S.habitlogs)) (hlBy[h.uid] ||= {})[h.day] = h.done || [];
  ordered.forEach(([uid, p], idx) => {
    const js = p.joinedSlot || 0;
    const wb = {};
    for (const w of Object.values(S.weighins)) if (w.uid === uid && typeof w.lossPct === 'number') wb[w.slot] = w.lossPct;
    const active = wb[js] !== undefined;
    /* Pause (krank, Urlaub): Woche w = Haken Mo–So von Woche w + Wiegen am Montag danach (Slot w). Keine Punkte, keine Strafen,
       nicht im Wochenranking und nicht Wochenletzter, Streak bleibt stehen. Das nächste Wiegen vergleicht wie immer mit dem Tiefstwert. */
    const paused = new Set((Array.isArray(p.pausedWeeks) ? p.pausedWeeks : []).filter(w => Number.isInteger(w) && w > js && w <= CONFIG.weeks));
    // persönliches Ziel (max. Abnahme in % vom Startgewicht), fest ab dem Startgewicht; goalWeek = erstes Wiegen mit lossPct >= Ziel
    const goal = typeof p.maxLossPct === 'number' && p.maxLossPct > 0 ? p.maxLossPct : null;
    let goalWeek = null;
    if (goal) for (let k = js + 1; k <= CONFIG.weeks; k++) if (!paused.has(k) && wb[k] !== undefined && wb[k] >= goal - 1e-9) { goalWeek = k; break; }
    const hl = hlBy[uid] || {};
    const weeks = {};
    let best = 0;
    /* Haltephase: ab der Woche nach dem Erreichen des Ziels. Nur das Wiegen ist Pflicht. Liegt es höchstens holdBand Prozentpunkte
       neben dem Ziel: volle Waage-Punkte + Bonus (3 × habitMaxPts), dazu Gewohnheiten/Challenge, alles zusammen höchstens das normale
       Wochenmaximum. Daneben: 0 Waage-Punkte, kein Bonus. */
    const wMax = CONFIG.weighMaxTenths * CONFIG.weighPerTenth, cap = wMax + habitMax() + CONFIG.challengePts;
    // Ausgestiegen (Ziel erreicht): nur Wochen bis finishedWeek zählen, danach keine Punkte und keine Strafen
    const finished = p.status === 'finished' && Number.isInteger(p.finishedWeek), lastW = finished ? Math.min(p.finishedWeek, CONFIG.weeks) : CONFIG.weeks;
    for (let w = js + 1; w <= lastW; w++) {
      if (paused.has(w)) { weeks[w] = { paused: true, weigh: 0, habits: 0, bonus: 0, weekly: 0, chCnt: 0, cnt: tickCounts(hl, w), targets: habitsFor(p, w).map(h => h.target), met: false, hold: goalWeek !== null && w > goalWeek, inBand: false, total: 0, weighed: wb[w] !== undefined }; continue; }
      const has = wb[w] !== undefined, hold = goalWeek !== null && w > goalWeek;
      const inBand = hold && has && Math.abs(wb[w] - goal) <= CONFIG.holdBand + 1e-9;
      const weigh = hold ? (inBand ? wMax : 0) : has ? clamp(Math.floor((wb[w] - best) * 10 + 1e-6), 0, CONFIG.weighMaxTenths) * CONFIG.weighPerTenth : 0;
      if (has) best = Math.max(best, wb[w]);
      const H = habitsFor(p, w), cnt = tickCounts(hl, w);
      const habits = H.reduce((s, h, i) => s + habitPts(cnt[i], h.target), 0);
      const met = H.every((h, i) => cnt[i] >= h.target);
      const weekly = challengePoints(S.weekly[w], cnt[3]);
      const bonus = inBand ? Math.max(0, Math.min(habitMax(), cap - weigh - habits - weekly)) : 0;
      weeks[w] = { weigh, habits, bonus, weekly, chCnt: cnt[3], cnt, targets: H.map(h => h.target), met, hold, inBand, total: weigh + bonus + habits + weekly, weighed: has };
    }
    // Wochen ohne alle 3 Wochenziele, die nicht mehr nachgetragen werden können (kosten CONFIG.habitFee; in der Haltephase freiwillig)
    const missedHabitWeeks = [];
    if (active) for (let w = js + 1; w <= lastW && weekFinal(w); w++) if (!weeks[w].met && !weeks[w].hold && !weeks[w].paused) missedHabitWeeks.push(w);
    const taskPts = {};
    for (const td of Object.values(S.taskDone)) {
      const t = S.tasks[td.taskId];
      if (td.uid === uid && td.confirmedBy && t && t.etappe <= etappeOf(lastW)) taskPts[t.etappe] = (taskPts[t.etappe] || 0) + CONFIG.taskPts;
    }
    const missedSlots = [];
    if (active) for (let k = js + 1; k <= Math.min(lc, lastW); k++) if (wb[k] === undefined && !paused.has(k)) missedSlots.push(k);
    const missed = missedSlots.length;
    const slots = Object.keys(wb).map(Number).sort((a, b) => a - b);
    const latest = slots.length ? wb[slots[slots.length - 1]] : 0;
    // längste Serie Wiegen ohne Verpassen (für Meilensteine)
    let run = 0, weighRun = 0;
    if (active) for (let k = js + 1; k <= lastW; k++) { if (paused.has(k)) continue; if (wb[k] !== undefined) weighRun = Math.max(weighRun, ++run); else if (k <= lc) run = 0; else break; }
    const x = { uid, name: p.name, js, wb, hl, active, goal, goalWeek, hold: active && goalWeek !== null && !finished, finished, paused: [...paused].sort((a, b) => a - b), fw: lastW, finishedAt: tsNum(p.finishedAt), weeks, taskPts, teamPts: {}, missed, missedSlots, missedHabitWeeks, loserWeeks: [], latest, color: colorOf(idx), idx,
      weighRun, bestLoss: Math.max(0, ...Object.values(wb)), lastActive: tsNum(p.lastActive) };
    x.streak = active ? streakOf(x) : { cur: 0, best: 0, joker: true, jokerWeek: null };
    x.ms = MILESTONES.filter(m => m.test(x)).map(m => m.id);
    C[uid] = x;
  });
  for (let w = 1; w <= Math.min(lc, CONFIG.weeks); w++) for (const u of weekLosers(C, w)) C[u].loserWeeks.push(w);
  // Team-Monat: Bonus für jeden mit Eintrag, wenn am Ende der Etappe alle gezogenen Ziele erreicht sind
  TEAM = {};
  for (let e = 1; e <= NUM_ETAPPEN; e++) {
    const t = teamMonth(S, C, e); if (!t) continue;
    TEAM[e] = t;
    if (t.closed && t.reached) for (const u of Object.keys(t.by)) if (C[u] && !(C[u].finished && C[u].fw < etEndWeek(e))) C[u].teamPts[e] = CONFIG.teamPts;
  }
  return C;
}
function chTarget(ch) { return ch?.kind === 'daily' ? 7 : clamp(ch?.target || 1, 1, 7); }
function challengePoints(ch, n) {
  if (!ch || !n) return 0;
  if (ch.kind === 'daily') return Math.min(n, CONFIG.challengePts);
  const t = chTarget(ch); return Math.min(n, t) * Math.round(CONFIG.challengePts / t);
}
const chLabel = ch => ch.kind === 'daily' ? 'täglich' : chTarget(ch) + '× diese Woche';
function weekLosers(C, w) { // Letzte(r) einer abgeschlossenen Woche, nur wenn nicht alle gleich
  const r = rankWeek(C, w); if (r.length < 2) return [];
  const min = Math.min(...r.map(x => x.total)), max = Math.max(...r.map(x => x.total));
  return min === max ? [] : r.filter(x => x.total === min).map(x => x.uid);
}
function fees(p, e) { // e = Etappe oder null für gesamt
  const inE = w => e === null || etappeOf(w) === e;
  const einsatz = p.active && (e === null || etappeOf(p.js + 1) === e) ? CONFIG.einsatz : 0;
  // Ausstieg mit erreichtem Ziel: Einsatz zurück (in der Etappe des Ausstiegs), Strafen bis dahin bleiben im Topf
  const refund = p.active && p.finished && (e === null || etappeOf(Math.min(p.fw + 1, CONFIG.weeks)) === e) ? CONFIG.einsatz : 0;
  const missed = p.missedSlots.filter(inE).length, losers = p.loserWeeks.filter(inE).length, habitWeeks = p.missedHabitWeeks.filter(inE).length;
  const strafen = missed * CONFIG.strafe + losers * CONFIG.loserFee + habitWeeks * CONFIG.habitFee;
  return { einsatz, refund, missed, losers, habitWeeks, strafen, total: einsatz - refund + strafen };
}
const fmtDT = d => fmtD(d) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const exclusiveUntil = w => new Date(slotDeadline(w - 1).getTime() + CONFIG.chooseHours * 3600e3);
function tsNum(t) { if (!t) return 0; if (typeof t === 'number') return t; if (t.toMillis) return t.toMillis(); if (t.seconds) return t.seconds * 1000; return 0; }
function sortRank(arr) { return arr.sort((a, b) => b.total - a.total || b.latest - a.latest || a.name.localeCompare(b.name)); }
function rankWeek(C, w) {
  return sortRank(Object.values(C).filter(p => p.active && p.js < w && p.weeks[w] && !p.weeks[w].paused).map(p => ({ ...p.weeks[w], habits: p.weeks[w].habits + p.weeks[w].bonus, uid: p.uid, name: p.name, color: p.color, latest: p.latest, tasks: 0 })));
}
function rankRange(C, wFrom, wTo, etappen) {
  // Ausgestiegene nur in Etappen, die vor ihrem Ausstieg schon fertig waren (Gesamt: eigener Abschnitt "Ziel erreicht")
  return sortRank(Object.values(C).filter(p => p.active && p.js < wTo && !(p.finished && p.fw < wTo)).map(p => {
    const r = { uid: p.uid, name: p.name, color: p.color, latest: p.latest, weigh: 0, habits: 0, weekly: 0, team: 0, tasks: 0, missed: p.missed };
    for (let w = wFrom; w <= wTo; w++) if (p.weeks[w]) { r.weigh += p.weeks[w].weigh; r.habits += p.weeks[w].habits + p.weeks[w].bonus; r.weekly += p.weeks[w].weekly; }
    for (const e of etappen) { r.tasks += p.taskPts[e] || 0; r.team += p.teamPts[e] || 0; }
    r.total = r.weigh + r.habits + r.weekly + r.team + r.tasks;
    return r;
  }));
}
const rankTotal = C => rankRange(C, 1, CONFIG.weeks, Array.from({ length: NUM_ETAPPEN }, (_, i) => i + 1));
const rankEtappe = (C, e) => rankRange(C, (e - 1) * CONFIG.etappeWeeks + 1, Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks), [e]);
function pot(C) { const r = { total: 0, players: 0, refunds: 0, missed: 0, losers: 0, habitWeeks: 0 }; for (const p of Object.values(C)) if (p.active) { const f = fees(p, null); r.total += f.total; r.players++; r.refunds += f.refund ? 1 : 0; r.missed += f.missed; r.losers += f.losers; r.habitWeeks += f.habitWeeks; } return r; }
// eingefrorenes Ergebnis nach dem Ausstieg: "−15,2 % · Ziel nach 18 Wochen"
const frozenLine = p => `${tn(lossStr(p.wb[p.fw] ?? p.latest))} · Ziel nach ${wochen(p.goalWeek - p.js)}`;
const frozenPts = p => Object.values(p.weeks).reduce((s, w) => s + w.total, 0) + Object.values(p.taskPts).reduce((a, b) => a + b, 0) + Object.values(p.teamPts).reduce((a, b) => a + b, 0);
// Aussteigen geht, sobald das Ziel bei einem Wiegen erreicht war und das letzte Wiegen im Ziel-Band liegt
const canExit = me => !!me?.active && me.goalWeek !== null && !me.finished && !seasonOver() && me.latest >= me.goal - CONFIG.holdBand - 1e-9;
function weeklySetters(C, w) { // null = jeder, [] = noch offen
  if (w <= 1) return null;
  if (lastClosedSlot() < w - 1) return [];
  const r = rankWeek(C, w - 1); if (!r.length) return null;
  const min = Math.min(...r.map(x => x.total)); return r.filter(x => x.total === min).map(x => x.uid);
}
function canSetWeekly(S, C, w) {
  if (S.weekly[w] || w < 1 || w > CONFIG.weeks || C[S.me]?.finished) return false;
  const cw = curWeek();
  if (w === 1) return cw <= 1;
  if (cw !== w || now() < slotDeadline(w - 1)) return false; // erst nach dem Wiegen
  if (now() >= exclusiveUntil(w)) return true;                // danach: jeder, wer zuerst kommt
  const s = weeklySetters(C, w); return s === null || s.includes(S.me);
}
// Gewohnheiten ändern: vor dem Start, in der 1. Woche jeder Etappe und vor dem eigenen Start (Spätstarter)
const habitsEditable = (js = 0) => { const cw = curWeek(); return cw === 0 || (cw <= CONFIG.weeks && ((cw - 1) % CONFIG.etappeWeeks === 0 || cw <= js)); };
const habitEtappe = js => Math.max(etappeOf(clamp(curWeek(), 1, CONFIG.weeks)), etappeOf(js + 1)); // für diese Etappe gilt eine Änderung jetzt
function taskEditable(e) { const cw = curWeek(); if (cw === 0) return e === 1; const end = Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks); return (etappeOf(cw) === e && cw <= CONFIG.weeks) || (now() < slotDeadline(end)); }

/* ---------- Team-Monat ----------
   Jeder schlägt pro Etappe ein Ziel vor: "pro Person X pro Tag/Woche/Monat". Am ersten Montag der Etappe (Wiegeschluss)
   werden CONFIG.teamDraw Vorschläge zufällig, aber für alle gleich gezogen (Zufall aus der Etappe und den Vorschlägen).
   Das Teamziel = Satz pro Person × Spielerwochen in der Etappe (wer später einsteigt, zählt nur seine Wochen). */
const etFirstWeek = e => (e - 1) * CONFIG.etappeWeeks + 1;
const etEndWeek = e => Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks);
const drawTime = e => slotDeadline(etFirstWeek(e) - 1);
const PERIOD = { day: 'Tag', week: 'Woche', month: 'Monat' };
const perWeek = i => (+i.per || 0) * (i.period === 'day' ? 7 : i.period === 'week' ? 1 : 1 / CONFIG.etappeWeeks);
function ideasFor(S, e) {
  const dt = drawTime(e).getTime();
  return Object.entries(S.teamideas || {}).filter(([, x]) => x.etappe === e && x.text)
    // nach der Ziehung eingereichte Vorschläge ignorieren (nur mit echter Uhrzeit prüfbar)
    .filter(([, x]) => NOW_OVERRIDE || !tsNum(x.ts) || tsNum(x.ts) <= dt + 5 * 60e3)
    .map(([id, x]) => ({ ...x, id })).sort((a, b) => a.id.localeCompare(b.id));
}
function drawIdeas(list, e) { // deterministisch: alle Geräte ziehen dieselben
  const r = rng('team-e' + e + '|' + list.map(x => x.id + x.text).join('|')), a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, CONFIG.teamDraw);
}
function teamMonth(S, C, e) {
  if (now() < drawTime(e)) return null;
  const tasks = drawIdeas(ideasFor(S, e), e); if (!tasks.length) return null;
  const w0 = etFirstWeek(e), w1 = etEndWeek(e), d0 = 7 * (w0 - 1), d1 = 7 * w1;
  let pw = 0; // Spielerwochen
  for (const p of Object.values(C)) if (p.active) for (let w = w0; w <= w1; w++) if (w > p.js && (!p.finished || w <= p.fw) && !p.weeks[w]?.paused) pw++;
  const by = {}, sums = {};
  for (const l of Object.values(S.teamlogs || {})) {
    if (!l.vals || l.day < d0 || l.day >= d1 || !C[l.uid]?.active || (C[l.uid].finished && l.day >= 7 * C[l.uid].fw)) continue;
    for (const t of tasks) {
      const raw = +l.vals[t.id] || 0, v = t.kind === 'count' ? (raw > 0 ? 1 : 0) : clamp(raw, 0, 1e6);
      if (!v) continue;
      sums[t.id] = (sums[t.id] || 0) + v; const b = (by[l.uid] ||= {}); b[t.id] = (b[t.id] || 0) + v;
    }
  }
  const items = tasks.map(t => { const target = Math.max(1, Math.ceil(perWeek(t) * pw - 1e-9)), sum = sums[t.id] || 0; return { ...t, target, sum, reached: sum >= target }; });
  return { e, items, by, pw, reached: items.every(i => i.reached), closed: lastClosedSlot() >= w1 };
}
const teamFmt = (g, v) => g.kind === 'count' ? `${nf(v)}×` : `${nf(v)}${g.unit ? ' ' + esc(g.unit) : ''}`;
const ideaRate = x => `${teamFmt(x, x.per)} pro Person und ${PERIOD[x.period] || 'Woche'}`;
const nextDrawE = () => { for (let e = 1; e <= NUM_ETAPPEN; e++) if (now() < drawTime(e)) return e; return null; }; // nächste Ziehung
function canSuggest(e) { // Vorschlag für Etappe e: ab Beginn der Vor-Etappe bis zur Ziehung
  return S.member && !C[S.me]?.finished && e >= 1 && e <= NUM_ETAPPEN && now() < drawTime(e) && (e === 1 || now() >= slotStart(etFirstWeek(e - 1) - 1)) && !S.teamideas['e' + e + '_' + S.me];
}
function teamEditable(d, js) { // eigener Wert für Tag d: Nachtragefenster wie Gewohnheiten, bis zum Wiegeschluss nach der Etappe
  const today = dayIdx(), e = etappeOf(weekOfDay(d));
  return d >= 0 && d <= today && d >= today - CONFIG.backfillDays && d >= 7 * js && d < CONFIG.weeks * 7 && now() < slotDeadline(etEndWeek(e)) && !!TEAM[e];
}

/* ---------- Streak, Meilensteine, Aktivität ---------- */
/* Streak = Wochen am Stück mit allen 3 Wochenzielen. Die laufende Woche (und die Vorwoche, solange sie nachgetragen werden kann)
   zählt erst, wenn erledigt, bricht aber nicht. 1 Joker pro Etappe rettet die erste verpasste Woche, in der gerade eine Streak läuft. */
function streakOf(x) {
  const last = Math.min(curWeek(), CONFIG.weeks);
  let cur = 0, best = 0; const used = {};
  for (let w = x.js + 1; w <= last; w++) {
    const wk = x.weeks[w]; if (!wk) continue;
    if (wk.met) { best = Math.max(best, ++cur); continue; }
    if (!weekFinal(w) || wk.hold || wk.paused) continue; // läuft noch, Haltephase (Gewohnheiten freiwillig) oder Pause
    const e = etappeOf(w);
    if (cur > 0 && used[e] === undefined) { used[e] = w; continue; }
    cur = 0;
  }
  const ce = etappeOf(clamp(curWeek(), 1, CONFIG.weeks));
  return { cur, best, joker: used[ce] === undefined, jokerWeek: used[ce] ?? null };
}
const wochen = n => n === 1 ? '1 Woche' : n + ' Wochen';
const MILESTONES = [
  { id: 'goal', cat: 'g', n: 0, label: 'Ziel erreicht' },
  { id: 'l2', cat: 'l', n: 2, label: '−2 %' }, { id: 'l5', cat: 'l', n: 5, label: '−5 %' }, { id: 'l7', cat: 'l', n: 7.5, label: '−7,5 %' }, { id: 'l10', cat: 'l', n: 10, label: '−10 %' },
  { id: 'w4', cat: 'w', n: 4, label: '4 Wochen ohne verpasstes Wiegen', short: '4 Wochen' },
  { id: 'w10', cat: 'w', n: 10, label: '10 Wochen ohne verpasstes Wiegen', short: '10 Wochen' },
  { id: 'w20', cat: 'w', n: 20, label: '20 Wochen ohne verpasstes Wiegen', short: '20 Wochen' },
  { id: 'sw4', cat: 's', n: 4, label: 'Streak 4 Wochen (alle Wochenziele)', short: '4-Wochen-Streak' },
  { id: 'sw12', cat: 's', n: 12, label: 'Streak 12 Wochen (alle Wochenziele)', short: '12-Wochen-Streak' },
].map(m => ({ ...m, test: x => m.cat === 'g' ? x.goalWeek !== null : (m.cat === 'l' ? x.bestLoss : m.cat === 'w' ? x.weighRun : x.streak.best) >= m.n - 1e-9 }));
const MS_BY = Object.fromEntries(MILESTONES.map(m => [m.id, m]));
const topMilestones = p => ['g', 'l', 'w', 's'].map(c => MILESTONES.filter(m => m.cat === c && p.ms.includes(m.id)).pop()).filter(Boolean);
function activity(ts) {
  if (!ts) return null;
  const d = Math.max(0, dayIdx() - dayIdx(new Date(ts)));
  return d === 0 ? { t: 'heute aktiv' } : d === 1 ? { t: 'gestern aktiv' } : { t: `seit ${d} Tagen still`, still: true };
}

/* =====================================================================
   DATENSCHICHT: Demo (lokal) und Firebase
   ===================================================================== */
// Das Ziel (maxLossPct, max. Abnahme in % vom Startgewicht) steht öffentlich auf dem Spieler-Dokument: die anderen brauchen es für
// Haltephase und Ausstieg. Die kg-Werte bleiben privat (players/{uid}/private/weights, nur für den Besitzer).
const emptyState = () => ({ ready: false, synced: false, authed: false, member: false, me: null, players: {}, weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, myWeights: {} });

function rng(seed) { let h = 1779033703 ^ seed.length; for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }

function makeDemoDB(emit) {
  const KEY = 'cdf-demo-v1';
  const ME = 'demo-me';
  const blank = () => ({ player: null, weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {}, myWeights: {}, push: false });
  let mine; try { mine = JSON.parse(LS.getItem(KEY)) || null; } catch { mine = null; }
  mine = { ...blank(), ...(mine || {}) };
  const save = () => LS.setItem(KEY, JSON.stringify(mine));
  const hb = (...a) => a.map(([name, target]) => ({ name, target }));
  const BASE = [
    { uid: 'bot-siggi', name: 'Siggi', start: 104.6, trend: 0.75, disc: 0.8, habits: hb(['Kochen statt Lieferdienst', 5], ['Keine Softdrinks', 7], ['1× 10 km laufen', 1]), joined: 1, idle: 2 / 24 },
    { uid: 'bot-julian', name: 'Julian', start: 91.2, trend: 0.55, disc: 0.65, habits: hb(['Training (min. 45 Min)', 3], ['Kein Alkohol', 5], ['Vor 0 Uhr ins Bett', 6]), joined: 2, idle: 3 },
  ];
  // ?bots=N: mehr simulierte Mitspieler (bis 20), um die Oberfläche mit vielen Leuten zu prüfen
  const EXTRA = ['Mehmet', 'Lena', 'Tobi', 'Kathi', 'Jonas', 'Ali', 'Sarah', 'Paul', 'Nico', 'Jana', 'Ben', 'Marie', 'Felix', 'Anna', 'Lukas', 'Mia', 'Emre', 'Tim'];
  const HAB = [hb(['8.000 Schritte', 5], ['Kein Zucker', 6], ['Vor 23 Uhr schlafen', 4]), hb(['Kein Bier unter der Woche', 4], ['30 Min Bewegung', 3], ['Gemüse zu jeder Mahlzeit', 5]), hb(['Treppe statt Aufzug', 7], ['Kein Snack nach 20 Uhr', 5], ['2× Krafttraining', 2])];
  const nBots = clamp(parseInt(QS.get('bots'), 10) || 2, 2, 2 + EXTRA.length);
  const BOTS = [...BASE, ...EXTRA.map((name, i) => ({ uid: 'bot-' + name.toLowerCase(), name, start: 78 + (i * 7.3) % 42, trend: .25 + (i * .37) % .65, disc: .4 + (i * .13) % .5, habits: HAB[i % 3], joined: 3 + i, idle: (i % 6) * .8 }))].slice(0, nBots);
  const WEEKLY_TXT = [{ text: 'Treppe statt Aufzug', kind: 'daily' }, { text: '2× Sport (min. 45 Min)', kind: 'count', target: 2 }, { text: 'Kein Lieferdienst', kind: 'daily' }, { text: '1× 5 km laufen', kind: 'count', target: 1 }, { text: '20 Min spazieren', kind: 'daily' }];
  const IDEAS = [
    { text: 'Schritte sammeln', kind: 'sum', per: 8000, period: 'day', unit: 'Schritte' },
    { text: 'Sport, mindestens 30 Min', kind: 'count', per: 3, period: 'week', unit: '' },
    { text: 'Laufen', kind: 'sum', per: 20, period: 'month', unit: 'km' },
    { text: 'Tage ohne Alkohol', kind: 'count', per: 5, period: 'week', unit: '' },
    { text: 'Liegestütze', kind: 'sum', per: 300, period: 'week', unit: 'Stück' },
    { text: 'Gemüse zu jeder Mahlzeit', kind: 'count', per: 4, period: 'week', unit: '' },
  ];
  function seed() {
    const S = { players: {}, weighins: {}, habitlogs: {}, weekly: {}, weeklyDone: {}, tasks: {}, taskDone: {}, teamideas: {}, teamlogs: {} };
    const t = now(), tn = t.getTime() - 6e4, today = dayIdx(t), lc = lastClosedSlot(), os = openSlot();
    const past = ms => Math.min(ms, tn); // simulierte Zeitstempel nie in der Zukunft
    for (const b of BOTS) {
      S.players[b.uid] = { name: b.name, habits: b.habits, habitSets: { 1: b.habits }, joinedSlot: 0, joinedAt: b.joined, lastActive: t.getTime() - b.idle * DAY };
      const r = rng(b.uid); let kg = b.start;
      for (let k = 0; k <= CONFIG.weeks; k++) {
        const due = k <= lc || (os === k && b.uid === 'bot-siggi');
        if (!due) break;
        if (k > 0) kg += -b.start * b.trend / 100 + (r() - 0.45) * 0.9;
        if (k > 0 && r() < 0.07) continue; // verpasst
        const ts = past(slotStart(k).getTime() + (6 + rng(b.uid + 'w' + k)() * 5) * 36e5);
        S.weighins[b.uid + '_' + k] = { uid: b.uid, slot: k, lossPct: Math.round((b.start - kg) / b.start * 10000) / 100, ts };
      }
      for (let d = 0; d <= today && d < CONFIG.weeks * 7; d++) {
        const rr = rng(b.uid + d), r2 = rng(b.uid + 'h' + d);
        // Wahrscheinlichkeit pro Tag passend zum Wochenziel (disc = Disziplin)
        const done = [...b.habits.map(h => rr() < Math.min(1, h.target / 7 * (b.disc + .35))), rr() < b.disc - .2];
        const late = d < today && r2() < .12; // manchmal am nächsten Morgen nachgetragen
        const ts = late ? dayDate(d + 1).getTime() + (7 + r2() * 4) * 36e5 : dayDate(d).getTime() + (d === today ? 7 + r2() * 15 : 18 + r2() * 5) * 36e5;
        if (ts > tn) continue; // heute erst, wenn es schon passiert ist
        S.habitlogs[b.uid + '_' + d] = { uid: b.uid, day: d, done, ts };
      }
    }
    for (let w = 1; w <= Math.min(curWeek(), CONFIG.weeks); w++) {
      if (mine.weekly[w]) continue;
      if (w === curWeek() && w > 1 && dayIdx() === 7 * (w - 1)) continue; // Montag: der Wochenletzte ist dran
      const ts = past(w === 1 ? dayDate(-2).getTime() + 20 * 36e5 : slotDeadline(w - 1).getTime() + (1 + (w % 3)) * 36e5);
      S.weekly[w] = { ...WEEKLY_TXT[(w - 1) % WEEKLY_TXT.length], setBy: w % 2 ? 'bot-julian' : 'bot-siggi', setByName: w % 2 ? 'Julian' : 'Siggi', ts };
    }
    // Team-Monat: die ersten Bots reichen Vorschläge ein, sobald das Fenster offen ist (bis zur Etappe nach der aktuellen)
    const ceT = curWeek() >= 1 ? etappeOf(Math.min(curWeek(), CONFIG.weeks)) : 0;
    for (let e = 1; e <= Math.min(ceT + 1, NUM_ETAPPEN); e++) BOTS.slice(0, 4).forEach((b, i) => {
      const from = e === 1 ? dayDate(-6).getTime() : slotStart(etFirstWeek(e - 1) - 1).getTime();
      const ts = from + (1 + i * 3 + (e % 3)) * DAY + 19 * 36e5;
      if (ts > tn) return;
      S.teamideas['e' + e + '_' + b.uid] = { ...IDEAS[(i + e * 2) % IDEAS.length], etappe: e, setBy: b.uid, setByName: b.name, ts };
    });
    const allIdeas = { ...S.teamideas, ...mine.teamideas };
    for (let e = 1; e <= ceT; e++) {
      if (now() < drawTime(e)) continue;
      const tasks = drawIdeas(ideasFor({ teamideas: allIdeas }, e), e); if (!tasks.length) continue;
      for (const b of BOTS) for (let d = 7 * (etFirstWeek(e) - 1); d < 7 * etEndWeek(e) && d < today; d++) {
        const rr = rng(b.uid + 't' + d), vals = {};
        for (const t of tasks) {
          const daily = perWeek(t) / 7, x = rr();
          if (t.kind === 'count') { if (x < daily * (b.disc + .35)) vals[t.id] = 1; }
          else if (x < .8) vals[t.id] = Math.round(daily / .8 * (b.disc + .45) * (.6 + rr() * .8));
        }
        if (Object.keys(vals).length) S.teamlogs[b.uid + '_' + d] = { uid: b.uid, day: d, etappe: e, vals };
      }
    }
    const ce = curWeek() >= 1 ? etappeOf(Math.min(curWeek(), CONFIG.weeks)) : 0;
    for (let e = 1; e <= ce; e++) {
      const e0 = 7 * CONFIG.etappeWeeks * (e - 1), into = today - e0, open = e === ce;
      const at = (dd, h) => past(dayDate(e0 + dd).getTime() + h * 36e5);
      const ta = 'e' + e + '_bot-siggi', tb = 'e' + e + '_bot-julian';
      S.tasks[ta] = { etappe: e, text: '2× 5 km laufen', createdBy: 'bot-siggi', createdByName: 'Siggi', ts: at(0, 19) };
      if (!open || into > 6) S.taskDone[ta + '_bot-siggi'] = { uid: 'bot-siggi', taskId: ta, confirmedBy: 'bot-julian', confirmedByName: 'Julian', ts: at(5, 20), confirmedAt: at(6, 8) };
      if (!open || into > 10) {
        S.tasks[tb] = { etappe: e, text: '1 Stunde schwimmen', createdBy: 'bot-julian', createdByName: 'Julian', ts: at(1, 12) };
        S.taskDone[tb + '_bot-julian'] = { uid: 'bot-julian', taskId: tb, confirmedBy: null, ts: at(10, 18) };
      }
      // weitere Bots machen Siggis Aufgabe mit (nur bei ?bots=…)
      BOTS.slice(2).forEach((b, i) => {
        if (i % 3 || (open && into <= 8 + i)) return;
        S.taskDone[ta + '_' + b.uid] = { uid: b.uid, taskId: ta, confirmedBy: i % 2 ? null : 'bot-siggi', confirmedByName: i % 2 ? null : 'Siggi', ts: at(8 + (i % 5), 17), confirmedAt: i % 2 ? null : at(9 + (i % 5), 9) };
      });
    }
    return S;
  }
  function state() {
    const s = seed();
    const S = { ...emptyState(), ready: true, synced: true, authed: true, me: ME };
    S.member = !!mine.player;
    for (const k of ['players', 'weighins', 'habitlogs', 'weekly', 'weeklyDone', 'tasks', 'taskDone', 'teamideas', 'teamlogs']) S[k] = { ...s[k], ...(k === 'players' ? {} : mine[k]) };
    if (mine.player) S.players[ME] = mine.player;
    S.myWeights = { ...mine.myWeights };
    return S;
  }
  const ts = () => now().getTime();
  const commit = () => { if (mine.player) mine.player.lastActive = ts(); save(); emit(state()); };
  setTimeout(() => emit(state()));
  return {
    demo: true, refresh: () => emit(state()),
    signIn() { }, signOut() { },
    reset() { LS.removeItem(KEY); for (const k of ['cdf-ms-', 'cdf-cel-', 'cdf-wrapped-']) LS.removeItem(k + ME); mine = blank(); commit(); },
    async register(d) { mine.player = { name: d.name, habits: d.habits, habitSets: d.habitSets, maxLossPct: d.maxLossPct, joinedSlot: d.joinedSlot, joinedAt: Date.now(), invite: 'DEMO' }; commit(); },
    async updatePlayer(d) { Object.assign(mine.player, d); commit(); },
    async finish(fw) { Object.assign(mine.player, { status: 'finished', finishedWeek: fw, finishedAt: ts() }); commit(); },
    async saveWeigh(slot, kg, lossPct, player) { mine.weighins[ME + '_' + slot] = { uid: ME, slot, lossPct, ts: ts() }; mine.myWeights[slot] = kg; if (player) Object.assign(mine.player, player); commit(); },
    async setHabit(day, done) { mine.habitlogs[ME + '_' + day] = { uid: ME, day, done, ts: ts() }; commit(); },
    async setWeekly(w, text, kind, target) { mine.weekly[w] = { text, kind, target, setBy: ME, setByName: mine.player.name, ts: ts() }; commit(); },
    async addTask(e, text) { const id = 'e' + e + '_' + ME; mine.tasks[id] = { etappe: e, text, createdBy: ME, createdByName: mine.player.name, ts: ts() }; commit(); },
    async deleteTask(id) { delete mine.tasks[id]; for (const k of Object.keys(mine.taskDone)) if (k.startsWith(id + '_')) delete mine.taskDone[k]; commit(); },
    async markTask(id, on) {
      const k = id + '_' + ME;
      if (on) { mine.taskDone[k] = { uid: ME, taskId: id, confirmedBy: null, ts: ts() }; setTimeout(() => { if (mine.taskDone[k]) { Object.assign(mine.taskDone[k], { confirmedBy: 'bot-julian', confirmedByName: 'Julian', confirmedAt: ts() }); commit(); toast('Julian hat deine Aufgabe bestätigt.'); } }, 2500); }
      else delete mine.taskDone[k];
      commit();
    },
    async confirmTask(tdId) {
      const td = mine.taskDone[tdId] || null;
      const c = { confirmedBy: ME, confirmedByName: mine.player.name, confirmedAt: ts() };
      if (td) Object.assign(td, c);
      else { // Bot-Eintrag: als eigene Kopie übernehmen
        const s = seed().taskDone[tdId]; if (s) mine.taskDone[tdId] = { ...s, ...c };
      }
      commit();
    },
    async addTeamIdea(e, d) { mine.teamideas['e' + e + '_' + ME] = { ...d, etappe: e, setBy: ME, setByName: mine.player.name, ts: ts() }; commit(); },
    async delTeamIdea(id) { delete mine.teamideas[id]; commit(); },
    async setTeamLog(day, etappe, vals) { mine.teamlogs[ME + '_' + day] = { uid: ME, day, etappe, vals }; commit(); },
    pushState: () => mine.push ? 'on' : 'off',
    async enablePush() { mine.push = true; commit(); toast('Demo: Erinnerungen sind nur simuliert, es kommt nichts an.'); },
    async disablePush() { mine.push = false; commit(); toast('Erinnerungen aus.'); },
  };
}

// Service Worker (Push + installierbare App). Pfad relativ, damit er unter /fettsaecke/ läuft.
let SW = null;
function swReady() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(undefined);
  return SW ||= navigator.serviceWorker.register('firebase-messaging-sw.js').then(() => navigator.serviceWorker.ready);
}

async function makeFirebaseDB(cfg, emit) {
  const base = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const [A, Au, F] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
  const app = A.initializeApp(cfg);
  const auth = Au.getAuth(app);
  const db = F.getFirestore(app);
  let S = emptyState(); let unsubs = []; let allSubbed = false; let gen = 0;
  const fire = () => emit({ ...S });
  const fail = e => { console.error(e); toast(e.code === 'permission-denied' ? 'Keine Berechtigung (Regeln/Zeitfenster).' : 'Fehler: ' + (e.message || e)); };
  function subscribeAll() {
    if (allSubbed) return; allSubbed = true;
    // erst rendern/automatisch handeln, wenn ALLE Daten einmal geladen sind
    const need = new Set(['players', 'weighins', 'habitlogs', 'weekly', 'tasks', 'taskDone', 'teamideas', 'teamlogs', 'private']);
    const got = n => { if (need.delete(n) && need.size === 0) S.synced = true; };
    const my = gen;
    // Ein Listener, der mit einem Fehler abbricht, meldet sich nie wieder. Direkt nach der Anmeldung kann das passieren
    // (die Regeln sehen das neue Spieler-Dokument noch nicht) -> dann nach kurzer Pause neu abonnieren statt ewig "Lade…".
    const retry = (name, n, again) => { if (my !== gen) return false; if (n >= 6) return false; setTimeout(() => { if (my === gen) again(n + 1); }, 800 * (n + 1)); return true; };
    // optional = neue Sammlungen: fehlen die Regeln noch, bleibt die App trotzdem benutzbar
    // serverTimestamps 'estimate': eigene, noch nicht bestätigte Zeitstempel sind sofort da (Feed-Reihenfolge)
    const col = (name, optional, n = 0) => unsubs.push(F.onSnapshot(F.collection(db, name), qs => { const o = {}; qs.forEach(d => o[d.id] = d.data({ serverTimestamps: 'estimate' })); S[name] = o; if (name === 'players' && !o[S.me] && S.players[S.me]) o[S.me] = S.players[S.me]; got(name); fire(); },
      e => {
        console.warn(name, e.code);
        if (e.code === 'permission-denied' && !S.synced && retry(name, n, k => col(name, optional, k))) return;
        if (optional) { S[name] = {}; got(name); fire(); } else { fail(e); if (!S.synced) { S.loadError = true; fire(); } }
      }));
    ['players', 'weighins', 'habitlogs', 'weekly', 'tasks', 'taskDone'].forEach(n => col(n));
    ['teamideas', 'teamlogs'].forEach(n => col(n, true));
    const priv = (n = 0) => unsubs.push(F.onSnapshot(F.doc(db, 'players', S.me, 'private', 'weights'), s => {
      const d = s.exists() ? s.data() : {};
      S.myWeights = d.slots || {};
      got('private'); fire();
    }, e => { if (!retry('private', n, priv)) { fail(e); S.loadError = true; fire(); } }));
    priv();
  }
  Au.onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = []; allSubbed = false; gen++; S = emptyState();
    if (!user) { S.ready = true; fire(); return; }
    S.authed = true; S.me = user.uid; S.displayName = user.displayName || '';
    if (LS.getItem('cdf-push-' + user.uid)) messaging().catch(() => { });
    // includeMetadataChanges: erst alles andere abonnieren, wenn das eigene Spieler-Dokument auf dem Server liegt.
    // Sonst lehnen die Regeln (member() = Spieler-Dokument existiert) direkt nach dem Beitreten alle Abfragen ab.
    unsubs.push(F.onSnapshot(F.doc(db, 'players', user.uid), { includeMetadataChanges: true }, snap => {
      if (snap.exists()) { S.players = { ...S.players, [user.uid]: snap.data({ serverTimestamps: 'estimate' }) }; S.member = true; if (!snap.metadata.hasPendingWrites) subscribeAll(); }
      else S.member = false;
      S.ready = true; fire();
    }, e => { S.ready = true; fail(e); fire(); }));
  });
  const me = () => S.me;
  // "zuletzt aktiv": nach eigenen Schreibvorgängen, höchstens alle CONFIG.activeEveryMin Minuten
  let lastTouch = 0;
  const touch = () => {
    if (!S.member) return;
    const t = Date.now(), k = 'cdf-active-' + S.me;
    if (t - Math.max(lastTouch, +LS.getItem(k) || 0, tsNum(S.players[S.me]?.lastActive)) < CONFIG.activeEveryMin * 60e3) return;
    lastTouch = t; LS.setItem(k, String(t));
    F.updateDoc(F.doc(db, 'players', S.me), { lastActive: F.serverTimestamp() }).catch(e => console.warn('lastActive', e.code));
  };
  const wrap = p => p.then(r => { touch(); return r; }, e => { fail(e); throw e; });
  // Push (Firebase Cloud Messaging)
  let msg = null;
  async function messaging() {
    if (msg) return msg;
    const M = await import(base + 'firebase-messaging.js');
    if (!(await M.isSupported())) return null;
    msg = { M, m: M.getMessaging(app) };
    M.onMessage(msg.m, p => toast([p.notification?.title, p.notification?.body].filter(Boolean).join(': ')));
    return msg;
  }
  const pushKey = () => 'cdf-push-' + S.me;
  return {
    demo: false,
    refresh: fire,
    async signIn() { const prov = new Au.GoogleAuthProvider(); try { await Au.signInWithPopup(auth, prov); } catch (e) { if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') await Au.signInWithRedirect(auth, prov); else fail(e); } },
    signOut: () => Au.signOut(auth),
    async register(d) {
      await F.setDoc(F.doc(db, 'players', me()), { name: d.name, habits: d.habits, habitSets: d.habitSets, maxLossPct: d.maxLossPct, joinedSlot: d.joinedSlot, joinedAt: F.serverTimestamp(), lastActive: F.serverTimestamp(), invite: d.invite }).catch(e => { if (e.code === 'permission-denied') toast('Einladungscode falsch.'); else fail(e); throw e; });
    },
    updatePlayer: d => wrap(F.updateDoc(F.doc(db, 'players', me()), d)),
    // Ausstieg mit erreichtem Ziel (einmalig, die Regeln lassen es nicht rückgängig machen)
    finish: fw => wrap(F.updateDoc(F.doc(db, 'players', me()), { status: 'finished', finishedWeek: fw, finishedAt: F.serverTimestamp() })),
    saveWeigh(slot, kg, lossPct, player) { // player: z. B. { maxLossPct } beim Startgewicht, im selben Schreibvorgang
      const b = F.writeBatch(db);
      if (player) b.update(F.doc(db, 'players', me()), player);
      b.set(F.doc(db, 'weighins', me() + '_' + slot), { uid: me(), slot, lossPct, ts: F.serverTimestamp() });
      b.set(F.doc(db, 'players', me(), 'private', 'weights'), { slots: { [slot]: kg } }, { merge: true });
      return wrap(b.commit());
    },
    // ts nur für die Reihenfolge im Liveticker (die Regeln prüfen nur uid/day/done)
    setHabit: (day, done) => wrap(F.setDoc(F.doc(db, 'habitlogs', me() + '_' + day), { uid: me(), day, done, ts: F.serverTimestamp() })),
    setWeekly: (w, text, kind, target) => F.setDoc(F.doc(db, 'weekly', String(w)), { text, kind, target, setBy: me(), setByName: S.players[me()]?.name || '', ts: F.serverTimestamp() }).then(touch, e => { toast(e.code === 'permission-denied' ? 'Zu spät, jemand anderes war schneller.' : 'Fehler: ' + e.message); throw e; }),
    addTask: (e, text) => wrap(F.setDoc(F.doc(db, 'tasks', 'e' + e + '_' + me()), { etappe: e, text, createdBy: me(), createdByName: S.players[me()]?.name || '', ts: F.serverTimestamp() })),
    deleteTask: id => wrap(F.deleteDoc(F.doc(db, 'tasks', id))),
    markTask: (id, on) => wrap(on ? F.setDoc(F.doc(db, 'taskDone', id + '_' + me()), { uid: me(), taskId: id, confirmedBy: null, confirmedByName: null, ts: F.serverTimestamp() }) : F.deleteDoc(F.doc(db, 'taskDone', id + '_' + me()))),
    async confirmTask(tdId) {
      const ref = F.doc(db, 'taskDone', tdId), d = { confirmedBy: me(), confirmedByName: S.players[me()]?.name || '' };
      // confirmedAt (Zeitpunkt für den Liveticker) braucht die aktuellen Regeln.
      // Sind die noch nicht veröffentlicht, lehnt Firestore ab -> ohne Zeitpunkt noch einmal.
      try { await F.updateDoc(ref, { ...d, confirmedAt: F.serverTimestamp() }); touch(); }
      catch (e) { if (e.code !== 'permission-denied') { fail(e); throw e; } await wrap(F.updateDoc(ref, d)); }
    },
    addTeamIdea: (e, d) => F.setDoc(F.doc(db, 'teamideas', 'e' + e + '_' + me()), { ...d, etappe: e, setBy: me(), setByName: S.players[me()]?.name || '', ts: F.serverTimestamp() }).then(touch, x => { toast(x.code === 'permission-denied' ? 'Geht nicht: Du hast schon einen Vorschlag oder die Ziehung war schon.' : 'Fehler: ' + x.message); throw x; }),
    delTeamIdea: id => wrap(F.deleteDoc(F.doc(db, 'teamideas', id))),
    setTeamLog: (day, etappe, vals) => wrap(F.setDoc(F.doc(db, 'teamlogs', me() + '_' + day), { uid: me(), day, etappe, vals })),
    pushState: () => LS.getItem(pushKey()) ? 'on' : 'off',
    async enablePush() {
      if (!CONFIG.vapidKey) return toast('Erinnerungen sind noch nicht eingerichtet: vapidKey fehlt in CONFIG (siehe README).');
      const x = await messaging().catch(() => null); if (!x) return toast('Dieser Browser kann keine Push-Nachrichten empfangen.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Benachrichtigungen sind blockiert. Erlaube sie in den Browser-Einstellungen.');
      const token = await x.M.getToken(x.m, { vapidKey: CONFIG.vapidKey, serviceWorkerRegistration: await swReady() });
      await F.setDoc(F.doc(db, 'players', me(), 'private', 'tokens'), { tokens: { [token]: { ts: F.serverTimestamp(), ua: navigator.userAgent.slice(0, 120) } } }, { merge: true });
      LS.setItem(pushKey(), token); fire(); toast('Erinnerungen sind auf diesem Gerät aktiv.');
    },
    async disablePush() {
      const token = LS.getItem(pushKey()); LS.removeItem(pushKey());
      if (token) {
        try { const x = await messaging(); if (x) await x.M.deleteToken(x.m); } catch { }
        await F.updateDoc(F.doc(db, 'players', me(), 'private', 'tokens'), new F.FieldPath('tokens', token), F.deleteField()).catch(() => { });
      }
      fire(); toast('Erinnerungen aus.');
    },
  };
}

/* =====================================================================
   UI
   ===================================================================== */
let S = emptyState(), C = {}, DB = null, CHARTS = {};
const UI = { tab: 'heute', rankMode: 'gesamt', rankWeek: null, rankEtappe: null, etView: null, habitWeek: null, chartTable: false, kgTable: false, modal: null, feedN: null, tmDay: null, obStep: 0, obDone: false };
// Desktop: Seitenleiste, "Ich" und "Verlauf" sind ein Tab
const DESK = matchMedia('(min-width:1025px)');
const isDesk = () => DESK.matches;
const viewTab = () => isDesk() && UI.tab === 'verlauf' ? 'ich' : UI.tab;
DESK.addEventListener?.('change', () => { if (S.ready) render(); });
const LOAD_T0 = Date.now();
let pendingRender = false, bumping = false, lastTab = null, tabsKey = '';
const TABS = [['heute', 'Heute'], ['ranking', 'Ranking'], ['challenges', 'Challenges'], ['verlauf', 'Verlauf'], ['ich', 'Ich'], ['regeln', 'Regeln']];
const TAB_KEYS = TABS.map(t => t[0]);
const initial = n => esc(String(n || '?').trim().slice(0, 1).toUpperCase() || '?');
const pct = x => fmt1(x).replace(/,0$/, '');
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function onState(ns) {
  S = ns;
  C = compute(S);
  // Startgewicht verpasst? -> automatisch nächsten Montag starten
  const p = S.players[S.me];
  if (S.member && S.synced && p && !C[S.me]?.active && S.myWeights[p.joinedSlot || 0] === undefined && slotDeadline(p.joinedSlot || 0) <= now() && !bumping) {
    const k = nextJoinSlot();
    if (k !== null && k > (p.joinedSlot || 0)) { bumping = true; DB.updatePlayer({ joinedSlot: k }).finally(() => bumping = false); }
  }
  checkMilestones();
  checkWrapped();
  checkOnboarding();
  render();
}

/* ---------- Meilensteine, Feiern, Saisonrückblick ---------- */
function seenList(key, cur) { // neue Einträge seit dem letzten Mal; beim allerersten Mal still übernehmen
  const raw = LS.getItem(key);
  let seen; try { seen = raw === null ? null : JSON.parse(raw) || []; } catch { seen = []; }
  if (seen === null) { LS.setItem(key, JSON.stringify(cur)); return []; }
  const fresh = cur.filter(x => !seen.includes(x));
  if (fresh.length) LS.setItem(key, JSON.stringify([...new Set([...seen, ...cur])]));
  return fresh;
}
// Konfetti bei jeder 5 % vom Startgewicht (bester Wert) und beim eigenen Ziel
function celebrationMarks(me) {
  const out = [];
  for (let n = 5; n <= me.bestLoss + 1e-9; n += 5) out.push('l' + n);
  if (me.goalWeek !== null) out.push('goal' + me.goal);
  return out;
}
function checkMilestones() { // einmaliger Toast (und Konfetti), wenn etwas Neues dazukommt
  const me = C[S.me]; if (!S.member || !S.synced || !me) return;
  const fresh = seenList('cdf-ms-' + S.me, me.ms);
  const cel = seenList('cdf-cel-' + S.me, celebrationMarks(me));
  if (!fresh.length && !cel.length) return;
  const msgs = fresh.filter(id => id !== 'goal').map(id => MS_BY[id].label);
  for (const m of cel) {
    if (m.startsWith('goal')) msgs.unshift(`Ziel erreicht: −${pct(me.goal)} % vom Startgewicht`);
    else if (!fresh.includes(m)) msgs.push(`−${m.slice(1)} % vom Startgewicht`);
  }
  // kurz nach der Bestätigung des Speicherns zeigen, sonst überschreibt die sie
  setTimeout(() => { toast((fresh.some(id => id !== 'goal') ? 'Meilenstein erreicht: ' : '') + msgs.join(', ')); if (cel.length) celebrate(); }, 1600);
}
function celebrate() {
  if (reducedMotion()) return;
  let fx = document.getElementById('fx');
  if (!fx) { fx = document.createElement('div'); fx.id = 'fx'; fx.className = 'fx'; fx.setAttribute('aria-hidden', 'true'); document.body.appendChild(fx); }
  const cols = ['var(--lime)', 'var(--pink)', 'var(--cyan)', 'var(--blood)', '#fff'];
  const r = Math.random;
  fx.innerHTML = Array.from({ length: 90 }, (_, i) => `<i style="--x:${(r() * 100).toFixed(1)}vw;--dx:${((r() - .5) * 40).toFixed(1)}vw;--r:${Math.round(r() * 1080 - 540)}deg;--d:${(1.8 + r() * 1.6).toFixed(2)}s;--delay:${(r() * .4).toFixed(2)}s;--w:${4 + Math.round(r() * 6)}px;background:${cols[i % cols.length]}"></i>`).join('');
  clearTimeout(celebrate._t); celebrate._t = setTimeout(() => { fx.innerHTML = ''; }, 4200);
}
function checkOnboarding() { // Einführung einmal nach dem Beitreten (bzw. für alle, die sie noch nicht gesehen haben)
  const p = S.players[S.me];
  if (!S.member || !S.synced || !p || p.onboardingDone || UI.obDone || UI.modal) return;
  UI.modal = 'onboarding'; UI.obStep = 0;
}
function closeModal() {
  if (UI.modal === 'onboarding') { UI.obDone = true; if (!S.players[S.me]?.onboardingDone) DB.updatePlayer({ onboardingDone: true }).catch(() => { }); }
  UI.modal = null; renderModal();
}
function checkWrapped() { // Saisonrückblick einmal automatisch öffnen, danach per Knopf
  const me = C[S.me];
  if (!S.member || !S.synced || !me?.active || me.finished || !seasonOver() || UI.modal) return;
  const k = 'cdf-wrapped-' + S.me; if (LS.getItem(k)) return;
  LS.setItem(k, '1'); UI.modal = 'wrapped';
}

/* ---------- Rendern ---------- */
function render() {
  const a = document.activeElement;
  if (a && a.matches && a.matches('#app input, #app select') && a.value) { pendingRender = true; return; }
  pendingRender = false;
  CHARTS = {};
  const page = S.ready && S.member && S.synced, vt = viewTab();
  // Einblend-Animation nur beim Tab-Wechsel, nicht bei jedem Daten-Update
  const enter = page && lastTab !== vt;
  const dir = enter && lastTab ? Math.sign(TAB_KEYS.indexOf(vt) - TAB_KEYS.indexOf(lastTab)) : 0;
  document.getElementById('app').innerHTML = header() + banner() + body(enter, dir);
  if (page) lastTab = vt;
  renderTabs();
  wireCharts();
  markFeedSeen();
  if (!document.activeElement?.closest?.('#modal')) renderModal();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) render(); }, 0));
function renderTabs() {
  const nav = document.getElementById('tabs');
  document.body.classList.toggle('has-nav', !!S.member);
  if (!S.member) { nav.hidden = true; tabsKey = ''; return; }
  const me = S.players[S.me], desk = isDesk(), vt = viewTab();
  const list = desk ? TABS.filter(([k]) => k !== 'verlauf').map(([k, l]) => [k, k === 'ich' ? 'Ich & Verlauf' : l]) : TABS;
  const html = `<div class="brand">${logoImg('mark lg')}<div class="logo">Club der<br>Fettsäcke</div><div class="sub">${subline().replace(' · Topf', '<br>Topf')}</div></div>
    <div class="in">${list.map(([k, l]) => `<button data-tab="${k}">${svg(k)}<span>${l}</span></button>`).join('')}</div>
    <button class="prof" data-act="profile"><span class="avatar" aria-hidden="true" style="--pc:${C[S.me]?.color || 'var(--lime)'}">${initial(me?.name)}</span><span><b>${esc(me?.name)}</b><small>Profil und Erinnerungen</small></span></button>`;
  nav.hidden = false;
  // nur neu aufbauen, wenn sich etwas geändert hat, damit die Markierung animiert wandert
  if (html !== tabsKey) { nav.innerHTML = html; tabsKey = html; }
  nav.querySelectorAll('[data-tab]').forEach(b => { const on = b.dataset.tab === vt; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}

function subline() {
  const cw = curWeek(); const po = pot(C);
  if (cw === 0) return `Start: ${fmtD(START)} · ${CONFIG.weeks} Wochen`;
  if (seasonOver()) return `Saison beendet · Topf ${eur(po.total)}`;
  return `Woche ${Math.min(cw, CONFIG.weeks)}/${CONFIG.weeks} · Etappe ${etappeOf(Math.min(cw, CONFIG.weeks))}/${NUM_ETAPPEN} · Topf ${eur(po.total)}`;
}
const logoImg = cls => `<img class="${cls}" src="icons/logo-256.png" alt="" width="256" height="256" decoding="async">`;
function header() {
  const me = S.players[S.me];
  const m = me && S.member;
  return `<header class="apphead">${logoImg('mark')}<div class="grow"><div class="logo">Club der Fettsäcke</div><div class="sub">${subline()}</div></div>
    ${m ? `<button class="hrules${UI.tab === 'regeln' ? ' on' : ''}" data-tab="regeln">${svg('regeln')}<span>Regeln</span></button>
    <button class="avatar" data-act="profile" aria-label="Profil und Erinnerungen" style="--pc:${C[S.me]?.color || 'var(--lime)'}">${initial(me.name)}</button>` : ''}</header>`;
}
function banner() {
  if (!DEMO && CONFIG.testMode) return `<div class="banner"><b>Testmodus</b> Simulierte Zeit: ${NOW_OVERRIDE ? fmtDT(new Date(NOW_OVERRIDE)) : 'echt'}. Ändern per URL, z. B. ?now=2026-11-30T09:00</div>`;
  if (!DEMO) return '';
  const v = NOW_OVERRIDE ? toLocalInput(new Date(NOW_OVERRIDE)) : '';
  return `<div class="banner"><b>Demo-Modus</b><span>Daten nur in diesem Browser, die anderen sind simuliert.</span>
    <label class="row">Zeit <input type="datetime-local" id="demoTime" value="${v}"></label>
    <button class="link" data-act="demoMon">Nächster Mo 9:00</button>
    <button class="link" data-act="demoReset">Zurücksetzen</button></div>`;
}
const toLocalInput = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const navBar = (act, cur, min, max, label) => `<div class="wnav"><button class="iconbtn" data-act="${act}" data-d="-1" ${cur <= min ? 'disabled' : ''} aria-label="Zurück">${svg('prev')}</button><b>${label}</b><button class="iconbtn" data-act="${act}" data-d="1" ${cur >= max ? 'disabled' : ''} aria-label="Weiter">${svg('next')}</button></div>`;
const weekRange = w => `${fmtD(dayDate(7 * (w - 1)))}–${fmtD(dayDate(7 * w - 1))}`;
const shortRange = w => { const a = dayDate(7 * (w - 1)), b = dayDate(7 * w - 1); return `${a.getDate()}.${a.getMonth() + 1}.–${b.getDate()}.${b.getMonth() + 1}.`; };

function body(enter, dir) {
  if (!S.ready || (S.member && !S.synced)) {
    // Sicherheitsnetz: nie endlos drehen, nach 12 s Hinweis und Knopf zum Neuladen
    const slow = S.loadError || Date.now() - LOAD_T0 > 12000;
    if (!slow && !body._t) body._t = setTimeout(() => { body._t = null; render(); }, 12500);
    return `<p class="loading"><span class="spin" aria-hidden="true"></span>Lade…</p>${slow ? `<section class="card narrow"><p class="t2">Das dauert ungewöhnlich lange. Meist hilft neu laden.</p><button class="btn" data-act="reload">Neu laden</button></section>` : ''}`;
  }
  if (!S.authed) return `<div class="page">${viewLogin()}</div>`;
  if (!S.member) return `<div class="page">${viewRegister()}</div>`;
  const vt = viewTab();
  const title = { heute: fmtLong(now()), ranking: 'Ranking', challenges: 'Challenges', verlauf: 'Verlauf', ich: isDesk() ? 'Ich & Verlauf' : 'Mein Fortschritt', regeln: 'Regeln' }[vt];
  const v = ({ heute: viewHeute, ranking: viewRanking, challenges: viewChallenges, verlauf: viewVerlauf, ich: viewIch, regeln: () => `<div class="view"><div class="board">${pane('', viewRegeln())}</div></div>` })[vt]();
  return `<div class="page${enter ? ' enter' : ''}" style="--dir:${dir}"><h1 class="ptitle">${title}</h1>${v}</div>`;
}

function viewLogin() {
  const end = dayDate(CONFIG.weeks * 7 - 1);
  return `<div class="view"><div class="board two login"><section class="card hero">${logoImg('mark xl')}
    <p class="kicker">${CONFIG.weeks} Wochen · ${fmtD(START)}${START.getFullYear()} bis ${fmtD(end)}${end.getFullYear()}</p>
    <h1 class="herot">Wer nachlässt, <em>zahlt.</em></h1>
    <p class="t2">Montags wiegen, täglich 3 Gewohnheiten abhaken, alles in Prozent vom eigenen Startgewicht. Mit Google anmelden, danach Name, Ziel in Prozent, Gewohnheiten mit Wochenziel und den Einladungscode aus der Gruppe eintragen.</p>
    <button class="btn" data-act="signin">Mit Google anmelden</button></section>${viewRegeln()}</div></div>`;
}
function viewRegister() {
  const k = nextJoinSlot();
  if (k === null) return `<section class="card narrow"><div class="hd"><h2>Saison vorbei</h2></div><p class="t2">Einsteigen geht erst wieder in der nächsten Saison.</p></section>`;
  return `<div class="view"><div class="board two login"><section class="card narrow"><div class="hd"><h2>Beitreten</h2></div>
    <p class="t2 small">Dein Start: <b>${fmtD(slotStart(k))}</b>, Startgewicht zwischen ${weighHours} eintragen. Einsatz: <b>${eur(CONFIG.einsatz)}</b>.</p>
    <label class="f" for="rName">Dein Name</label><input class="inp" id="rName" maxlength="20" placeholder="z. B. Robbi" value="${esc(S.displayName?.split(' ')[0] || '')}">
    <label class="f" for="rGoal">Dein Ziel: so viel willst du abnehmen <span class="muted">(in % vom Startgewicht)</span></label>
    ${goalInput('rGoal', null)}
    <p class="small muted">${goalHint}</p>
    <label class="f">Deine 3 Gewohnheiten und wie oft pro Woche</label>
    <p class="small muted">Muss nicht Sport sein, z. B. „Kochen statt Lieferdienst“ oder „1× 10 km laufen“. Jede bringt bis zu ${CONFIG.habitMaxPts} Punkte pro Woche, egal wie oft. Zu leichte Gewohnheiten darf die Gruppe ablehnen.</p>
    ${habitInputs('r', null, false)}
    ${DEMO ? '' : `<label class="f" for="rCode">Einladungscode</label><input class="inp" id="rCode" placeholder="Code aus der Gruppe">`}
    <button class="btn full" data-act="register">Beitreten</button>
    ${DEMO ? '' : `<button class="link" data-act="signout">Mit anderem Google-Konto anmelden</button>`}</section>${viewRegeln()}</div></div>`;
}

// Ziel (max. Abnahme in %): Eingabe, Erklärung, wer es noch ändern darf
const GOAL_MIN = 1, GOAL_MAX = 40;
const goalInput = (id, v) => `<label class="pctin"><input id="${id}" type="number" inputmode="decimal" step="0.5" min="${GOAL_MIN}" max="${GOAL_MAX}" placeholder="10" aria-label="Ziel in Prozent vom Startgewicht" value="${v ?? ''}"><span aria-hidden="true">%</span></label>`;
const goalHint = 'z. B. 10 % = bei 100 kg Startgewicht 10 kg. Ab dem Startgewicht ist das Ziel fest und alle sehen den Prozentwert. Wer es erreicht, hält das Gewicht (Haltephase) oder steigt aus.';
const readGoal = id => { const g = Math.round(parseFloat(val(id).replace(',', '.')) * 10) / 10; return g >= GOAL_MIN && g <= GOAL_MAX ? g : null; };
// Ändern geht bis zum Startgewicht. Wer (aus Testzeiten) noch kein Ziel hat, darf es im Demo-/Testmodus auch danach einmal setzen.
const goalEditable = (me, p) => !me?.active || (typeof p?.maxLossPct !== 'number' && (DEMO || CONFIG.testMode));
// Pause: laufende Woche bis Mittwoch 23:59, jede spätere jederzeit. Zurücknehmen nur, solange die Woche noch nicht begonnen hat.
const pauseDeadline = w => dayDate(7 * (w - 1) + 3);
const canUnpause = w => now() < dayDate(7 * (w - 1));
const pauseLbl = w => `Woche ${w} · ${shortRange(w)}, kein Wiegen am ${fmtD(slotStart(w))}`;
function pauseOptions(me) {
  if (!me || me.finished || me.paused.length >= CONFIG.pauseWeeks) return [];
  const out = [];
  for (let w = Math.max(me.js + 1, curWeek(), 1); w <= CONFIG.weeks; w++) if (!me.paused.includes(w) && now() < pauseDeadline(w)) out.push(w);
  return out;
}
const pausedNow = p => !!p?.weeks?.[clamp(curWeek(), 1, CONFIG.weeks)]?.paused && curWeek() >= 1;
const HOLD_LBL = 'Haltephase – nur Montag wiegen';
const exitBtn = me => canExit(me) ? `<button class="btn ghost danger" data-act="exitAsk">Ziel erreicht – aussteigen</button>` : '';
function goalBar(me) {
  const g = me.goal, cur = Math.max(0, me.latest), done = me.goalWeek !== null;
  if (me.hold) {
    const inb = Math.abs(me.latest - g) <= CONFIG.holdBand + 1e-9;
    return `<div class="goalbar"><div class="row"><b class="small grow">${HOLD_LBL}</b><b class="small ${inb ? 'ok' : 'bad'}">${tn(fmt1(me.latest))} %</b></div>
      <p class="small t2">Halten zwischen ${tn(pct(g - CONFIG.holdBand))} und ${tn(pct(g + CONFIG.holdBand))} % (Ziel ${tn(pct(g))} % ± ${tn(pct(CONFIG.holdBand))}): volle ${CONFIG.weighMaxTenths * CONFIG.weighPerTenth} Waage-Punkte + ${habitMax()} Bonus. Daneben 0. Gewohnheiten sind freiwillig.</p>${exitBtn(me)}</div>`;
  }
  return `<div class="goalbar"><div class="row"><span class="small t2 grow">Dein Ziel</span><b class="small">${tn(fmt1(cur))} % von ${tn(pct(g))} %</b></div>
    <div class="bar pk${done ? ' done' : ''}" role="progressbar" aria-label="Dein Ziel" aria-valuemin="0" aria-valuemax="${g}" aria-valuenow="${fmt1(cur)}"><i style="width:${(clamp(cur / g, 0, 1) * 100).toFixed(1)}%"></i></div>${exitBtn(me)}</div>`;
}

// Gewohnheit + Wochenziel (Anmeldung und Profil)
const targetLbl = n => n === 7 ? '7× (täglich)' : n + '× pro Woche';
function habitInputs(pre, hs, dis) {
  const ph = ['z. B. Kochen statt Lieferdienst', 'z. B. Keine Softdrinks', 'z. B. Vor 0 Uhr ins Bett'], def = [4, 7, 5];
  return `<div class="stack">${[0, 1, 2].map(i => `<div class="row hin"><input class="inp grow" id="${pre}H${i}" maxlength="40" placeholder="${ph[i]}" value="${esc(hs?.[i]?.name || '')}"${dis ? ' disabled' : ''} aria-label="Gewohnheit ${i + 1}">
    <select class="inp auto" id="${pre}T${i}"${dis ? ' disabled' : ''} aria-label="Wochenziel Gewohnheit ${i + 1}">${[1, 2, 3, 4, 5, 6, 7].map(n => `<option value="${n}"${n === (hs?.[i]?.target ?? def[i]) ? ' selected' : ''}>${targetLbl(n)}</option>`).join('')}</select></div>`).join('')}</div>`;
}
const readHabits = pre => [0, 1, 2].map(i => ({ name: val(pre + 'H' + i), target: clamp(parseInt(val(pre + 'T' + i), 10) || HABIT_DEFAULT_T, 1, 7) }));

/* ---------- Ringe (Apple-Watch-Stil), auch für das Ziel im Tab Ich ---------- */
function ringSvg(rings, size, sw, gap) {
  const c = size / 2; let r = c - sw / 2, h = '';
  for (const x of rings) {
    const len = 2 * Math.PI * r, p = clamp(x.p || 0, 0, 1);
    h += `<circle class="rt" cx="${c}" cy="${c}" r="${r.toFixed(2)}" stroke-width="${sw}" style="stroke:${x.c}"/>`;
    if (p > 0.004) h += `<circle class="rf" cx="${c}" cy="${c}" r="${r.toFixed(2)}" stroke-width="${sw}" transform="rotate(-90 ${c} ${c})" filter="url(#fx-glow)" style="stroke:${x.c};--len:${len.toFixed(1)};stroke-dasharray:${len.toFixed(1)};stroke-dashoffset:${(len * (1 - p)).toFixed(1)}"/>`;
    r -= sw + gap;
  }
  return `<svg class="rings" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${h}</svg>`;
}
// gemeinsamer Glow-Filter für Ringe und Diagrammlinien (SVG-Filter, funktioniert auch in Safari)
function ensureDefs() {
  if (document.getElementById('fx-defs')) return;
  document.body.insertAdjacentHTML('beforeend', `<svg id="fx-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <filter id="fx-glow" filterUnits="userSpaceOnUse" x="-200" y="-200" width="4000" height="2000"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs></svg>`);
}

/* ---------- LAYOUT ----------
   Jeder Tab ist ein .board (CSS-Grid). Spaltenzahl 1–4 per Container Query auf die Inhaltsbreite (style.css, "Boards").
   .pane = Spalte bzw. Block, .grp = Gruppe, die je nach Breite eine eigene Spalte ist oder sich auflöst (display: contents).
   Auf dem Desktop ist der Inhaltsbereich genau so hoch wie das Fenster, jede Spalte scrollt für sich. */
const pane = (cls, html) => html ? `<div class="pane ${cls}">${html}</div>` : '';

/* ---------- HEUTE ---------- */
function viewHeute() {
  const me = C[S.me]; const p = S.players[S.me];
  if (seasonOver()) return seasonEnd(me);
  // Fokus (Grün): montags das Wiegen, sonst die heutige Spalte im Gewohnheiten-Raster
  const wc = me.finished ? { html: finishedCard(me), due: false } : weighCard(me, p);
  // Spalten: 1 = f a b c untereinander · 2 = [f a c] [b] · 3 = [f a] [b] [c] · 4 = [f] [a] [b] [c]
  // Heatmap und Meilensteine nur ab 2 Spalten (style.css), damit die Startseite auf großen Schirmen nicht leer wirkt.
  return `<div class="view"><div class="board dash">
    <div class="grp gL"><div class="grp gF">${pane('f', feedCard(true))}${pane('a', wc.html + (me.finished ? '' : statusCard(me) + loserCard()))}</div>
    ${pane('c', weeklyCard(me) + teamCard(me) + (me.active ? msCard(me) : ''))}</div>
    ${pane('b', (me.finished ? '' : habitsCard(me, p, !wc.due)) + (me.active ? heatCard(me, p) : ''))}</div></div>`;
}
function finishedCard(me) {
  const f = fees(me, null);
  return `<section class="card fin" data-k="me"><div class="hd"><h2>Ziel erreicht · ausgestiegen</h2></div>
    <p class="finbig num">${tn(lossStr(me.wb[me.fw] ?? me.latest))}</p>
    <p class="t2">Ziel −${tn(pct(me.goal))} % nach ${wochen(me.goalWeek - me.js)}, ausgestiegen nach Woche ${me.fw}. Du bekommst deinen Einsatz zurück (${eur(f.refund)})${f.strafen ? `, deine Strafen (${eur(f.strafen)}) bleiben im Topf` : ''}.</p>
    <p class="small muted">Keine Punkte, Strafen oder Erinnerungen mehr. Dein Ergebnis steht eingefroren unter Ranking → Gesamt → Ziel erreicht.</p></section>`;
}
function seasonEnd(me) {
  const w = rankTotal(C)[0];
  const win = `<section class="card" data-k="rank"><div class="hd"><h2>Saison beendet</h2></div>
    ${w ? `<p class="lname" style="color:var(--lime);text-shadow:0 0 28px var(--lime-glow)">${esc(w.name)}</p>
    <p class="t2">gewinnt mit <b>${nf(w.total)} Punkten</b> und ${tn(lossStr(w.latest))} seit Start und kassiert den Topf: <b>${eur(pot(C).total)}</b>.</p>` : ''}
    ${me?.active && !me.finished ? `<button class="btn" data-act="wrapped">${svg('spark')}Dein Saisonrückblick</button>` : ''}</section>`;
  return `<div class="view"><div class="board two">${pane('', win + feedCard())}${pane('', rankCards('gesamt').list)}</div></div>`;
}
function weighInput(slot, label, val, primary) {
  return `<div class="row weighrow"><label class="kgin"><input id="kg" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="0,0" aria-label="Gewicht in kg" value="${val ?? ''}"><span aria-hidden="true">kg</span></label><button class="btn${primary ? '' : ' ghost'}" data-act="weigh" data-slot="${slot}">${label}</button></div>`;
}
const cdHtml = to => `<b class="cd${to - now() < 2 * 36e5 ? ' bad' : ''}">${countdown(to)}</b>`;
function weighCard(me, p) {
  const js = p.joinedSlot || 0; const os = openSlot(); const dl = `${CONFIG.deadlineHour}:00 Uhr`;
  if (!me.active) {
    // Ziel: fehlt es noch, wird es hier zusammen mit dem Startgewicht gespeichert (danach fest)
    const goal = me.goal ? `<p class="small t2">Dein Ziel: <b>−${tn(pct(me.goal))} %</b> vom Startgewicht, ab dem Startgewicht fest. <button class="link" data-tab="ich">Ändern</button></p>`
      : `<label class="f" for="mlp">Dein Ziel: so viel willst du abnehmen <span class="muted">(in %)</span></label>${goalInput('mlp', null)}<p class="small muted">${goalHint}</p>`;
    if (os === js) return { due: true, html: `<section class="card due" data-k="weigh"><div class="hd"><h2>Startgewicht bis ${dl}</h2></div>
      <p class="when">Noch ${cdHtml(slotDeadline(js))} · andere sehen nur Prozente</p>${me.goal ? '' : goal}${weighInput(js, 'Speichern', '', true)}${me.goal ? goal : ''}</section>` };
    return { due: false, html: `<section class="card" data-k="weigh"><div class="hd"><h2>Startgewicht am ${fmtD(slotStart(js))}</h2></div>
      <p class="when">${weighHours} · in <b class="cd">${countdown(slotOpen(js))}</b></p>${me.goal ? goal : '<p class="small t2">Noch kein Ziel. <button class="link" data-tab="ich">Ziel festlegen</button></p>'}</section>` };
  }
  if (os === null || os < js || me.finished) return { due: false, html: '' };
  if (me.weeks[os]?.paused) return { due: false, html: `<section class="card" data-k="weigh"><div class="hd"><h2>Heute kein Wiegen</h2><span class="aside">Woche ${os}</span></div><p class="small t2">Woche ${os} ist pausiert, das Wiegen heute fällt weg. Nächste Woche vergleicht die Waage wie immer mit deinem Tiefstwert.</p></section>` };
  if (os > js && me.wb[os] === undefined) return { due: true, html: `<section class="card due" data-k="weigh"><div class="hd"><h2>Wiegen bis ${dl}</h2><span class="aside">Woche ${os}</span></div>
    <p class="when">Noch ${cdHtml(slotDeadline(os))} · verpasst = 0 Waage-Punkte und ${eur(CONFIG.strafe)}</p>${weighInput(os, 'Eintragen', '', true)}</section>` };
  const msg = os === js ? 'Startgewicht gespeichert.' : `Woche ${os} gewogen: <b>+${ptsStr(me.weeks[os]?.weigh ?? 0)}</b>.`;
  return { due: false, html: `<section class="card" data-k="weigh"><div class="hd"><h2>Waage</h2><span class="aside"><b>${tn(lossStr(me.latest))}</b> seit Start</span></div>
    <p class="okline">${msg} <span class="muted">Korrigieren bis ${dl}.</span></p>${weighInput(os, 'Korrigieren', S.myWeights[os], false)}</section>` };
}
// Bei vielen Spielern: Top 3, du mit Nachbarn und der Letzte; dazwischen eine Lücke
function windowed(list, uid, max = 7) {
  if (list.length <= max) return list;
  const mi = list.findIndex(x => x.uid === uid);
  const keep = new Set([0, 1, 2, list.length - 1]);
  if (mi >= 0) for (const i of [mi - 1, mi, mi + 1]) if (i >= 0 && i < list.length) keep.add(i);
  const out = []; let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) { if (i - prev > 1) out.push(null); out.push(list[i]); prev = i; }
  return out;
}
function statusCard(me) {
  const cw = curWeek(); if (!me.active || cw < 1 || cw > CONFIG.weeks) return '';
  let w = cw;
  if (dayIdx() === 7 * (cw - 1) && cw - 1 > me.js) w = cw - 1; // Montag: Ergebnis der Vorwoche
  const r = rankWeek(C, w); const mine = r.find(x => x.uid === S.me);
  const names = xs => andJoin(xs.map(x => esc(x.name)));
  const closed = lastClosedSlot() >= w;
  let head, note = '';
  if (w < cw) {
    head = `Woche ${w} · ${closed ? 'Endstand' : `vorläufig bis ${CONFIG.deadlineHour}:00 Uhr`}`;
    if (closed) { if (!weekLosers(C, w).length) note = 'Kein Wochenletzter, alle haben gleich viele Punkte.'; } // sonst eigene Karte darunter
    else { const open = r.filter(x => !x.weighed); note = open.length ? `Noch nicht gewogen: ${names(open)}.` : 'Alle haben gewogen.'; }
  } else { head = `Woche ${w} · bis ${fmtD(dayDate(7 * w - 1))}`; note = `Waage-Punkte kommen am ${fmtD(slotStart(w))} dazu.`; }
  let rank = '';
  if (mine) {
    const wk = me.weeks[w] || {};
    const defs = [
      { c: 'var(--lime)', v: Math.min(habitMax(), (wk.habits || 0) + (wk.bonus || 0)), max: habitMax(), l: wk.bonus ? 'Gewohnheiten + Bonus' : 'Gewohnheiten' },
      { c: 'var(--cyan)', v: wk.weekly || 0, max: CONFIG.challengePts, l: 'Challenge', off: !S.weekly[w] && 'keine' },
      { c: 'var(--pink)', v: wk.weigh || 0, max: CONFIG.weighMaxTenths * CONFIG.weighPerTenth, l: 'Waage', off: !wk.weighed && !closed && (w === cw ? 'ab ' + fmtD(slotStart(w)) : 'offen') },
    ];
    const legend = defs.map(x => `<li style="--c:${x.c}"><b>${x.off ? '–' : x.v}<small>/${x.max}</small></b>${x.l}${x.off ? `<span>${x.off}</span>` : ''}</li>`).join('')
;
    const pos = 1 + r.filter(x => x.total > mine.total).length;
    rank = `<div class="sthero"><div class="stleft"><div class="rankbig num"><small>#</small>${pos}</div><p class="small t2">von ${r.length} · <b>${ptsStr(mine.total)}</b></p></div>
      ${ringSvg(defs.map(x => ({ p: x.off ? 0 : x.v / x.max, c: x.c })), 96, 11, 3)}</div><ul class="rlegend">${legend}</ul>`;
    if (r.length >= 2) {
      const others = r.filter(x => x.uid !== S.me);
      const above = others.filter(x => x.total > mine.total), below = others.filter(x => x.total < mine.total), tied = others.filter(x => x.total === mine.total);
      const parts = [];
      if (tied.length) parts.push('gleichauf mit ' + names(tied));
      if (above.length) { const t = Math.min(...above.map(x => x.total)); parts.push(`${t - mine.total} hinter ${names(above.filter(x => x.total === t))}`); }
      else if (below.length) { const t = Math.max(...below.map(x => x.total)); parts.push(`${mine.total - t} vor ${names(below.filter(x => x.total === t))}`); }
      const topT = Math.max(1, ...r.map(x => x.total)), lo = closed ? weekLosers(C, w) : [];
      const lb = windowed(r, S.me).map(x => x ? `<div class="r${x.uid === S.me ? ' me' : ''}${lo.includes(x.uid) ? ' lo' : ''}"><span class="n">${1 + r.filter(y => y.total > x.total).length}</span><span class="nm">${esc(x.name)}</span><span class="v">${x.total}</span><span class="tr"><i style="width:${(x.total / topT * 100).toFixed(1)}%;background:${C[x.uid]?.color || 'var(--text-2)'}"></i></span></div>` : '<span class="skip" aria-hidden="true"></span>').join('');
      rank += `<p class="gap">${cap(parts.join(', ')) || 'Alle gleichauf'}. <span class="muted">${note}</span></p><div class="lb">${lb}</div>
        ${r.length > 7 ? `<button class="link" data-act="toWeekRank" data-w="${w}">Alle ${r.length} im Wochenranking</button>` : ''}`;
    } else if (note) rank += `<p class="small t2">${note}</p>`;
  } else if (me.weeks[w]?.paused) rank = `<p class="t2"><b>Pause.</b> Woche ${w} zählt für dich nicht: keine Punkte, keine Strafen, Streak bleibt stehen.</p>`;
  const pz = Object.values(C).filter(x => x.uid !== S.me && x.weeks[w]?.paused).map(x => esc(x.name));
  if (pz.length) rank += `<p class="small muted">Pause: ${andJoin(pz)}</p>`;
  const kv = me.goal ? [] : [['Seit Start', tn(lossStr(me.latest))]];
  const gb = me.goal ? goalBar(me) : goalEditable(me, S.players[S.me]) ? `<p class="small t2 sep">Noch kein Ziel gesetzt. <button class="link" data-tab="ich">Ziel festlegen</button></p>` : '';
  if (openSlot() === null) { const nk = Math.floor(Math.max(0, dayIdx()) / 7) + 1; if (nk <= CONFIG.weeks) kv.push(['Nächstes Wiegen', fmtD(slotStart(nk))]); }
  const last = Math.max(...Object.keys(me.wb).map(Number));
  if (last > me.js && me.weeks[last]) kv.push(['Letztes Wiegen', `+${me.weeks[last].weigh} P. (Woche ${last})`]);
  if (me.missed) kv.push(['Wiegen verpasst', `<span class="bad">${me.missed}× · ${eur(me.missed * CONFIG.strafe)}</span>`]);
  if (me.missedHabitWeeks.length) kv.push(['Wochenziele verfehlt', `<span class="bad">${me.missedHabitWeeks.length}× · ${eur(me.missedHabitWeeks.length * CONFIG.habitFee)}</span>`]);
  return `<section class="card status" data-k="rank"><div class="hd"><h2>${head}</h2></div>${rank}${gb}<dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>`;
}
// Wochenletzter der zuletzt abgeschlossenen Woche: vom Wiegeschluss am Montag bis zum nächsten Wiegen
function loserCard() {
  const lc = lastClosedSlot(), cw = curWeek();
  if (lc < 1 || cw !== lc + 1 || cw > CONFIG.weeks || openSlot() !== null) return '';
  const l = weekLosers(C, lc); if (!l.length) return '';
  const r = rankWeek(C, lc), ls = r.filter(x => l.includes(x.uid)), me = l.includes(S.me), many = ls.length > 1;
  const up = r.filter(x => !l.includes(x.uid)), next = up[up.length - 1];
  const who = me ? (many ? 'Du und ' + andJoin(ls.filter(x => x.uid !== S.me).map(x => esc(x.name))) : 'Du') : andJoin(ls.map(x => esc(x.name)));
  const ch = S.weekly[cw], ex = exclusiveUntil(cw);
  const pick = ch ? `Gewählte Challenge: ${esc(ch.text)}.` : now() < ex ? `${me ? (many ? 'Ihr wählt' : 'Du wählst') : many ? 'Sie wählen' : 'Wählt'} die Challenge bis ${fmtDT(ex)}.` : 'Die Challenge darf jetzt jeder wählen.';
  const pay = me ? `${many ? 'Ihr zahlt je' : 'Du zahlst'} ${eur(CONFIG.loserFee)}.` : `${many ? 'Zahlen je' : 'Zahlt'} ${eur(CONFIG.loserFee)}.`;
  return `<section class="card loser${me ? ' me' : ''}" data-k="loser"><div class="hd"><h2>Wochenletzter · Woche ${lc}</h2><span class="aside"><b>${ptsStr(ls[0].total)}</b></span></div>
    <p class="lname">${who}</p>
    <p class="small t2">${next ? `${next.total - ls[0].total} hinter ${esc(next.name)}. ` : ''}${pay} ${pick}</p></section>`;
}
const dayHeads = (d0, today) => [0, 1, 2, 3, 4, 5, 6].map(i => { const d = d0 + i; return `<span class="dh${d === today ? ' today' : ''}">${d === today ? 'Heute' : WD[(i + 1) % 7]}<b>${dayDate(d).getDate()}.</b></span>`; }).join('');
// Klick-Animation überlebt das Neuzeichnen nach dem Speichern: neues Element startet mit negativer Verzögerung
const TAP = { k: null, t: 0 };
function tapFx(k) { const dt = performance.now() - TAP.t; return TAP.k === k && dt < 700 ? { cls: ' tap', st: ` style="--tapd:-${Math.round(dt)}ms"` } : { cls: '', st: '' }; }
function habitsCard(me, p, focus) {
  const today = dayIdx(); const cw = curWeek();
  if (cw === 0) return `<section class="card" data-k="habits"><div class="hd"><h2>Deine Gewohnheiten</h2><span class="aside">ab ${fmtD(START)}</span></div>
    <ul class="hlist">${habitsFor(p, 1).map(h => `<li><span>${esc(h.name)}</span><b>${targetLbl(h.target)}</b></li>`).join('')}</ul>
    <p class="small muted">Jede bringt bis zu ${CONFIG.habitMaxPts} Punkte pro Woche, anteilig zum Wochenziel. Ändern über dein Profil.</p></section>`;
  const cur = Math.min(cw, CONFIG.weeks);
  const minW = Math.min(cur, Math.max(1, (p.joinedSlot || 0) + 1));
  const w = clamp(UI.habitWeek ?? cur, minW, cur);
  const d0 = 7 * (w - 1);
  const minDay = 7 * (p.joinedSlot || 0);
  const wk = me.weeks[w];
  const ch = S.weekly[w];
  const canEdit = d => d <= today && d >= today - CONFIG.backfillDays && d >= minDay && d < CONFIG.weeks * 7;
  const prevEditable = w === cur && w > minW && [1, 2, 3].some(i => canEdit(d0 - i));
  const H = habitsFor(p, w), cnt = tickCounts(me.hl, w);
  // Fortschritt pro Gewohnheit: "2/4", grün wenn geschafft, orange wenn nicht mehr erreichbar
  const prog = (hi, t) => {
    const open = Array.from({ length: 7 }, (_, i) => d0 + i).filter(d => d >= minDay && !me.hl[d]?.[hi] && (d > today || canEdit(d))).length;
    const cls = cnt[hi] >= t ? ' ok' : cnt[hi] + open < t ? ' bad' : '';
    return `<span class="hp${cls}" title="${cnt[hi]} von ${t}× diese Woche">${cnt[hi]}/${t}</span>`;
  };
  const rows = H.map((h, hi) => [`<span class="hn">${esc(h.name)}</span>${prog(hi, h.target)}`, h.name, hi, false]);
  if (ch) rows.push([`<span class="hn"><b>Challenge:</b> ${esc(ch.text)}</span>`, 'Challenge: ' + ch.text, 3, true]);
  let g = `<div class="hgrid${focus ? ' focus' : ''}"><div class="hrow hhead"><span class="hname"></span><div class="hcells">${dayHeads(d0, today)}</div></div>`;
  for (const [html, plain, hi, isCh] of rows) {
    g += `<div class="hrow${isCh ? ' ch' : ''}"><span class="hname" title="${esc(plain)}">${html}</span><div class="hcells">`;
    for (let i = 0; i < 7; i++) {
      const d = d0 + i; const on = !!me.hl[d]?.[hi];
      const edit = canEdit(d) && !wk?.paused, fx = tapFx(`h${d}_${hi}`);
      const cls = ['hc', on && 'on', d === today && 'td', d > today || d < minDay ? 'off' : edit ? '' : 'lock'].filter(Boolean).join(' ') + fx.cls;
      g += `<button class="${cls}"${fx.st} ${edit ? `data-act="habit" data-day="${d}" data-h="${hi}"` : 'disabled'} aria-pressed="${on}" aria-label="${esc(plain)}, ${fmtD(dayDate(d))}">${svg('check', 'ck')}</button>`;
    }
    g += '</div></div>';
  }
  g += '</div>';
  const st = me.streak;
  const hold = wk?.paused ? `<p class="small t2"><b>Pause:</b> Woche ${w} zählt nicht, Haken bringen hier nichts.</p>` : me.hold && w > me.goalWeek ? `<p class="small t2"><b>${HOLD_LBL}.</b> Gewohnheiten sind freiwillig und bringen weiter Punkte, bis das Wochenmaximum voll ist.</p>` : '';
  const streak = me.active ? `<p class="streak">${svg('flame')}<span class="m">Streak <b>${wochen(st.cur)}</b></span><span class="m muted">Rekord ${st.best}</span><span class="m muted">${st.joker ? 'Joker frei' : `Joker verbraucht (Woche ${st.jokerWeek})`}</span></p>` : '';
  const score = `<span class="aside"><b>${wk ? wk.habits : 0}</b>/${habitMax()}${ch ? ` · Challenge <b>${wk ? wk.weekly : 0}</b>/${CONFIG.challengePts}` : ''}</span>`;
  // Warnung: Vorwoche kann noch nachgetragen werden, aber nicht alle Wochenziele sind erreicht (sonst Strafe)
  const pw = cur - 1, pwk = me.weeks[pw];
  let warn = '';
  if (me.active && CONFIG.habitFee && pwk && !pwk.met && !pwk.hold && !weekFinal(pw)) {
    const Hp = habitsFor(p, pw), miss = Hp.map((h, i) => pwk.cnt[i] < h.target ? `${esc(h.name)} ${pwk.cnt[i]}/${h.target}` : null).filter(Boolean);
    warn = `<p class="small bad">Woche ${pw} nicht geschafft: ${miss.join(', ')}. Nachtragen geht bis ${fmtD(dayDate(7 * pw - 1 + CONFIG.backfillDays))}, sonst ${eur(CONFIG.habitFee)}.</p>`;
  }
  return `<section class="card" data-k="habits"><div class="hd"><h2>Gewohnheiten</h2>${score}</div>${streak}${hold}
    ${navBar('hw', w, minW, cur, `${w === cur ? 'Diese Woche' : 'Woche ' + w} · ${shortRange(w)}`)}${g}${warn}
    ${prevEditable ? `<button class="link" data-act="hw" data-d="-1">Vorwoche nachtragen</button>` : ''}</section>`;
}
// Punktestand vieler Spieler als umbrechende Chips (sortiert)
const chips = arr => `<div class="chips">${arr.map(({ p, v }) => `<span class="chip${p.uid === S.me ? ' me' : ''}"><i style="background:${p.color}"></i>${esc(p.name)} <b>${v}</b></span>`).join('')}</div>`;
function weeklyCard(me) {
  const cw = curWeek(); const w = cw === 0 ? 1 : Math.min(cw, CONFIG.weeks);
  const ch = S.weekly[w];
  let inner, aside = '';
  if (ch) {
    const per = ch.kind === 'daily' ? '1 Punkt pro Tag' : `${Math.round(CONFIG.challengePts / chTarget(ch))} Punkte pro Mal`;
    const lbl = chLabel(ch);
    const stand = Object.values(C).filter(p => p.active && p.js < w && (cw === 0 || (p.weeks[w] && !p.weeks[w].paused))).map(p => ({ p, v: p.weeks[w]?.weekly || 0 })).sort((a, b) => b.v - a.v || a.p.name.localeCompare(b.p.name));
    if (cw > 0 && me.active && !me.finished) aside = `<span class="aside"><b>${me.weeks[w]?.weekly || 0}</b>/${CONFIG.challengePts} P.</span>`;
    inner = `<p class="chtext">${esc(ch.text)}</p>
      <p class="small t2">${cap(lbl)} · ${per} · von ${esc(ch.setByName)}</p>
      ${cw > 0 && stand.length ? chips(stand) : cw === 0 ? '<p class="small muted">Startet am Montag.</p>' : ''}`;
  } else if (canSetWeekly(S, C, w)) {
    const excl = w > 1 ? exclusiveUntil(w) : null;
    const why = w === 1 ? 'Die erste Challenge darf jeder festlegen, wer zuerst kommt.'
      : now() < excl ? `Du warst letzte Woche Letzter: Nur du darfst bis <b>${fmtDT(excl)}</b> wählen (noch ${countdown(excl)}).`
      : 'Der Letzte hat nichts festgelegt. Jetzt darf jeder, wer zuerst kommt.';
    inner = `<p class="small t2">${why}</p>
      <input class="inp" id="wText" maxlength="60" placeholder="z. B. Treppe statt Aufzug" aria-label="Challenge">
      <div class="row"><select class="inp grow" id="wKind" aria-label="Wie oft">
        <option value="daily">Täglich (1 P./Tag, max. ${CONFIG.challengePts})</option>
        <option value="1">1× diese Woche (${CONFIG.challengePts} P.)</option>
        <option value="2">2× diese Woche (je ${Math.round(CONFIG.challengePts / 2)} P.)</option>
      </select><button class="btn ghost" data-act="setWeekly" data-w="${w}">Festlegen</button></div>`;
  } else if (w > 1 && now() < slotDeadline(w - 1)) {
    inner = `<p class="small t2">Ab ${CONFIG.deadlineHour}:00 Uhr wählt der Wochenletzte, ${CONFIG.chooseHours} Std. lang. Danach darf jeder.</p>`;
  } else {
    const s = weeklySetters(C, w) || [];
    const names = s.map(u => C[u]?.name).filter(Boolean).map(esc).join(' / ') || 'Der Wochenletzte';
    inner = `<p class="small t2"><b>${names}</b> wählt bis ${fmtDT(exclusiveUntil(w))}. Danach darf jeder, wer zuerst kommt.</p>`;
  }
  // Hinweis auf den Team-Monat: eigener Vorschlag für die nächste Ziehung fehlt noch
  let team = '';
  const ne = nextDrawE();
  if (ne && canSuggest(ne)) team = `<p class="small t2 sep">Team-Monat Etappe ${ne}: Dein Vorschlag fehlt noch, gezogen wird ${fmtDT(drawTime(ne))}. <button class="link" data-tab="challenges">Vorschlagen</button></p>`;
  return `<section class="card" data-k="challenge"><div class="hd"><h2>Wochen-Challenge</h2>${aside}</div>${inner}${team}</section>`;
}
function teamCard(me) {
  const cw = curWeek(); if (cw < 1 || cw > CONFIG.weeks) return '';
  const ce = etappeOf(cw), prev = TEAM[ce - 1];
  // am ersten Montag der Etappe läuft bis zum Wiegeschluss noch die alte (Nachtragen), danach die neue
  const t = TEAM[ce] || (prev && !prev.closed ? prev : null); if (!t) return '';
  return `<section class="card" data-k="team">${teamHead(t, true)}${teamEntry(t, me)}</section>`;
}
function teamHead(t, hd) {
  const done = t.items.filter(i => i.reached).length, end = slotDeadline(etEndWeek(t.e));
  const state = t.closed ? (t.reached ? `<span class="ok">Geschafft.</span> +${CONFIG.teamPts} P. für alle mit Eintrag.` : 'Nicht geschafft, niemand bekommt den Bonus.')
    : `${t.reached ? '<span class="ok">Alle Ziele erreicht.</span> Zählt fest ab' : 'Alle schaffen bis'} ${fmtDT(end)}: +${CONFIG.teamPts} P. für jeden mit Eintrag. Ein Ziel verfehlt = keiner bekommt etwas.`;
  const items = t.items.map(i => `<div class="tmi"><div class="row top"><div class="grow"><div class="tt">${esc(i.text)}</div><div class="small muted">${ideaRate(i)} · von ${esc(i.setByName)}</div></div><span class="aside"><b>${nf(i.sum)}</b> / ${teamFmt(i, i.target)}</span></div>
    <div class="bar${i.reached ? ' done' : ''}" role="progressbar" aria-label="${esc(i.text)}" aria-valuemin="0" aria-valuemax="${i.target}" aria-valuenow="${Math.round(i.sum)}"><i style="width:${(clamp(i.sum / i.target, 0, 1) * 100).toFixed(1)}%"></i></div></div>`).join('');
  const who = Object.values(C).filter(p => t.by[p.uid]).map(p => esc(p.name));
  return `${hd ? `<div class="hd"><h2>Team-Monat · Etappe ${t.e}</h2><span class="aside"><b>${done}</b>/${t.items.length} erreicht</span></div>` : ''}${items}
    <p class="small t2">${state}</p>${who.length ? `<p class="small muted">Dabei: ${andJoin(who)}</p>` : ''}`;
}
function teamEntry(t, me) {
  if (!me?.active || me.finished || t.closed) return '';
  const today = dayIdx();
  const days = Array.from({ length: CONFIG.backfillDays + 1 }, (_, i) => today - i).filter(d => etappeOf(weekOfDay(d)) === t.e && teamEditable(d, me.js));
  if (!days.length) return '';
  const day = days.includes(UI.tmDay) ? UI.tmDay : days[0];
  const mine = S.teamlogs[S.me + '_' + day]?.vals || {};
  const lbl = d => d === today ? 'Heute' : d === today - 1 ? 'Gestern' : fmtD(dayDate(d));
  const rows = t.items.map(i => {
    if (i.kind === 'count') {
      const on = (+mine[i.id] || 0) > 0, fx = tapFx('tm' + day + i.id);
      return `<div class="tmrow"><span class="hname">${esc(i.text)}</span><button class="hc${on ? ' on' : ''}${fx.cls}"${fx.st} data-act="tmTog" data-day="${day}" data-id="${esc(i.id)}" aria-pressed="${on}" aria-label="${esc(i.text)}, ${lbl(day)}">${svg('check', 'ck')}</button></div>`;
    }
    return `<div class="tmrow"><label class="hname" for="tmv-${esc(i.id)}">${esc(i.text)}</label><input class="inp" id="tmv-${esc(i.id)}" data-tm="${esc(i.id)}" inputmode="decimal" autocomplete="off" placeholder="${esc(i.unit || 'Wert')}" value="${mine[i.id] ? String(mine[i.id]).replace('.', ',') : ''}"></div>`;
  }).join('');
  return `<div class="tmentry sep"><div class="row"><span class="small t2 grow">Dein Beitrag</span><select class="inp auto" id="tmDay" aria-label="Tag">${days.map(d => `<option value="${d}"${d === day ? ' selected' : ''}>${lbl(d)}</option>`).join('')}</select></div>
    ${rows}${t.items.some(i => i.kind !== 'count') ? `<button class="btn ghost full" data-act="tmSave" data-day="${day}">Eintragen</button>` : ''}</div>`;
}

/* ---------- LIVETICKER: wird nur aus den Daten im Speicher gebaut, keine eigene Sammlung ---------- */
const FEED = { seen: new Set(), init: false };
const FEED_ICON = { weigh: 'scale', habits: 'check', task: 'challenges', confirm: 'double', challenge: 'bolt', team: 'team' };
const FEED_DAYS = 14;
function feedEvents() {
  const ev = [], today = dayIdx(), from = dayDate(today - FEED_DAYS + 1).getTime();
  const nm = uid => `<b>${esc(C[uid]?.name || S.players[uid]?.name || '?')}</b>`;
  for (const [id, w] of Object.entries(S.weighins)) {
    const p = C[w.uid]; if (!p || typeof w.lossPct !== 'number') continue;
    const start = w.slot === p.js;
    const reached = w.slot === p.goalWeek;
    ev.push({ id: 'w' + id, k: 'weigh', t: tsNum(w.ts) || slotStart(w.slot).getTime() + 9 * 36e5, approx: !tsNum(w.ts),
      html: start ? `${nm(w.uid)} hat das Startgewicht eingetragen` : reached ? `${nm(w.uid)} hat gewogen und das Ziel −${tn(pct(p.goal))} % erreicht` : `${nm(w.uid)} hat gewogen`,
      sub: start ? `startet in Woche ${w.slot + 1}` : `Woche ${w.slot} · ${tn(lossStr(w.lossPct))}${p.weeks[w.slot]?.hold ? (p.weeks[w.slot].inBand ? ' · Haltephase, im Ziel' : ' · Haltephase, daneben') : ''} · +${(p.weeks[w.slot]?.weigh ?? 0) + (p.weeks[w.slot]?.bonus ?? 0)} P.` });
  }
  // Wochenziel geschafft: an dem Tag, dessen Haken das Ziel erreicht hat (Zeit = letzte Änderung dieses Tages)
  for (const p of Object.values(C)) {
    const pl = S.players[p.uid];
    for (let w = Math.max(p.js + 1, weekOfDay(Math.max(0, today - FEED_DAYS))); w <= Math.min(weekOfDay(today), CONFIG.weeks); w++) {
      const H = habitsFor(pl, w), hits = [];
      H.forEach((h, i) => { let n = 0; for (let d = 7 * (w - 1); d < 7 * w && d <= today; d++) if (p.hl[d]?.[i] && ++n === h.target) hits.push({ i, d }); });
      const lastHit = hits.length === 3 ? Math.max(...hits.map(x => x.d)) : null;
      for (const { i, d } of hits) {
        const log = S.habitlogs[p.uid + '_' + d], t = tsNum(log?.ts) || dayDate(d).getTime() + 20 * 36e5;
        const late = !!log?.ts && dayIdx(new Date(t)) > d, sub = [`${H[i].target}× in Woche ${w}`];
        if (late) sub.push(`nachgetragen für ${fmtD(dayDate(d))}`);
        if (d === lastHit && hits.every(x => x.d < d || x.i <= i)) { sub.push('alle 3 Wochenziele'); if (p.streak.cur >= 2 && w >= curWeek() - 1) sub.push(`Streak ${wochen(p.streak.cur)}`); }
        ev.push({ id: `h${p.uid}_${w}_${i}`, k: 'habits', t, approx: !log?.ts, html: `${nm(p.uid)} hat „${esc(H[i].name)}“ geschafft`, sub: sub.join(' · ') });
      }
    }
  }
  for (const [id, td] of Object.entries(S.taskDone)) {
    const task = S.tasks[td.taskId]; if (!task || !C[td.uid]) continue;
    const rt = tsNum(td.ts), ct = tsNum(td.confirmedAt), tx = `„${esc(task.text)}“`;
    if (td.confirmedBy && (ct || rt)) ev.push({ id: 'c' + id, k: 'confirm', t: ct || rt, html: `${nm(td.confirmedBy)} hat die Aufgabe von ${nm(td.uid)} bestätigt`, sub: `${tx} · +${CONFIG.taskPts} P.` });
    else if (!td.confirmedBy && rt) ev.push({ id: 'r' + id, k: 'task', t: rt, html: `${nm(td.uid)} hat ${tx} geschafft`, sub: 'wartet auf Bestätigung' });
  }
  for (const p of Object.values(C)) if (p.finished && p.finishedAt) ev.push({ id: 'x' + p.uid, k: 'weigh', t: p.finishedAt, html: `${nm(p.uid)} ist mit erreichtem Ziel ausgestiegen`, sub: frozenLine(p) });
  for (const [w, ch] of Object.entries(S.weekly)) if (tsNum(ch.ts)) ev.push({ id: 'ch' + w, k: 'challenge', t: tsNum(ch.ts), html: `${nm(ch.setBy)} hat die Challenge für Woche ${w} gewählt`, sub: esc(ch.text) });
  for (const [id, x] of Object.entries(S.teamideas)) if (tsNum(x.ts) && x.setBy) ev.push({ id: 'ti' + id, k: 'team', t: tsNum(x.ts), html: `${nm(x.setBy)} hat ein Ziel für den Team-Monat vorgeschlagen`, sub: `Etappe ${x.etappe} · ${esc(x.text)}, ${ideaRate(x)}` });
  for (const t of Object.values(TEAM)) {
    ev.push({ id: 'td' + t.e, k: 'team', t: drawTime(t.e).getTime(), html: `<b>Team-Monat Etappe ${t.e}</b> ist ausgelost`, sub: t.items.map(i => `${esc(i.text)} ${teamFmt(i, i.target)}`).join(' · ') });
    if (t.closed) ev.push({ id: 'tr' + t.e, k: 'team', t: slotDeadline(etEndWeek(t.e)).getTime(), html: `<b>Team-Monat Etappe ${t.e}</b> ${t.reached ? 'geschafft' : 'nicht geschafft'}`, sub: t.reached ? `+${CONFIG.teamPts} P. für ${andJoin(Object.keys(t.by).map(u => esc(C[u]?.name || '?')))}` : `${t.items.filter(i => i.reached).length} von ${t.items.length} Zielen erreicht, kein Bonus` });
  }
  return ev.filter(e => e.t >= from).sort((a, b) => b.t - a.t || a.id.localeCompare(b.id));
}
const feedBase = () => isDesk() ? 20 : matchMedia('(min-width:640px)').matches ? 5 : 3; // Desktop: eigene Spalte bzw. scrollende Liste
function feedCard(top) {
  const all = feedEvents(), list = all.slice(0, UI.feedN ?? (top ? feedBase() : 8)), tnow = now().getTime(), today = dayIdx();
  const dayLbl = d => d === today ? 'Heute' : d === today - 1 ? 'Gestern' : fmtLong(dayDate(d));
  const hhmm = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  let h = '', lastDay = null;
  for (const e of list) {
    const t = Math.min(e.t, tnow), d = dayIdx(new Date(t));
    if (d !== lastDay) { h += `<li class="fday">${dayLbl(d)}</li>`; lastDay = d; }
    const fresh = FEED.init && !FEED.seen.has(e.id);
    h += `<li class="fe k-${e.k}${fresh ? ' new' : ''}" data-fid="${e.id}"><span class="fi">${svg(FEED_ICON[e.k])}</span><div class="fb"><p>${e.html}</p>${e.sub ? `<p class="fs">${e.sub}</p>` : ''}</div>${e.approx ? '' : `<time>${hhmm(t)}</time>`}</li>`;
  }
  return `<section class="card feed${top ? ' top' : ''}"><div class="hd"><h2><span class="live" aria-hidden="true"></span>Liveticker</h2><span class="aside">letzte ${FEED_DAYS} Tage</span></div>
    ${all.length ? `<ol class="flist">${h}</ol>${all.length > list.length ? `<button class="link" data-act="feedMore">Ältere anzeigen (${all.length - list.length})</button>` : ''}`
      : '<p class="small t2">Noch ruhig. Sobald jemand wiegt, ein Wochenziel schafft oder eine Aufgabe bestätigt, steht es hier.</p>'}</section>`;
}
function markFeedSeen() { // was einmal gezeigt wurde, gleitet beim nächsten Update nicht noch einmal herein
  const els = document.querySelectorAll('#app [data-fid]');
  els.forEach(el => FEED.seen.add(el.dataset.fid));
  if (document.querySelector('#app .feed')) FEED.init = true;
}

/* ---------- RANKING ---------- */
function metaLine(p) {
  if (!p) return '';
  const a = activity(p.lastActive); const out = [];
  if (a) out.push(`<span class="${a.still ? 'still' : ''}">${a.t}</span>`);
  if (p.hold) out.push(`<span class="ms hold">${HOLD_LBL}</span>`);
  if (pausedNow(p)) out.push('<span class="ms">Pause</span>');
  if (p.streak.cur > 0) out.push(`<span class="stk" title="Streak: ${wochen(p.streak.cur)} am Stück alle Wochenziele, Rekord ${p.streak.best}">${svg('flame')}${p.streak.cur}</span>`);
  for (const m of topMilestones(p)) out.push(`<span class="ms" title="Meilenstein: ${m.label}">${m.short || m.label}</span>`);
  return out.length ? `<span class="meta">${out.join('')}</span>` : '';
}
function viewRanking() {
  const cw = curWeek(); const cwc = clamp(cw, 1, CONFIG.weeks);
  if (UI.rankWeek === null) UI.rankWeek = cwc;
  if (UI.rankEtappe === null) UI.rankEtappe = etappeOf(cwc);
  const seg = `<div class="seg" role="group" aria-label="Wertung">${[['woche', 'Woche'], ['etappe', 'Etappe'], ['gesamt', 'Gesamt'], ['kasse', 'Kasse']].map(([k, l]) => `<button class="${UI.rankMode === k ? 'on' : ''}" data-act="rmode" data-m="${k}" aria-pressed="${UI.rankMode === k}">${l}</button>`).join('')}</div>`;
  if (UI.rankMode === 'kasse') return `<div class="view">${seg}<div class="board">${pane('', viewKasse(etNav))}</div></div>`;
  const r = rankCards(UI.rankMode);
  return `<div class="view">${seg}<div class="board rank">${pane('rl', r.list)}${pane('rc', r.chart)}</div></div>`;
}
const etNav = e => navBar('re', e, 1, etappeOf(clamp(curWeek(), 1, CONFIG.weeks)), `Etappe ${e} · ${fmtD(dayDate(7 * (e - 1) * CONFIG.etappeWeeks))}–${fmtD(dayDate(7 * Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks) - 1))}`);
function rankCards(mode) { // Liste (Woche/Etappe/Gesamt) und Diagramm "Punkte, aufsummiert"
  const cwc = clamp(curWeek(), 1, CONFIG.weeks);
  let list, title, note = '', losers = [];
  if (mode === 'woche') {
    const w = UI.rankWeek ?? cwc; list = rankWeek(C, w);
    title = navBar('rw', w, 1, cwc, `Woche ${w} · ${weekRange(w)}`);
    if (lastClosedSlot() < w) note = `<p class="small muted">Vorläufig: Waage-Punkte kommen am ${fmtD(slotStart(w))} bis ${CONFIG.deadlineHour} Uhr dazu.</p>`;
    const pz = Object.values(C).filter(p => p.weeks[w]?.paused).map(p => esc(p.name));
    if (pz.length) note += `<p class="small muted">Pause: ${andJoin(pz)}</p>`;
    else losers = weekLosers(C, w);
  } else if (mode === 'etappe') {
    list = rankEtappe(C, UI.rankEtappe ?? etappeOf(cwc)); title = etNav(UI.rankEtappe ?? etappeOf(cwc));
  } else {
    list = rankTotal(C);
    title = `<div class="hd"><h2>Gesamtwertung</h2><span class="aside">Topf <b>${eur(pot(C).total)}</b></span></div>`;
  }
  const cols = [['Waage', 'weigh'], ['Gewohn&shy;heiten', 'habits'], ['Chal&shy;lenge', 'weekly']];
  if (mode !== 'woche') cols.push(['Auf&shy;gaben', 'tasks'], ['Team', 'team']);
  if (mode === 'gesamt') cols.push(['Strafen', 'fee']);
  const top = list.length ? list[0].total : 0;
  const head = `<div class="rk head"><span class="pos">#</span><span class="who">Name</span><span class="br">${cols.map(([l]) => `<span>${l}</span>`).join('')}</span><span class="pts">Punkte</span></div>`;
  const rows = list.map(r => {
    const pos = 1 + list.filter(x => x.total > r.total).length;
    const fee = mode === 'gesamt' ? fees(C[r.uid], null).strafen : 0;
    const cls = ['rk', r.total === top && top > 0 && 'lead', r.uid === S.me && 'me', losers.includes(r.uid) && 'lo'].filter(Boolean).join(' ');
    return `<div class="${cls}"><span class="pos">${pos}</span>
      <span class="who"><span class="nm"><span class="dot" style="background:${r.color}"></span><span>${esc(r.name)}</span>${r.uid === S.me ? ' <span class="muted small">(du)</span>' : ''}${losers.includes(r.uid) ? ` <span class="tag bad">Letzter · zahlt ${eur(CONFIG.loserFee)}</span>` : ''}</span>${metaLine(C[r.uid])}</span>
      <span class="br">${cols.map(([l, k]) => `<span data-l="${l.replace(/&shy;/g, '')}">${k === 'fee' ? (fee ? eur(fee) : '–') : r[k]}</span>`).join('')}</span>
      <span class="pts"><b>${nf(r.total)}</b><small>${tn(lossStr(r.latest))}</small></span></div>`;
  }).join('');
  // Gesamt: Ausgestiegene mit eingefrorenem Ergebnis in einem eigenen Abschnitt
  const fin = mode === 'gesamt' ? Object.values(C).filter(p => p.active && p.finished).sort((a, b) => (a.goalWeek - a.js) - (b.goalWeek - b.js) || a.name.localeCompare(b.name)) : [];
  const finHtml = fin.length ? `<h3>Ziel erreicht</h3><div class="rlist fin">${fin.map(p => `<div class="rk${p.uid === S.me ? ' me' : ''}"><span class="pos">${svg('check')}</span>
      <span class="who"><span class="nm"><span class="dot" style="background:${p.color}"></span><span>${esc(p.name)}</span>${p.uid === S.me ? ' <span class="muted small">(du)</span>' : ''}</span><span class="meta"><span>${frozenLine(p)}</span><span>ausgestiegen nach Woche ${p.fw}</span></span></span>
      <span class="br"></span><span class="pts"><b>${nf(frozenPts(p))}</b><small>eingefroren</small></span></div>`).join('')}</div>` : '';
  const listCard = `<section class="card" style="--n:${cols.length}">${title}${note}${list.length ? `<div class="rlist">${head}${rows}</div>` : '<p class="muted">Noch keine Daten. Es geht los, sobald alle ihr Startgewicht eingetragen haben.</p>'}${finHtml}</section>`;
  const ps = Object.values(C).filter(p => p.active);
  CHARTS.points = { series: pointsSeries(), yFmt: v => nf(v), xFmt: k => k === 0 ? 'Start' : 'W' + k, tip: v => nf(v) + ' P.', tipHead: k => k === 0 ? 'Start' : `Woche ${k} · bis ${fmtD(dayDate(7 * k - 1))}`, xMin: 4, hi: 10, hl: S.me, aria: 'Punkte aufsummiert pro Woche' };
  const chartCard = ps.length ? `<section class="card fillc"><div class="hd"><h2>Punkte, aufsummiert</h2><span class="aside">pro Woche</span></div><div class="chart fill" data-chart="points"></div>${legend(ps)}</section>` : '';
  return { list: listCard, chart: chartCard };
}
function pointsSeries() {
  const last = clamp(curWeek(), 1, CONFIG.weeks);
  return Object.values(C).filter(p => p.active && p.js < last).map(p => {
    const pts = [[p.js, 0]]; let cum = 0;
    for (let w = p.js + 1; w <= (p.finished ? Math.min(last, p.fw) : last); w++) {
      cum += p.weeks[w]?.total || 0;
      for (let e = 1; e <= NUM_ETAPPEN; e++) if (Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks, last) === w) cum += (p.taskPts[e] || 0) + (p.teamPts[e] || 0);
      pts.push([w, cum]);
    }
    return { uid: p.uid, name: p.name, color: p.color, pts };
  });
}
const legend = ps => ps.length > 4 ? `<div class="legend">${ps.map(p => `<span><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span>`).join('')}</div>` : '';
function viewKasse() {
  const e = UI.rankEtappe;
  const ps = Object.values(C).filter(p => p.active).map(p => ({ p, f: fees(p, e), g: fees(p, null) })).sort((a, b) => b.f.total - a.f.total || a.p.name.localeCompare(b.p.name));
  const po = pot(C);
  const cell = (n, price) => n ? `${n}× <span class="muted">${eur(n * price)}</span>` : '–';
  let sumE = 0, sumG = 0;
  const ref = po.refunds > 0; // Spalte "Einsatz zurück" nur, wenn jemand ausgestiegen ist
  const rows = ps.map(({ p, f, g }) => { sumE += f.total; sumG += g.total; return `<tr><td><span class="row"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</span></td><td>${f.einsatz ? eur(f.einsatz) : '–'}</td>${ref ? `<td>${f.refund ? `<span class="ok">−${eur(f.refund)}</span>` : '–'}</td>` : ''}<td>${cell(f.missed, CONFIG.strafe)}</td><td>${cell(f.habitWeeks, CONFIG.habitFee)}</td><td>${cell(f.losers, CONFIG.loserFee)}</td><td><b>${eur(f.total)}</b></td><td>${eur(g.total)}</td></tr>`; }).join('');
  return `<section class="card">${etNav(e)}
    ${ps.length ? `<div class="tscroll"><table class="t"><tr><th>Name</th><th>Einsatz</th>${ref ? '<th>Einsatz zurück</th>' : ''}<th>Wiegen verpasst</th><th>Wochenziele verfehlt</th><th>Letzter</th><th>Etappe</th><th>Gesamt</th></tr>${rows}
    <tr class="sum"><td>Summe</td><td></td>${ref ? '<td></td>' : ''}<td></td><td></td><td></td><td>${eur(sumE)}</td><td>${eur(sumG)}</td></tr></table></div>` : '<p class="muted">Noch keine Daten.</p>'}
    <p class="small t2">Topf gesamt: <b>${eur(po.total)}</b> (${po.players} × ${eur(CONFIG.einsatz)} Einsatz${ref ? `, ${po.refunds}× Einsatz zurück (Ziel erreicht, ausgestiegen)` : ''}, ${po.missed}× Wiegen verpasst, ${po.habitWeeks}× Wochenziele verfehlt, ${po.losers}× Letzter).</p></section>`;
}

/* ---------- CHALLENGES ---------- */
function viewChallenges() {
  const cw = curWeek(); const ce = cw === 0 ? 1 : etappeOf(Math.min(cw, CONFIG.weeks));
  if (UI.etView === null) UI.etView = ce;
  const e = UI.etView;
  const tasks = Object.entries(S.tasks).filter(([, t]) => t.etappe === e).sort((a, b) => tsNum(a[1].ts) - tsNum(b[1].ts));
  const ed = taskEditable(e) && S.member && !C[S.me]?.finished;
  const ws = (e - 1) * CONFIG.etappeWeeks + 1, we = Math.min(e * CONFIG.etappeWeeks, CONFIG.weeks);
  const nav = navBar('ev', e, 1, ce, `Etappe ${e} · ${fmtD(dayDate(7 * (ws - 1)))}–${fmtD(dayDate(7 * we - 1))}`);
  // Ausgestiegene zählen nicht mehr mit (weder bei den Spielern noch bei den gestellten Aufgaben)
  const nAct = Object.values(C).filter(p => (p.active || p.uid === S.me) && !p.finished).length, nSet = tasks.filter(([, t]) => !C[t.createdBy]?.finished).length;
  let h = `<section class="card" data-k="task"><div class="hd"><h2>Extra-Aufgaben</h2><span class="aside">${nSet}/${nAct} gestellt · +${CONFIG.taskPts} P.</span></div>`;
  if (!tasks.length) h += `<p class="t2">Noch keine Aufgaben für diese Etappe.</p>`;
  for (const [id, t] of tasks) {
    const tds = Object.entries(S.taskDone).filter(([, d]) => d.taskId === id);
    const mine = S.taskDone[id + '_' + S.me];
    let my;
    if (!mine) my = ed && cw > 0 ? `<button class="btn ghost sm" data-act="mark" data-id="${id}" data-on="1">Hab ich geschafft</button>` : '';
    else if (!mine.confirmedBy) my = `<span class="tag">Wartet auf Bestätigung</span>${ed ? `<button class="link" data-act="mark" data-id="${id}" data-on="0">Zurückziehen</button>` : ''}`;
    else my = `<span class="tag ok">+${CONFIG.taskPts} · bestätigt von ${esc(mine.confirmedByName || '')}</span>`;
    const others = tds.filter(([, d]) => d.uid !== S.me).sort((a, b) => (C[a[1].uid]?.name || '').localeCompare(C[b[1].uid]?.name || '')).map(([tid, d]) => {
      const n = esc(C[d.uid]?.name || '?');
      return d.confirmedBy ? `<span class="tag ok">${n} geschafft</span>` : `<button class="btn ghost sm" data-act="confirm" data-id="${tid}">${n} bestätigen</button>`;
    }).join('');
    const canDel = t.createdBy === S.me && !tds.length;
    h += `<div class="task"><div class="row top"><div class="grow"><div class="tt">${esc(t.text)}</div><div class="small muted">von ${esc(t.createdByName)}</div></div>${canDel ? `<button class="link" data-act="delTask" data-id="${id}">Löschen</button>` : ''}</div>
      ${my + others ? `<div class="who">${my}${others}</div>` : ''}</div>`;
  }
  if (ed && !tasks.some(([, t]) => t.createdBy === S.me)) h += `<h3>Deine Aufgabe für Etappe ${e}</h3><div class="row"><input class="inp grow" id="tText" maxlength="80" placeholder="z. B. 1 Stunde schwimmen" aria-label="Deine Aufgabe"><button class="btn" data-act="addTask" data-e="${e}">Stellen</button></div>`;
  else if (tasks.length) h += `<p class="small muted">Zählt, sobald jemand anderes bestätigt.</p>`;
  h += `</section>`;
  // Wochen-Challenges der Etappe
  let wl = '';
  for (let w = ws; w <= we; w++) {
    const ch = S.weekly[w]; if (!ch) continue;
    const who = Object.values(C).filter(p => p.weeks[w]?.weekly).map(p => ({ p, v: p.weeks[w].weekly })).sort((a, b) => b.v - a.v);
    wl += `<div class="task"><div class="row top"><span class="wk">W${w}</span><div class="grow"><div class="tt">${esc(ch.text)}</div><div class="small muted">${chLabel(ch)} · von ${esc(ch.setByName)}</div>${who.length ? `<div class="who">${chips(who)}</div>` : ''}</div></div></div>`;
  }
  const wc = `<section class="card" data-k="challenge"><div class="hd"><h2>Wochen-Challenges</h2></div>${wl || '<p class="t2">Noch keine.</p>'}</section>`;
  // Spalten: 1 = untereinander · 2 = [Aufgaben] [Team + Challenges] · 3 = [Aufgaben] [Team] [Challenges]
  return `<div class="view">${nav}<div class="board chal">${pane('t', h)}<div class="grp gT">${pane('tm', teamSection(e, ce))}${pane('wc', wc)}</div></div></div>`;
}
function teamSection(e, ce) {
  const t = TEAM[e];
  let h = `<section class="card" data-k="team"><div class="hd"><h2>Team-Monat</h2><span class="aside">+${CONFIG.teamPts} P. wenn alle Ziele klappen</span></div>`;
  if (t) h += teamHead(t, false);
  else if (now() < drawTime(e)) h += ideasBlock(e);
  else h += `<p class="t2">In dieser Etappe gab es keinen Team-Monat (keine Vorschläge).</p>`;
  if (e === ce && e < NUM_ETAPPEN && now() >= drawTime(e)) h += `<h3>Vorschläge für Etappe ${e + 1}</h3>${ideasBlock(e + 1)}`;
  return h + `</section>`;
}
function ideasBlock(e) {
  const list = ideasFor(S, e), open = now() < drawTime(e);
  let h = `<p class="small t2">Jeder schlägt ein Ziel pro Person vor. Am <b>${fmtDT(drawTime(e))}</b> werden ${CONFIG.teamDraw} davon zufällig gezogen und aufs ganze Team hochgerechnet.</p>`;
  h += list.length ? list.map(x => `<div class="task"><div class="row top"><div class="grow"><div class="tt">${esc(x.text)}</div><div class="small muted">${ideaRate(x)} · von ${esc(x.setByName)}</div></div>${x.setBy === S.me && open ? `<button class="link" data-act="delIdea" data-id="${esc(x.id)}">Zurückziehen</button>` : ''}</div></div>`).join('')
    : '<p class="small muted">Noch keine Vorschläge.</p>';
  if (canSuggest(e)) h += `<div class="stack idea"><input class="inp" id="iText" maxlength="60" placeholder="Was? z. B. Schritte sammeln" aria-label="Was soll das Team schaffen?">
    <select class="inp" id="iKind" aria-label="Art"><option value="sum">Menge: jeder trägt täglich eine Zahl ein</option><option value="count">Anzahl: jeder hakt ab (max. 1× pro Tag)</option></select>
    <div class="row wrapr"><input class="inp grow" id="iPer" inputmode="decimal" placeholder="z. B. 8000" aria-label="Wie viel pro Person"><input class="inp grow" id="iUnit" maxlength="20" placeholder="z. B. Schritte" aria-label="Einheit"><select class="inp auto" id="iPeriod" aria-label="Zeitraum"><option value="day">pro Tag</option><option value="week">pro Woche</option><option value="month">pro Monat</option></select></div>
    <button class="btn ghost" data-act="addIdea" data-e="${e}">Vorschlagen</button></div>`;
  return h;
}

/* ---------- VERLAUF ---------- */
function viewVerlauf() { // Handy/Tablet: eigener Tab
  return `<div class="view"><div class="board verl">${pane('loss', lossCard())}${pane('chron', chronicleCard())}</div></div>`;
}
function lossCard() {
  const players = Object.values(C).filter(p => p.active);
  let h = `<section class="card fillc"><div class="hd"><h2>Abnahme seit Start</h2><button class="link" data-act="ctab">${UI.chartTable ? 'Als Diagramm' : 'Als Tabelle'}</button></div>
    <p class="small muted">In Prozent vom eigenen Startgewicht.${isDesk() ? '' : ' Deine kg-Werte stehen unter <button class="link" data-tab="ich">Ich</button>, nur für dich.'}</p>`;
  if (!players.length) h += `<p class="t2">Noch keine Daten.</p>`;
  else if (UI.chartTable) {
    const maxS = Math.max(...players.flatMap(p => Object.keys(p.wb).map(Number)));
    h += `<div class="tscroll"><table class="t"><tr><th>Woche</th>${players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>`;
    for (let k = 0; k <= maxS; k++) h += `<tr><td>${k === 0 ? 'Start' : k}</td>${players.map(p => `<td>${p.wb[k] !== undefined ? tn(lossStr(p.wb[k])) : '–'}</td>`).join('')}</tr>`;
    h += `</table></div>`;
  } else {
    CHARTS.loss = {
      series: players.map(p => ({ uid: p.uid, name: p.name, color: p.color, pts: Object.keys(p.wb).map(Number).sort((a, b) => a - b).map(k => [k, p.wb[k]]) })),
      yFmt: v => Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '−' : '+') + pct(Math.abs(v)), xFmt: k => k === 0 ? 'Start' : 'W' + k,
      tip: v => lossStr(v), tipHead: k => (k === 0 ? 'Start' : 'Woche ' + k) + ' · ' + fmtD(slotStart(k)), xMin: 4, hi: 2, hl: S.me, aria: 'Abnahme in Prozent pro Woche',
    };
    h += `<div class="chart fill" data-chart="loss"></div>${legend(players)}`;
  }
  return h + `</section>`;
}
// Sieger und Letzte jeder abgeschlossenen Woche, neueste oben
function chronicleCard() {
  const lc = Math.min(lastClosedSlot(), CONFIG.weeks); if (lc < 1) return '';
  let rows = '';
  for (let w = lc; w >= 1; w--) {
    const r = rankWeek(C, w); if (!r.length) continue;
    const top = r[0].total, win = r.filter(x => x.total === top), lo = weekLosers(C, w);
    const loN = r.filter(x => lo.includes(x.uid));
    rows += `<tr><td>W${w}</td><td>${win.map(x => esc(x.name)).join(', ')} <span class="muted">${top}</span></td><td>${loN.length ? `<span class="bad">${loN.map(x => esc(x.name)).join(', ')}</span> <span class="muted">${loN[0].total}</span>` : '–'}</td></tr>`;
  }
  return rows ? `<section class="card"><div class="hd"><h2>Wochen-Chronik</h2><span class="aside">Sieger und Letzte</span></div><div class="tscroll"><table class="t chron"><tr><th>Woche</th><th>Sieger</th><th>Letzter</th></tr>${rows}</table></div></section>` : '';
}

/* Liniendiagramm: wird in echter Pixelgröße gezeichnet, damit die Schrift bei jeder Größe 12 px bleibt.
   .chart.fill in einer Spalte mit fester Höhe (Desktop, CSS setzt dann --fill: 1) füllt Breite UND Höhe des Panels,
   sonst ergibt sich die Höhe aus der Breite.
   Optionen: zero:false (y-Achse nicht ab 0, z. B. kg), x0 (erste Woche), area (Fläche bei 1 Linie), refs (Hilfslinien), hl (uid hervorheben) */
const RO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(es => es.forEach(e => drawChart(e.target))) : null;
function wireCharts() { RO?.disconnect(); document.querySelectorAll('#app .chart[data-chart]').forEach(el => { drawChart(el); RO?.observe(el); }); }
function drawChart(el) {
  const c = CHARTS[el.dataset.chart]; const W = Math.floor(el.clientWidth);
  const fill = getComputedStyle(el).getPropertyValue('--fill').trim() === '1';
  const H = fill ? Math.max(180, Math.floor(el.clientHeight)) : clamp(Math.round(W * .55), 200, 320);
  if (!c || W < 120 || el._sz === W + 'x' + H) return; el._sz = W + 'x' + H;
  const s = c.series.filter(x => x.pts.length);
  if (!s.length) { el.innerHTML = '<p class="t2">Noch keine Daten.</p>'; return; }
  const many = s.length > 6; el.classList.toggle('many', many);
  const names = c.labels ?? s.length <= 4;
  const R = names ? 14 + Math.max(...s.map(x => x.name.length * 7.4)) : 12, L = 44, T = 14, B = 26;
  const refs = c.refs || [];
  const vals = [...s.flatMap(x => x.pts.map(p => p[1])), ...refs.map(r => r.v)];
  let lo, hi;
  if (c.zero === false) { lo = Math.min(...vals); hi = Math.max(...vals); const span = c.minSpan ?? 2; if (hi - lo < span) { const m = (hi + lo) / 2; lo = m - span / 2; hi = m + span / 2; } }
  else { lo = Math.min(0, ...vals); hi = Math.max(c.hi ?? 1, ...vals); }
  const raw = (hi - lo) / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw - 1e-9);
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step; if (hi <= lo) hi = lo + step;
  const x0 = c.x0 ?? 0;
  const xm = Math.max(x0 + (c.xMin ?? 4), ...s.flatMap(x => x.pts.map(p => p[0])));
  const per = (W - L - R) / (xm - x0);
  const x = k => L + per * (k - x0), y = v => T + (H - T - B) * (hi - v) / (hi - lo);
  let g = '';
  for (let i = 0; lo + i * step <= hi + 1e-9; i++) { const v = lo + i * step; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${Math.abs(v) < 1e-9 ? 'zero' : 'gl'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${c.yFmt(v)}</text>`; }
  const xs = [1, 2, 4, 8, 12, 24].find(n => n * per >= 36) || 24;
  for (let k = x0; k <= xm; k += xs) g += `<text x="${x(k)}" y="${H - 8}" text-anchor="middle">${c.xFmt(k)}</text>`;
  for (const r of refs) { const yy = y(r.v).toFixed(1); g += `<line class="ref" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>${r.label ? `<text class="reft" x="${W - R}" y="${(y(r.v) - 6).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>` : ''}`; }
  let defs = '', lines = '', dl = ''; const lab = [];
  const ordered = [...s].sort((a, b) => (a.uid === c.hl) - (b.uid === c.hl)); // hervorgehobene Linie zuletzt = oben
  for (const se of ordered) {
    const lit = !many || se.uid === c.hl;
    const P = se.pts.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
    if (c.area && s.length === 1) {
      const id = 'ar-' + el.dataset.chart, base = (H - B).toFixed(1);
      defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${se.color};stop-opacity:.32"/><stop offset="1" style="stop-color:${se.color};stop-opacity:0"/></linearGradient>`;
      lines += `<path d="M${P.join(' L')} L${x(se.pts[se.pts.length - 1][0]).toFixed(1)},${base} L${x(se.pts[0][0]).toFixed(1)},${base} Z" fill="url(#${id})"/>`;
    }
    lines += `<polyline class="ln${se.uid === c.hl ? ' hi' : ''}" style="color:${se.color}"${lit ? ' filter="url(#fx-glow)"' : ''} points="${P.join(' ')}"/>`;
    if (se.pts.length <= 12 && lit) lines += se.pts.map(p => `<circle class="pt" cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="3.5" style="color:${se.color}"/>`).join('');
    const lp = se.pts[se.pts.length - 1]; lab.push({ x: x(lp[0]), y: y(lp[1]), name: se.name });
  }
  if (names) { lab.sort((a, b) => a.y - b.y); for (let i = 1; i < lab.length; i++) if (lab[i].y - lab[i - 1].y < 15) lab[i].y = lab[i - 1].y + 15; dl = lab.map(l => `<text class="nm" x="${(l.x + 8).toFixed(1)}" y="${(l.y + 4).toFixed(1)}">${esc(l.name)}</text>`).join(''); }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.aria || '')}">${defs ? `<defs>${defs}</defs>` : ''}${g}<line class="xh" y1="${T}" y2="${H - B}" style="display:none"/>${lines}${dl}</svg><div class="tip" hidden></div>`;
  el._c = { x, x0, xm, per, L, s, c };
  if (el._wired) return; el._wired = true;
  const move = ev => {
    const z = el._c, svgEl = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh'); if (!svgEl) return;
    const r = svgEl.getBoundingClientRect();
    const k = clamp(Math.round((ev.clientX - r.left - z.L) / z.per) + z.x0, z.x0, z.xm);
    let rows = z.s.map(se => ({ se, p: se.pts.find(p => p[0] === k) })).filter(o => o.p).sort((a, b) => b.p[1] - a.p[1]);
    if (!rows.length) { tip.hidden = true; xh.style.display = 'none'; return; }
    let more = 0; // bei vielen Spielern: die besten 9 und du
    if (rows.length > 10) { const keep = rows.slice(0, 9), mine = rows.find(o => o.se.uid === z.c.hl); if (mine && !keep.includes(mine)) keep.push(mine); more = rows.length - keep.length; rows = keep; }
    xh.setAttribute('x1', z.x(k)); xh.setAttribute('x2', z.x(k)); xh.style.display = '';
    tip.innerHTML = `<div class="muted" style="margin-bottom:4px">${z.c.tipHead(k)}</div>` + rows.map(o => `<div class="tr"><span class="row" style="gap:6px"><span class="dot" style="background:${o.se.color}"></span>${esc(o.se.name)}</span><b>${z.c.tip(o.p[1], k)}</b></div>`).join('') + (more ? `<div class="muted" style="margin-top:4px">+${more} weitere</div>` : '');
    tip.hidden = false;
    const px = z.x(k), tw = tip.offsetWidth;
    tip.style.left = (px + 12 + tw > r.width ? Math.max(0, px - tw - 12) : px + 12) + 'px';
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', () => { const tip = el.querySelector('.tip'), xh = el.querySelector('.xh'); if (tip) tip.hidden = true; if (xh) xh.style.display = 'none'; });
}

/* ---------- ICH (privat: nur der eigene Browser zeigt kg und Ziel) ---------- */
function myKg() { // eigene kg aus players/{uid}/private/weights
  const me = C[S.me], ks = Object.keys(S.myWeights).map(Number).sort((a, b) => a - b);
  const lk = ks[ks.length - 1];
  return { ks, start: S.myWeights[me?.js ?? 0], last: lk !== undefined ? S.myWeights[lk] : undefined };
}
function viewIch() {
  const me = C[S.me], p = S.players[S.me];
  // Desktop: Ich und Verlauf in einem Tab. Spalten: 2 = [Ich] [Verlauf] · 3 = [Ziel, Meilensteine] [kg, Heatmap] [Verlauf] · 4 = Verlauf geteilt
  const v = isDesk() ? `<div class="grp gV">${pane('loss', lossCard())}${pane('chron', chronicleCard())}</div>` : '';
  return `<div class="view"><div class="board ich${v ? ' wv' : ''}"><div class="grp gI"><div class="grp gI1">${pane('goal', goalCard(me))}${pane('ms', msCard(me))}</div>
    <div class="grp gI2">${pane('kg', kgCard(me))}${pane('heat', heatCard(me, p))}</div></div>${v}</div></div>`;
}
function goalCard(me) {
  const p = S.players[S.me], g = me?.goal, act = !!me?.active, cur = act ? me.latest : 0, kg = myKg();
  const goalKg = g && kg.start ? kg.start * (1 - g / 100) : null; // nur für dich: Ziel in kg
  const prog = g && act ? Math.max(0, cur) / g : 0, done = !!me?.active && me.goalWeek !== null, ed = goalEditable(me, p);
  let txt;
  if (!g) txt = 'Leg fest, wie viel Prozent vom Startgewicht du abnehmen willst. Ab dem Startgewicht ist das Ziel fest.';
  else if (!act) txt = `Ab dem Startgewicht ist das Ziel fest, bis dahin kannst du es noch ändern.`;
  else if (done) txt = `<b class="ok">Ziel erreicht</b> in Woche ${me.goalWeek}.`;
  else txt = `Noch <b>${kg.last !== undefined && goalKg ? tn(fmt1(Math.max(0, kg.last - goalKg))) + ' kg' : tn(pct(g - Math.max(0, cur))) + ' %'}</b>${goalKg ? ` bis ${tn(fmt1(goalKg))} kg` : ''}, ${Math.round(prog * 100)} % geschafft.`;
  const lost = kg.start !== undefined && kg.last !== undefined ? kg.start - kg.last : null;
  const tiles = act ? `<div class="tiles">
    <div class="tile"><b class="num">${lost === null ? '–' : tn((lost > 0.049 ? '−' : lost < -0.049 ? '+' : '±') + fmt1(Math.abs(lost)))}</b><span>kg seit Start</span></div>
    <div class="tile"><b class="num">${tn(lossStr(me.bestLoss))}</b><span>bester Wert</span></div>
    <div class="tile"><b class="num">${me.streak.best}</b><span>Wochen-Streak-Rekord</span></div></div>` : '';
  const form = ed ? `<div class="row">${goalInput('goal', g)}<button class="btn${g ? ' ghost' : ''}" data-act="setGoal">${g ? 'Ändern' : 'Festlegen'}</button></div>`
    : g ? `<p class="small muted row">${svg('lock')}Fest seit deinem Startgewicht.</p>` : '';
  return `<section class="card goal${done ? ' done' : ''}" data-k="me"><div class="hd"><h2>Dein Ziel</h2><span class="aside privnote">${svg('lock')}kg nur für dich</span></div>
    <div class="goalring">${ringSvg([{ p: Math.min(prog, 1), c: 'var(--pink)' }], 184, 18, 0)}<div class="ringc"><b class="num">${act ? tn(lossStr(cur)) : '–'}</b><small>${g ? `Ziel −${tn(pct(g))} %${goalKg ? ` · ${tn(fmt1(goalKg))} kg` : ''}` : 'noch kein Ziel'}</small></div></div>
    <p class="small t2">${txt}</p>
    ${form}${exitBtn(me)}${tiles}
    ${seasonOver() && act ? `<button class="link" data-act="wrapped">Saisonrückblick ansehen</button>` : ''}</section>`;
}
function kgCard(me) {
  const kg = myKg();
  let h = `<section class="card kg fillc" data-k="weigh"><div class="hd"><h2>Dein Gewicht</h2>${kg.ks.length ? `<button class="link" data-act="kgtab">${UI.kgTable ? 'Als Diagramm' : 'Als Tabelle'}</button>` : ''}</div>`;
  if (!kg.ks.length) return h + `<p class="t2">Noch keine Werte. Montags ${weighHours} wiegen, dann steht hier dein Verlauf in kg.</p></section>`;
  const js = me?.js ?? kg.ks[0];
  const goalKg = me?.goal && kg.start ? kg.start * (1 - me.goal / 100) : null;
  if (UI.kgTable) {
    h += `<div class="tscroll"><table class="t"><tr><th>Woche</th><th>kg</th><th>seit Start</th><th>Punkte</th></tr>
      ${kg.ks.slice().reverse().map(k => `<tr><td>${k === js ? 'Start' : k}</td><td>${tn(fmt1(S.myWeights[k]))}</td><td>${me?.wb[k] !== undefined ? tn(lossStr(me.wb[k])) : '–'}</td><td>${k > js && me?.weeks[k] ? '+' + (me.weeks[k].weigh + me.weeks[k].bonus) : ''}</td></tr>`).join('')}</table></div>`;
  } else {
    CHARTS.kg = {
      series: [{ uid: S.me, name: 'Du', color: 'var(--pink)', pts: kg.ks.map(k => [k, S.myWeights[k]]) }], zero: false, area: true, labels: false, x0: js, xMin: 4, minSpan: 2,
      yFmt: v => pct(v), xFmt: k => k === js ? 'Start' : 'W' + k, tip: (v, k) => `${fmt1(v)} kg${k !== js && me?.wb[k] !== undefined ? ' · ' + lossStr(me.wb[k]) : ''}`,
      tipHead: k => (k === js ? 'Start' : 'Woche ' + k) + ' · ' + fmtD(slotStart(k)), refs: goalKg ? [{ v: goalKg, label: `Ziel ${fmt1(goalKg)} kg` }] : [], aria: 'Dein Gewicht in kg pro Woche',
    };
    h += `<div class="chart fill" data-chart="kg"></div>`;
  }
  return h + `<p class="small muted">Nur du siehst die kg-Werte, die anderen sehen nur Prozente.</p></section>`;
}
// GitHub-artige Heatmap über die ganze Saison: Spalte = Woche, Zeile = Wochentag (Mo–So)
function heatCard(me, p) {
  const W = CONFIG.weeks, today = dayIdx(), js = p?.joinedSlot || 0, hl = me?.hl || {};
  let cells = '', ticks = 0;
  for (let d = 0; d < W * 7; d++) {
    const done = hl[d] || [], n = done.slice(0, 3).filter(Boolean).length, lvl = Math.min(4, n + (done[3] ? 1 : 0));
    const fut = d > today, pre = d < 7 * js;
    if (!fut && !pre) ticks += n;
    const tip = fut || pre ? fmtD(dayDate(d)) : `${fmtD(dayDate(d))}: ${n} von 3${done[3] ? ' + Challenge' : ''}`;
    cells += `<i class="${fut ? 'f' : pre ? 'x' : 'l' + lvl}${d === today ? ' td' : ''}" style="--c:${Math.floor(d / 7) + d % 7}" title="${tip}"></i>`;
  }
  const top = Array.from({ length: NUM_ETAPPEN }, (_, i) => `<span style="--span:${Math.min(CONFIG.etappeWeeks, W - i * CONFIG.etappeWeeks)}">E${i + 1}</span>`).join('');
  const days = ['Mo', '', 'Mi', '', 'Fr', '', 'So'].map(t => `<span>${t}</span>`).join('');
  // Wochen mit allen 3 Wochenzielen (abgeschlossene Wochen plus die laufende, falls schon geschafft)
  const wks = Object.entries(me?.weeks || {}).filter(([w, x]) => +w <= Math.min(curWeek(), W) && (weekFinal(+w) || x.met));
  const met = wks.filter(([, x]) => x.met).length;
  const leg = `<div class="hm-legend" aria-hidden="true"><span>weniger</span>${[0, 1, 2, 3, 4].map(l => `<i class="${l ? 'l' + l : ''}"></i>`).join('')}<span>mehr</span></div>`;
  return `<section class="card heat" data-k="habits"><div class="hd"><h2>Gewohnheiten, ganze Saison</h2><span class="aside">${W} Wochen · ${W * 7} Tage</span></div>
    <div class="heatbox" style="--w:${W}"><div class="heatg"><div class="hm-top" aria-hidden="true">${top}</div><div class="hm-days" aria-hidden="true">${days}</div>
    <div class="hm" role="img" aria-label="Heatmap: ${ticks} Haken, ${met} Wochen mit allen Zielen">${cells}</div></div></div>
    <div class="row" style="justify-content:space-between;flex-wrap:wrap"><p class="hm-sum"><span><b>${met}</b>${wks.length ? ` von ${wks.length}` : ''} Wochen alle Ziele</span><span><b>${ticks}</b> Haken</span></p>${leg}</div></section>`;
}
function msCard(me) {
  const cats = [['g', 'Dein Ziel'], ['l', 'Abnahme (bester Wert)'], ['w', 'Wiegen ohne Pause'], ['s', 'Streak']];
  const prog = m => m.cat === 'g' ? (me.goal ? `bisher ${pct(Math.max(0, me.latest))} von ${pct(me.goal)} %` : 'noch kein Ziel') : m.cat === 'l' ? `bisher ${pct(Math.max(0, me.bestLoss))} %` : m.cat === 'w' ? `bisher ${me.weighRun}` : `Rekord ${wochen(me.streak.best)}`;
  const groups = cats.map(([c, t]) => `<div><h4>${t}</h4><div class="chips">${MILESTONES.filter(m => m.cat === c).map(m => { const got = me.ms.includes(m.id); return `<span class="msi${got ? ' got' : ''}" title="${esc(m.label + (got ? ': erreicht' : ': ' + prog(m)))}">${got ? svg('check') : ''}${m.short || m.label}</span>`; }).join('')}</div></div>`).join('');
  const next = me.active ? ['g', 'l', 'w', 's'].map(c => MILESTONES.find(x => x.cat === c && !me.ms.includes(x.id))).filter(Boolean).map(x =>
    x.cat === 'g' ? (me.goal ? `${x.label} (noch ${fmt1(Math.max(0, me.goal - me.latest))} %)` : null) : x.cat === 'l' ? `${x.label} (noch ${fmt1(x.n - me.bestLoss)} %)` : x.cat === 'w' ? `${x.label} (bisher ${me.weighRun})` : `${x.label} (Rekord ${wochen(me.streak.best)})`) : [];
  const nx = next.filter(Boolean);
  return `<section class="card msc" data-k="rank"><div class="hd"><h2>Meilensteine</h2><span class="aside"><b>${me.ms.length}</b>/${MILESTONES.length}</span></div><div class="msg">${groups}</div>
    ${nx.length ? `<p class="small muted">Als Nächstes: ${nx.join(' · ')}</p>` : ''}</section>`;
}

/* ---------- SAISONRÜCKBLICK (Wrapped) ---------- */
function wrappedData() {
  const p = C[S.me]; if (!p?.active) return null;
  const tot = rankTotal(C), mine = tot.find(x => x.uid === S.me); if (!mine) return null;
  const f = fees(p, null), ser = pointsSeries(), ms = ser.find(x => x.uid === S.me);
  // Nemesis: wessen Punktestand lag über die Saison im Schnitt am nächsten an deinem (Wochen, in denen beide dabei waren)?
  let nem = null;
  if (ms) for (const q of ser) {
    if (q.uid === S.me) continue;
    const qm = new Map(q.pts), from = Math.max(p.js, C[q.uid]?.js ?? 0);
    let sum = 0, n = 0, last = null;
    for (const [w, v] of ms.pts) if (w > from && qm.has(w)) { sum += Math.abs(v - qm.get(w)); n++; last = v - qm.get(w); }
    if (!n) continue;
    const avg = sum / n;
    if (!nem || avg < nem.avg - 1e-9 || (Math.abs(avg - nem.avg) < 1e-9 && q.name.localeCompare(nem.name) < 0)) nem = { name: q.name, avg, n, pts: q.pts, last };
  }
  // Wochensiege: Wochen, in denen niemand mehr Punkte hatte (bei Gleichstand zählt es für alle Ersten)
  let wins = 0, weeks = 0;
  for (let w = p.js + 1; w <= CONFIG.weeks; w++) {
    const r = rankWeek(C, w), m = r.find(x => x.uid === S.me); if (!m) continue;
    weeks++; if (r.length > 1 && m.total > 0 && m.total === r[0].total) wins++;
  }
  return { name: p.name, loss: p.latest, pos: 1 + tot.filter(x => x.total > mine.total).length, of: tot.length, total: mine.total, wins, weeks,
    strafen: f.strafen, missed: f.missed, losers: f.losers, habitWeeks: f.habitWeeks, streak: p.streak.best, nem, mine: ms?.pts || [], winner: tot[0], pot: pot(C).total };
}
function duelSvg(a, b) { // Mini-Diagramm: du (durchgezogen) gegen Nemesis (gestrichelt)
  const all = [...a, ...b], x0 = Math.min(...all.map(p => p[0])), xm = Math.max(x0 + 1, ...all.map(p => p[0])), ym = Math.max(1, ...all.map(p => p[1]));
  const Wd = 300, H = 56, x = k => ((k - x0) / (xm - x0) * (Wd - 4) + 2).toFixed(1), y = v => (H - 3 - v / ym * (H - 6)).toFixed(1);
  const line = (pts, cls) => `<polyline class="${cls}" vector-effect="non-scaling-stroke" points="${pts.map(p => `${x(p[0])},${y(p[1])}`).join(' ')}"/>`;
  return `<svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="none" aria-hidden="true">${line(b, 'nem')}${line(a, 'me')}</svg>`;
}
function wrappedHtml(fresh) {
  const d = wrappedData(); if (!d) return '';
  const end = dayDate(CONFIG.weeks * 7 - 1), gain = d.loss < 0.05;
  const fd = d.nem ? Math.round(d.nem.last) : 0;
  const final = !d.nem ? '' : fd > 0 ? `am Ende ${ptsStr(fd)} vorn` : fd < 0 ? `am Ende ${ptsStr(-fd)} dahinter` : 'am Ende punktgleich';
  const fee = d.strafen ? [d.missed && `${d.missed}× Wiegen verpasst`, d.habitWeeks && `${d.habitWeeks}× Wochenziele verfehlt`, d.losers && `${d.losers}× Letzter`].filter(Boolean).join(' · ') : 'kein einziger Euro';
  return `<div class="wrapped${fresh ? ' fresh' : ''}" role="dialog" aria-modal="true" aria-label="Saisonrückblick" tabindex="-1">
    <article class="wcard">
      <header class="wtop"><span class="row" style="gap:6px">${logoImg('mark sm')}Club der Fettsäcke</span><span>Saison ${START.getFullYear()}/${String(end.getFullYear()).slice(2)}</span></header>
      <p class="wname">${esc(d.name)}</p>
      <div class="wb w-loss${gain ? ' gain' : ''}"><span class="wl">${gain ? 'seit Start' : 'vom Startgewicht verloren'}</span><b class="wbig" data-cnt="${d.loss}" data-f="loss">${tn(lossStr(d.loss))}</b></div>
      <div class="wgrid">
        <div class="wb w-rank"><span class="wl">Platz</span><b class="wnum" data-cnt="${d.pos}">${d.pos}</b><span class="ws">von ${d.of} · ${nf(d.total)} Punkte</span></div>
        <div class="wb w-streak"><span class="wl">Längste Streak</span><b class="wnum" data-cnt="${d.streak}">${d.streak}</b><span class="ws">Wochen am Stück, alle Ziele</span></div>
        <div class="wb w-fee"><span class="wl">Strafen in den Topf</span><b class="wnum" data-cnt="${d.strafen}" data-f="eur">${eur(d.strafen)}</b><span class="ws">${fee}</span></div>
        <div class="wb w-wins"><span class="wl">Wochensiege</span><b class="wnum" data-cnt="${d.wins}">${d.wins}</b><span class="ws">von ${d.weeks} Wochen ganz oben</span></div>
        ${d.nem ? `<div class="wb w-nem"><span class="wl">Deine Nemesis</span><b class="wnum">${esc(d.nem.name)}</b><span class="ws">im Schnitt ${tn(fmt1(d.nem.avg))} Punkte Abstand über ${d.nem.n} Wochen, ${final}</span>${duelSvg(d.mine, d.nem.pts)}</div>` : ''}
      </div>
      <footer class="wfoot"><span>Sieger: <b>${esc(d.winner.name)}</b></span><span>Topf: <b>${eur(d.pot)}</b></span></footer>
    </article>
    <div class="wact"><span class="small t2">Screenshot machen und ab in die Gruppe.</span><button class="btn ghost" data-act="closeModal">Schließen</button></div></div>`;
}
function runCountUps(root) {
  if (reducedMotion()) return;
  const els = [...root.querySelectorAll('[data-cnt]')]; if (!els.length) return;
  const F = { loss: v => lossStr(v), eur: v => eur(v), int: v => nf(v) };
  els.forEach(el => { el._to = +el.dataset.cnt; el._f = F[el.dataset.f] || F.int; el.innerHTML = tn(el._f(0)); });
  const t0 = performance.now(), dur = 1300;
  const step = t => { const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3; els.forEach(el => { el.innerHTML = tn(el._f(el._to * e)); }); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------- REGELN ---------- */
function viewRegeln() {
  const end = dayDate(CONFIG.weeks * 7 - 1);
  const wMax = CONFIG.weighMaxTenths * CONFIG.weighPerTenth;
  return `<section class="card rules"><div class="hd"><h2>Regeln</h2>${S.member ? '<button class="link" data-act="obOpen">Einführung nochmal ansehen</button>' : ''}</div><div class="rcols">
  <div class="rs"><p><b>${CONFIG.weeks} Wochen</b> (${fmtD(START)}${START.getFullYear()} bis ${fmtD(end)}${end.getFullYear()}), aufgeteilt in <b>${NUM_ETAPPEN} Etappen</b> à ${CONFIG.etappeWeeks} Wochen. Alles wird in <b>Prozent vom eigenen Startgewicht</b> gerechnet, damit es für jede Größe fair ist.</p></div>
  <div class="rs"><h3>Wiegen (max. ${wMax} P./Woche)</h3><ul>
   <li>Jeden <b>Montag ${weighHours}</b>: morgens, nüchtern, nach dem Klo, gleiche Waage. Foto in die Gruppe. Andere sehen nur deine Prozente, nie die kg.</li>
   <li><b>${CONFIG.weighPerTenth} Punkte pro 0,1 %</b> unter deinem bisherigen Tiefstwert, maximal ${wMax} Punkte (= ${fmt1(CONFIG.weighMaxTenths / 10)} %) pro Woche. Mehr bringt nichts, Crash-Diäten lohnen sich also nicht.</li>
   <li>Zunehmen kostet keine Punkte. Waage-Punkte gibt's aber erst wieder, wenn du unter deinem alten Tiefstwert bist.</li>
   <li>Verpasst = 0 Waage-Punkte + <b>${eur(CONFIG.strafe)}</b> in den Topf.</li></ul></div>
  <div class="rs"><h3>Gewohnheiten (max. ${habitMax()} P./Woche)</h3><ul>
   <li>Jeder wählt <b>3 eigene</b>, die Überwindung kosten. 1 Punkt pro Gewohnheit und Tag, bis zu ${CONFIG.backfillDays} Tage nachtragen (auch in die Vorwoche).</li>
   <li>Jeder Tag ohne alle 3 kostet <b>${eur(CONFIG.habitFee)}</b>, sobald er nicht mehr nachgetragen werden kann. Die Challenge zählt dabei nicht mit.</li>
   <li>Ändern nur vor dem Start und in der 1. Woche jeder Etappe. Zu leichte Gewohnheiten darf die Gruppe ablehnen.</li></ul></div>
  <div class="rs"><h3>Wochen-Challenge (max. ${CONFIG.challengePts} P.)</h3><ul>
   <li>Montag nach dem Wiegen hat der <b>Wochenletzte ${CONFIG.chooseHours} Std. Zeit</b>, die Challenge zu wählen. Danach darf jeder, wer zuerst kommt, entscheidet.</li>
   <li>Täglich (1 Punkt pro Tag, max. ${CONFIG.challengePts}, also ${7 - CONFIG.challengePts} Tage Puffer) oder 1–2× pro Woche (${CONFIG.challengePts} bzw. je ${Math.round(CONFIG.challengePts / 2)} Punkte). Abhaken in der Challenge-Zeile unter den Gewohnheiten.</li></ul></div>
  <div class="rs"><h3>Extra-Aufgaben (+${CONFIG.taskPts} P. pro Aufgabe)</h3><ul>
   <li><b>Jeder stellt 1 Komfortzonen-Aufgabe pro Etappe</b> (z. B. 2× 5 km laufen, 1 h schwimmen). Je mehr Leute, desto mehr Aufgaben. Alle dürfen jede Aufgabe machen.</li>
   <li>Zählt erst, wenn <b>jemand anderes bestätigt</b>. Beweis in die Gruppe.</li></ul></div>
  <div class="rs"><h3>Team-Monat (+${CONFIG.teamPts} P. pro Etappe)</h3><ul>
   <li>Jeder schlägt pro Etappe <b>ein Ziel pro Person</b> vor, z. B. „8.000 Schritte pro Tag“, „3× Sport pro Woche“ oder „20 km laufen pro Monat“. Vorschläge für die nächste Etappe gehen, sobald die aktuelle läuft.</li>
   <li>Am ersten Montag der Etappe um ${CONFIG.deadlineHour} Uhr werden <b>${CONFIG.teamDraw} Vorschläge zufällig gezogen</b> und aufs Team hochgerechnet: Satz pro Person × alle Spieler × Wochen (wer später einsteigt, zählt nur ab seinem Start).</li>
   <li>Jeder trägt täglich bei (Zahl oder Haken, bis zu ${CONFIG.backfillDays} Tage rückwirkend). Sind am Ende der Etappe <b>alle Ziele erreicht</b>, bekommt jeder mit Eintrag +${CONFIG.teamPts} Punkte. <b>Fehlt auch nur eins, bekommt niemand etwas.</b></li></ul></div>
  <div class="rs"><h3>Streak und Joker (keine Punkte)</h3><ul>
   <li>Streak = Tage am Stück mit allen 3 Gewohnheiten. Die Challenge zählt nicht mit.</li>
   <li>Pro Etappe gibt es <b>1 Joker</b>: Er rettet automatisch den ersten verpassten Tag, an dem gerade eine Streak läuft.</li></ul></div>
  <div class="rs"><h3>Meilensteine und eigenes Ziel</h3><ul>
   <li>−2 %, −5 %, −7,5 % und −10 % vom Startgewicht · 4, 10 und 20 Wochen ohne verpasstes Wiegen · Streak 7 und 30 Tage.</li>
   <li>Dein <b>Zielgewicht</b> gibst du beim Beitreten an, ändern im Tab <b>Ich</b>. Das sieht nur du, Punkte gibt es dafür nicht.</li></ul></div>
  <div class="rs"><h3>Topf</h3><ul>
   <li><b>${eur(CONFIG.einsatz)} Einsatz</b> (einmalig) + <b>${eur(CONFIG.strafe)}</b> pro verpasstem Wiegen + <b>${eur(CONFIG.habitFee)}</b> pro Tag ohne alle 3 Gewohnheiten + <b>${eur(CONFIG.loserFee)} für den Letzten jeder Woche</b> (nur wenn nicht alle gleich viele Punkte haben).</li>
   <li>Wer was zahlt, steht unter Ranking → Kasse, aufgeteilt nach Etappe. Am besten am Ende jeder Etappe einsammeln. Der <b>Gesamtsieger</b> nach Woche ${CONFIG.weeks} kassiert alles.</li>
   <li>Neue Leute können jederzeit einsteigen und starten am nächsten Montag. Für Spätstarter ist die Etappenwertung die faire Chance.</li></ul></div>
  <div class="rs"><h3>Erinnerungen</h3><ul>
   <li>Im Profil einschalten: montags 8:00 Uhr, wenn du noch nicht gewogen hast, und täglich 21:00 Uhr, wenn noch Gewohnheiten offen sind. Auf dem iPhone nur aus der installierten App (Teilen → „Zum Home-Bildschirm“, ab iOS 16.4).</li></ul></div></div></section>`;
}

/* ---------- PROFIL / OVERLAYS ---------- */
function pushInfo() {
  if (DB.pushState() === 'on') return 'on';
  if (DEMO) return 'off';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (ios && !standalone) return 'ios';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}
function pauseBlock() {
  const me = C[S.me]; if (!me || me.finished) return '';
  const left = CONFIG.pauseWeeks - me.paused.length, opts = pauseOptions(me);
  const list = me.paused.map(w => `<div class="row"><span class="small grow">${pauseLbl(w)}</span>${canUnpause(w) ? `<button class="link" data-act="unpause" data-w="${w}">Zurücknehmen</button>` : ''}</div>`).join('');
  return `<h3>Pause (krank, Urlaub)</h3>
    <p class="small t2">Noch <b>${left}</b> von ${CONFIG.pauseWeeks} Pausenwochen. Eine Pause gilt für eine ganze Woche (Mo–So) und das Wiegen am Montag danach: keine Punkte, keine Strafen, Streak bleibt stehen. Die laufende Woche geht bis Mittwoch 23:59.</p>
    ${list}${opts.length ? `<div class="row"><select class="inp grow" id="pWeek" aria-label="Woche pausieren">${opts.map(w => `<option value="${w}">${pauseLbl(w)}</option>`).join('')}</select><button class="btn ghost" data-act="pause">Pausieren</button></div>` : ''}`;
}
function profileHtml(fresh) {
  const p = S.players[S.me]; const he = habitsEditable(p.joinedSlot || 0);
  const code = p.invite && !DEMO ? `<h3>Neue Leute einladen</h3><p class="small t2">Schick ihnen den Link und den Code <b>${esc(p.invite)}</b>.</p>` : '';
  const when = 'montags 8:00 Uhr, wenn du noch nicht gewogen hast, und täglich 21:00 Uhr, wenn Gewohnheiten offen sind';
  const push = {
    on: `<p class="small t2">Aktiv auf diesem Gerät: ${when}.</p><button class="link" data-act="pushOff">Ausschalten</button>`,
    off: `<p class="small t2">Push-Nachricht ${when}.</p><button class="btn ghost" data-act="push">Erinnerungen aktivieren</button>`,
    ios: `<p class="small t2">Auf dem iPhone gehen Erinnerungen nur aus der installierten App: in Safari auf Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen (ab iOS 16.4).</p>`,
    unsupported: `<p class="small t2">Dieser Browser kann keine Push-Nachrichten empfangen.</p>`,
    denied: `<p class="small t2">Benachrichtigungen sind für diese Seite blockiert. Erlaube sie in den Browser-Einstellungen und öffne das Profil neu.</p>`,
  }[pushInfo()];
  return `<div class="modal${fresh ? ' fresh' : ''}" data-act="closeModal"><div class="sheet" data-stop role="dialog" aria-modal="true" aria-labelledby="pTitle" tabindex="-1">
    <div class="hd"><h2 id="pTitle">Profil</h2><button class="iconbtn" data-act="closeModal" aria-label="Schließen">${svg('close')}</button></div>
    <label class="f" for="pName">Name</label><input class="inp" id="pName" maxlength="20" value="${esc(p.name)}">
    <label class="f">Gewohnheiten ${he ? '' : '<span class="muted">(gesperrt bis zur 1. Woche der nächsten Etappe)</span>'}</label>
    ${habitInputs('p', normHabits(p.habits), !he)}
    <p class="small muted">Jede bringt bis zu ${CONFIG.habitMaxPts} Punkte pro Woche, anteilig zum Wochenziel. Änderungen gelten ab der laufenden Etappe.</p>
    <button class="btn full" data-act="saveProfile">Speichern</button>
    ${pauseBlock()}
    <h3>Erinnerungen</h3>${push}
    <h3>Dein Fortschritt</h3><p class="small t2">Ziel, Gewichtsverlauf in kg, Heatmap und Meilensteine stehen im Tab <button class="link" data-tab="ich">Ich</button>.</p>
    ${code}
    ${DEMO ? '' : `<h3>Konto</h3><button class="link" data-act="signout">Abmelden</button>`}</div></div>`;
}
/* Einführung: 3 Screens, alle Zahlen aus CONFIG */
function exampleWeek() { // eine realistische Woche: 0,6 % runter, Gewohnheiten fast geschafft, Challenge 3×
  const tenths = Math.min(6, CONFIG.weighMaxTenths), weigh = tenths * CONFIG.weighPerTenth;
  const hs = [['Kochen statt Lieferdienst', 3, 4], ['Keine Softdrinks', 6, 7], ['1× 10 km laufen', 1, 1]];
  const habits = hs.reduce((a, [, d, t]) => a + habitPts(d, t), 0), ch = challengePoints({ kind: 'daily' }, 3), total = weigh + habits + ch;
  const seg = (v, c, l) => `<i style="flex:${v};background:${c}" title="${l} ${v}"></i>`;
  return `<div class="obex"><div class="obbar">${seg(weigh, 'var(--pink)', 'Waage')}${seg(habits, 'var(--lime)', 'Gewohnheiten')}${seg(ch, 'var(--cyan)', 'Challenge')}</div>
    <ul class="rlegend obleg"><li style="--c:var(--pink)"><b>${weigh}</b>Waage: −${fmt1(tenths / 10)} % unter dem Tiefstwert</li>
    <li style="--c:var(--lime)"><b>${habits}</b>Gewohnheiten: ${hs.map(([n, d, t]) => `${d}/${t}`).join(', ')}</li>
    <li style="--c:var(--cyan)"><b>${ch}</b>Challenge: 3 Tage</li>
    <li class="obsum"><b>${total}</b>Punkte, davon ${Math.round(weigh / total * 100)} % von der Waage</li></ul></div>`;
}
function onboardingHtml(fresh) {
  const n = 3, st = clamp(UI.obStep, 0, n - 1), wMax = CONFIG.weighMaxTenths * CONFIG.weighPerTenth, me = C[S.me];
  const screens = [
    ['Punkte', `<p class="t2">Jede Woche zählt neu. So kommen die Punkte zusammen:</p>
      <ul class="small t2 xlist"><li><b>Waage:</b> ${CONFIG.weighPerTenth} Punkte pro 0,1 % unter deinem bisherigen Tiefstwert, max. ${wMax} pro Woche.</li>
      <li><b>Gewohnheiten:</b> 3 eigene mit eigenem Wochenziel (1–7×), je bis zu ${CONFIG.habitMaxPts} Punkte, anteilig.</li>
      <li><b>Wochen-Challenge:</b> bis zu ${CONFIG.challengePts} Punkte, der Wochenletzte sucht sie aus.</li>
      <li><b>Extra-Aufgaben:</b> +${CONFIG.taskPts} pro geschaffter Aufgabe, ein anderer bestätigt. Team-Monat: +${CONFIG.teamPts}, wenn alle Ziele klappen.</li></ul>
      <h3>Eine realistische Woche</h3>${exampleWeek()}`],
    ['Wiegen', `${me && !me.active ? `<p class="t2">Dein Startgewicht: <b>${fmtLong(slotStart(me.js))}</b>, ${weighHours}.</p>` : ''}<p class="t2">Jeden <b>Montag ${weighHours}</b>: morgens, nüchtern, gleiche Waage, Foto in die Gruppe. Die anderen sehen nur Prozente, nie deine kg.</p>
      <p class="t2">Verpasst = 0 Waage-Punkte und <b>${eur(CONFIG.strafe)}</b> in den Topf. Krank oder im Urlaub? Bis zu ${CONFIG.pauseWeeks} Wochen pro Saison pausieren, im Profil.</p>
      <p class="t2">Dein Ziel${me?.goal ? ` (−${tn(pct(me.goal))} %)` : ''} ist ab dem Startgewicht fest: Erreichst du es, hältst du es in der Haltephase (nur noch montags wiegen) oder steigst aus und bekommst deinen Einsatz zurück.</p>`],
    ['Kasse', `<p class="t2"><b>${eur(CONFIG.einsatz)} Einsatz</b> zahlt jeder einmal. Dazu kommen:</p>
      <ul class="small t2 xlist"><li><b>${eur(CONFIG.strafe)}</b> pro verpasstem Wiegen</li><li><b>${eur(CONFIG.habitFee)}</b> pro Woche, in der nicht alle 3 Wochenziele geschafft sind</li><li><b>${eur(CONFIG.loserFee)}</b> für den Wochenletzten</li></ul>
      <p class="t2">Der <b>Gesamtsieger</b> nach Woche ${CONFIG.weeks} bekommt den ganzen Topf. Wer was zahlt, steht unter <b>Ranking → Kasse</b>.</p>`],
  ];
  const [title, body] = screens[st];
  return `<div class="modal mid${fresh ? ' fresh' : ''}" data-act="closeModal"><div class="sheet ob" data-stop role="dialog" aria-modal="true" aria-labelledby="obTitle" tabindex="-1">
    <div class="hd"><span class="obdots" aria-label="Schritt ${st + 1} von ${n}">${Array.from({ length: n }, (_, i) => `<i class="${i === st ? 'on' : ''}"></i>`).join('')}</span><button class="link" data-act="closeModal">Überspringen</button></div>
    <h2 id="obTitle" class="obt">${title}</h2>${body}
    <div class="row obnav">${st > 0 ? `<button class="btn ghost" data-act="obNav" data-d="-1">Zurück</button>` : ''}<span class="grow"></span>
    ${st < n - 1 ? `<button class="btn" data-act="obNav" data-d="1">Weiter</button>` : `<button class="btn" data-act="closeModal">Los geht's</button>`}</div></div></div>`;
}
function exitHtml(fresh) {
  const me = C[S.me]; if (!canExit(me)) return '';
  const f = fees(me, null), fw = Math.max(...Object.keys(me.wb).map(Number));
  return `<div class="modal mid${fresh ? ' fresh' : ''}" data-act="closeModal"><div class="sheet confirm" data-stop role="alertdialog" aria-modal="true" aria-labelledby="xTitle" tabindex="-1">
    <div class="hd"><h2 id="xTitle">Wirklich aussteigen?</h2><button class="iconbtn" data-act="closeModal" aria-label="Abbrechen">${svg('close')}</button></div>
    <p class="t2">Ziel −${tn(pct(me.goal))} % erreicht nach ${wochen(me.goalWeek - me.js)}, aktuell <b>${tn(lossStr(me.latest))}</b>.</p>
    <ul class="small t2 xlist">
      <li>Dein Ergebnis wird nach Woche ${fw} eingefroren und steht in der Gesamtwertung unter „Ziel erreicht“.</li>
      <li>Du bekommst deinen Einsatz zurück (${eur(CONFIG.einsatz)}).${f.strafen ? ` Deine Strafen bis jetzt (${eur(f.strafen)}) bleiben im Topf.` : ''}</li>
      <li>Ab dann keine Punkte, keine Strafen, keine Erinnerungen und kein Wochen- oder Etappenranking mehr. Den Topf kannst du nicht mehr gewinnen.</li>
      <li><b>Das lässt sich nicht rückgängig machen.</b> Wer bleibt, ist in der Haltephase und muss nur montags wiegen.</li></ul>
    <div class="row wrapr"><button class="btn danger" data-act="exitDo" data-w="${fw}">Aussteigen</button><button class="btn ghost" data-act="closeModal">Doch bleiben</button></div></div></div>`;
}
function renderModal() {
  const m = document.getElementById('modal');
  const k = S.member && S.synced ? UI.modal : null;
  if (!k) { if (m.innerHTML) m.innerHTML = ''; m.dataset.k = ''; document.body.classList.remove('locked'); return; }
  const fresh = m.dataset.k !== k;
  if (k === 'wrapped' && !fresh) return; // nicht neu zeichnen, sonst laufen Animationen und Zähler erneut
  const sc = m.querySelector('.sheet')?.scrollTop || 0;
  const html = k === 'wrapped' ? wrappedHtml(fresh) : k === 'exit' ? exitHtml(fresh) : k === 'onboarding' ? onboardingHtml(fresh) : profileHtml(fresh);
  if (!html) { UI.modal = null; renderModal(); return; }
  m.innerHTML = html; m.dataset.k = k; document.body.classList.add('locked');
  if (!fresh) { const sh = m.querySelector('.sheet'); if (sh) sh.scrollTop = sc; return; }
  // Fokus ins Overlay (ohne Tastatur aufzuklappen), damit Daten-Updates es nicht neu zeichnen
  m.querySelector('.sheet, .wrapped')?.focus({ preventScroll: true });
  if (k === 'wrapped') setTimeout(() => runCountUps(m), 250);
}

/* ---------- EVENTS ---------- */
const val = id => (document.getElementById(id)?.value || '').trim();
const intVal = id => parseInt(val(id).replace(/[^\d]/g, ''), 10);
function setTab(tab) { UI.tab = TAB_KEYS.includes(tab) ? tab : 'heute'; window.scrollTo(0, 0); render(); }
function go(tab) { // Tab im Hash merken (Neuladen, Lesezeichen), ohne den Verlauf vollzuschreiben
  if (UI.modal === 'profile') UI.modal = null;
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
  setTab(tab);
}
window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));
function tapStart(el, key) { // Federn sofort starten, render() übernimmt den Stand
  TAP.k = key; TAP.t = performance.now();
  el.classList.remove('tap'); el.style.removeProperty('--tapd'); void el.offsetWidth; el.classList.add('tap');
}
document.addEventListener('click', async ev => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) { go(tab.dataset.tab); return; }
  const el = ev.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'closeModal' && ev.target.closest('[data-stop]') && el.classList.contains('modal')) return;
  const a = el.dataset.act;
  try {
    switch (a) {
      case 'signin': await DB.signIn(); break;
      case 'signout': UI.modal = null; await DB.signOut(); break;
      case 'register': {
        const name = val('rName'), habits = readHabits('r'), maxLossPct = readGoal('rGoal');
        if (!name) return toast('Name fehlt.');
        if (!maxLossPct) return toast(`Bitte dein Ziel in Prozent eintragen (${GOAL_MIN}–${GOAL_MAX} %), z. B. 10.`);
        if (habits.some(h => !h.name)) return toast('Bitte alle 3 Gewohnheiten eintragen.');
        const k = nextJoinSlot(); if (k === null) return;
        document.activeElement?.blur();
        await DB.register({ name, habits, habitSets: { [etappeOf(k + 1)]: habits }, maxLossPct, joinedSlot: k, invite: DEMO ? 'DEMO' : val('rCode') });
        break; // danach öffnet sich die Einführung (nennt auch den Starttermin)
      }
      case 'weigh': {
        const slot = +el.dataset.slot; const kg = parseFloat(val('kg').replace(',', '.'));
        if (!(kg >= 30 && kg <= 300)) return toast('Bitte ein gültiges Gewicht eingeben.');
        const p = S.players[S.me]; const js = p.joinedSlot || 0;
        let loss = 0, extra = null;
        if (slot !== js) { const st = S.myWeights[js]; if (!st) return toast('Startgewicht fehlt.'); loss = Math.round((st - kg) / st * 10000) / 100; }
        else if (typeof p.maxLossPct !== 'number') { // Ziel fehlt noch: zusammen mit dem Startgewicht festschreiben
          const g = readGoal('mlp'); if (!g) return toast(`Erst dein Ziel eintragen (${GOAL_MIN}–${GOAL_MAX} %).`);
          extra = { maxLossPct: g };
        }
        document.activeElement?.blur();
        await DB.saveWeigh(slot, Math.round(kg * 10) / 10, loss, extra);
        toast(slot === js ? 'Startgewicht gespeichert.' : `Gespeichert: ${lossStr(loss)} seit Start`); break;
      }
      case 'habit': {
        tapStart(el, `h${el.dataset.day}_${el.dataset.h}`);
        el.classList.toggle('on'); el.setAttribute('aria-pressed', el.classList.contains('on')); // sofortiges Feedback
        const d = +el.dataset.day, i = +el.dataset.h; const cur = (C[S.me].hl[d] || []).slice(0, 4).map(Boolean);
        while (cur.length < 4) cur.push(false); cur[i] = !cur[i]; await DB.setHabit(d, cur);
        const hr = now().getHours(); if (cur[i] && hr >= 1 && hr < 5) toast('Geh schlafen. Schlaf ist auch eine Gewohnheit.'); // nachts abgehakt
        break;
      }
      case 'hw': {
        const cur = Math.min(curWeek(), CONFIG.weeks); const minW = Math.min(cur, Math.max(1, (S.players[S.me]?.joinedSlot || 0) + 1));
        UI.habitWeek = clamp((UI.habitWeek ?? cur) + +el.dataset.d, minW, cur); if (UI.habitWeek === cur) UI.habitWeek = null; render(); break;
      }
      case 'setWeekly': {
        const t = val('wText'); if (!t) return toast('Text fehlt.');
        const k = document.getElementById('wKind')?.value || 'daily';
        document.activeElement?.blur();
        await DB.setWeekly(+el.dataset.w, t, k === 'daily' ? 'daily' : 'count', k === 'daily' ? 7 : +k); toast('Challenge gespeichert.'); break;
      }
      case 'addIdea': {
        const e = +el.dataset.e, text = val('iText'), kind = val('iKind') === 'count' ? 'count' : 'sum', period = ['day', 'week', 'month'].includes(val('iPeriod')) ? val('iPeriod') : 'week';
        const per = Math.round(parseFloat(val('iPer').replace(/\./g, '').replace(',', '.')) * 100) / 100, unit = kind === 'sum' ? val('iUnit').slice(0, 20) : '';
        if (!text) return toast('Was soll das Team schaffen?');
        if (!(per > 0 && per <= 1e6)) return toast('Wie viel pro Person? Bitte eine Zahl eintragen.');
        const maxCount = { day: 1, week: 7, month: 7 * CONFIG.etappeWeeks }[period];
        if (kind === 'count' && per > maxCount) return toast(`Abhaken geht höchstens 1× pro Tag, also max. ${maxCount} pro ${PERIOD[period]}.`);
        document.activeElement?.blur();
        await DB.addTeamIdea(e, { text, kind, per, period, unit }); toast(`Vorschlag für Etappe ${e} gespeichert.`); break;
      }
      case 'delIdea': await DB.delTeamIdea(el.dataset.id); toast('Vorschlag zurückgezogen.'); break;
      case 'tmTog': {
        const d = +el.dataset.day, id = el.dataset.id, e = etappeOf(weekOfDay(d));
        if (!teamEditable(d, C[S.me]?.js || 0)) return toast('Dieser Tag ist nicht mehr offen.');
        const vals = { ...(S.teamlogs[S.me + '_' + d]?.vals || {}) }; const on = (+vals[id] || 0) > 0;
        tapStart(el, 'tm' + d + id); el.classList.toggle('on', !on);
        vals[id] = on ? 0 : 1; await DB.setTeamLog(d, e, vals); break;
      }
      case 'tmSave': {
        const d = +el.dataset.day, e = etappeOf(weekOfDay(d));
        if (!teamEditable(d, C[S.me]?.js || 0)) return toast('Dieser Tag ist nicht mehr offen.');
        const vals = { ...(S.teamlogs[S.me + '_' + d]?.vals || {}) };
        for (const inp of document.querySelectorAll('#app [data-tm]')) {
          const raw = inp.value.trim(), v = raw ? Math.round(parseFloat(raw.replace(/\./g, '').replace(',', '.')) * 100) / 100 : 0;
          if (!(v >= 0 && v <= 1e6)) return toast('Bitte Zahlen zwischen 0 und 1.000.000 eintragen.');
          vals[inp.dataset.tm] = v;
        }
        document.activeElement?.blur();
        await DB.setTeamLog(d, e, vals); toast(`Eingetragen für ${fmtD(dayDate(d))}.`); break;
      }
      case 'reload': location.reload(); break;
      case 'addTask': { const t = val('tText'); if (!t) return toast('Text fehlt.'); document.activeElement?.blur(); await DB.addTask(+el.dataset.e, t); break; }
      case 'delTask': await DB.deleteTask(el.dataset.id); break;
      case 'mark': await DB.markTask(el.dataset.id, el.dataset.on === '1'); break;
      case 'confirm': await DB.confirmTask(el.dataset.id); toast('Bestätigt.'); break;
      case 'rmode': UI.rankMode = el.dataset.m; render(); break;
      case 'rw': UI.rankWeek = clamp(UI.rankWeek + +el.dataset.d, 1, CONFIG.weeks); render(); break;
      case 're': UI.rankEtappe = clamp(UI.rankEtappe + +el.dataset.d, 1, NUM_ETAPPEN); render(); break;
      case 'ev': UI.etView = clamp(UI.etView + +el.dataset.d, 1, NUM_ETAPPEN); render(); break;
      case 'toWeekRank': UI.rankMode = 'woche'; UI.rankWeek = +el.dataset.w; go('ranking'); break;
      case 'ctab': UI.chartTable = !UI.chartTable; render(); break;
      case 'kgtab': UI.kgTable = !UI.kgTable; render(); break;
      case 'feedMore': UI.feedN = (UI.feedN ?? feedBase()) + 12; render(); break;
      case 'setGoal': {
        const g = readGoal('goal'); if (!g) return toast(`Ziel in Prozent eingeben (${GOAL_MIN}–${GOAL_MAX} %), z. B. 10.`);
        if (!goalEditable(C[S.me], S.players[S.me])) return toast('Dein Ziel ist seit dem Startgewicht fest.');
        document.activeElement?.blur(); await DB.updatePlayer({ maxLossPct: g });
        toast(C[S.me]?.active ? `Ziel gespeichert: −${pct(g)} %.` : `Ziel gespeichert: −${pct(g)} %. Ab dem Startgewicht ist es fest.`); break;
      }
      case 'wrapped': UI.modal = 'wrapped'; renderModal(); break;
      case 'profile': UI.modal = 'profile'; renderModal(); break;
      case 'exitAsk': UI.modal = 'exit'; renderModal(); break;
      case 'pause': {
        const w = parseInt(val('pWeek'), 10), me = C[S.me];
        if (!pauseOptions(me).includes(w)) return toast('Diese Woche kann nicht mehr pausiert werden.');
        await DB.updatePlayer({ pausedWeeks: [...me.paused, w].sort((a, b) => a - b) }); renderModal(); toast(`Woche ${w} pausiert.`); break;
      }
      case 'unpause': {
        const w = +el.dataset.w, me = C[S.me];
        if (!canUnpause(w)) return toast('Die Woche hat schon begonnen.');
        await DB.updatePlayer({ pausedWeeks: me.paused.filter(x => x !== w) }); renderModal(); toast(`Pause für Woche ${w} zurückgenommen.`); break;
      }
      case 'exitDo': {
        if (!canExit(C[S.me])) { UI.modal = null; renderModal(); return toast('Aussteigen geht gerade nicht.'); }
        UI.modal = null; renderModal(); await DB.finish(+el.dataset.w);
        toast('Ausgestiegen. Ziel erreicht, Einsatz kommt zurück. Glückwunsch!'); celebrate(); break;
      }
      case 'closeModal': closeModal(); break;
      case 'obNav': UI.obStep = clamp(UI.obStep + +el.dataset.d, 0, 2); renderModal(); document.querySelector('#modal .sheet')?.scrollTo(0, 0); break;
      case 'obOpen': UI.modal = 'onboarding'; UI.obStep = 0; renderModal(); break;
      case 'push': await DB.enablePush(); renderModal(); break;
      case 'pushOff': await DB.disablePush(); renderModal(); break;
      case 'saveProfile': {
        const name = val('pName'); if (!name) return toast('Name fehlt.');
        const p = S.players[S.me], js = p.joinedSlot || 0, d = { name };
        if (habitsEditable(js)) {
          const hs = readHabits('p'); if (hs.some(h => !h.name)) return toast('3 Gewohnheiten nötig.');
          // pro Etappe speichern, damit alte Wochen ihre alten Ziele behalten
          const e = habitEtappe(js), sets = { ...(p.habitSets || {}) };
          if (!Object.keys(sets).length && etappeOf(js + 1) < e) sets[etappeOf(js + 1)] = normHabits(p.habits);
          sets[e] = hs; d.habits = hs; d.habitSets = sets;
        }
        document.activeElement?.blur(); await DB.updatePlayer(d); UI.modal = null; renderModal(); toast('Gespeichert'); break;
      }
      case 'demoReset': DB.reset(); UI.rankWeek = UI.rankEtappe = UI.etView = UI.habitWeek = null; break;
      case 'demoMon': { const d = dayIdx(); const k = Math.max(0, Math.floor(d / 7) + 1); const t = slotStart(Math.min(k, CONFIG.weeks)); t.setHours(9); setNow(t); break; }
    }
  } catch (e) { console.warn(e); /* Fehler wurde schon angezeigt */ }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'demoTime' && ev.target.value) setNow(new Date(ev.target.value));
  if (ev.target.id === 'tmDay') { UI.tmDay = +ev.target.value; ev.target.blur(); render(); }
});
function setNow(t) { NOW_OVERRIDE = t.getTime(); LS.setItem('cdf-demo-now', String(NOW_OVERRIDE)); UI.rankWeek = UI.rankEtappe = UI.etView = UI.habitWeek = null; DB.refresh(); }
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && UI.modal) { closeModal(); return; }
  if (ev.key === 'Enter' && ev.target.matches('#app input')) { const b = ev.target.closest('.row, .tmentry, .idea')?.querySelector('.btn'); if (b) b.click(); }
});

/* ---------- START ---------- */
(async function init() {
  ensureDefs();
  const h = location.hash.slice(1); if (TAB_KEYS.includes(h)) UI.tab = h;
  const q = QS.get('now');
  if (DEMO) {
    const stored = +LS.getItem('cdf-demo-now');
    if (q) NOW_OVERRIDE = new Date(q).getTime();
    else if (stored) NOW_OVERRIDE = stored;
    else { const t = dayDate(14); t.setHours(9); NOW_OVERRIDE = Math.max(Date.now(), t.getTime()); }
    DB = makeDemoDB(onState);
  } else {
    if (CONFIG.testMode && q) NOW_OVERRIDE = new Date(q).getTime();
    swReady().catch(e => console.warn('Service Worker', e));
    try { DB = await makeFirebaseDB(CONFIG.firebase, onState); }
    catch (e) { console.error(e); document.getElementById('app').innerHTML = `<section class="card"><div class="hd"><h2>Verbindung fehlgeschlagen</h2></div><p class="t2">Firebase konnte nicht geladen werden. Prüf die Config in app.js.</p></section>`; }
  }
  setInterval(() => { if (S.ready && !UI.modal) render(); }, 60000);
})();
