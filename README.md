# Club der Fettsäcke

Abnehm-Wettbewerb unter Freunden: montags wiegen (in Prozent vom Startgewicht), 3 Habits mit eigenem Wochenziel abhaken, Wochen-Challenge, Extra-Aufgaben, Team-Monat, persönliches Ziel mit Haltephase oder Ausstieg, Pause bei Krankheit/Urlaub, Kasse.

- App: `index.html` + `style.css` + `app.js` (kein Build), läuft auf GitHub Pages: https://rob17020.github.io/fettsaecke/
- Daten: Firebase (Spark-Plan, kostenlos): Google-Login + Firestore
- Ohne Firebase-Config (`CONFIG.firebase = null`) oder mit `?demo` in der URL läuft ein Demo-Modus mit simulierten Mitspielern.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Hülle: lädt `style.css` und `app.js` (Versionsnummer `?v=` nach Änderungen hochzählen) |
| `style.css` | komplettes Design |
| `app.js` | die App: `CONFIG`, Punkte-Logik, Firebase/Demo, Oberfläche |
| `firestore.rules` | Sicherheitsregeln, in der Firebase-Konsole einfügen und veröffentlichen |
| `manifest.json`, `icons/` | installierbare App (Zum Home-Bildschirm) |
| `firebase-messaging-sw.js` | Service Worker für Push-Nachrichten |
| `fonts/` | Schrift Schibsted Grotesk, lokal eingebunden (SIL Open Font License, `fonts/OFL.txt`) |
| `reminders/send.mjs` | verschickt die Erinnerungen (läuft in GitHub Actions) |
| `reminders/backup.mjs`, `restore.mjs`, `backup-format.mjs` | wöchentliches verschlüsseltes Backup und Wiederherstellen |
| `.github/workflows/reminders.yml` | Zeitplan für Erinnerungen und Backup |

## Einrichten der Erinnerungen (Push)

Funktioniert ohne kostenpflichtigen Blaze-Plan: Firebase Cloud Messaging ist kostenlos, der Zeitplan läuft über GitHub Actions.

1. **Web-Push-Schlüssel erzeugen**
   Firebase-Konsole → Projekteinstellungen → Cloud Messaging → *Web-Push-Zertifikate* → *Schlüsselpaar generieren*.
   Den öffentlichen Schlüssel in `app.js` bei `CONFIG.vapidKey` eintragen. Solange das Feld leer ist, sagt die App beim Aktivieren, dass Erinnerungen noch nicht eingerichtet sind.

2. **Regeln veröffentlichen**
   Inhalt von `firestore.rules` in der Firebase-Konsole → Firestore → Regeln einfügen und veröffentlichen. Neu in dieser Version: Habits mit Wochenziel (`habits: [{name, target}]`, `habitSets`), festes Ziel `maxLossPct`, Pause (`pausedWeeks`), Ausstieg (`status`, `finishedWeek`, `finishedAt`), Einführung (`onboardingDone`). Ohne die neuen Regeln schlagen Beitreten, Pause und Ausstieg fehl.

3. **Service-Account als GitHub-Secret**
   Firebase-Konsole → Projekteinstellungen → Dienstkonten → *Neuen privaten Schlüssel generieren* (lädt eine JSON-Datei herunter).
   GitHub → Repo `fettsaecke` → Settings → Secrets and variables → Actions → *New repository secret*:
   Name `FIREBASE_SERVICE_ACCOUNT`, Wert = der komplette Inhalt der JSON-Datei.
   **Die Datei niemals ins Repo legen** (`.gitignore` fängt die üblichen Dateinamen ab). Danach die heruntergeladene Datei löschen.

4. **Testen**
   GitHub → Actions → *Erinnerungen* → *Run workflow*: Art `test`, *Nur zählen* an → zeigt, wie viele Geräte registriert sind.
   Dann noch einmal mit *Nur zählen* aus → jedes registrierte Gerät bekommt eine Testnachricht.

5. **Auf dem Handy aktivieren**
   In der App: Profil (Kreis oben rechts) → *Erinnerungen aktivieren* → Benachrichtigungen erlauben.
   **iPhone:** Web-Push geht nur ab iOS 16.4 und nur aus der installierten App: In Safari *Teilen* → *Zum Home-Bildschirm*, dann die App vom Home-Bildschirm öffnen und dort aktivieren.

