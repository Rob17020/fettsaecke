# Club der Fettsäcke

Abnehm-Wettbewerb unter Freunden: montags wiegen (in Prozent vom Startgewicht), täglich 3 Gewohnheiten abhaken, Wochen-Challenge, Extra-Aufgaben, Teamwoche, Kasse.

- App: `index.html` (eine Datei, kein Build), läuft auf GitHub Pages: https://rob17020.github.io/fettsaecke/
- Daten: Firebase (Spark-Plan, kostenlos): Google-Login + Firestore
- Ohne Firebase-Config (`CONFIG.firebase = null`) läuft ein Demo-Modus mit simulierten Mitspielern.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | die komplette App |
| `firestore.rules` | Sicherheitsregeln, in der Firebase-Konsole einfügen und veröffentlichen |
| `manifest.json`, `icons/` | installierbare App (Zum Home-Bildschirm) |
| `firebase-messaging-sw.js` | Service Worker für Push-Nachrichten |
| `fonts/` | Schrift Schibsted Grotesk, lokal eingebunden (SIL Open Font License, `fonts/OFL.txt`) |
| `reminders/send.mjs` | verschickt die Erinnerungen (läuft in GitHub Actions) |
| `.github/workflows/reminders.yml` | Zeitplan für die Erinnerungen |

## Einrichten der Erinnerungen (Push)

Funktioniert ohne kostenpflichtigen Blaze-Plan: Firebase Cloud Messaging ist kostenlos, der Zeitplan läuft über GitHub Actions.

1. **Web-Push-Schlüssel erzeugen**
   Firebase-Konsole → Projekteinstellungen → Cloud Messaging → *Web-Push-Zertifikate* → *Schlüsselpaar generieren*.
   Den öffentlichen Schlüssel in `index.html` bei `CONFIG.vapidKey` eintragen. Solange das Feld leer ist, sagt die App beim Aktivieren, dass Erinnerungen noch nicht eingerichtet sind.

2. **Regeln veröffentlichen**
   Inhalt von `firestore.rules` in der Firebase-Konsole → Firestore → Regeln einfügen und veröffentlichen (neu: `teamgoals`, `teamlogs`).

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
| Montag 8:00 | „Wiegen bis 12 Uhr“ (bzw. „Startgewicht bis 12 Uhr“) | nur wer für diese Woche noch nicht gewogen hat |
| täglich 21:00 | „Gewohnheiten noch offen“ mit den fehlenden Gewohnheiten | nur wer heute noch nicht alle 3 abgehakt hat |

GitHub-Cron läuft in UTC, deshalb steht jede Zeit zweimal im Workflow (Sommer- und Winterzeit). Das Skript prüft die Uhrzeit in Berlin und merkt sich in `reminderRuns/{art}_{datum}`, dass schon verschickt wurde. Geräte, die sich abgemeldet haben, werden automatisch aus `players/{uid}/private/tokens` entfernt.

### Bekannte Grenzen

- **GitHub-Cron kann sich verspäten**, meist um Minuten, bei hoher Last auch mal länger. Das Skript akzeptiert deshalb Montag 8–12 Uhr bzw. 21–23 Uhr.
- **Öffentliche Repos:** GitHub schaltet geplante Workflows ab, wenn 60 Tage lang nichts im Repo passiert. Dann unter Actions → *Erinnerungen* → *Enable workflow* wieder einschalten (oder zwischendurch etwas committen).
- Die Logs der Actions sind bei öffentlichen Repos öffentlich. Das Skript loggt deshalb nur Zahlen, keine Namen oder Tokens.

## Vor dem Saisonstart

- `CONFIG.testMode` in `index.html` auf `false`
- `TESTMODE()` in `firestore.rules` auf `false`, Regeln veröffentlichen
- Test-Sammlungen in Firestore löschen (inkl. `teamgoals`, `teamlogs`, `reminderRuns`)
- `START_MS` (Regeln), `CONFIG.start` (index.html) und `SEASON.start` (`reminders/send.mjs`) müssen zusammenpassen
