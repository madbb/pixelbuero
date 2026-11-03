# Pixelbüro

Interaktives Lernmodul als Arbeitsprobe: ein Pixel-Büro im Browser, hinter jeder Tür eine H5P-Lektion. Die erste Tür führt zu einem Testmodul zum Thema Projektmanagement, klassisch gegen agil. Die Grafiken sind Platzhalter.

## Ansehen

Die Seite liegt im Ordner `site/` und läuft ohne Build direkt im Browser. Lokal über einen Server starten, nicht per Doppelklick:

    cd site
    python -m http.server 8123

Dann http://localhost:8123/ öffnen. Steuerung: Pfeiltasten oder WASD, Leertaste oder Enter an Türen, oder mit Maus und Touch auf den Boden oder eine Tür klicken.

## Aufbau

- `site/index.html`, `site/hub.js`: die Halle mit Canvas
- `site/daten/welt.json`: Räume, Türen und Module
- `site/player.html`: spielt ein entpacktes H5P-Modul mit h5p-standalone ab
- `site/test_standalone/`: h5p-standalone 3.8.0 und die Module

## Lizenzen

h5p-standalone und die H5P-Bibliotheken stehen unter ihren eigenen Lizenzen (siehe die Lizenzdateien in den Ordnern).
