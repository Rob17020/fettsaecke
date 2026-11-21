# Club der Fettsäcke – Projektkontext

Abnehm-Wettbewerb unter Freunden (Robbi, Siggi, Julian; weitere können jederzeit einsteigen). Problem vorher: Wetten schliefen nach ~2 Wochen ein. Ziel: ein faires, kompetitives System, das dranhält. Sprache der App und der Kommunikation: **Deutsch**.

## Tech-Stack
- **Die App besteht aus drei Dateien, kein Build, keine Libraries außer Firebase:** `index.html` (nur die Hülle), `style.css` (komplettes Design), `app.js` (ES-Modul: CONFIG, Logik, Datenschicht, UI). Daneben nur statische Dateien: `manifest.json`, `icons/`, `fonts/`, `firebase-messaging-sw.js`.
- **Cache:** `index.html` bindet `style.css?v=N` und `app.js?v=N` ein. Nach Änderungen an CSS/JS die Nummer hochzählen (GitHub Pages cacht 10 Min.).
- **Lokal testen** geht nur über einen Server (ES-Module laden nicht per `file://`): `python3 -m http.server`, dann `index.html?demo`. `?demo` erzwingt den Demo-Modus trotz Firebase-Config, `?bots=18` simuliert bis zu 20 Spieler, `#ich`/`#ranking` usw. öffnet direkt einen Tab, `?now=…` stellt die Zeit.
- **Firebase** (Spark-Plan, kostenlos): Google-Login (Authentication) + Firestore (Region europe-west3) + Cloud Messaging (Push). SDK per CDN: `https://www.gstatic.com/firebasejs/10.14.1/`.
- **Hosting:** GitHub Pages → `https://rob17020.github.io/fettsaecke/` (Repo `fettsaecke`, Branch `main`, root). In Firebase Auth ist `rob17020.github.io` als autorisierte Domain eingetragen.
- **`firestore.rules`**: Sicherheitsregeln, manuell in der Firebase-Konsole einfügen + veröffentlichen.
- Firebase-Projekt: `club-der-fettsaecke`. Die Config steht in `CONFIG.firebase` (apiKey ist öffentlich, Schutz läuft über die Regeln). **Dieselbe Config steht auch in `firebase-messaging-sw.js`.**
- **Erinnerungen:** GitHub Actions (`.github/workflows/reminders.yml`, Cron in UTC doppelt für Sommer-/Winterzeit) startet `reminders/send.mjs` (Node + firebase-admin). Service-Account nur als GitHub-Secret `FIREBASE_SERVICE_ACCOUNT`, nie committen. Einrichtung: `README.md`.
- Schrift: Schibsted Grotesk, lokal in `fonts/` (OFL), kein Google-Fonts-Request.
- Entwickelt wird auf Pop!_OS (COSMIC) mit VSCodium.

## Wichtige Schalter / Konfiguration
Alles oben in `app.js` unter `CONFIG`:
- `firebase: null` (oder `?demo` in der URL) → **Demo-Modus** (lokale Daten, simulierte Bots Siggi & Julian inkl. Teamwoche und „zuletzt aktiv“, Zeitsteuerung im Banner bzw. per `?now=`; mit `?bots=N` weitere Bots).
- `testMode: true` → Zeit in Prod per URL simulierbar (`?now=2026-11-30T09:00`). **Vor dem Saisonstart auf `false`!**
- `teamPts: 10` (Punkte bei erreichter Teamwoche), `activeEveryMin: 10` (lastActive höchstens alle 10 Min. schreiben), `vapidKey: ''` (Web-Push-Schlüssel aus der Firebase-Konsole; leer = Erinnerungen aus).
- In `firestore.rules`: `TESTMODE()` → `true` schaltet die Zeitfenster-Prüfungen ab. **Vor dem Saisonstart auf `false`!**
- `INVITE()` in den Regeln = Einladungscode für die Registrierung.
- `START_MS` in den Regeln (1795388400000 = Mo 23.11.2026 00:00 MEZ) muss zu `CONFIG.start` passen, ebenso die feste `24` (Anzahl Wochen). `SEASON` in `reminders/send.mjs` ebenfalls.
- Vor dem Start: alle Test-Sammlungen in Firestore löschen (inkl. `teamgoals`, `teamlogs`, `reminderRuns`).

