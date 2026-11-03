// Pixelbüro Hub, Prototyp mit Platzhaltern. Eigener Code mit Canvas, keine Engine.
// Räume, Türen, Objekte und Module kommen aus daten/welt.json.
(function () {
  'use strict';

  var B = 320;
  var H = 180;
  var PARAMS = new URLSearchParams(window.location.search);
  var DEBUG = PARAMS.get('debug') === '1';

  // Pfade relativ zu site/index.html
  var WELT_PFAD = 'daten/welt.json';
  var PLAYER_SEITE = 'player.html';
  var SPEICHER_KEY = 'pixelbuero.siegel.v2';
  var UEBERBLENDUNG_MS = 500;

  var canvas = document.getElementById('halle');
  var ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var ergebnisBox = document.getElementById('ergebnis');
  var overlay = document.getElementById('overlay');
  var overlayTitel = document.getElementById('overlay-titel');
  var playerBox = document.getElementById('player');
  var ladeBox = document.getElementById('lade');
  var zurueckBtn = document.getElementById('zurueck');
  var navListe = document.getElementById('tuerliste');
  var navTitel = document.getElementById('nav-titel');

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

  var spieler = { x: 0, y: 0, w: 10, h: 12 };
  var TEMPO = 62; // Pixel pro Sekunde

  function zone(r, rand) { return { x: r.x - rand, y: r.y - rand, w: r.w + 2 * rand, h: r.h + 2 * rand }; }

  // Berührung zählt nicht als Überlappung. Die kleine Toleranz fängt Rundungsfehler ab,
  // damit die Figur an einer Kante entlang gehen kann, ohne hängen zu bleiben.
  var EPS = 1e-6;
  function schneidet(a, b) {
    return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
  }

  // Bewegung getrennt nach Achsen: erst x, dann y. Bei Treffer wird an die Kante des
  // getroffenen Rechtecks gesetzt, so bleibt die Figur an Wänden nicht hängen.
  function bewege(dx, dy) {
    var i, r;
    spieler.x += dx;
    for (i = 0; i < KOLLISION.length; i++) {
      r = KOLLISION[i];
      if (schneidet(spieler, r)) {
        spieler.x = dx > 0 ? r.x - spieler.w : r.x + r.w;
      }
    }
    spieler.y += dy;
    for (i = 0; i < KOLLISION.length; i++) {
      r = KOLLISION[i];
      if (schneidet(spieler, r)) {
        spieler.y = dy > 0 ? r.y - spieler.h : r.y + r.h;
      }
    }
  }

  // ---------- Wegfindung (Raster, A*) ----------
  // Jede Zelle (4 Pixel) steht für eine mögliche Position der linken oberen Ecke der Figur.
  // Gehbar ist sie, wenn die Figur dort kein Kollisionsrechteck berührt. Diagonale Schritte
  // sind nur erlaubt, wenn beide Nachbarzellen daneben gehbar sind (keine Ecken schneiden).
  // Das Raster wird bei jedem Raumwechsel aus den Daten des Raums neu gebaut.
  var ZELLE = 4;
  var GW = B / ZELLE;
  var GH = H / ZELLE;
  var gitter = [];
  var RICHT = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  function frei(x, y) {
    if (x < 0 || y < 0 || x + spieler.w > B || y + spieler.h > H) { return false; }
    var r = { x: x, y: y, w: spieler.w, h: spieler.h };
    for (var i = 0; i < KOLLISION.length; i++) {
      if (schneidet(r, KOLLISION[i])) { return false; }
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
    var bx = Math.round(spieler.x / ZELLE);
    var by = Math.round(spieler.y / ZELLE);
    var beste = -1;
    var bestD = Infinity;
    for (var j = by - 6; j <= by + 6; j++) {
      for (var i = bx - 6; i <= bx + 6; i++) {
        if (!gehbar(i, j)) { continue; }
        var d = Math.pow(i * ZELLE - spieler.x, 2) + Math.pow(j * ZELLE - spieler.y, 2);
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
        var z = aktuellesZiel({ x: pt.x, y: pt.y, w: spieler.w, h: spieler.h });
        if (z && z.id === o.id) { liste.push(idx); }
      }
      objektZellen[o.id] = liste;
    }
    return objektZellen[o.id];
  }

  // Plant einen Weg zu einem Wunschpunkt (linke obere Ecke der Figur) oder zu einem Objekt.
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
    var glatt = vereinfache([{ x: spieler.x, y: spieler.y }].concat(punkte)).slice(1);
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
        INTERAKTIV.push({ id: o.id, art: 'objekt', name: o.name || o.id, rect: o, zone: zone(o, o.zone || 6), daten: o });
      }
    }
    var tueren = r.tueren || [];
    for (i = 0; i < tueren.length; i++) {
      var t = tueren[i];
      INTERAKTIV.push({ id: t.id, art: 'tuer', name: t.name, rect: t, zone: zone(t, t.zone || 8), daten: t });
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
    spieler.x = s.x;
    spieler.y = s.y;
    weg = null;
    blase = null;
    hoverAus();
    tasten = {};
    baueNav();
    canvas.setAttribute('aria-label', 'Pixelbüro, Raum ' + r.name + '. Die Türen sind auch in der Liste unter der Halle erreichbar.');
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

  function baueNav() {
    navTitel.textContent = 'Türen in diesem Raum: ' + raum.name;
    navListe.innerHTML = '';
    INTERAKTIV.forEach(function (e) {
      if (e.art !== 'tuer') { return; }
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + e.id;
      a.textContent = e.name;
      if ((e.daten.ziel || {}).typ === 'gesperrt') { a.setAttribute('aria-disabled', 'true'); }
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        bediene(e, a);
      });
      li.appendChild(a);
      li.appendChild(document.createTextNode(' ' + ziellabel(e.daten)));
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
    if (overlayOffen) {
      if (e.key === 'Escape') { schliesseOverlay(); e.preventDefault(); }
      return; // sonst ignoriert die Halle alle Tasten
    }
    if (e.ctrlKey || e.metaKey || e.altKey) { return; }
    if (inBedienelement(e.target)) { return; }
    var n = tastenName(e);
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
    if (z) { bediene(z); }
  }

  // Löst die Interaktion eines Eintrags (Tür oder Objekt) aus
  function bediene(e, vonElement) {
    if (e.art === 'objekt') {
      sprich(e.daten.text || e.name, e.rect);
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
      var r = zone(o.rect, 3);
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) { return o; }
    }
    return null;
  }

  function klickZiel(p, o) {
    weg = null;
    if (o) {
      var jetzt = aktuellesZiel();
      if (jetzt && jetzt.id === o.id) { bediene(o); return; }
      weg = planeWeg(null, o);
      if (!weg) { sprich('Da komme ich nicht hin.', spieler); }
      return;
    }
    weg = planeWeg({ x: p.x - spieler.w / 2, y: p.y - spieler.h / 2 }, null);
    if (!weg) { sprich('Da komme ich nicht hin.', spieler); return; }
    if (!weg.punkte.length) {
      weg = null;
      var dx = p.x - (spieler.x + spieler.w / 2);
      var dy = p.y - (spieler.y + spieler.h / 2);
      if (Math.sqrt(dx * dx + dy * dy) > 10) { sprich('Da komme ich nicht hin.', spieler); }
    }
  }

  canvas.style.touchAction = 'manipulation';

  canvas.addEventListener('pointerdown', function (e) {
    if (overlayOffen || !raum || ueberblendung) { return; }
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
    if (overlayOffen || !raum || ueberblendung || e.pointerType !== 'mouse') { hoverAus(); return; }
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
  function ereignis(s) {
    if (!s || !s.verb || !s.verb.id || !aktivesModul) { return; }
    if (s.verb.id.split('/').pop() !== 'completed') { return; }
    // Nur das Hauptobjekt zählt, Unterinhalte tragen subContentId in der Objekt-ID
    var oid = (s.object && s.object.id) || '';
    if (oid.indexOf('subContentId=') !== -1) { return; }
    var m = aktivesModul;
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
    tasten = {};
    weg = null;
    hoverAus();
    blase = null;
    rueckfokus = vonElement || canvas;
    sitzung += 1;
    overlayTitel.textContent = modul.name;
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

  // ---------- Skalierung: ganzzahlig, ohne Glättung ----------
  function skaliere() {
    var breite = document.getElementById('stage').clientWidth || B;
    var hoehe = Math.max(H, window.innerHeight - 240);
    var f = Math.max(1, Math.floor(Math.min(breite / B, hoehe / H)));
    canvas.style.width = (B * f) + 'px';
    canvas.style.height = (H * f) + 'px';
  }
  window.addEventListener('resize', skaliere);

  // ---------- Zeichnen ----------
  function rechteck(r, farbe) {
    ctx.fillStyle = farbe;
    ctx.fillRect(Math.round(r.x), Math.round(r.y), r.w, r.h);
  }

  function text(t, x, y, farbe, ausrichtung) {
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = ausrichtung || 'left';
    ctx.fillStyle = farbe;
    ctx.fillText(t, Math.round(x), Math.round(y));
  }

  function umbreche(t, maxBreite) {
    ctx.font = 'bold 8px monospace';
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
    var zeilen = umbreche(t, 100);
    var breite = 0;
    ctx.font = 'bold 8px monospace';
    for (var i = 0; i < zeilen.length; i++) { breite = Math.max(breite, ctx.measureText(zeilen[i]).width); }
    var bw = Math.ceil(breite) + 8;
    var bh = zeilen.length * 10 + 6;
    var bx = Math.round(anker.x + anker.w / 2 - bw / 2);
    var by = Math.round(anker.y + anker.h + 8);
    if (by + bh > H - 4) { by = Math.round(anker.y - bh - 4); }
    bx = Math.max(4, Math.min(B - bw - 4, bx));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#1d1a22';
    ctx.fillRect(bx, by, bw, 1);
    ctx.fillRect(bx, by + bh - 1, bw, 1);
    ctx.fillRect(bx, by, 1, bh);
    ctx.fillRect(bx + bw - 1, by, 1, bh);
    for (var j = 0; j < zeilen.length; j++) { text(zeilen[j], bx + 4, by + 3 + j * 10, '#1d1a22'); }
  }

  var TUER_FARBE = { modul: '#3aa860', raum: '#4a7ac0', gesperrt: '#7a7a85' };

  // Text über einem Eintrag beim Hover: Name, bei Modul-Türen mit Siegel auch das Ergebnis
  function beschriftung(e) {
    var t = e.name;
    var z = e.daten.ziel;
    if (e.art === 'tuer' && z && z.typ === 'modul' && siegel[z.id]) { t += ' (' + punkteText(siegel[z.id]) + ')'; }
    return t;
  }

  function zeichneBoden() {
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

  // Zeichenliste des Raums, sortiert nach z (Standard 0, Türen 2), bei Gleichstand in Reihenfolge der Daten
  function zeichenliste() {
    var liste = [];
    var n = 0;
    function add(r, z, art) { if (r.farbe || art === 'tuer') { liste.push({ r: r, z: z, n: n++, art: art }); } }
    (raum.kollision || []).forEach(function (r) { add(r, r.z || 0, 'rect'); });
    (raum.objekte || []).forEach(function (r) { add(r, r.z || 0, 'rect'); });
    (raum.tueren || []).forEach(function (r) { add(r, r.z || 2, 'tuer'); });
    liste.sort(function (a, b) { return a.z - b.z || a.n - b.n; });
    return liste;
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
    if (!raum) {
      ctx.fillStyle = '#2b2833';
      ctx.fillRect(0, 0, B, H);
      return;
    }
    zeichneBoden();
    var liste = zeichenliste();
    for (i = 0; i < liste.length; i++) {
      if (liste[i].art === 'tuer') { zeichneTuer(liste[i].r, jetzt); } else { rechteck(liste[i].r, liste[i].r.farbe); }
    }
    // Zielmarker (bei reduzierter Bewegung ohne Pulsieren)
    if (weg && weg.ziel) {
      var mx = Math.round(weg.ziel.x + spieler.w / 2);
      var my = Math.round(weg.ziel.y + spieler.h - 2);
      var gr = (reduziert || Math.floor(jetzt / 350) % 2 === 0) ? 3 : 4;
      ctx.fillStyle = '#1d1a22';
      ctx.fillRect(mx - gr - 1, my - gr - 1, 2 * gr + 2, 2 * gr + 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - gr, my - gr, 2 * gr, 2 * gr);
      ctx.fillStyle = '#cdbf9f';
      ctx.fillRect(mx - gr + 1, my - gr + 1, 2 * gr - 2, 2 * gr - 2);
    }
    // Figur
    rechteck(spieler, '#f08a3c');
    rechteck({ x: spieler.x + 2, y: spieler.y + 2, w: 6, h: 3 }, '#ffd9b0');

    // Hinweis und Sprechblase
    var ziel = ueberblendung ? null : aktuellesZiel();
    if (blase && jetzt > blase.bis) { blase = null; }
    if (blase) {
      zeichneBlase(blase.text, blase.rect);
    } else if (hoverId) {
      for (i = 0; i < INTERAKTIV.length; i++) {
        if (INTERAKTIV[i].id === hoverId) { zeichneBlase(beschriftung(INTERAKTIV[i]), INTERAKTIV[i].rect); }
      }
    } else if (ziel) {
      zeichneBlase('Leertaste', ziel.rect);
    }

    if (DEBUG) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,40,40,0.95)';
      for (i = 0; i < KOLLISION.length; i++) {
        ctx.strokeRect(KOLLISION[i].x + 0.5, KOLLISION[i].y + 0.5, KOLLISION[i].w - 1, KOLLISION[i].h - 1);
      }
      ctx.strokeStyle = 'rgba(40,140,255,0.95)';
      for (i = 0; i < INTERAKTIV.length; i++) {
        var z = INTERAKTIV[i].zone;
        ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
      }
      if (weg) {
        // Rohweg aus dem Raster (blass) und vereinfachter Weg (kräftig), jeweils durch die Mitte der Figur
        var ox = spieler.w / 2;
        var oy = spieler.h / 2;
        ctx.strokeStyle = 'rgba(0,200,200,0.8)';
        ctx.beginPath();
        for (i = 0; i < weg.roh.length; i++) { ctx.lineTo(weg.roh[i].x + ox, weg.roh[i].y + oy); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,0,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(spieler.x + ox, spieler.y + oy);
        for (i = weg.i; i < weg.punkte.length; i++) { ctx.lineTo(weg.punkte[i].x + ox, weg.punkte[i].y + oy); }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,0,0.95)';
      ctx.strokeRect(Math.round(spieler.x) + 0.5, Math.round(spieler.y) + 0.5, spieler.w - 1, spieler.h - 1);
    }

    // Überblendung beim Raumwechsel
    if (alpha > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, B, H);
    }
  }

  // ---------- Weg ablaufen ----------
  // Gleiche Bewegung und gleiche Kollisionsprüfung wie bei der Tastatur, die Figur wird nie versetzt.
  function folgeWeg(dt) {
    var p = weg.punkte[weg.i];
    if (!p) { ankunft(); return; }
    var vx = p.x - spieler.x;
    var vy = p.y - spieler.y;
    var laenge = Math.sqrt(vx * vx + vy * vy);
    if (laenge < 1e-7) {
      weg.i += 1;
      if (weg.i >= weg.punkte.length) { ankunft(); }
      return;
    }
    var s = Math.min(TEMPO * dt, laenge);
    var ax = spieler.x;
    var ay = spieler.y;
    bewege(vx / laenge * s, 0);
    bewege(0, vy / laenge * s);
    var bewegt = Math.sqrt(Math.pow(spieler.x - ax, 2) + Math.pow(spieler.y - ay, 2));
    if (s > 0 && bewegt < s * 0.25) {
      weg.steckt += dt;
      if (weg.steckt > 0.5) {
        weg = null;
        sprich('Hier komme ich nicht weiter.', spieler);
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
      if (z && z.id === aktionId) { bediene(z); }
    }
  }

  // ---------- Schleife ----------
  var letzte = 0;
  function schleife(jetzt) {
    var dt = Math.min(0.05, (jetzt - (letzte || jetzt)) / 1000);
    letzte = jetzt;
    var alpha = 0;
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
        if (dx) { bewege(dx * l * TEMPO * dt, 0); }
        if (dy) { bewege(0, dy * l * TEMPO * dt); }
      } else if (weg) {
        folgeWeg(dt);
      }
    }
    zeichne(jetzt, Math.max(0, Math.min(1, alpha)));
    window.requestAnimationFrame(schleife);
  }

  // ---------- Start: welt.json laden ----------
  function init(w) {
    if (!w || !Array.isArray(w.raeume) || !w.raeume.length) { throw new Error('welt.json enthält keine Räume.'); }
    welt = w;
    if (w.groesse) { B = w.groesse.b; H = w.groesse.h; }
    canvas.width = B;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
    if (w.figur) { spieler.w = w.figur.w; spieler.h = w.figur.h; TEMPO = w.figur.tempo || TEMPO; }
    w.raeume.forEach(function (r) { raeume[r.id] = r; });
    (w.module || []).forEach(function (m) { modulMap[m.id] = m; });
    if (!raeume[w.start]) { throw new Error('Der Startraum "' + w.start + '" gibt es nicht.'); }
    ladeSiegel();
    skaliere();
    ladeRaum(w.start, null);
    ergebnisBox.textContent = '';

    if (DEBUG) {
      // Nur für Tests mit ?debug=1: Lesezugriff auf den Zustand
      window.pixelbuero = {
        spieler: spieler,
        canvas: canvas,
        zustand: function () {
          return {
            x: spieler.x, y: spieler.y, raum: raum && raum.id,
            weg: weg ? { n: weg.punkte.length, ziel: weg.ziel, aktion: weg.aktion } : null,
            hover: hoverId, overlay: overlayOffen, ueberblendung: !!ueberblendung,
            modul: aktivesModul && aktivesModul.id,
            nav: [].slice.call(navListe.querySelectorAll('li')).map(function (li) { return li.textContent; }),
            navTitel: navTitel.textContent
          };
        },
        // Läuft einen Klick ohne Zeitverlauf durch (Schritte zu 1/60 s). Setzt die Figur um, nur für Tests.
        simuliere: function (sx, sy, tx, ty, objektId) {
          spieler.x = sx;
          spieler.y = sy;
          blase = null;
          var o = null;
          for (var i = 0; i < INTERAKTIV.length; i++) { if (INTERAKTIV[i].id === objektId) { o = INTERAKTIV[i]; } }
          klickZiel({ x: tx, y: ty }, o);
          var plan = weg ? { punkte: weg.punkte.slice(), roh: weg.roh.length } : null;
          var n = 0;
          while (weg && n < 6000) { folgeWeg(1 / 60); n += 1; }
          return {
            schritte: n, x: spieler.x, y: spieler.y, hinweis: blase ? blase.text : null,
            ueberlagert: overlayOffen, modul: aktivesModul && aktivesModul.id, plan: plan,
            wechselt: ueberblendung ? ueberblendung.id : null
          };
        },
        schliesse: function () { schliesseOverlay(); },
        setzeRaum: function (id) { ueberblendung = null; ladeRaum(id, null); },
        fertig: function () {
          if (ueberblendung) {
            if (!ueberblendung.gewechselt) { ladeRaum(ueberblendung.id, ueberblendung.spawn); }
            ueberblendung = null;
          }
        },
        gehbar: function (x, y) { return frei(x, y); }
      };
    }
    window.requestAnimationFrame(schleife);
  }

  ergebnisBox.textContent = 'Halle wird geladen ...';
  fetch(WELT_PFAD, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) { throw new Error(WELT_PFAD + ' nicht gefunden (HTTP ' + r.status + ').'); }
    return r.json();
  }).then(init).catch(function (err) {
    var m = err && err.message ? err.message : String(err);
    if (window.location.protocol === 'file:') { m += ' Die Seite muss über einen Server geöffnet werden (python -m http.server), nicht per Doppelklick.'; }
    ergebnisBox.textContent = 'Die Halle konnte nicht geladen werden: ' + m;
  });
})();