### Was wann kommt

| Wann (Berlin) | Nachricht | An wen |
|---|---|---|
| Montag 8:00 | Wiegen bis 14 Uhr, mehrere Textvarianten (nennt, wer schon gewogen hat) | nur wer für diese Woche noch nicht gewogen hat; wer sein Startgewicht verpasst hat, bekommt eine neue Start-Erinnerung |
| täglich 21:00 | offene Habits mit Stand der Woche, z. B. „Kochen 2/4“, Text wechselt täglich und wird zum Sonntag dringlicher (sonntags: nachtragen nur bis Montag 14 Uhr) | nur wer ein Wochenziel noch nicht erreicht und diese Habit heute noch nicht abgehakt hat |

Keine Erinnerungen in pausierten Wochen und nach dem Ausstieg. In der Haltephase gibt es weiter beide Erinnerungen.

GitHub-Cron läuft in UTC, deshalb steht jede Zeit zweimal im Workflow (Sommer- und Winterzeit). Das Skript prüft die Uhrzeit in Berlin und merkt sich in `reminderRuns/{art}_{datum}`, dass schon verschickt wurde. Geräte, die sich abgemeldet haben, werden automatisch aus `players/{uid}/private/tokens` entfernt.

### Bekannte Grenzen

- **GitHub-Cron kann sich verspäten**, meist um Minuten, bei hoher Last auch mal länger. Das Skript akzeptiert deshalb Montag 8–14 Uhr bzw. 21–23 Uhr.
- **Öffentliche Repos:** GitHub schaltet geplante Workflows ab, wenn 60 Tage lang nichts im Repo passiert. Dann unter Actions → *Erinnerungen* → *Enable workflow* wieder einschalten (oder zwischendurch etwas committen).
- Die Logs der Actions sind bei öffentlichen Repos öffentlich. Das Skript loggt deshalb nur Zahlen, keine Namen oder Tokens.

## Backup (wöchentlich) und Wiederherstellen

Jede Nacht von Sonntag auf Montag (23:30 bzw. 0:30 Uhr Berlin) sichert der Workflow *Erinnerungen* alle Firestore-Sammlungen samt Unter-Sammlungen (auch `players/{uid}/private` mit den kg-Werten und Push-Geräten) in **eine** Datei und legt sie als Artefakt ab. Artefakte werden nach 90 Tagen automatisch gelöscht.

**Wichtig:** Das Repo ist öffentlich, und Artefakte öffentlicher Repos kann jeder angemeldete GitHub-Nutzer herunterladen. Deshalb wird die Datei vorher verschlüsselt (AES-256-GCM, Schlüssel aus einer Passphrase). Ohne Passphrase bricht der Job ab, statt unverschlüsselt hochzuladen. Backups **nie committen** (`.gitignore` fängt `backup/` und `*.fsbak` ab).

### Einrichten (einmal)

1. Lange, zufällige Passphrase erzeugen, z. B. `openssl rand -base64 32`, und sicher aufheben (Passwort-Manager). Ohne sie ist kein Backup lesbar.
2. GitHub → Repo → Settings → Secrets and variables → Actions → *New repository secret*: Name `BACKUP_PASSPHRASE`, Wert = die Passphrase.
3. Testen: Actions → *Erinnerungen* → *Run workflow* → Art `backup`. Danach steht im Lauf unten unter *Artifacts* `firestore-backup-JJJJ-MM-TT`.

Der Service-Account (`FIREBASE_SERVICE_ACCOUNT`) ist derselbe wie für die Erinnerungen. Ein Backup liest jedes Dokument einmal (Ende der Saison bei 20 Spielern grob 5.000 bis 10.000 Lesevorgänge), das passt ins kostenlose Tageslimit.

### Wiederherstellen

Das Skript schreibt nur in eine **leere** Datenbank (sonst Abbruch, `--force` überschreibt gleiche Pfade trotzdem).