## Spielregeln (aktueller Stand)
- **Saison:** 24 Wochen ab Mo 23.11.2026, 6 Etappen à 4 Wochen. Alles in **Prozent vom eigenen Startgewicht** → fair für jede Größe.
- **Wiegen:** jeden Montag 0–12 Uhr (Startgewicht am ersten Montag). Waage-Punkte: **3 Punkte pro 0,1 %** unter dem bisherigen Tiefstwert, max. 30/Woche (= 1 %, gegen Crash-Diäten). Zunehmen kostet nichts, Punkte gibt's erst wieder unter dem alten Tiefstwert. Verpasst = 0 Punkte + 2 €.
- **Gewohnheiten:** jeder wählt 3 eigene, 1 Punkt pro Tag und Gewohnheit (max. 21/Woche). Bis zu 2 Tage nachtragen (auch in die Vorwoche, Wochen-Navigation ‹ ›). Ändern nur vor dem Start und in der 1. Woche jeder Etappe.
- **Wochen-Challenge (max. 6 P.):** Montag nach dem Wiegen darf der **Wochenletzte 12 Std. lang** wählen, danach jeder (wer zuerst kommt). Arten: täglich (1 P./Tag, max. 6) oder 1×/2× pro Woche (6 bzw. je 3 P.). Abhaken in der „Challenge:“-Zeile (gelb, gestrichelt abgesetzt) im Gewohnheiten-Raster (`habitlogs.done[3]`).
- **Extra-Aufgaben (Komfortzone):** jeder stellt **1 Aufgabe pro Etappe** (skaliert mit der Spielerzahl), alle dürfen jede machen, +15 P., zählt erst nach Bestätigung durch jemand anderen.
- **Teamwoche (+10 P.):** jeder darf ein Teamziel für die **nächste** Woche festlegen (eins pro Woche, nicht überschreibbar). Art `sum` (jeder trägt täglich eine Zahl ein, z. B. Schritte) oder `count` (jeder hakt täglich ab, max. 1 pro Tag). Eintragen 2 Tage rückwirkend, spätestens Montag 12 Uhr nach der Woche. Ist das Ziel dann erreicht, bekommt jeder mit mindestens einem Eintrag `teamPts` für die Woche (zählt in Wochensumme, Ranking-Spalte „Team“, damit auch für den Wochenletzten).
- **Streak (keine Punkte):** Tage am Stück mit allen 3 Gewohnheiten (Challenge zählt nicht). Heute zählt erst, wenn erledigt, bricht aber nicht. **1 Joker pro Etappe** rettet automatisch den ersten verpassten Tag, an dem gerade eine Streak läuft. Wird clientseitig aus `habitlogs` berechnet (`streakOf()`), keine Schreibvorgänge.
- **Meilensteine:** −2/−5/−7,5/−10 % (bester Wert), 4/10/20 Wochen ohne verpasstes Wiegen (längste Serie), Streak 7/30 Tage (Rekord). Klein im Ranking (höchster je Kategorie) und im Tab Ich, einmaliger Toast beim Erreichen (gesehen-Liste in localStorage `cdf-ms-<uid>`).
- **Eigenes Ziel (privat, keine Punkte):** Ziel in % im Tab Ich, Ring wie bei der Apple Watch. Konfetti bei jeder 5 % vom Startgewicht (bester Wert) und beim Erreichen des Ziels (gesehen-Liste `cdf-cel-<uid>`, beim ersten Mal still übernommen).
- **Liveticker (Heute):** wird nur im Client aus `weighins`, `habitlogs` (Tage mit allen 3), `taskDone` (gemeldet/bestätigt), `weekly` und `teamgoals` gebaut, letzte 14 Tage. Sortiert nach `ts` bzw. `confirmedAt`; alte Einträge ohne Zeitstempel bekommen eine geschätzte Zeit ohne Uhrzeit. Neue Einträge gleiten herein (bereits gezeigte IDs in `FEED.seen`).
- **Wochenletzter-Karte (Heute):** von Montag 12 Uhr bis zum nächsten Wiegefenster, pulsiert blutorange.
- **Saisonrückblick (Wrapped):** öffnet sich einmal automatisch, sobald die Saison beendet ist (`seasonOver()`, also nach dem letzten Wiegen Mo 12 Uhr, nicht schon um 0 Uhr), Merker `cdf-wrapped-<uid>`; danach per Knopf auf Heute bzw. im Tab Ich. Zeigt % seit Start, Platz, längste Streak, Strafen (ohne Einsatz), Wochensiege und die Nemesis (kleinster durchschnittlicher Abstand der aufsummierten Punkte über die gemeinsamen Wochen). Keine kg-Werte, weil der Screenshot in die Gruppe geht.
- **Zuletzt aktiv:** „heute aktiv“ / „gestern aktiv“ / „seit X Tagen still“ (ab 2 Tagen rot) im Ranking.
- **Erinnerungen (Push):** Mo 8:00 „Wiegen bis 12 Uhr“ nur an wer noch nicht gewogen hat, täglich 21:00 „Gewohnheiten noch offen“ mit den fehlenden Gewohnheiten. Opt-in im Profil. iPhone nur als installierte App (ab iOS 16.4), Hinweis steht im Profil.
- **Geld:** 10 € Einsatz (einmalig) + 2 € pro verpasstem Wiegen + **1 € für den Wochenletzten** (nur wenn nicht alle gleich viele Punkte haben). Übersicht unter Ranking → Kasse, pro Etappe. Der Gesamtsieger kassiert den Topf.
- **Spätere Einsteiger:** starten am nächsten Montag. Verpasst jemand sein Startgewicht, wird er automatisch auf den nächsten Montag verschoben (erst wenn alle Daten geladen sind, `S.synced`).
- **Privatsphäre:** Andere sehen nur Prozente, die kg-Werte liegen in `players/{uid}/private/weights` (nur für den Besitzer lesbar).

