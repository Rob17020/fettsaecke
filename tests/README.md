# Tests

Nur zum Entwickeln, nicht Teil der App (GitHub Pages liefert den Ordner zwar mit aus, die App lädt ihn nie).

| Datei | Prüft | Braucht |
|---|---|---|
| `logic.test.mjs` | Punkte und Geld aus `app.js`: Waage, Habits mit Bestätigung, Haltephase, Pause, Spätstarter, Wochenletzter, Ausstieg, Streak/Joker, Team-Monat, Abschluss der Woche am Montag 14 Uhr | nur Node |
| `rules.test.mjs` | `firestore.rules`: jeder Schreibweg der App, erlaubt und verboten, jeweils mit `TESTMODE()` false und true | Emulator (firebase-tools, Java) |
| `reminders.test.mjs` | `reminders/send.mjs` mit gestellter Uhr: wer bekommt wann welche Erinnerung, Doppelschutz, Sommerzeit, Saisonende | Emulator, `reminders/node_modules` |
| `forms.mjs` | Eingaben überleben das Neuzeichnen: Felder füllen, 3 Daten-Updates + Minuten-Takt, Werte/Fokus/Cursor prüfen, Daten drumherum laufen weiter, Entwurf nach dem Speichern weg | Playwright, lokaler Server |
| `ui.mjs` (+ `fbmock.mjs`) | Screenshots aller Tabs, Zustände und Breiten, dazu automatische Prüfungen (Überlauf, Konsolenfehler, leere Spalten) | Playwright, lokaler Server |

## Einrichten (einmal)

```
cd tests && npm install
cd ../reminders && npm install
npx playwright install chromium     # nur für ui.mjs
```

firebase-tools (`npm i -g firebase-tools`) und Java müssen installiert sein.

## Laufen lassen

```
cd tests
npm test              # Logik + Regeln + Erinnerungen (startet und stoppt den Emulator selbst)
npm run logic         # nur Logik, ohne Emulator
npm run rules         # nur Regeln; ONLY=Ausstieg npm run rules für einzelne Fälle
npm run reminders     # nur Erinnerungen
```

Formulare: im Repo-Ordner `python3 -m http.server 8765` starten, dann `cd tests && npm run forms`.

Screenshots: im Repo-Ordner `python3 -m http.server 8765` starten, dann `cd tests && npm run ui -- heute-mid` (Filter = Teil des Dateinamens, ohne Filter rund 170 Bilder). Bilder und `report.json` landen in `tests/shots/`.

## Wie es funktioniert

- **Zeit:** Der Emulator nimmt immer die echte Uhrzeit. `rules.test.mjs` verschiebt deshalb `START_MS` in einer Kopie der Regeln so, dass „jetzt“ an der gewünschten Stelle der Saison liegt (z. B. Montag 9 Uhr). `TESTMODE()` wird nur in dieser Kopie umgeschaltet, `firestore.rules` bleibt unverändert.
- **Einladungscode:** Die Tests lesen den Platzhalter aus `firestore.rules`. Der echte Code steht nur in der Firebase-Konsole.
- **Logik:** `logic.test.mjs` schneidet den Logik-Teil aus `app.js` aus (bis „DATENSCHICHT“) und lädt ihn als Modul. Neue Funktionen, die getestet werden sollen, in der `export`-Zeile oben ergänzen.
- **Erinnerungen:** `send.mjs` läuft mit `FIRESTORE_EMULATOR_HOST` ohne Service-Account und listet nur dann die Empfänger. In GitHub Actions loggt es weiter nur Zahlen.
- **Neue Regeln oder Zeitfenster:** Fall in die Liste `T` in `rules.test.mjs` eintragen (Szenario, Beschreibung, erwartet bei TESTMODE false, erwartet bei true, Aktion).