```
cd reminders
npm install
# Artefakt herunterladen und entpacken, dann:
export BACKUP_PASSPHRASE='…'
node restore.mjs firestore-2027-01-17.fsbak --dry-run                     # nur lesen und zählen
node restore.mjs firestore-2027-01-17.fsbak --key=service-account.json --dry-run   # zusätzlich Ziel prüfen (leer?)
node restore.mjs firestore-2027-01-17.fsbak --key=service-account.json    # zurückspielen
```

Ziel ist das Projekt des Service-Accounts (`--key=…` oder `FIREBASE_SERVICE_ACCOUNT`). Für eine neue Datenbank: neues Firebase-Projekt anlegen, Firestore aktivieren, Regeln veröffentlichen, Service-Account-Schlüssel erzeugen, zurückspielen, `CONFIG.firebase` in `app.js` und `firebase-messaging-sw.js` anpassen. Den Schlüssel danach löschen.

Ein Backup von Hand geht auch lokal: `node backup.mjs --key=service-account.json --out=backup` (mit `BACKUP_PASSPHRASE`). Mit dem Firestore-Emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) laufen beide Skripte ohne Schlüssel, gut zum Ausprobieren.

## Lokal ausprobieren

ES-Module laden nicht per `file://`, deshalb über einen kleinen Server:

```
python3 -m http.server 8000
```

Dann `http://localhost:8000/index.html?demo` öffnen. Nützliche Zusätze:

- `?demo&bots=18`: 20 Spieler, um zu sehen, wie Ranking und Diagramme mit vielen Leuten aussehen
- `&now=2027-01-18T09:00`: Zeit setzen (z. B. Montag im Wiegefenster), `&now=2027-05-10T14:00` zeigt den Saisonrückblick
- `#ich`, `#ranking`, `#verlauf`: direkt einen Tab öffnen

Automatische Tests (Punkte-Logik, Firestore-Regeln im Emulator, Erinnerungen, Screenshots) liegen in `tests/`, siehe `tests/README.md`.

Das Layout passt sich ohne feste Breakpoints an: Jeder Tab ist ein Raster mit 1–4 Spalten je nach Fensterbreite, auf dem Desktop scrollt jede Spalte für sich. Zum Prüfen das Fenster von schmal (320 px) bis sehr breit ziehen, auch mit wenig Höhe.

## Vor dem Saisonstart

- `CONFIG.testMode` in `app.js` und `TESTMODE()` in `firestore.rules` stehen auf `false` (für Tests auf `true`, nie so committen)
- Regeln veröffentlichen und dabei in der Konsole den Platzhalter in `INVITE()` durch den echten Einladungscode ersetzen (nie ins Repo)
- Test-Sammlungen in Firestore löschen (inkl. `teamideas`, `teamlogs`, `reminderRuns`, alte `teamgoals`). Wer schon als Tester angemeldet war, meldet sich danach neu an (dann mit Ziel in % und Wochenzielen).
- `START_MS` (Regeln), `CONFIG.start` (`app.js`) und `SEASON.start` (`reminders/send.mjs`) müssen zusammenpassen, ebenso die festen Zahlen in den Regeln (24 Wochen, 4 Wochen pro Etappe, 2 Pausenwochen, Ziel-Band 1 Prozentpunkt) und `SEASON` im Erinnerungs-Skript (Strafen, `holdBand`)
- GitHub-Secret `BACKUP_PASSPHRASE` anlegen und das Backup einmal per Hand starten (siehe oben)


> **Update Nov 2026:** Die Regeln haben eine neue Sammlung `habitok` (Habits bestätigen) und Felder `extraHabits`/`extra`. Nach dem Einspielen `firestore.rules` neu in der Konsole veröffentlichen (Einladungscode dort wieder eintragen).
>
> **Update 22.11.2026 (Prüfung):** `firestore.rules` geschärft (Einstieg nur zum nächsten Montag, Vorwoche nur bis Montag 14 Uhr abhaken/bestätigen, Bestätigen 2 Tage, Ausstieg nur mit aktuellem Wiegen, Challenges/Aufgaben nur in ihrer Woche/Etappe, `byName` geprüft). Wieder komplett in die Konsole kopieren, dort `INVITE()` durch den echten Code und `TESTMODE()` nach Bedarf setzen, dann veröffentlichen.