## Datenmodell (Firestore)
- `players/{uid}`: name, habits[3], joinedSlot, joinedAt, invite, lastActive (Server-Zeit, nach eigenen Schreibvorgängen, gedrosselt)
- `players/{uid}/private/weights`: `{ slots: { <slot>: kg }, goal: <Ziel in %> }` (goal optional, nur für den Besitzer)
- `players/{uid}/private/tokens`: `{ tokens: { <fcmToken>: { ts, ua } } }` (Push-Geräte, nur Besitzer + Admin-Skript)
- `weighins/{uid}_{slot}`: uid, slot, lossPct, ts (slot 0 = Start, slot k schließt Woche k ab)
- `habitlogs/{uid}_{day}`: uid, day (Tage seit Start), done[4] (3 Gewohnheiten + Challenge), ts (letzte Änderung, nur für den Liveticker)
- `weekly/{week}`: text, kind ('daily'|'count'), target, setBy, setByName, ts (nur create, nicht überschreibbar)
- `tasks/e{etappe}_{uid}`: etappe, text, createdBy, createdByName
- `taskDone/{taskId}_{uid}`: uid, taskId, ts, confirmedBy, confirmedByName, confirmedAt (nur ein anderer Spieler darf bestätigen; confirmedAt nur als Serverzeit. Mit alten Regeln ohne confirmedAt bestätigt die App einfach ohne Zeitpunkt.)
- `teamgoals/{week}`: week, text, kind ('sum'|'count'), target, unit, setBy, setByName, ts (nur create, nur für die nächste Woche)
- `teamlogs/{uid}_{day}`: uid, day, week, value (nur eigene, Nachtragefenster + bis Montag 12 Uhr)
- `reminderRuns/{kind}_{YYYY-MM-DD}`: nur das Erinnerungs-Skript (Admin), verhindert doppelten Versand

