# Probezeit

Eine Lernumgebung im Browser. Du bist neu in einer kleinen Softwarefirma und läufst durch ein gezeichnetes Büro. Jedes Möbelstück öffnet einen kurzen Lernpfad mit Dialogen, Entscheidungen und Aufgaben.

Das Repository heißt noch `pixelbuero`. Das Projekt selbst heißt Probezeit.

## Idee

Fachwissen bleibt besser hängen, wenn es zu einer Geschichte gehört. Die Lernenden erleben ihren dritten Tag in der Probezeit. Eine Kundin hat einen Auftrag, das Team arbeitet daran, und die Lernenden helfen mit. Der erste Lernpfad behandelt Lastenheft und Pflichtenheft, weitere folgen.

Jeder Lernpfad dauert etwa 10 bis 15 Minuten. Es gibt keinen Zeitdruck, und eine falsche Entscheidung beendet nichts. Sie führt zu einer Rückmeldung.

## Aufbau

| Teil | Aufgabe |
| --- | --- |
| Hub (`site/index.html`, `site/hub.js`) | Das Büro als Zeichenfläche. Die Figur läuft zu Möbeln, Objekte öffnen Lernpfade. |
| Player (`site/player.html`) | Zeigt ein Lernmodul im Fenster über dem Büro und meldet den Abschluss an den Hub. |
| Lernpfade | H5P-Module (Branching Scenario mit Course Presentation). Sie hängen an Objekten im Büro. |
| Daten (`site/daten/`) | Raum, Möbel und Figur als JSON. Änderungen brauchen keinen Eingriff in den Code. |

## Lernpfade

| Nr. | Objekt | Thema | Stand |
| --- | --- | --- | --- |
| 01 | Aktenschrank | Lastenheft und Pflichtenheft | als H5P-Paket gebaut, im Hub noch nicht fest verbunden |
| 02 | Testplatz | offen | geplant |
| 03 | Pinnwand | offen | geplant |

Der Aktenschrank startet im Hub vorläufig ein Testmodul. Die Tür zum Flur ist gesperrt.

## Bedienung

- Ein Klick auf eine Stelle im Raum lässt die Figur dorthin laufen.
- Ein Klick auf ein Möbelstück fragt, ob die Aufgabe jetzt geöffnet werden soll.
- Die Taste F schaltet das Vollbild ein.
- Die Lernpfade sind für Maus und Touch gedacht. Touch ist noch nicht auf einem Gerät getestet.
- Der Fortschritt (Siegel) liegt im `localStorage` des Browsers. Wer den Browser wechselt oder die Daten löscht, beginnt von vorn.

## Lokal starten

Der Hub ist eine statische Seite. Es genügt ein einfacher Webserver:

```
cd site
python -m http.server
```

Danach `http://localhost:8000` öffnen. Der Hub lädt JSON-Dateien nach und braucht deshalb einen Webserver.

## Einbetten

Der Hub passt sich der Fenstergröße an und ist für die Einbettung in einen `iframe` ausgelegt. Für das Vollbild braucht der Frame das Attribut `allowfullscreen`:

```html
<iframe src="https://example.org/probezeit/" width="960" height="540" allowfullscreen></iframe>
```

Ziel ist die Einbindung in Moodle. Ob Moodle den Frame in jeder Einbettungsart zulässt und ob das Vollbild dort funktioniert, ist noch nicht geprüft.

## Anpassen

| Datei | Inhalt |
| --- | --- |
| `site/daten/welt.json` | Größe der Halle (1280 x 720) und begehbarer Bereich |
| `site/daten/moebel.json` | Möbel mit Breite und Fußpunkt in Prozent der Bühne, Kollision und Interaktion |
| `site/daten/figur.json` | Bildfolgen der Figur, Fußpunkt je Bild und Maßstab |

Zwei Adressparameter helfen beim Einrichten:

- `?debug=1` zeigt Höhe und Breite jedes Möbelstücks und der Figur.
- `?moebel_skala=1.2` skaliert alle Möbel um einen Faktor.

## Stand

Das Projekt ist in Arbeit.

- Büro, Figur, Wegfindung und Kollision sind umgesetzt und geprüft. Lernpfad 01 ist im Player in Chrome durchgespielt.
- Nicht getestet sind Firefox, Safari, Touch-Geräte und die Einbindung in Moodle.
- Das Ereignis, mit dem ein Lernpfad den Abschluss an den Hub meldet, ist noch ungetestet.
- Die Seite im Netz zeigt zum Teil noch den älteren Pixelstand.

## Grafiken

Die Spielfigur stammt aus PixelLab. Die Raum- und Möbelillustrationen sowie die Bilder der Lernpfade sind mit KI-Werkzeugen erzeugt.
