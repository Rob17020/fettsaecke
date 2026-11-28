# Einrichtung im Detail

Alles läuft ohne kostenpflichtigen Firebase-Plan: Spark (kostenlos) für Anmeldung, Datenbank und Push, GitHub Pages für die App, GitHub Actions für Zeitplan und Backup. Kurzfassung: [README](../README.md#eigene-instanz-einrichten).

## 1. Firebase-Projekt

1. [Firebase-Konsole](https://console.firebase.google.com/) → *Projekt hinzufügen*. Google Analytics wird nicht gebraucht.
2. Projekteinstellungen → *Allgemein* → *Meine Apps* → Web-App (`</>`) registrieren. Firebase Hosting wird nicht gebraucht.
3. Das angezeigte `firebaseConfig`-Objekt in [`app.js`](../app.js) bei `CONFIG.firebase` **und** in [`firebase-messaging-sw.js`](../firebase-messaging-sw.js) eintragen. Der `apiKey` ist öffentlich, geschützt wird über die Regeln.

## 2. Anmeldung mit Google

1. Authentication → *Jetzt starten* → *Anbieter hinzufügen* → **Google** aktivieren, Support-E-Mail wählen.
2. Authentication → Einstellungen → *Autorisierte Domains* → die Domain von GitHub Pages hinzufügen, z. B. `name.github.io`. Ohne diesen Eintrag schlägt die Anmeldung auf der Live-Seite fehl. `localhost` steht schon drin.

## 3. Firestore und Regeln

1. Firestore-Datenbank → *Datenbank erstellen* → Produktionsmodus, Standort z. B. `europe-west3` (Frankfurt). Der Standort lässt sich später nicht ändern.
2. Den Inhalt von [`firestore.rules`](../firestore.rules) unter Firestore → *Regeln* einfügen und **vor dem Veröffentlichen** anpassen:
   - `INVITE()`: den Platzhalter `CODE-NUR-IN-DER-KONSOLE` durch euren Einladungscode ersetzen. Der echte Code steht **nur** in der Konsole, nie im Repo (das Repo ist öffentlich). Codes, die jemals im Repo standen, nicht wieder verwenden.
   - `ADMINS()`: die Firebase-uids der Admins eintragen, z. B. `['abc123']`, gleich wie `CONFIG.adminUids` in `app.js`. Admins dürfen im Profil einen Nachtrag erlauben, wenn jemand das Wiegefenster verpasst hat. Die eigene uid steht in der Konsole unter Authentication → *Users* (Spalte *User UID*) und in der App unter Profil → Konto.
   - `TESTMODE()` muss `false` sein.
   - `START_MS()` muss zu `CONFIG.start` passen (Montag 00:00 Uhr deutscher Zeit in Millisekunden).
3. *Veröffentlichen*. Bei jeder späteren Änderung an `firestore.rules` wieder die ganze Datei einfügen und Einladungscode und Admin-uids erneut eintragen.

## 4. App ausliefern (GitHub Pages)

1. Repo auf GitHub → Settings → *Pages* → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
2. Nach ein, zwei Minuten läuft die App unter `https://name.github.io/repo/`.
3. Nach Änderungen an `app.js` oder `style.css` die Nummer `?v=` in `index.html` hochzählen. GitHub Pages cacht bis zu 10 Minuten.

## 5. Erinnerungen (Push)

Firebase Cloud Messaging ist kostenlos, der Zeitplan läuft über GitHub Actions ([`.github/workflows/reminders.yml`](../.github/workflows/reminders.yml), Skript [`reminders/send.mjs`](../reminders/send.mjs)).

1. **Web-Push-Schlüssel:** Projekteinstellungen → *Cloud Messaging* → *Web-Push-Zertifikate* → *Schlüsselpaar generieren*. Den öffentlichen Schlüssel in `CONFIG.vapidKey` eintragen. Solange das Feld leer ist, sagt die App beim Aktivieren, dass Erinnerungen noch nicht eingerichtet sind.
2. **Service-Account:** Projekteinstellungen → *Dienstkonten* → *Neuen privaten Schlüssel generieren* (lädt eine JSON-Datei). GitHub → Repo → Settings → *Secrets and variables* → *Actions* → *New repository secret*: Name `FIREBASE_SERVICE_ACCOUNT`, Wert = kompletter Inhalt der Datei. **Die Datei nie ins Repo legen** (`.gitignore` fängt die üblichen Namen ab) und danach löschen.
3. **Testen:** Actions → *Erinnerungen* → *Run workflow*: Art `test`, *Nur zählen* an zeigt, wie viele Geräte registriert sind. Mit *Nur zählen* aus bekommt jedes registrierte Gerät eine Testnachricht.
4. **Auf dem Handy:** in der App Profil → *Erinnerungen aktivieren* → Benachrichtigungen erlauben. **iPhone:** nur ab iOS 16.4 und nur aus der installierten App (Safari → *Teilen* → *Zum Home-Bildschirm*, dann von dort öffnen).

| Wann (Berlin) | Nachricht | An wen |
| --- | --- | --- |
| Montag 8:00 | Wiegen bis 14 Uhr (nennt, wer schon gewogen hat) | wer für diese Woche noch nicht gewogen hat; wer sein Startgewicht verpasst hat, bekommt eine neue Start-Erinnerung |
| täglich 21:00 | offene Habits mit Stand der Woche, z. B. „Kochen 2/4“, zum Sonntag hin dringlicher | wer ein Wochenziel noch nicht erreicht und das Habit heute nicht abgehakt hat |
| alle 30 Min., 8–22 Uhr | neue Extra-Aufgabe, neuer Team-Vorschlag oder Wochen-Challenge (mehrere in einer Nachricht), mit Hinweis, wenn die eigene Aufgabe bzw. der eigene Vorschlag fehlt | alle außer dem, der es eingetragen hat (Stand in `reminderRuns/news_state`, beim ersten Lauf wird nur gemerkt) |
| 18:00 an Etappentag 2, 6, 13, 20 bzw. 6, 2, 1 Tag vor der Ziehung | „Deine Extra-Aufgabe fehlt“ / „Team-Vorschlag fehlt“ | wer für die laufende Etappe noch keine Aufgabe bzw. für die nächste Ziehung keinen Vorschlag hat (einmal pro Tag, `reminderRuns/nudge_{datum}`) |

Keine Erinnerungen in Pausenwochen und nach dem Ausstieg, in der Haltephase weiter beide. GitHub-Cron läuft in UTC, deshalb steht jede Zeit zweimal im Workflow (Sommer- und Winterzeit); das Skript prüft die Uhrzeit in Berlin und merkt sich in `reminderRuns/{art}_{datum}`, dass schon verschickt wurde. Abgemeldete Geräte werden automatisch aus `players/{uid}/private/tokens` entfernt.

Grenzen: GitHub-Cron kann sich verspäten (das Skript akzeptiert Montag 8–14 Uhr bzw. 21–23 Uhr). Die Logs öffentlicher Repos sind öffentlich, das Skript loggt deshalb nur Zahlen.

## Backup und Wiederherstellen

Jede Nacht von Sonntag auf Montag (23:30 bzw. 0:30 Uhr Berlin) sichert der Workflow alle Firestore-Sammlungen samt Unter-Sammlungen (auch `players/{uid}/private` mit den kg-Werten und die Beweisfotos in `proofs`) in **eine** Datei und legt sie als Artefakt ab. Artefakte werden nach 90 Tagen gelöscht.

Artefakte öffentlicher Repos kann jeder angemeldete GitHub-Nutzer herunterladen, deshalb wird die Datei vorher verschlüsselt (gzip + AES-256-GCM, Schlüssel aus einer Passphrase). Ohne Passphrase bricht der Job ab, statt unverschlüsselt hochzuladen. Backups **nie committen** (`.gitignore`: `backup/`, `*.fsbak`).

### Einrichten (einmal)

1. Lange, zufällige Passphrase erzeugen, z. B. `openssl rand -base64 32`, und sicher aufheben (Passwort-Manager). Ohne sie ist kein Backup lesbar.
2. GitHub-Secret `BACKUP_PASSPHRASE` mit der Passphrase anlegen. Der Service-Account ist derselbe wie für die Erinnerungen.
3. Testen: Actions → *Erinnerungen* → *Run workflow* → Art `backup`. Danach steht im Lauf unter *Artifacts* `firestore-backup-JJJJ-MM-TT`.

Ein Backup liest jedes Dokument einmal (bei 20 Spielern am Saisonende grob 5.000 bis 10.000 Lesevorgänge), das passt ins kostenlose Tageslimit.

### Wiederherstellen

[`reminders/restore.mjs`](../reminders/restore.mjs) schreibt nur in eine **leere** Datenbank (sonst Abbruch; `--force` überschreibt gleiche Pfade trotzdem).

```sh
cd reminders
npm install
# Artefakt herunterladen und entpacken, dann:
export BACKUP_PASSPHRASE='…'
node restore.mjs firestore-2027-01-17.fsbak --dry-run                               # nur lesen und zählen
node restore.mjs firestore-2027-01-17.fsbak --key=service-account.json --dry-run   # zusätzlich Ziel prüfen (leer?)
node restore.mjs firestore-2027-01-17.fsbak --key=service-account.json             # zurückspielen
```

Ziel ist das Projekt des Service-Accounts (`--key=…` oder `FIREBASE_SERVICE_ACCOUNT`). Für eine neue Datenbank: neues Firebase-Projekt wie oben einrichten, Regeln veröffentlichen, Service-Account-Schlüssel erzeugen, zurückspielen, `CONFIG.firebase` in `app.js` und `firebase-messaging-sw.js` anpassen. Den Schlüssel danach löschen.

Von Hand lokal: `node backup.mjs --key=service-account.json --out=backup` (mit `BACKUP_PASSPHRASE`). Mit dem Firestore-Emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) laufen beide Skripte ohne Schlüssel.

## Vor dem Saisonstart

- `CONFIG.testMode` in `app.js` und `TESTMODE()` in `firestore.rules` auf `false`.
- Regeln veröffentlichen, dabei Einladungscode und Admin-uids in der Konsole eintragen.
- Test-Sammlungen in Firestore löschen (inkl. `teamideas`, `teamlogs`, `reminderRuns`, `proofs`).
- `START_MS` (Regeln), `CONFIG.start` (`app.js`) und `SEASON.start` (`reminders/send.mjs`) müssen zusammenpassen, ebenso die festen Zahlen in den Regeln (Wochen, Wochen pro Etappe, Pausenwochen, Ziel-Band) und `SEASON` im Erinnerungs-Skript (Strafen, `holdBand`).
- Secret `BACKUP_PASSPHRASE` anlegen und das Backup einmal per Hand starten.

## Während der Saison

- Geplante Workflows schlafen in öffentlichen Repos nach 60 Tagen ohne Commit ein: Actions → *Erinnerungen* → *Enable workflow*, oder vorher etwas committen.
- Lesekosten im Blick behalten: Jeder App-Start liest alle `habitlogs` (Spieler × Tage), bei 20 Spielern am Saisonende etwa 3.400 Dokumente; das Spark-Limit sind 50.000 Lesevorgänge am Tag. Beweisfotos werden nur beim Ansehen geladen.
- Speicher: Spark hat 1 GiB. Ein Beweisfoto hat höchstens 400 KB, meist unter 200 KB.