## App-Struktur
Tabs: Heute · Ranking (Woche/Etappe/Gesamt/Kasse) · Challenges (Extra-Aufgaben, Teamwoche, Challenge-Historie) · Verlauf (Abnahme aller, Wochen-Chronik) · Ich (privat: Ziel-Ring, kg-Diagramm/Tabelle, Saison-Heatmap, Meilensteine) · Regeln. Auf Handy/Tablet hat die untere Leiste 5 Tabs, Regeln sitzt als Icon oben rechts neben dem Profil; auf dem Desktop steht alles in der Seitenleiste. Der aktive Tab steht im URL-Hash (`#ich`), per `replaceState`, also ohne Verlaufseinträge. Profil (Name, Gewohnheiten, Erinnerungen, Einladungscode) als Bottom-Sheet bzw. auf dem Desktop als Seitenpanel.
- **Heute** = Dashboard: `a` Wiegen (nur wenn das Fenster offen ist) + Wochenstand (Platz, 3 Wochenringe Gewohnheiten/Challenge/Waage, Mini-Ranking) + Wochenletzter, `b` Gewohnheiten-Raster mit Streak, `c` Wochen-Challenge + Teamwoche, `f` Liveticker. Handy: untereinander a, b, c, f. Tablet: a links, c und f rechts, b volle Breite darunter. Desktop: a|b|c, f unter c (`.col.cf` mit `display:contents` außerhalb des Desktops). Handy quer: b zuerst.
- **Viele Spieler:** nichts geht von einer festen Spielerzahl aus. Mini-Ranking auf Heute zeigt ab 8 Spielern nur Top 3, dich mit Nachbarn und den Letzten (`windowed()`); Punktestände als umbrechende Chips; Diagramme dimmen ab 7 Linien alle außer deiner, Tooltip zeigt höchstens 10; Spielerfarben `colorOf()` (10 feste, danach goldener Winkel).
- **Ranking:** Zeile = Platz, Name (+ aktiv, Streak, Meilensteine), Aufschlüsselung, Punkte. Schmal: Aufschlüsselung als „30 · 16 · 6“ mit Legende darüber; ab 540px Kartenbreite echte Spalten (Container Query). Desktop daneben Diagramm „Punkte, aufsummiert“.
- **Diagramme** (`drawChart`) werden in echter Pixelbreite gezeichnet (ResizeObserver), Schrift bleibt 12px. Optionen: `zero:false` (kg), `x0`, `area`, `refs` (Ziel-Linie), `hl` (eigene Linie). Glow über den SVG-Filter `#fx-glow` (`ensureDefs()`), weil CSS-Filter auf SVG-Elementen in Safari nicht gehen.
- **Rendern:** `render()` baut `#app` bei jedem Daten-Update neu. Animationen deshalb nur gezielt: Seitenwechsel nur bei Tab-Wechsel (`.page.enter`), Haken-Feder über `TAP` (neues Element startet mit negativer Verzögerung), Ticker-Einträge nur wenn neu, Overlays nur beim Öffnen (`.fresh`). Der Saisonrückblick wird nach dem Öffnen nicht neu gezeichnet.
- Daten-Schicht: `makeDemoDB` und `makeFirebaseDB` mit identischer Schnittstelle (inkl. setTeamGoal, setTeamLog, setGoal, enablePush, disablePush, pushState). Punkte-Logik in `compute()` (inkl. Team, Streak, Meilensteine), `weekLosers()`, `fees()`, `pot()`, `teamStatus()`, `streakOf()`. Feed: `feedEvents()`, Rückblick: `wrappedData()`.
- Neue Sammlungen werden „optional“ abonniert: Fehlen die Regeln noch, bleibt die App benutzbar (leere Daten statt Hänger).
- **Lesekosten im Blick behalten:** Jeder App-Start liest alle `habitlogs` (Spieler × Tage). Bei 20 Spielern sind das am Saisonende ~3.400 Dokumente pro Start, das sprengt das Spark-Limit von 50.000 Lesevorgängen/Tag schnell. Ab ~8 Spielern Wochen-Dokumente statt Tages-Dokumente erwägen.

