// Probezeit Hub, Prototyp mit Platzhaltern. Eigener Code mit Canvas, keine Engine.
// Räume, Türen, Objekte und Module kommen aus daten/welt.json.
(function () {
  'use strict';

  var B = 1280;   // logische Breite der Halle, kommt aus welt.json
  var H = 720;
  var PARAMS = new URLSearchParams(window.location.search);
  var DEBUG = PARAMS.get('debug') === '1';

  // Pfade relativ zu site/index.html
  var WELT_PFAD = 'daten/welt.json';
  var FIGUR_PFAD = 'daten/figur.json';
  var MOEBEL_PFAD = 'daten/moebel.json';
  var REFERENZ_PFAD = 'daten/referenz.json';
  var ZONEN_RADIUS = 26;  // Halbe Kantenlänge der Interaktionszone um den Interaktionspunkt eines Möbelstücks
  var PLAYER_SEITE = 'player.html';
  var SPEICHER_KEY = 'pixelbuero.siegel.v2';
  var MERKER_KEY = 'pixelbuero.einleitung.v1';   // Merker "Einleitung gesehen"
  var EINLEITUNG_ID = 'einleitung-hub';           // Modul-id der Einleitung in welt.json
  var UEBERBLENDUNG_MS = 500;

  var buehne = document.getElementById('buehne');
  var canvas = document.getElementById('halle');
  var ctx = canvas.getContext('2d');
  ctxEinstellen();
  var ergebnisBox = document.getElementById('ergebnis');
  var overlay = document.getElementById('overlay');
  var overlayTitel = document.getElementById('overlay-titel');
  var playerBox = document.getElementById('player');
  var ladeBox = document.getElementById('lade');
  var zurueckBtn = document.getElementById('zurueck');
  var navListe = document.getElementById('tuerliste');
  var navTitel = document.getElementById('nav-titel');

  // Im iframe (zum Beispiel in Moodle) bekommt die Halle den Platz der Überschrift
  try { if (window.self !== window.top) { document.body.classList.add('eingebettet'); } } catch (e) { document.body.classList.add('eingebettet'); }

  var reduziert = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduziert = mq.matches;
    var aendern = function (e) { reduziert = e.matches; };
    if (mq.addEventListener) { mq.addEventListener('change', aendern); } else if (mq.addListener) { mq.addListener(aendern); }
  } catch (e) { /* ohne matchMedia läuft die Halle mit Animation */ }

  // ---------- Welt (aus welt.json) ----------
  var welt = null;
  var raeume = {};       // id -> Raum
  var modulMap = {};     // id -> Modul
  var raum = null;       // aktueller Raum
  var KOLLISION = [];    // Rechtecke des aktuellen Raums (Wände, Möbel, Objekte mit kollision)
  var INTERAKTIV = [];   // Türen und Info-Objekte des aktuellen Raums

  // spieler: Fußpunkt (fx, fy) und die daraus abgeleitete Fußbox (x, y, w, h). Die Figur wird mit der Tiefe größer
  // (Tiefenskalierung), Fußbox, Schatten, Umriss und Tempo wachsen mit. Pfadraster, Zonen und Kollision rechnen mit dem Fußpunkt.
  var FIG = { oben: 0.8, unten: 1.4, tempoH: 1.65, fussB: 0.2, fussT: 0.1 };   // Vielfache der Türhöhe bzw. der Figurhöhe
  var UMRISS = { an: false, breite: 2, farbe: '#FEE5C6' };
  var SCHATTEN = null;
  var spieler = { fx: 0, fy: 0, x: 0, y: 0, w: 0, h: 0 };
  var referenz = null;    // Inhalt von referenz.json (Messwerte der Referenz)
  var SKALA = 0.75;       // moebel_skala

  function tuerHoehe() { return referenz ? referenz.tuer.hoehe_px * B / referenz.breite_px : 242.7; }

  // Höhe der Figur bei der Fuß-y fy: h(y) = h_oben + (h_unten - h_oben) * t
  function figHoehe(fy) {
    var wl = (raum && raum.wandlinie) || 0;
    var bu = (raum && raum.boden_unten) || H;
    var tt = Math.max(0, Math.min(1, (fy - wl) / Math.max(1, bu - wl)));
    var ho = FIG.oben * tuerHoehe();
    return ho + (FIG.unten * ho - ho) * tt;
  }

  function boxBei(fx, fy) {
    var h = figHoehe(fy);
    var w = FIG.fussB * h;
    var d = FIG.fussT * h;
    return { x: fx - w / 2, y: fy - d, w: w, h: d };
  }

  function setzeFuss(fx, fy) {
    spieler.fx = fx;
    spieler.fy = fy;
    var b = boxBei(fx, fy);
    spieler.x = b.x;
    spieler.y = b.y;
    spieler.w = b.w;
    spieler.h = b.h;
  }

  function tempoBei(fy) { return FIG.tempoH * figHoehe(fy); }

  // ---------- Figur (aus figur.json) ----------
  var figur = null;        // Inhalt von figur.json oder null
  var sheets = {};         // Animationsname -> { img, ok, fehler }
  var zeilenIndex = {};    // Animationsname -> { Zeilenname: Index }
  var WECHSEL_MS = 100;    // Richtung höchstens so oft ändern
  var PIXEL = false;       // Figur ist Pixel-Art (figur.json darstellung): ohne Glättung zeichnen
  var GEHT_NACHLAUF_MS = 80; // so lange gilt die Figur nach der letzten Bewegung noch als gehend
  var RICHTUNG_8 = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne']; // nach Winkel, y wächst nach unten
  var fz = { richtung: 's', richtungSeit: -1e9, letzteBewegung: -1e9, anim: 'idle', zeile: 'idle_sued', t0: 0, frame: 0 };

  function fussPunkt() { return { x: spieler.fx, y: spieler.fy }; }

  // ---------- Möbel (aus moebel.json) ----------
  var moebelMap = {};      // id -> Möbelstück
  var moebelBilder = {};   // id -> Image
  var moebelGemeldet = {};

  var wandabstand = 10;  // globaler Abstand Fußpunkt zur Wandlinie bei Wandmöbeln (moebel.json)

  function ladeMoebel(d) {
    if (typeof d.wandabstand === 'number') { wandabstand = d.wandabstand; }
    if (typeof d.zonen_radius === 'number') { ZONEN_RADIUS = d.zonen_radius; }
    if (typeof d.moebel_skala === 'number') { SKALA = d.moebel_skala; }
    var us = parseFloat(PARAMS.get('moebel_skala'));
    if (us > 0) { SKALA = us; }
    (d.moebel || []).forEach(function (m) { moebelMap[m.id] = m; });
  }

  function ladeReferenz(d) { referenz = d; }

  // Anzeigegröße (ab, ah) in logischen Pixeln: so groß wie in der Referenz mal moebel_skala, relativ zur Höhe A des Aktenschranks
  // oder mit der Breite eines anderen Möbelstücks. Das Seitenverhältnis kommt aus der Datei.
  function moebelAnzeige(m) {
    var g = m.groesse;
    var sp = m.sprite;
    var asp = sp ? sp.b / sp.h : 1;
    var fk = B / referenz.breite_px;
    var ab, ah, o;
    if (g.art === 'prozent') {
      ab = g.breite / 100 * B * SKALA;     // Prozent der Bühnenbreite
      ah = ab / asp;
    } else if (g.art === 'referenz') {
      o = referenz.objekte[g.objekt];
      if (g.mass === 'breite') { ab = o.breite_px * fk * SKALA; ah = ab / asp; }
      else { ah = o.hoehe_px * fk * SKALA; ab = ah * asp; }
    } else if (g.art === 'relativ') {
      ah = g.hoehe_a * moebelAnzeige(moebelMap.aktenschrank).ah;   // A: Höhe des Aktenschranks im Spiel
      ab = ah * asp;
    } else {
      ab = moebelAnzeige(moebelMap[g.objekt]).ab;
      ah = ab / asp;
    }
    return { ab: ab, ah: ah };
  }

  // Fußpunkt im Raum. Mit bezug relativ zum Fußpunkt eines anderen Möbelstücks (wandert mit).
  function moebelFuss(m) {
    var b = m.bezug && moebelMap[m.bezug.moebel];
    if (b) {
      var bf = moebelFuss(b);
      var ba = moebelAnzeige(b);
      return { x: bf.x + m.bezug.dx_b * ba.ab, y: bf.y + m.bezug.dy_h * ba.ah };
    }
    if (m.position === 'prozent') {
      return { x: m.fuss_prozent.x / 100 * B, y: m.fuss_prozent.y / 100 * H };
    }
    if (m.position === 'referenz' && referenz) {
      var o = referenz.objekte[m.groesse.objekt];
      return { x: o.fuss_x_prozent / 100 * B, y: o.fuss_y_prozent / 100 * H };
    }
    // Wandmöbel: Fuß y = Wandlinie des Raums plus Wandabstand
    if (m.stellung === 'wand') {
      return { x: m.fuss.x, y: ((raum && raum.wandlinie) || 0) + (typeof m.wandabstand === 'number' ? m.wandabstand : wandabstand) };
    }
    return m.fuss;
  }

  // Sortierschlüssel: sort_y, sonst bei bezug mit vor true knapp vor dem Bezug, sonst die Fuß-y
  function moebelSortY(m) {
    if (typeof m.sort_y === 'number') { return m.sort_y; }
    var b = m.bezug && m.bezug.vor && moebelMap[m.bezug.moebel];
    return b ? moebelSortY(b) + 1 : moebelFuss(m).y;
  }

  // Sichtbares Rechteck, Kollisionsrechteck und Interaktionszone eines Möbelstücks aus den Daten
  function moebelGeometrie(m) {
    var fp = moebelFuss(m);
    var fx = fp.x;
    var fy = fp.y;
    var an = moebelAnzeige(m);
    var ab = an.ab;
    var ah = an.ah;
    var rect = { x: fx - ab / 2, y: fy - ah, w: ab, h: ah };
    var kol = null;
    var k = m.kollision;
    if (k && k.modus === 'unten') {
      var kh = Math.max(k.min_h || 1, Math.round(ah * (typeof k.anteil === 'number' ? k.anteil : 0.3)));
      if (typeof k.tiefe_prozent === 'number') { kh = k.tiefe_prozent / 100 * H; }   // schmaler Streifen am Fuß, Tiefe in Prozent der Bühnenhöhe
      kol = { x: rect.x, y: fy - kh, w: ab, h: kh };
    } else if (k) {
      kol = { x: fx + k.x, y: fy + k.y, w: k.w, h: k.h };
    }
    var zone = null;
    if (m.interaktion) {
      var ip = m.interaktionspunkt || { dx: 0, dy: 20 };
      var zx = fx;
      var zy = fy;
      if (ip.bezug && m.bezug) { var bf = moebelFuss(moebelMap[m.bezug.moebel]); zx = bf.x; zy = bf.y; }
      zone = { x: zx + ip.dx - ZONEN_RADIUS, y: zy + ip.dy - ZONEN_RADIUS, w: 2 * ZONEN_RADIUS, h: 2 * ZONEN_RADIUS };
    }
    return { rect: rect, kollision: kol, zone: zone };
  }

  // Ids der Möbel eines Raums. Möbel mit "aktiv": false in moebel.json sind abgeschaltet
  // (nicht gezeichnet, keine Klickfläche, keine Kollision), ihre Daten und Interaktion bleiben erhalten.
  function raumMoebel(r) {
    return (r.moebel || []).filter(function (id) { return !moebelMap[id] || moebelMap[id].aktiv !== false; });
  }

  function moebelBild(m) {
    if (!m.sprite) { return null; }
    var b = moebelBilder[m.id];
    if (!b) {
      b = new Image();
      b.onerror = function () {
        b.fehler = true;
        if (!moebelGemeldet[m.id]) { moebelGemeldet[m.id] = true; console.error('Möbel: Sprite "' + m.sprite.datei + '" für "' + m.id + '" fehlt oder lädt nicht. Es bleibt ein graues Rechteck.'); }
      };
      b.src = m.sprite.datei;
      moebelBilder[m.id] = b;
    }
    return b.complete && !b.fehler && b.naturalWidth ? b : null;
  }

  function ladeFigur(f) {
    figur = f;
    var rel = f.fussbox_rel || { breite: 0.2, tiefe: 0.1 };
    FIG.fussB = rel.breite;
    FIG.fussT = rel.tiefe;
    if (typeof f.figur_oben === 'number') { FIG.oben = f.figur_oben; }
    if (typeof f.figur_unten === 'number') { FIG.unten = f.figur_unten; }
    if (typeof f.tempo_h === 'number') { FIG.tempoH = f.tempo_h; }
    var po = parseFloat(PARAMS.get('figur_oben'));
    var pu = parseFloat(PARAMS.get('figur_unten'));
    if (po > 0) { FIG.oben = po; }
    if (pu > 0) { FIG.unten = pu; }
    PIXEL = f.darstellung === 'pixel';
    if (f.umriss) { UMRISS = f.umriss; }
    var up = PARAMS.get('umriss');
    if (up === '0') { UMRISS.an = false; } else if (up === '1') { UMRISS.an = true; }
    SCHATTEN = f.schatten || null;
    if (typeof f.richtungswechsel_ms === 'number') { WECHSEL_MS = f.richtungswechsel_ms; }
    fz.richtung = f.start_richtung || 's';
    fz.zeile = idleZeile(fz.richtung);
    Object.keys(f.animationen || {}).forEach(function (name) {
      var a = f.animationen[name];
      var idx = {};
      (a.zeilen || []).forEach(function (z, i) { idx[z.name] = i; });
      zeilenIndex[name] = idx;
      if (!a.frame_b || !a.frame_h || !a.frames) {
        console.error('Figur: Animation "' + name + '" hat keine frame_b, frame_h oder frames in ' + FIGUR_PFAD + '. Bitte tools/figur_sheets.py laufen lassen.');
        sheets[name] = { ok: false, fehler: true };
        return;
      }
      var img = new Image();
      var s = { img: img, ok: false, fehler: false };
      img.onload = function () { s.ok = true; };
      img.onerror = function () {
        s.fehler = true;
        console.error('Figur: Spritesheet "' + a.sheet + '" für "' + name + '" fehlt oder lädt nicht. Es bleibt das farbige Rechteck.');
      };
      img.src = a.sheet;
      sheets[name] = s;
    });
  }

  function idleZeile(r) {
    var z = figur && figur.idle_zuordnung && figur.idle_zuordnung[r];
    return z || (r.charAt(0) === 'n' ? 'idle_nord' : 'idle_sued');
  }

  function richtungAus(dx, dy) {
    var k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    return RICHTUNG_8[(k + 8) % 8];
  }

  // Nach jedem Schritt: Richtung aus der tatsächlichen Bewegung, dann Animation und Frame
  function aktualisiereFigur(jetzt, dx, dy) {
    if (dx * dx + dy * dy > 1e-6) {
      var gingSchon = jetzt - fz.letzteBewegung < GEHT_NACHLAUF_MS;
      fz.letzteBewegung = jetzt;
      var r = richtungAus(dx, dy);
      if (r !== fz.richtung && (!gingSchon || jetzt - fz.richtungSeit >= WECHSEL_MS)) {
        fz.richtung = r;
        fz.richtungSeit = jetzt;
      }
    }
    var geht = jetzt - fz.letzteBewegung < GEHT_NACHLAUF_MS;
    var anim = geht ? 'gehen' : 'idle';
    var zeile = geht ? fz.richtung : idleZeile(fz.richtung);
    // Wechsel Stand und Gehen: Frame 0. Wechsel der Idle-Zeile: Frame 0. Richtungswechsel beim Gehen: Frame läuft weiter.
    if (anim !== fz.anim || (anim === 'idle' && zeile !== fz.zeile)) { fz.t0 = jetzt; }
    fz.anim = anim;
    fz.zeile = zeile;
    var a = figur && figur.animationen && figur.animationen[anim];
    if (!a || !a.frames) { fz.frame = 0; return; }
    if (anim === 'idle' && reduziert) { fz.frame = 0; return; }
    fz.frame = Math.floor((jetzt - fz.t0) * (a.fps || 8) / 1000) % a.frames;
  }

  // Dreht die Figur zu einem Objekt: liegt es höher (kleinere Fuß-y, also untere Kante), nach Norden, sonst nach Süden
  function drehZu(e) {
    var unten = e.rect.y + e.rect.h;
    fz.richtung = unten < fussPunkt().y ? 'n' : 's';
    fz.richtungSeit = performance.now();
    fz.letzteBewegung = -1e9;
  }

  // Sichtbarer Bereich der Figur, zum Beispiel als Anker für Sprechblasen
  function figurRect() {
    var p = fussPunkt();
    var h = figHoehe(p.y);
    return { x: p.x - h * 0.18, y: p.y - h, w: h * 0.36, h: h };
  }

  function zone(r, rand) { return { x: r.x - rand, y: r.y - rand, w: r.w + 2 * rand, h: r.h + 2 * rand }; }

  // Berührung zählt nicht als Überlappung. Die kleine Toleranz fängt Rundungsfehler ab,
  // damit die Figur an einer Kante entlang gehen kann, ohne hängen zu bleiben.
  var EPS = 1e-6;
  function schneidet(a, b) {
    return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
  }

  // Bewegung getrennt nach Achsen: erst x, dann y. Bei Treffer wird an die Kante des
  // getroffenen Rechtecks gesetzt, so bleibt die Figur an Wänden nicht hängen.
  function bewegeAchse(dx, dy) {
    var fx = spieler.fx;
    var fy = spieler.fy;
    if (frei(fx + dx, fy + dy)) { setzeFuss(fx + dx, fy + dy); return; }
    // Hindernis: kleineren Schritt suchen, so nähert sich die Figur der Kante
    var f = 0.5;
    for (var k = 0; k < 5; k++, f /= 2) {
      if (frei(fx + dx * f, fy + dy * f)) { setzeFuss(fx + dx * f, fy + dy * f); return; }
    }
  }

  // Bewegung getrennt nach Achsen (gleitet an Kanten entlang). Kollision gegen Rechtecke und das begehbare Polygon.
  function bewege(dx, dy) {
    bewegeAchse(dx, 0);
    bewegeAchse(0, dy);
  }

  // Schritt in eine Richtung: erst der ganze Schritt, nur bei Hindernis getrennt nach Achsen
  function bewegeVektor(dx, dy) {
    if (frei(spieler.fx + dx, spieler.fy + dy)) { setzeFuss(spieler.fx + dx, spieler.fy + dy); return; }
    bewege(dx, dy);
  }

  // Polygon der begehbaren Fläche (raum.begehbar, Liste von [x, y]). Alle vier Ecken der Fußbox müssen darin liegen.
  function punktImPolygon(px, py, poly) {
    var n = poly.length;
    var innen = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var x1 = poly[i][0], y1 = poly[i][1], x2 = poly[j][0], y2 = poly[j][1];
      // Rand zählt als innen
      var kreuz = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      if (Math.abs(kreuz) < 1e-6 && px >= Math.min(x1, x2) - 1e-6 && px <= Math.max(x1, x2) + 1e-6 && py >= Math.min(y1, y2) - 1e-6 && py <= Math.max(y1, y2) + 1e-6) { return true; }
      if ((y1 > py) !== (y2 > py) && px < (x2 - x1) * (py - y1) / (y2 - y1) + x1) { innen = !innen; }
    }
    return innen;
  }

  function imPolygon(x, y, w, h) {
    var poly = raum && raum.begehbar;
    if (!poly) { return true; }
    return punktImPolygon(x, y, poly) && punktImPolygon(x + w, y, poly) && punktImPolygon(x, y + h, poly) && punktImPolygon(x + w, y + h, poly);
  }

  // ---------- Wegfindung (Raster, A*) ----------
  // Jede Zelle (8 logische Pixel) steht für einen möglichen Fußpunkt der Figur.
  // Gehbar ist sie, wenn die Figur dort kein Kollisionsrechteck berührt. Diagonale Schritte
  // sind nur erlaubt, wenn beide Nachbarzellen daneben gehbar sind (keine Ecken schneiden).
  // Das Raster wird bei jedem Raumwechsel aus den Daten des Raums neu gebaut.
  var ZELLE = 8;
  var GW = B / ZELLE;
  var GH = H / ZELLE;
  var gitter = [];
  var RICHT = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  // Steht die Fußbox mit dem Fußpunkt (fx, fy) frei? Die Boxgröße hängt von der Tiefe ab.
  function frei(fx, fy) {
    var b = boxBei(fx, fy);
    if (b.x < 0 || b.y < 0 || b.x + b.w > B || b.y + b.h > H) { return false; }
    if (!imPolygon(b.x, b.y, b.w, b.h)) { return false; }
    for (var i = 0; i < KOLLISION.length; i++) {
      if (schneidet(b, KOLLISION[i])) { return false; }
    }
    return true;
  }

  function baueGitter() {
    GW = Math.floor(B / ZELLE);
    GH = Math.floor(H / ZELLE);
    gitter = [];
    for (var j = 0; j < GH; j++) {
      for (var i = 0; i < GW; i++) { gitter.push(frei(i * ZELLE, j * ZELLE)); }
    }
    objektZellen = {};
  }

  function gehbar(i, j) { return i >= 0 && j >= 0 && i < GW && j < GH && gitter[j * GW + i]; }

  function nachbarn(idx, fn) {
    var i = idx % GW;
    var j = (idx / GW) | 0;
    for (var k = 0; k < RICHT.length; k++) {
      var dx = RICHT[k][0];
      var dy = RICHT[k][1];
      if (!gehbar(i + dx, j + dy)) { continue; }
      if (dx && dy && !(gehbar(i + dx, j) && gehbar(i, j + dy))) { continue; }
      fn((j + dy) * GW + (i + dx), RICHT[k][2]);
    }
  }

  function Haufen() { this.a = []; }
  Haufen.prototype.push = function (f, v) {
    var a = this.a;
    a.push([f, v]);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) { break; }
      var t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Haufen.prototype.pop = function () {
    var a = this.a;
    var oben = a[0];
    var letztes = a.pop();
    if (a.length) {
      a[0] = letztes;
      var i = 0;
      var n = a.length;
      for (;;) {
        var l = 2 * i + 1;
        var r = l + 1;
        var m = i;
        if (l < n && a[l][0] < a[m][0]) { m = l; }
        if (r < n && a[r][0] < a[m][0]) { m = r; }
        if (m === i) { break; }
        var t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return oben;
  };

  // Schritte von der Startzelle zu allen erreichbaren Zellen (-1 heißt nicht erreichbar)
  function flut(start) {
    var schritte = new Int32Array(GW * GH).fill(-1);
    var warte = [start];
    schritte[start] = 0;
    for (var q = 0; q < warte.length; q++) {
      var cur = warte[q];
      nachbarn(cur, function (n) {
        if (schritte[n] < 0) { schritte[n] = schritte[cur] + 1; warte.push(n); }
      });
    }
    return schritte;
  }

  function astern(start, ziel) {
    var tx = ziel % GW;
    var ty = (ziel / GW) | 0;
    var g = new Float32Array(GW * GH).fill(Infinity);
    var von = new Int32Array(GW * GH).fill(-1);
    var offen = new Haufen();
    function h(idx) {
      var dx = Math.abs((idx % GW) - tx);
      var dy = Math.abs(((idx / GW) | 0) - ty);
      return dx + dy - 0.5858 * Math.min(dx, dy);
    }
    g[start] = 0;
    offen.push(h(start), start);
    while (offen.a.length) {
      var e = offen.pop();
      var cur = e[1];
      if (cur === ziel) {
        var pfad = [cur];
        while (von[cur] >= 0) { cur = von[cur]; pfad.push(cur); }
        return pfad.reverse();
      }
      if (e[0] - h(cur) > g[cur] + 1e-4) { continue; }
      nachbarn(cur, function (n, kosten) {
        var ng = g[cur] + kosten;
        if (ng < g[n]) { g[n] = ng; von[n] = cur; offen.push(ng + h(n), n); }
      });
    }
    return null;
  }

  // Gehbare Zelle, die der Figur am nächsten liegt (die Figur kann an einer Wand
  // zwischen zwei Rasterpunkten stehen)
  function startZelle() {
    var bx = Math.round(spieler.fx / ZELLE);
    var by = Math.round(spieler.fy / ZELLE);
    var beste = -1;
    var bestD = Infinity;
    for (var j = by - 6; j <= by + 6; j++) {
      for (var i = bx - 6; i <= bx + 6; i++) {
        if (!gehbar(i, j)) { continue; }
        var d = Math.pow(i * ZELLE - spieler.fx, 2) + Math.pow(j * ZELLE - spieler.fy, 2);
        if (d < bestD) { bestD = d; beste = j * GW + i; }
      }
    }
    return beste;
  }

  function zellPunkt(idx) { return { x: (idx % GW) * ZELLE, y: ((idx / GW) | 0) * ZELLE }; }

  // Sichtlinie: Die Figur kann geradeaus von a nach b gehen, ohne ein Rechteck zu berühren
  function sicht(a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
    for (var k = 1; k <= n; k++) {
      if (!frei(a.x + dx * k / n, a.y + dy * k / n)) { return false; }
    }
    return true;
  }

  function vereinfache(p) {
    var aus = [p[0]];
    var i = 0;
    while (i < p.length - 1) {
      var j = p.length - 1;
      while (j > i + 1 && !sicht(p[i], p[j])) { j--; }
      aus.push(p[j]);
      i = j;
    }
    return aus;
  }

  // Zellen, in denen die Figur das Objekt o bedienen würde (gleiche Regel wie die Leertaste)
  var objektZellen = {};
  function zellenFuer(o) {
    if (!objektZellen[o.id]) {
      var liste = [];
      for (var idx = 0; idx < gitter.length; idx++) {
        if (!gitter[idx]) { continue; }
        var pt = zellPunkt(idx);
        var z = aktuellesZiel(boxBei(pt.x, pt.y));
        if (z && z.id === o.id) { liste.push(idx); }
      }
      objektZellen[o.id] = liste;
    }
    return objektZellen[o.id];
  }

  // Plant einen Weg zu einem Wunschpunkt (Fußpunkt der Figur) oder zu einem Objekt.
  // Liefert null, wenn es keinen Weg gibt.
  var weg = null;       // { roh, punkte, i, aktion, ziel, steckt }
  var hoverId = null;

  function planeWeg(wunsch, objekt) {
    var start = startZelle();
    if (start < 0) { return null; }
    var schritte = flut(start);
    var zielIdx = -1;
    var i;
    if (objekt) {
      var zellen = zellenFuer(objekt);
      var best = Infinity;
      for (i = 0; i < zellen.length; i++) {
        var sch = schritte[zellen[i]];
        if (sch >= 0 && sch < best) { best = sch; zielIdx = zellen[i]; }
      }
    } else {
      var bestD = Infinity;
      for (i = 0; i < schritte.length; i++) {
        if (schritte[i] < 0) { continue; }
        var pt = zellPunkt(i);
        var d = Math.pow(pt.x - wunsch.x, 2) + Math.pow(pt.y - wunsch.y, 2);
        if (d < bestD || (d === bestD && schritte[i] < schritte[zielIdx])) { bestD = d; zielIdx = i; }
      }
    }
    if (zielIdx < 0) { return null; }
    var roh = astern(start, zielIdx);
    if (!roh) { return null; }
    var punkte = roh.map(zellPunkt);
    var glatt = vereinfache([{ x: spieler.fx, y: spieler.fy }].concat(punkte)).slice(1);
    return {
      roh: punkte,
      punkte: glatt,
      i: 0,
      aktion: objekt ? objekt.id : null,
      ziel: punkte[punkte.length - 1],
      steckt: 0
    };
  }

  // ---------- Speicher (localStorage nur mit try/catch) ----------
  // Siegel und Punkte hängen an der Modul-id: { modulId: { punkte, rang } }
  var siegel = {};
  function ladeSiegel() {
    try {
      var s = window.localStorage.getItem(SPEICHER_KEY);
      if (s) {
        var o = JSON.parse(s);
        if (o && typeof o === 'object') { siegel = o; }
      }
    } catch (e) { siegel = {}; }
  }
  function speichereSiegel() {
    try { window.localStorage.setItem(SPEICHER_KEY, JSON.stringify(siegel)); } catch (e) { /* läuft ohne Speicher weiter */ }
  }

  // Merker "Einleitung gesehen". Ohne Speicher gilt der Merker nur für diese Sitzung im Arbeitsspeicher,
  // die Einleitung erscheint dann bei jedem Start. Es gibt keine Fehlermeldung.
  var einleitungGesehen = false;
  function ladeMerker() {
    try { einleitungGesehen = window.localStorage.getItem(MERKER_KEY) === '1'; } catch (e) { einleitungGesehen = false; }
  }
  function setzeMerker() {
    einleitungGesehen = true;
    try { window.localStorage.setItem(MERKER_KEY, '1'); } catch (e) { /* läuft ohne Speicher weiter */ }
  }

  function rangFuer(modul, punkte) {
    var raenge = (modul && modul.raenge && modul.raenge.length) ? modul.raenge : [{ ab: 0, name: 'Teilnehmer' }];
    var name = raenge[0].name;
    for (var i = 0; i < raenge.length; i++) { if (punkte >= raenge[i].ab) { name = raenge[i].name; } }
    return name;
  }

  function punkteText(s) {
    return s.punkte + (s.punkte === 1 ? ' Punkt' : ' Punkte') + ', Rang ' + s.rang;
  }

  function ergebnisText(modul, s) {
    return modul.name + ': ' + punkteText(s) + ' (Platzhalter)';
  }

  // ---------- Sprechblase ----------
  var blase = null; // { text, rect, bis }
  function sprich(text, rect) {
    blase = { text: text, rect: rect, bis: performance.now() + 2600 };
    ergebnisBox.textContent = text;
  }

  // ---------- Räume ----------
  var ueberblendung = null; // { t0, dauer, id, spawn, gewechselt }
  var bilder = {};          // Pfad -> Image

  function hintergrundBild(r) {
    var h = r.hintergrund;
    if (typeof h !== 'string' || h.charAt(0) === '#') { return null; }
    if (!bilder[h]) {
      var img = new Image();
      img.onerror = function () { img.fehler = true; };
      img.src = h;
      bilder[h] = img;
    }
    var b = bilder[h];
    return b.complete && !b.fehler && b.naturalWidth ? b : null;
  }

  function baueRaum(r) {
    KOLLISION = (r.kollision || []).slice();
    INTERAKTIV = [];
    var i;
    var objekte = r.objekte || [];
    for (i = 0; i < objekte.length; i++) {
      var o = objekte[i];
      if (o.kollision) { KOLLISION.push(o); }
      if (o.typ === 'info') {
        INTERAKTIV.push({ id: o.id, art: 'objekt', name: o.name || o.id, rect: o, zone: zone(o, o.zone || 20), daten: o });
      }
    }
    raumMoebel(r).forEach(function (id) {
      var m = moebelMap[id];
      if (!m || !m.sprite) {
        console.error('Möbel "' + id + '" von Raum "' + r.id + '" steht nicht in ' + MOEBEL_PFAD + ' oder hat keinen Sprite (python tools/moebel_bauen.py).');
        return;
      }
      var g = moebelGeometrie(m);
      if (g.kollision) { KOLLISION.push(g.kollision); }
      if (g.zone) {
        INTERAKTIV.push({ id: m.id, art: 'moebel', name: m.name || m.id, rect: g.rect, zone: g.zone, daten: m });
      }
    });
    var tueren = r.tueren || [];
    for (i = 0; i < tueren.length; i++) {
      var t = tueren[i];
      INTERAKTIV.push({ id: t.id, art: 'tuer', name: t.name, rect: t, zone: zone(t, t.zone || ZONEN_RADIUS), daten: t });
    }
    baueGitter();
  }

  function naechsteFreieStelle(x, y) {
    if (frei(x, y)) { return { x: x, y: y }; }
    var beste = null;
    var bestD = Infinity;
    for (var idx = 0; idx < gitter.length; idx++) {
      if (!gitter[idx]) { continue; }
      var p = zellPunkt(idx);
      var d = Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2);
      if (d < bestD) { bestD = d; beste = p; }
    }
    return beste || { x: x, y: y };
  }

  function ladeRaum(id, spawn) {
    var r = raeume[id];
    if (!r) { return; }
    raum = r;
    baueRaum(r);
    var s = naechsteFreieStelle((spawn || r.start).x, (spawn || r.start).y);
    setzeFuss(s.x, s.y);
    // Nach dem Betreten steht die Figur mit Blick in den Raum (Süden)
    fz.richtung = 's';
    fz.letzteBewegung = -1e9;
    weg = null;
    blase = null;
    hoverAus();
    tasten = {};
    baueNav();
    canvas.setAttribute('aria-label', 'Probezeit, Raum ' + r.name + '. Die Türen sind auch in der Liste unter der Halle erreichbar.');
    ergebnisBox.textContent = 'Raum: ' + r.name;
  }

  function wechsleRaum(id, spawn) {
    if (!raeume[id] || ueberblendung) { return; }
    weg = null;
    tasten = {};
    if (reduziert) {
      ladeRaum(id, spawn);
      fokusNachRaumwechsel();
    } else {
      ueberblendung = { t0: null, dauer: UEBERBLENDUNG_MS, id: id, spawn: spawn, gewechselt: false };
    }
  }

  // Die Linkliste wird beim Raumwechsel neu gebaut. Lag der Fokus darin, geht er auf die Überschrift.
  function fokusNachRaumwechsel() {
    var a = document.activeElement;
    if (!a || a === document.body || (navListe && navListe.contains(a)) || a === navTitel) {
      try { navTitel.focus(); } catch (e) { /* Fokus ist nur eine Hilfe */ }
    }
  }

  // ---------- Linkliste unter dem Canvas ----------
  function ziellabel(t) {
    var z = t.ziel || {};
    if (z.typ === 'modul') {
      var s = siegel[z.id];
      return '(offen' + (s ? ', ' + punkteText(s) : '') + ')';
    }
    if (z.typ === 'raum') { return '(zum Raum ' + (raeume[z.id] ? raeume[z.id].name : z.id) + ')'; }
    return '(gesperrt: ' + (z.hinweis || 'In Arbeit') + ')';
  }

  // Beschriftung hinter einem Möbelstück in der Linkliste
  function moebellabel(m) {
    var ia = m.interaktion || {};
    if (ia.typ === 'frage') {
      var s = siegel[(ia.ziel || {}).id];
      return '(öffnet einen Lernpfad' + (s ? ', ' + punkteText(s) : '') + ')';
    }
    if (ia.typ === 'gesperrt') { return '(gesperrt: ' + (ia.hinweis || 'In Arbeit') + ')'; }
    return '(Hinweistext)';
  }

  function baueNav() {
    navTitel.textContent = 'Türen und Objekte in diesem Raum: ' + raum.name;
    navListe.innerHTML = '';
    INTERAKTIV.forEach(function (e) {
      if (e.art !== 'tuer' && e.art !== 'moebel') { return; }
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + e.id;
      a.textContent = e.name;
      var gesperrt = e.art === 'tuer' ? (e.daten.ziel || {}).typ === 'gesperrt' : (e.daten.interaktion || {}).typ === 'gesperrt';
      if (gesperrt) { a.setAttribute('aria-disabled', 'true'); }
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        bediene(e, a);
      });
      li.appendChild(a);
      li.appendChild(document.createTextNode(' ' + (e.art === 'tuer' ? ziellabel(e.daten) : moebellabel(e.daten))));
      navListe.appendChild(li);
    });
  }

  // ---------- Eingabe ----------
  var tasten = {};
  var overlayOffen = false;

  function tastenName(e) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': return 'links';
      case 'ArrowRight': case 'd': case 'D': return 'rechts';
      case 'ArrowUp': case 'w': case 'W': return 'hoch';
      case 'ArrowDown': case 's': case 'S': return 'runter';
      case ' ': case 'Spacebar': case 'Enter': return 'aktion';
      default: return null;
    }
  }

  function inBedienelement(el) {
    return !!(el && el.closest && el.closest('a, button, input, textarea, select, [contenteditable]'));
  }

  window.addEventListener('keydown', function (e) {
    if (dialogOffen) { return; }   // der Dialog bedient seine Tasten selbst
    if (overlayOffen) {
      if (e.key === 'Escape') { schliesseOverlay(); e.preventDefault(); }
      return; // sonst ignoriert die Halle alle Tasten
    }
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (inBedienelement(e.target)) { return; }
    var n = tastenName(e);
    var istF = e.key === 'f' || e.key === 'F';
    if (istF) { e.preventDefault(); if (!e.repeat) { vollbildUmschalten(); } return; }
    if (!n) { return; }
    e.preventDefault();
    if (!raum || ueberblendung) { return; }
    weg = null; // ein Tastendruck bricht den Klick-Weg ab
    if (n === 'aktion') {
      if (!e.repeat) { aktion(); }
      return;
    }
    tasten[n] = true;
  });

  window.addEventListener('keyup', function (e) {
    var n = tastenName(e);
    if (n && n !== 'aktion') { delete tasten[n]; }
  });

  window.addEventListener('blur', function () { tasten = {}; });

  // Nächstes Objekt, dessen Zone das Rechteck r (Standard: die Figur) berührt
  function aktuellesZiel(r) {
    r = r || spieler;
    var beste = null;
    var bestD = Infinity;
    var sx = r.x + r.w / 2;
    var sy = r.y + r.h / 2;
    for (var i = 0; i < INTERAKTIV.length; i++) {
      var o = INTERAKTIV[i];
      if (schneidet(r, o.zone)) {
        var d = Math.abs(sx - (o.rect.x + o.rect.w / 2)) + Math.abs(sy - (o.rect.y + o.rect.h / 2));
        if (d < bestD) { bestD = d; beste = o; }
      }
    }
    return beste;
  }

  function aktion() {
    var z = aktuellesZiel();
    if (z) { drehZu(z); bediene(z); }
  }

  // Löst die Interaktion eines Eintrags (Tür oder Objekt) aus
  function bediene(e, vonElement) {
    if (e.art === 'objekt') {
      sprich(e.daten.text || e.name, e.rect);
      return;
    }
    if (e.art === 'moebel') {
      var ia = e.daten.interaktion || {};
      if (ia.typ === 'frage') { oeffneDialog(e, vonElement); }
      else if (ia.typ === 'gesperrt') { sprich(ia.hinweis || 'In Arbeit', e.rect); }
      else { sprich(ia.text || e.name, e.rect); }
      return;
    }
    var ziel = e.daten.ziel || {};
    if (ziel.typ === 'modul') {
      var m = modulMap[ziel.id];
      if (!m) { sprich('Das Modul fehlt.', e.rect); return; }
      var vor = vonElement || (document.activeElement && document.activeElement !== document.body ? document.activeElement : canvas);
      oeffneOverlay(vor, m);
    } else if (ziel.typ === 'raum') {
      wechsleRaum(ziel.id, ziel.spawn);
    } else {
      sprich(ziel.hinweis || 'In Arbeit', e.rect);
    }
  }

  // ---------- Rückfrage (zum Beispiel Aktenschrank öffnen: Öffnen oder Später) ----------
  var dialog = document.getElementById('dialog');
  var dialogVortext = document.getElementById('dialog-vortext');
  var dialogFrage = document.getElementById('dialog-frage');
  var dialogJa = document.getElementById('dialog-ja');
  var dialogNein = document.getElementById('dialog-nein');
  var dialogOffen = false;
  var dialogEintrag = null;
  var dialogRueck = null;

  function oeffneDialog(e, vonElement) {
    if (dialogOffen || !dialog) { return; }
    var ia = e.daten.interaktion;
    dialogOffen = true;
    dialogEintrag = e;
    dialogRueck = vonElement || canvas;
    tasten = {};
    weg = null;
    blase = null;
    hoverAus();
    dialogVortext.textContent = ia.vortext || '';
    dialogFrage.textContent = ia.frage || '';
    dialogJa.textContent = ia.ja || 'Ja';
    dialogNein.textContent = ia.nein || 'Nein';
    dialog.hidden = false;
    dialogJa.focus();
  }

  function schliesseDialog(oeffnen) {
    if (!dialogOffen) { return; }
    var e = dialogEintrag;
    var rueck = dialogRueck;
    dialogOffen = false;
    dialogEintrag = null;
    dialog.hidden = true;
    if (oeffnen) {
      var z = (e.daten.interaktion || {}).ziel || {};
      var m = modulMap[z.id];
      if (!m) { sprich('Das Modul fehlt.', e.rect); } else { oeffneOverlay(rueck, m); return; }
    }
    if (!rueck || !document.contains(rueck)) { rueck = canvas; }
    try { rueck.focus(); } catch (x) { canvas.focus(); }
  }

  if (dialog) {
    dialogJa.addEventListener('click', function () { schliesseDialog(true); });
    dialogNein.addEventListener('click', function () { schliesseDialog(false); });
    dialog.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); schliesseDialog(false); return; }
      if (ev.key === 'Tab') {
        // Fokus bleibt im Dialog
        var erster = dialogJa;
        var letzter = dialogNein;
        if (ev.shiftKey && document.activeElement === erster) { ev.preventDefault(); letzter.focus(); }
        else if (!ev.shiftKey && document.activeElement === letzter) { ev.preventDefault(); erster.focus(); }
      }
    });
  }

  // ---------- Zeiger: Klick und Tipp zum Laufen, Hover ----------
  // Rechnet eine Zeigerposition in Canvas-Koordinaten um. Funktioniert bei jeder
  // Skalierung und mit Rand, weil Position und Größe bei jedem Ereignis neu gelesen werden.
  function canvasPunkt(e) {
    var r = canvas.getBoundingClientRect();
    var cw = canvas.clientWidth || r.width;
    var ch = canvas.clientHeight || r.height;
    if (!cw || !ch) { return null; }
    var x = (e.clientX - r.left - canvas.clientLeft) * B / cw;
    var y = (e.clientY - r.top - canvas.clientTop) * H / ch;
    if (x < 0 || y < 0 || x >= B || y >= H) { return null; }
    return { x: x, y: y };
  }

  function objektBei(p) {
    for (var i = 0; i < INTERAKTIV.length; i++) {
      var o = INTERAKTIV[i];
      var r = zone(o.rect, 10);
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) { return o; }
    }
    return null;
  }

  function klickZiel(p, o) {
    weg = null;
    if (o) {
      var jetzt = aktuellesZiel();
      if (jetzt && jetzt.id === o.id) { drehZu(o); bediene(o); return; }
      weg = planeWeg(null, o);
      if (!weg) { sprich('Da komme ich nicht hin.', figurRect()); }
      return;
    }
    weg = planeWeg({ x: p.x, y: p.y }, null);
    if (!weg) { sprich('Da komme ich nicht hin.', figurRect()); return; }
    if (!weg.punkte.length) {
      weg = null;
      var dx = p.x - spieler.fx;
      var dy = p.y - spieler.fy;
      if (Math.sqrt(dx * dx + dy * dy) > 30) { sprich('Da komme ich nicht hin.', figurRect()); }
    }
  }

  canvas.style.touchAction = 'manipulation';

  canvas.addEventListener('pointerdown', function (e) {
    if (overlayOffen || dialogOffen || !raum || ueberblendung) { return; }
    if (e.isPrimary === false) { return; }
    if (e.pointerType === 'mouse' && e.button !== 0) { return; }
    var p = canvasPunkt(e);
    if (!p) { return; }
    klickZiel(p, objektBei(p));
  });

  function hoverAus() {
    hoverId = null;
    canvas.style.cursor = '';
  }

  canvas.addEventListener('pointermove', function (e) {
    if (overlayOffen || dialogOffen || !raum || ueberblendung || e.pointerType !== 'mouse') { hoverAus(); return; }
    var p = canvasPunkt(e);
    var o = p ? objektBei(p) : null;
    hoverId = o ? o.id : null;
    canvas.style.cursor = o ? 'pointer' : '';
  });
  canvas.addEventListener('pointerleave', hoverAus);
  canvas.addEventListener('pointercancel', hoverAus);

  // ---------- Overlay und Player ----------
  var sitzung = 0;              // erhöht bei jedem Öffnen und Schließen, verwirft späte Ereignisse
  var rahmen = null;            // der iframe mit player.html
  var rueckfokus = null;
  var aktivesModul = null;

  // Verarbeitet eine xAPI-Aussage, die player.html weitergereicht hat
  var letzteFolie = 0;   // höchste Folie der Einleitung, die der Player gemeldet hat (xAPI progressed, ending-point)

  function ereignis(s) {
    if (!s || !s.verb || !s.verb.id || !aktivesModul) { return; }
    var verb = s.verb.id.split('/').pop();
    if (verb === 'progressed' && aktivesModul.id === EINLEITUNG_ID) {
      var ext = (s.object && s.object.definition && s.object.definition.extensions) || {};
      var ep = parseInt(ext['http://id.tincanapi.com/extension/ending-point'], 10);
      if (ep > letzteFolie) { letzteFolie = ep; }
      return;
    }
    if (verb !== 'completed') { return; }
    // Nur das Hauptobjekt zählt, Unterinhalte tragen subContentId in der Objekt-ID
    var oid = (s.object && s.object.id) || '';
    if (oid.indexOf('subContentId=') !== -1) { return; }
    var m = aktivesModul;
    if (m.id === EINLEITUNG_ID) {
      // Die Einleitung hat keine Punkte und kein Siegel. Vollständiger Durchlauf: Merker setzen, Fenster schließen, Büro freigeben.
      // Vollständig heißt: Der Player hat die letzte Folie gemeldet (welt.json, folien). Der Weiter-Knopf des Players lässt sich
      // sonst schon auf Folie 1 drücken und meldet dann auch completed. In dem Fall schließt das Fenster ohne Merker.
      if (!m.folien || letzteFolie >= m.folien) { setzeMerker(); }
      schliesseOverlay();
      return;
    }
    var score = s.result && s.result.score;
    var punkte = score && typeof score.raw === 'number' ? score.raw : null;
    var eintrag = siegel[m.id] || {};
    if (punkte === null) {
      siegel[m.id] = { punkte: eintrag.punkte || 0, rang: eintrag.rang || rangFuer(m, 0), ohnePunkte: true };
      ergebnisBox.textContent = m.name + ' abgeschlossen, das Modul hat keine Punkte gemeldet.';
    } else {
      if (typeof eintrag.punkte !== 'number' || punkte >= eintrag.punkte) {
        siegel[m.id] = { punkte: punkte, rang: rangFuer(m, punkte) };
      }
      ergebnisBox.textContent = ergebnisText(m, { punkte: punkte, rang: rangFuer(m, punkte) });
    }
    speichereSiegel();
    baueNav();
  }

  window.addEventListener('message', function (e) {
    if (!overlayOffen || !rahmen || e.source !== rahmen.contentWindow) { return; }
    if (window.location.origin !== 'null' && e.origin !== window.location.origin) { return; }
    var d = e.data;
    if (!d || typeof d !== 'object') { return; }
    if (d.typ === 'bereit') { ladeBox.textContent = ''; }
    else if (d.typ === 'fehler') { ladeBox.textContent = 'Das Modul konnte nicht geladen werden. ' + (d.text || ''); }
    else if (d.typ === 'xapi') { ereignis(d.statement); }
  });

  function oeffneOverlay(vonElement, modul) {
    if (overlayOffen) { return; }
    overlayOffen = true;
    aktivesModul = modul;
    letzteFolie = 0;
    tasten = {};
    weg = null;
    hoverAus();
    blase = null;
    rueckfokus = vonElement || canvas;
    sitzung += 1;
    overlayTitel.textContent = modul.name;
    zurueckBtn.textContent = 'Zurück zur Halle';
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    ladeBox.textContent = 'Modul wird geladen ...';
    // Jedes Öffnen bekommt einen frischen iframe, so bleibt kein Player-Zustand zurück
    rahmen = document.createElement('iframe');
    rahmen.title = 'Modul: ' + modul.name;
    rahmen.src = PLAYER_SEITE + '?modul=' + encodeURIComponent(modul.pfad);
    rahmen.setAttribute('allowfullscreen', '');
    playerBox.appendChild(rahmen);
    zurueckBtn.focus();
  }

  function schliesseOverlay() {
    if (!overlayOffen) { return; }
    sitzung += 1;
    rahmen = null;
    playerBox.innerHTML = '';
    ladeBox.textContent = '';
    overlay.hidden = true;
    document.body.style.overflow = '';
    overlayOffen = false;
    tasten = {};
    var m = aktivesModul;
    aktivesModul = null;
    ergebnisBox.textContent = m && siegel[m.id] ? ergebnisText(m, siegel[m.id]) : '';
    if (!rueckfokus || !document.contains(rueckfokus)) { rueckfokus = canvas; }
    try { rueckfokus.focus(); } catch (e) { canvas.focus(); }
  }

  zurueckBtn.addEventListener('click', schliesseOverlay);

  // ---------- Skalierung ----------
  // Logische Auflösung B x H (1280 x 720). Logik, Positionen und Kollisionen rechnen in logischen Pixeln.
  // Gezeichnet wird in Bildschirmauflösung: Canvasgröße = CSS-Größe mal devicePixelRatio, Glättung an.
  // Der Faktor ist stufenlos: min(Breite / B, Höhe / H) mit Rand an den Seiten. Fläche = window.innerWidth
  // und window.innerHeight (gilt auch in einem iframe), abzüglich Kopfbereich.
  var faktor = 1;
  var dpr = 1;

  function ctxEinstellen() {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }

  function istVollbild() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  function berechneFaktor(breite, hoehe) {
    return Math.max(0.05, Math.min(breite / B, hoehe / H));
  }

  function skaliere() {
    var voll = istVollbild();
    var kopf = voll ? 0 : buehne.getBoundingClientRect().top + (window.pageYOffset || 0);
    var breite = window.innerWidth - (voll ? 0 : 32);
    var hoehe = window.innerHeight - kopf - (voll ? 0 : 4);
    faktor = berechneFaktor(breite, hoehe);
    dpr = window.devicePixelRatio || 1;
    var cw = Math.floor(B * faktor);
    var ch = Math.floor(H * faktor);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    var pw = Math.max(1, Math.round(cw * dpr));
    var ph = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    ctxEinstellen();
    umrissCache = {};
  }
  window.addEventListener('resize', skaliere);

  // ---------- Einleitung, Hilfe und Vollbild ----------
  // Ablauf: Der Hub lädt. Fehlt der Merker "Einleitung gesehen", öffnet er sofort das Hilfe-Fenster mit dem Modul einleitung-hub.
  // Mit Merker geht es direkt ins Büro. Ein Start-Overlay gibt es nicht. Das Vollbild wird nicht beim Start angefordert,
  // sondern nur über den Vollbild-Knopf oder die Taste F.
  var vollbildBtn = document.getElementById('vollbild');
  var hilfeBtn = document.getElementById('hilfe');

  function vollbildMoeglich() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }

  // Öffnet die Einleitung wie einen Lernpfad. Fehlt das Modul in welt.json, läuft das Büro ohne sie weiter.
  // vonHilfe: Aufruf über den Hilfe-Knopf. Beim ersten Start lässt sich die Einleitung überspringen, das setzt keinen Merker.
  function oeffneEinleitung(vonHilfe) {
    var m = modulMap[EINLEITUNG_ID];
    if (!m) { return; }
    if (overlayOffen || dialogOffen) { return; }
    oeffneOverlay(vonHilfe === true && hilfeBtn ? hilfeBtn : canvas, m);
    zurueckBtn.textContent = vonHilfe === true ? 'Zurück zum Büro' : 'Einleitung überspringen';
  }
  if (hilfeBtn) { hilfeBtn.addEventListener('click', function () { oeffneEinleitung(true); }); }

  function vollbildUmschalten(still) {
    if (!vollbildMoeglich()) { return; }   // kein Fehler: das Büro läuft ohne Vollbild vollständig
    try {
      var p;
      if (istVollbild()) {
        p = (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var el = document.documentElement;
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) { return; }
        p = req.call(el);
      }
      if (p && p.catch) { p.catch(function (e) { if (still !== true) { vollbildFehler(e); } }); }
    } catch (e) { if (still !== true) { vollbildFehler(e); } }
  }

  function vollbildFehler(e) {
    ergebnisBox.textContent = 'Vollbild ist hier nicht möglich' + (e && e.message ? ' (' + e.message + ')' : '') + '.';
    canvas.focus();
  }

  function nachVollbildwechsel() {
    document.body.classList.toggle('vollbild', istVollbild());
    vollbildBtn.textContent = istVollbild() ? 'Vollbild beenden' : 'Vollbild';
    skaliere();
    // Der Tastaturfokus bleibt auf dem Canvas, solange kein Dialog oder Modul offen ist
    if (!overlayOffen && !dialogOffen) { canvas.focus(); }
  }
  document.addEventListener('fullscreenchange', nachVollbildwechsel);
  document.addEventListener('webkitfullscreenchange', nachVollbildwechsel);
  vollbildBtn.addEventListener('click', function () { vollbildUmschalten(); canvas.focus(); });
  // Ohne Vollbild im Browser (zum Beispiel iframe ohne allowfullscreen) verschwinden Knopf und Hinweis auf die Taste F
  if (!vollbildMoeglich()) {
    vollbildBtn.hidden = true;
    var hinweisText = document.getElementById('hinweis');
    if (hinweisText) { hinweisText.textContent = hinweisText.textContent.replace(', F für Vollbild', ''); }
  }

  // ---------- Zeichnen ----------
  function rechteck(r, farbe) {
    ctx.fillStyle = farbe;
    ctx.fillRect(Math.round(r.x), Math.round(r.y), r.w, r.h);
  }

  var SCHRIFT = 'bold 26px sans-serif';   // logische Pixel: bei Faktor 0,75 etwa 19, bei 1,5 etwa 39 Bildschirmpixel
  var ZEILE = 32;

  function text(t, x, y, farbe, ausrichtung, schrift) {
    ctx.font = schrift || SCHRIFT;
    ctx.textBaseline = 'top';
    ctx.textAlign = ausrichtung || 'left';
    ctx.fillStyle = farbe;
    ctx.fillText(t, x, y);
  }

  function umbreche(t, maxBreite) {
    ctx.font = SCHRIFT;
    var woerter = t.split(' ');
    var zeilen = [];
    var z = '';
    for (var i = 0; i < woerter.length; i++) {
      var probe = z ? z + ' ' + woerter[i] : woerter[i];
      if (ctx.measureText(probe).width > maxBreite && z) { zeilen.push(z); z = woerter[i]; } else { z = probe; }
    }
    if (z) { zeilen.push(z); }
    return zeilen;
  }

  function zeichneBlase(t, anker) {
    var zeilen = umbreche(t, 460);
    var breite = 0;
    ctx.font = SCHRIFT;
    for (var i = 0; i < zeilen.length; i++) { breite = Math.max(breite, ctx.measureText(zeilen[i]).width); }
    var bw = Math.ceil(breite) + 32;
    var bh = zeilen.length * ZEILE + 22;
    var bx = anker.x + anker.w / 2 - bw / 2;
    var by = anker.y + anker.h + 22;
    if (by + bh > H - 12) { by = anker.y - bh - 12; }
    bx = Math.max(12, Math.min(B - bw - 12, bx));
    by = Math.max(12, by);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#1f3a5f';
    ctx.lineWidth = 4;
    ctx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
    for (var j = 0; j < zeilen.length; j++) { text(zeilen[j], bx + 16, by + 11 + j * ZEILE, '#1f3a5f'); }
  }

  var TUER_FARBE = { modul: '#3aa860', raum: '#4a7ac0', gesperrt: '#7a7a85' };

  // Text über einem Eintrag beim Hover: Name, bei Modul-Türen mit Siegel auch das Ergebnis
  function beschriftung(e) {
    var t = e.name;
    var z = e.daten.ziel;
    if (e.art === 'tuer' && z && z.typ === 'modul' && siegel[z.id]) { t += ' (' + punkteText(siegel[z.id]) + ')'; }
    return t;
  }

  // Namensschild beim Hover: mittig über dem Objekt, 1 Prozentpunkt über der Oberkante.
  // Ist darüber weniger als 6 Prozentpunkte Platz (oder passt das Schild nicht), steht es 1 Prozentpunkt unter dem Fußpunkt.
  // Würde das Schild so ein anderes Objekt verdecken, wird die andere Seite genommen, wenn dort weniger verdeckt wird.
  function schildMasse(t) {
    var zeilen = umbreche(t, 460);
    var breite = 0;
    ctx.font = SCHRIFT;
    for (var i = 0; i < zeilen.length; i++) { breite = Math.max(breite, ctx.measureText(zeilen[i]).width); }
    return { zeilen: zeilen, w: Math.ceil(breite) + 32, h: zeilen.length * ZEILE + 22 };
  }

  function andereObjekte(id) {
    var liste = [];
    var eigen = moebelMap[id];
    var traeger = eigen && eigen.bezug && eigen.bezug.moebel;   // Was auf einem Tisch steht, darf den Tisch überdecken
    raumMoebel(raum).forEach(function (mid) {
      var m = moebelMap[mid];
      if (!m || !m.sprite || m.id === id || m.id === traeger || m.art === 'teppich') { return; }
      liste.push({ id: m.id, rect: moebelGeometrie(m).rect });
    });
    (raum.tueren || []).forEach(function (t) { if (t.id !== id && t.sichtbar !== false) { liste.push({ id: t.id, rect: t }); } });
    return liste;
  }

  function ueberlappFlaeche(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function schildPlatz(e) {
    var s = schildMasse(beschriftung(e));
    var r = e.rect;
    var abstand = H / 100;
    var x = Math.max(12, Math.min(B - s.w - 12, r.x + r.w / 2 - s.w / 2));
    var oben = { y: r.y - abstand - s.h, oben: true };
    var unten = { y: r.y + r.h + abstand, oben: false };
    var obenKlemmt = { y: 4, oben: true };   // letzter Ausweg: ganz oben am Bildrand, deckt dann den oberen Rand des eigenen Objekts
    var platzOben = r.y - abstand;
    var obenZuerst = platzOben >= Math.max(6 / 100 * H, s.h) && oben.y >= 4;
    var seiten = obenZuerst ? [oben, unten, obenKlemmt] : [unten, oben, obenKlemmt];
    var andere = andereObjekte(e.id);
    function verdeckt(sr) {
      var summe = 0;
      var namen = [];
      andere.forEach(function (o) { var f = ueberlappFlaeche(sr, o.rect); if (f > 0) { summe += f; namen.push(o.id); } });
      return { flaeche: summe, namen: namen };
    }
    // Je Seite zuerst mittig, dann um 1, 2, ... Prozentpunkte seitlich verschoben. Das erste Schild ohne Überdeckung gewinnt.
    var verschiebungen = [0];
    for (var k = 1; k <= 10; k++) { verschiebungen.push(-k * B / 100, k * B / 100); }
    // Kosten ohne Überdeckung: seitliche Verschiebung in Prozentpunkten plus Zuschlag für die zweite (4) und dritte Seite (10)
    var zuschlag = [0, 4, 10];
    var beste = null;
    var besteKosten = Infinity;
    for (var si = 0; si < seiten.length; si++) {
      var sd = seiten[si];
      if (sd.y < 4 - 1e-6 || sd.y + s.h > H - 4 + 1e-6) { continue; }
      for (var vi = 0; vi < verschiebungen.length; vi++) {
        var sx = Math.max(12, Math.min(B - s.w - 12, r.x + r.w / 2 - s.w / 2 + verschiebungen[vi]));
        var sr = { x: sx, y: sd.y, w: s.w, h: s.h };
        var v = verdeckt(sr);
        var kosten = Math.abs(verschiebungen[vi]) / B * 100 + zuschlag[si] + (v.flaeche > 0 ? 1e6 + v.flaeche : 0);
        if (kosten < besteKosten) {
          besteKosten = kosten;
          beste = { rect: sr, zeilen: s.zeilen, verdeckt: v.namen, oben: sd.oben };
        }
      }
    }
    return beste || { rect: { x: x, y: unten.y, w: s.w, h: s.h }, zeilen: s.zeilen, verdeckt: [], oben: false };
  }

  function zeichneSchild(e) {
    var p = schildPlatz(e);
    var bx = p.rect.x;
    var by = p.rect.y;
    var bw = p.rect.w;
    var bh = p.rect.h;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#1f3a5f';
    ctx.lineWidth = 4;
    ctx.strokeRect(bx + 2, by + 2, bw - 4, bh - 4);
    for (var j = 0; j < p.zeilen.length; j++) { text(p.zeilen[j], bx + 16, by + 11 + j * ZEILE, '#1f3a5f'); }
  }

  function zeichneBoden() {
    if (raum.hintergrund_farbe) {
      ctx.fillStyle = raum.hintergrund_farbe;
      ctx.fillRect(0, 0, B, H);
    }
    var bild = hintergrundBild(raum);
    if (bild) { ctx.drawImage(bild, 0, 0, B, H); return; }
    var f1 = typeof raum.hintergrund === 'string' && raum.hintergrund.charAt(0) === '#' ? raum.hintergrund : '#cdbf9f';
    var f2 = raum.hintergrund2;
    for (var y = 0; y < H; y += 12) {
      for (var x = 0; x < B; x += 12) {
        ctx.fillStyle = (f2 && ((x + y) / 12) % 2 !== 0) ? f2 : f1;
        ctx.fillRect(x, y, 12, 12);
      }
    }
  }

  // Zeichenliste des Raums. z kleiner 0 ist Hintergrund und kommt zuerst (nach z).
  // Alles andere wird mit der Figur nach der Fuß-y sortiert (untere Kante y + h),
  // bei Gleichstand nach z (Standard 0, Türen 2), dann in Reihenfolge der Daten.
  function zeichenliste() {
    var liste = [];
    var n = 0;
    function add(r, z, art) {
      if (r.farbe || art === 'tuer') { liste.push({ r: r, z: z, n: n++, art: art, fy: r.y + r.h, boden: z < 0 }); }
    }
    (raum.kollision || []).forEach(function (r) { add(r, r.z || 0, 'rect'); });
    (raum.objekte || []).forEach(function (r) { add(r, r.z || 0, 'rect'); });
    (raum.tueren || []).forEach(function (r) { if (r.sichtbar !== false) { add(r, typeof r.z === 'number' ? r.z : 2, 'tuer'); } });
    // Möbel: Wandobjekte gehören zum Hintergrund (nach dem Bild, vor allem anderen),
    // Bodenobjekte werden mit der Figur nach der Fuß-y sortiert (sort_y überschreibt, zum Beispiel für das Telefon auf dem Tisch)
    raumMoebel(raum).forEach(function (id) {
      var m = moebelMap[id];
      if (!m || !m.sprite) { return; }
      var teppich = m.art === 'teppich';
      var wand = m.art === 'wand' || teppich;
      liste.push({ art: 'moebel', m: m, z: teppich ? -1.5 : (wand ? -0.5 : 0), n: n++, fy: moebelSortY(m), boden: wand });
    });
    liste.push({ art: 'figur', z: 1, n: n++, fy: fussPunkt().y, boden: false });
    liste.sort(function (a, b) {
      if (a.boden !== b.boden) { return a.boden ? -1 : 1; }
      if (a.boden) { return a.z - b.z || a.n - b.n; }
      return a.fy - b.fy || a.z - b.z || a.n - b.n;
    });
    return liste;
  }

  // Möbel mit hoch bekommen eine Platzhalter-Höhe über der Grundfläche
  function zeichneRechteck(r) {
    if (r.hoch) {
      rechteck({ x: r.x, y: r.y - r.hoch, w: r.w, h: r.hoch }, r.farbe);
      rechteck({ x: r.x, y: r.y - r.hoch, w: r.w, h: r.hoch }, 'rgba(255,255,255,0.18)');
    }
    rechteck(r, r.farbe);
  }

  function zeichneMoebel(m) {
    var g = moebelGeometrie(m);
    var bild = moebelBild(m);
    if (bild) {
      ctx.drawImage(bild, g.rect.x, g.rect.y, g.rect.w, g.rect.h);
    } else if (moebelBilder[m.id] && moebelBilder[m.id].fehler) {
      rechteck(g.rect, '#9a9aa4');
    }
  }

  // Figur: weicher Bodenschatten, dann das Sprite (glatt auf die Tiefenhöhe skaliert), optional mit Cremerand (Offscreen-Canvas).
  // Der Umriss wird für quantisierte Höhen zwischengespeichert und beim Zeichnen auf die genaue Höhe skaliert.
  var umrissCache = {};

  // Sprite-Höhe in Sheet-Pixeln, die der Figurhöhe h(y) entspricht: massstab_hoehe (sichtbare Höhe von idle_sued Frame 0),
  // alte GIF-Fassung: animationen.gehen.hoehe
  function basisHoehe() {
    if (figur && figur.massstab_hoehe) { return figur.massstab_hoehe; }
    var g = figur && figur.animationen && figur.animationen.gehen;
    return (g && g.hoehe) || 48;
  }

  // Fußpunkt [x, y] des aktuellen Frames in Sheet-Pixeln: je Frame (Liste von Paaren) oder ein Wert je Zeile
  function fussImFrame(a, zi) {
    var f = a.zeilen[zi].fuss;
    if (!f) { return [a.frame_b / 2, a.frame_h - 1]; }
    return Array.isArray(f[0]) ? f[fz.frame % f.length] : f;
  }

  function umrissFrame(a, s, zi, h) {
    var qh = Math.max(24, Math.round(h / 8) * 8);
    var schluessel = fz.anim + '|' + zi + '|' + fz.frame + '|' + qh;
    var c = umrissCache[schluessel];
    if (c) { return c; }
    var k = qh / basisHoehe() * faktor * dpr;                  // Sprite-Pixel zu Bildschirmpixeln
    var r = Math.max(1, Math.round(UMRISS.breite * qh / (FIG.oben * tuerHoehe()) * faktor * dpr));
    var w = Math.ceil(a.frame_b * k) + 2 * r;
    var hh = Math.ceil(a.frame_h * k) + 2 * r;
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = hh;
    var t2 = tmp.getContext('2d');
    t2.imageSmoothingEnabled = !PIXEL;   // Pixel-Art ohne Glättung
    t2.imageSmoothingQuality = 'high';
    t2.drawImage(s.img, fz.frame * a.frame_b, zi * a.frame_h, a.frame_b, a.frame_h, r, r, a.frame_b * k, a.frame_h * k);
    var sil = document.createElement('canvas');
    sil.width = w;
    sil.height = hh;
    var t3 = sil.getContext('2d');
    t3.drawImage(tmp, 0, 0);
    t3.globalCompositeOperation = 'source-in';
    t3.fillStyle = UMRISS.farbe;
    t3.fillRect(0, 0, w, hh);
    var aus = document.createElement('canvas');
    aus.width = w;
    aus.height = hh;
    var t4 = aus.getContext('2d');
    var schritte = 24;
    for (var i = 0; i < schritte; i++) {
      var ang = i * 2 * Math.PI / schritte;
      t4.drawImage(sil, Math.cos(ang) * r, Math.sin(ang) * r);
    }
    t4.drawImage(tmp, 0, 0);
    c = { c: aus, r: r, w: w, h: hh, qh: qh };
    umrissCache[schluessel] = c;
    return c;
  }

  function zeichneFigur() {
    var p = fussPunkt();
    var fx = p.x;
    var fy = p.y;
    var fh = figHoehe(fy);
    if (SCHATTEN) {
      var rx = SCHATTEN.rx * fh;
      var ry = SCHATTEN.ry * fh;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.scale(1, ry / rx);
      var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      var rgb = SCHATTEN.farbe.replace('#', '');
      var rr = parseInt(rgb.substr(0, 2), 16), gg = parseInt(rgb.substr(2, 2), 16), bb = parseInt(rgb.substr(4, 2), 16);
      gr.addColorStop(0, 'rgba(' + rr + ',' + gg + ',' + bb + ',' + SCHATTEN.deckkraft + ')');
      gr.addColorStop(0.65, 'rgba(' + rr + ',' + gg + ',' + bb + ',' + (SCHATTEN.deckkraft * 0.7) + ')');
      gr.addColorStop(1, 'rgba(' + rr + ',' + gg + ',' + bb + ',0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }
    var a = figur && figur.animationen && figur.animationen[fz.anim];
    var s = sheets[fz.anim];
    var zi = zeilenIndex[fz.anim] ? zeilenIndex[fz.anim][fz.zeile] : undefined;
    if (a && s && s.ok && typeof zi === 'number') {
      var sk = fh / basisHoehe();
      var fuss = fussImFrame(a, zi);
      ctx.imageSmoothingEnabled = !PIXEL;   // Pixel-Art: wie image-rendering: pixelated
      if (UMRISS.an) {
        var u = umrissFrame(a, s, zi, fh);
        var f2 = faktor * dpr;
        var q = fh / u.qh;   // genaue Höhe zu Cache-Höhe
        ctx.drawImage(u.c, fx - fuss[0] * sk - u.r / f2 * q, fy - fuss[1] * sk - u.r / f2 * q, u.w / f2 * q, u.h / f2 * q);
      } else {
        ctx.drawImage(s.img, fz.frame * a.frame_b, zi * a.frame_h, a.frame_b, a.frame_h,
          fx - fuss[0] * sk, fy - fuss[1] * sk, a.frame_b * sk, a.frame_h * sk);
      }
      ctx.imageSmoothingEnabled = true;
      return;
    }
    // Platzhalter, wenn figur.json oder ein Sheet fehlt
    rechteck({ x: fx - fh * 0.15, y: fy - fh, w: fh * 0.3, h: fh }, '#f08a3c');
  }

  var vordergrundGemeldet = {};
  function vordergrundBild(r) {
    var v = r.vordergrund;
    if (typeof v !== 'string' || !v) { return null; }
    if (!bilder[v]) {
      var img = new Image();
      img.onerror = function () {
        img.fehler = true;
        if (!vordergrundGemeldet[v]) { vordergrundGemeldet[v] = true; console.error('Vordergrund "' + v + '" von Raum "' + r.id + '" fehlt oder lädt nicht.'); }
      };
      img.src = v;
      bilder[v] = img;
    }
    var b = bilder[v];
    return b.complete && !b.fehler && b.naturalWidth ? b : null;
  }

  function zeichneTuer(t, jetzt) {
    var typ = (t.ziel || {}).typ;
    rechteck(t, t.farbe || TUER_FARBE[typ] || '#7a7a85');
    rechteck({ x: t.x + 3, y: t.y + 3, w: t.w - 6, h: t.h - 3 }, 'rgba(0,0,0,0.22)');
    if (typ === 'gesperrt') {
      rechteck({ x: t.x + t.w / 2 - 3, y: t.y + 8, w: 6, h: 5 }, '#d9534f');
    }
    if (typ === 'modul' && siegel[t.ziel.id]) {
      var glanz = !reduziert && Math.floor(jetzt / 500) % 2 === 0;
      rechteck({ x: t.x + t.w - 8, y: t.y + 2, w: 7, h: 7 }, '#8a6a12');
      rechteck({ x: t.x + t.w - 7, y: t.y + 3, w: 5, h: 5 }, glanz ? '#ffe27a' : '#f2b84b');
    }
  }

  function zeichne(jetzt, alpha) {
    var i;
    // logische Pixel auf den Canvas in Bildschirmauflösung abbilden
    ctx.setTransform(canvas.width / B, 0, 0, canvas.height / H, 0, 0);
    ctxEinstellen();
    if (!raum) {
      ctx.fillStyle = '#2b2833';
      ctx.fillRect(0, 0, B, H);
      return;
    }
    zeichneBoden();
    var liste = zeichenliste();
    var markerGezeichnet = false;
    for (i = 0; i < liste.length; i++) {
      // Zielmarker liegt auf dem Boden: nach dem Hintergrund, vor allem anderen
      if (!liste[i].boden && !markerGezeichnet) { zeichneMarker(jetzt); markerGezeichnet = true; }
      if (liste[i].art === 'tuer') { zeichneTuer(liste[i].r, jetzt); }
      else if (liste[i].art === 'figur') { zeichneFigur(); }
      else if (liste[i].art === 'moebel') { zeichneMoebel(liste[i].m); }
      else { zeichneRechteck(liste[i].r); }
    }
    var vorne = vordergrundBild(raum);
    if (vorne) { ctx.drawImage(vorne, 0, 0, B, H); }

    // Hinweis und Sprechblase
    var ziel = ueberblendung ? null : aktuellesZiel();
    if (blase && jetzt > blase.bis) { blase = null; }
    if (blase) {
      zeichneBlase(blase.text, blase.rect);
    } else if (hoverId) {
      for (i = 0; i < INTERAKTIV.length; i++) {
        if (INTERAKTIV[i].id === hoverId) { zeichneSchild(INTERAKTIV[i]); }
      }
    } else if (ziel) {
      zeichneBlase('Leertaste', ziel.rect);
    }

    if (DEBUG) { zeichneDebug(); }

    // Überblendung beim Raumwechsel
    if (alpha > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, B, H);
    }
  }

  // Zielmarker am Fußpunkt des Ziels (bei reduzierter Bewegung ohne Pulsieren)
  function zeichneMarker(jetzt) {
    if (weg && weg.ziel) {
      var mx = weg.ziel.x;
      var my = weg.ziel.y;
      var gr = (reduziert || Math.floor(jetzt / 350) % 2 === 0) ? 11 : 14;
      ctx.fillStyle = 'rgba(31,58,95,0.35)';
      ctx.beginPath();
      ctx.ellipse(mx, my, gr * 1.6, gr * 0.8, 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#1f3a5f';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }

  // Nur mit ?debug=1: Kollision, Zonen, Weg, Fußbox, Fußpunkt, Richtung, Animation, Frame
  function zeichneDebug() {
    var i;
    ctx.lineWidth = 2;
    // begehbares Polygon
    if (raum.begehbar) {
      ctx.strokeStyle = 'rgba(40,200,80,0.95)';
      ctx.beginPath();
      for (i = 0; i < raum.begehbar.length; i++) { ctx.lineTo(raum.begehbar[i][0], raum.begehbar[i][1]); }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,40,40,0.95)';
    for (i = 0; i < KOLLISION.length; i++) {
      ctx.strokeRect(KOLLISION[i].x, KOLLISION[i].y, KOLLISION[i].w, KOLLISION[i].h);
    }
    ctx.strokeStyle = 'rgba(40,140,255,0.95)';
    for (i = 0; i < INTERAKTIV.length; i++) {
      var z = INTERAKTIV[i].zone;
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
    if (weg) {
      // Rohweg aus dem Raster (blass) und vereinfachter Weg (kräftig), jeweils durch die Mitte der Fußbox
      var ox = 0;
      var oy = 0;
      ctx.strokeStyle = 'rgba(0,200,200,0.8)';
      ctx.beginPath();
      for (i = 0; i < weg.roh.length; i++) { ctx.lineTo(weg.roh[i].x + ox, weg.roh[i].y + oy); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,0,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(spieler.fx + ox, spieler.fy + oy);
      for (i = weg.i; i < weg.punkte.length; i++) { ctx.lineTo(weg.punkte[i].x + ox, weg.punkte[i].y + oy); }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,0,0.95)';
    ctx.strokeRect(spieler.x, spieler.y, spieler.w, spieler.h);
    var fp = fussPunkt();
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(fp.x - 8, fp.y - 1, 16, 2);
    ctx.fillRect(fp.x - 1, fp.y - 8, 2, 16);
    // Höhen in logischen Pixeln: jedes Möbelstück und die Figur
    ctx.font = 'bold 20px monospace';
    raumMoebel(raum).forEach(function (id) {
      var m = moebelMap[id];
      if (!m || !m.sprite) { return; }
      var r = moebelGeometrie(m).rect;
      var beschr = 'H ' + Math.round(r.h) + ' B ' + Math.round(r.w);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(r.x, r.y + 2, ctx.measureText(beschr).width + 10, 24);
      text(beschr, r.x + 5, r.y + 4, '#ffff66', 'left', 'bold 20px monospace');
    });
    var figh = figHoehe(fp.y);
    var figt = 'Figur H ' + Math.round(figh);
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(fp.x - 60, fp.y - figh - 28, ctx.measureText(figt).width + 10, 24);
    text(figt, fp.x - 55, fp.y - figh - 26, '#7dff7d', 'left', 'bold 20px monospace');
    var info = 'Faktor ' + faktor.toFixed(2) + ' | moebel_skala ' + SKALA + ' | figur ' + FIG.oben + '/' + FIG.unten + ' | Richtung ' + fz.richtung + ' | ' + fz.anim + ' ' + fz.zeile + ' | Frame ' + fz.frame;
    ctx.font = 'bold 22px monospace';
    var bw = Math.ceil(ctx.measureText(info).width) + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(6, H - 40, bw, 32);
    text(info, 14, H - 36, '#ffff66', 'left', 'bold 22px monospace');
  }

  // ---------- Weg ablaufen ----------
  // Gleiche Bewegung und gleiche Kollisionsprüfung wie bei der Tastatur, die Figur wird nie versetzt.
  function folgeWeg(dt) {
    var p = weg.punkte[weg.i];
    if (!p) { ankunft(); return; }
    var vx = p.x - spieler.fx;
    var vy = p.y - spieler.fy;
    var laenge = Math.sqrt(vx * vx + vy * vy);
    if (laenge < 1e-7) {
      weg.i += 1;
      if (weg.i >= weg.punkte.length) { ankunft(); }
      return;
    }
    var s = Math.min(tempoBei(spieler.fy) * dt, laenge);
    var ax = spieler.fx;
    var ay = spieler.fy;
    bewegeVektor(vx / laenge * s, vy / laenge * s);
    var bewegt = Math.sqrt(Math.pow(spieler.fx - ax, 2) + Math.pow(spieler.fy - ay, 2));
    if (s > 0 && bewegt < s * 0.25) {
      weg.steckt += dt;
      if (weg.steckt > 0.5) {
        weg = null;
        sprich('Hier komme ich nicht weiter.', figurRect());
      }
    } else {
      weg.steckt = 0;
    }
  }

  function ankunft() {
    var aktionId = weg && weg.aktion;
    weg = null;
    if (aktionId) {
      var z = aktuellesZiel();
      if (z && z.id === aktionId) { drehZu(z); bediene(z); }
    }
  }

  // ---------- Schleife ----------
  var letzte = 0;
  function schleife(jetzt) {
    var dt = Math.min(0.05, (jetzt - (letzte || jetzt)) / 1000);
    letzte = jetzt;
    var alpha = 0;
    var vorX = spieler.fx;
    var vorY = spieler.fy;
    var vorRaum = raum;
    if (ueberblendung) {
      if (ueberblendung.t0 === null) { ueberblendung.t0 = jetzt; }
      var p = (jetzt - ueberblendung.t0) / ueberblendung.dauer;
      if (p >= 0.5 && !ueberblendung.gewechselt) {
        ueberblendung.gewechselt = true;
        ladeRaum(ueberblendung.id, ueberblendung.spawn);
      }
      alpha = p < 0.5 ? p * 2 : 2 - 2 * p;
      if (p >= 1) { ueberblendung = null; alpha = 0; fokusNachRaumwechsel(); }
    } else if (raum && !overlayOffen) {
      var dx = (tasten.rechts ? 1 : 0) - (tasten.links ? 1 : 0);
      var dy = (tasten.runter ? 1 : 0) - (tasten.hoch ? 1 : 0);
      if (dx || dy) {
        weg = null;
        var l = dx && dy ? Math.SQRT1_2 : 1;
        bewegeVektor(dx * l * tempoBei(spieler.fy) * dt, dy * l * tempoBei(spieler.fy) * dt);
      } else if (weg) {
        folgeWeg(dt);
      }
    }
    // Ein Raumwechsel ist keine Bewegung
    if (raum === vorRaum) { aktualisiereFigur(jetzt, spieler.fx - vorX, spieler.fy - vorY); } else { aktualisiereFigur(jetzt, 0, 0); }
    zeichne(jetzt, Math.max(0, Math.min(1, alpha)));
    window.requestAnimationFrame(schleife);
  }

  // ---------- Start: welt.json laden ----------
  function init(w) {
    if (!w || !Array.isArray(w.raeume) || !w.raeume.length) { throw new Error('welt.json enthält keine Räume.'); }
    welt = w;
    if (w.groesse) { B = w.groesse.b; H = w.groesse.h; }
    w.raeume.forEach(function (r) { raeume[r.id] = r; });
    (w.module || []).forEach(function (m) { modulMap[m.id] = m; });
    if (!raeume[w.start]) { throw new Error('Der Startraum "' + w.start + '" gibt es nicht.'); }
    ladeSiegel();
    ladeMerker();
    skaliere();
    ladeRaum(w.start, null);
    ergebnisBox.textContent = '';
    if (!einleitungGesehen) { oeffneEinleitung(false); }

    if (DEBUG) {
      // Nur für Tests mit ?debug=1: Lesezugriff auf den Zustand
      window.pixelbuero = {
        spieler: spieler,
        canvas: canvas,
        zustand: function () {
          return {
            x: spieler.fx, y: spieler.fy, raum: raum && raum.id,
            weg: weg ? { n: weg.punkte.length, ziel: weg.ziel, aktion: weg.aktion } : null,
            hover: hoverId, overlay: overlayOffen, dialog: dialogOffen, ueberblendung: !!ueberblendung,
            modul: aktivesModul && aktivesModul.id,
            nav: [].slice.call(navListe.querySelectorAll('li')).map(function (li) { return li.textContent; }),
            navTitel: navTitel.textContent,
            figur: { richtung: fz.richtung, anim: fz.anim, zeile: fz.zeile, frame: fz.frame, fuss: fussPunkt(),
              sheets: Object.keys(sheets).map(function (k) { return k + ':' + (sheets[k].ok ? 'ok' : (sheets[k].fehler ? 'fehler' : 'laedt')); }) }
          };
        },
        // Läuft einen Klick ohne Zeitverlauf durch (Schritte zu 1/60 s). Setzt die Figur um, nur für Tests.
        simuliere: function (sx, sy, tx, ty, objektId) {
          setzeFuss(sx, sy);
          blase = null;
          var o = null;
          for (var i = 0; i < INTERAKTIV.length; i++) { if (INTERAKTIV[i].id === objektId) { o = INTERAKTIV[i]; } }
          klickZiel({ x: tx, y: ty }, o);
          var plan = weg ? { punkte: weg.punkte.slice(), roh: weg.roh.length } : null;
          var n = 0;
          while (weg && n < 6000) { folgeWeg(1 / 60); n += 1; }
          return {
            schritte: n, x: spieler.fx, y: spieler.fy, hinweis: blase ? blase.text : null,
            ueberlagert: overlayOffen, dialog: dialogOffen, modul: aktivesModul && aktivesModul.id, plan: plan,
            wechselt: ueberblendung ? ueberblendung.id : null
          };
        },
        // Lage des Namensschilds eines Objekts (Rechteck, oben oder unten, Liste der verdeckten Objekte)
        schild: function (id) {
          for (var i = 0; i < INTERAKTIV.length; i++) { if (INTERAKTIV[i].id === id) { var p = schildPlatz(INTERAKTIV[i]); return { rect: p.rect, oben: p.oben, verdeckt: p.verdeckt, objekt: INTERAKTIV[i].rect }; } }
          return null;
        },
        schliesse: function () { schliesseOverlay(); },
        setzeRaum: function (id) { ueberblendung = null; ladeRaum(id, null); },
        fertig: function () {
          if (ueberblendung) {
            if (!ueberblendung.gewechselt) { ladeRaum(ueberblendung.id, ueberblendung.spawn); }
            ueberblendung = null;
          }
        },
        merker: function () { return einleitungGesehen; },
        faktor: function () { return { faktor: faktor, dpr: dpr, canvas: canvas.width + ' x ' + canvas.height, css: canvas.style.width + ' x ' + canvas.style.height, innen: window.innerWidth + ' x ' + window.innerHeight, vollbild: istVollbild() }; },
        berechneFaktor: berechneFaktor,
        gehbar: function (x, y) { return frei(x, y); },
        groessen: function () {
          var o = { figur_oben: figHoehe((raum.wandlinie || 0)), figur_unten: figHoehe(raum.boden_unten || H), moebel_skala: SKALA, moebel: {} };
          raumMoebel(raum).forEach(function (id) { var r = moebelGeometrie(moebelMap[id]).rect; o.moebel[id] = { h: r.h, b: r.w, fuss: moebelFuss(moebelMap[id]) }; });
          return o;
        }
      };
    }
    window.requestAnimationFrame(schleife);
  }

  ergebnisBox.textContent = 'Halle wird geladen ...';
  // figur.json ist optional: fehlt sie, läuft die Halle mit dem farbigen Rechteck weiter
  var figurLaden = fetch(FIGUR_PFAD, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.json();
  }).then(ladeFigur).catch(function (err) {
    console.error('Figur: ' + FIGUR_PFAD + ' fehlt oder ist fehlerhaft (' + (err && err.message ? err.message : err) + '). Es bleibt das farbige Rechteck.');
  });
  // moebel.json ist optional: ohne die Datei hat der Raum keine Möbel, die Halle läuft weiter
  var moebelLaden = fetch(MOEBEL_PFAD, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.json();
  }).then(ladeMoebel).catch(function (err) {
    console.error('Möbel: ' + MOEBEL_PFAD + ' fehlt oder ist fehlerhaft (' + (err && err.message ? err.message : err) + '). Der Raum hat keine Möbel.');
  });
  var referenzLaden = fetch(REFERENZ_PFAD, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) { throw new Error('HTTP ' + r.status); }
    return r.json();
  }).then(ladeReferenz).catch(function (err) {
    console.error('Referenz: ' + REFERENZ_PFAD + ' fehlt oder ist fehlerhaft (' + (err && err.message ? err.message : err) + '). Möbelgrößen und Figurhöhe sind nicht berechenbar.');
  });
  Promise.all([moebelLaden, referenzLaden, fetch(WELT_PFAD, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) { throw new Error(WELT_PFAD + ' nicht gefunden (HTTP ' + r.status + ').'); }
    return r.json();
  }), figurLaden]).then(function (e) { init(e[2]); }).catch(function (err) {
    var m = err && err.message ? err.message : String(err);
    if (window.location.protocol === 'file:') { m += ' Die Seite muss über einen Server geöffnet werden (python -m http.server), nicht per Doppelklick.'; }
    ergebnisBox.textContent = 'Die Halle konnte nicht geladen werden: ' + m;
  });
})();