## Design
„Apple Fitness trifft Fight Club“: Smartwatch-Datenoptik mit rauer, brutalistischer Kante. Alle Tokens oben in `style.css`.
- **Farben:** OLED-Schwarz `--bg #000`, Karten `#111111` / `#1c1c1e` / `#2c2c2e`. Neon nur mit fester Bedeutung: **Grün `--lime #b6ff3c`** = Gewohnheiten, erledigt, Hauptaktion, Fokus; **Pink `--pink #ff2d78`** = Waage, Gewicht, eigenes Ziel; **Cyan `--cyan #2de2ff`** = Gruppe (Wochen-Challenge, Teamwoche, Aufgaben). **Blutorange `--blood #ff4a1c`** = Strafen, Warnungen, Wochenletzter, „seit X Tagen still“. Karten tragen ein kleines Quadrat in ihrer Kategoriefarbe (`data-k`). Spielerfarben `--p1…--p10` fest nach Beitritt.
- **Genau ein heller Fokus pro Screen (grün):** Heute = montags die Wiege-Karte (grüner Rahmen + Button), sonst die heutige Spalte im Gewohnheiten-Raster. Ranking = Platz 1. Pro Karte höchstens ein grüner Button, Nebenaktionen als `.btn.ghost` oder `.link`. Einzige Ausnahme mit Bewegung: die pulsierende Wochenletzter-Karte.
- **Typo:** Schibsted Grotesk, harte Gewichtskontraste: riesige Zahlen in 900 mit enger Laufweite (Platz, kg-Eingabe, Ring-Mitte, Wrapped), Labels 13 px/700 in Grau. Tabellenziffern für Zahlen; Komma/Punkt per `tn()` schmal halten (die tnum-Variante der Schrift macht sie sehr breit). CSS-Regeln für `span` in Zahl-Containern nur als `>span` schreiben, sonst treffen sie das Komma-`span` von `tn()`.
- **Bewegung:** Feder-Kurve `--spring` für Klicks (Haken 0,95 → 1,07 → 1 plus grünes Aufleuchten, Buttons, Tabs), `--out` für Einblenden. Seitenwechsel gleitet in Tab-Richtung, Ringe laufen beim Öffnen voll, Heatmap baut sich diagonal auf. `prefers-reduced-motion` schaltet alles ab.
- Keine Emojis in der UI; Icons als Inline-SVG (24er Raster, 1,5 px Strich) in `I`. Radien 4–8 px, keine Pillen, keine Versalien-Labels.
- Abstände: 4/8er Raster, Karten-Innenabstand `--pad` (12/16/20 px je Breite), Rhythmus `.card>*+*` = 12 px. Breakpoints 640 (Tablet) und 1025 (Desktop: Seitenleiste 232 px, Inhalt max. 1200 px linksbündig).
- Kontrast: alle Textfarben ≥ 4,5:1 auf `#000`, `#111111` und `#1c1c1e` (geprüft). Auf `#2c2c2e` (Hover/aktiv) nur weiße Schrift, Grau und Pink wären dort zu schwach.

## Offene Ideen
- Robbi wollte eine Idee aus einem Instagram-Reel einbauen (Inhalt noch unbekannt).
