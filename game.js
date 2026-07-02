// Exploration — prototype (repart a plat, Charlie 2026-07-02)
// Base propre : sol d'herbe pastel, un perso forme simple qui se deplace,
// fog of war + mini-carte "comme avant" (repris de l'explorer d'origine,
// git 832e93e v0.2.0). Zero asset pour l'instant : les sapins/rochers
// dessines a la main seront decoupes de la photo et ajoutes ensuite.
// Vanilla JS + Canvas, aucune dependance.

(function () {
  'use strict';

  var VERSION = '0.12.0';

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var dpr = Math.max(1, window.devicePixelRatio || 1);
  var W = 0, H = 0;
  var T = 0;      // temps global (s) pour les animations (frappe, wobble)
  var shake = 0;  // secousse d'écran à l'impact

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (typeof fog !== 'undefined' && fog) { fog.width = W; fog.height = H; }
    if (booted) refreshActive(); // la fenêtre active/nav dépend de W/H
  }
  window.addEventListener('resize', resize);
  // Orientation : l'UI est fluide (tout se recalcule depuis W/H). On force un
  // recalcul à la rotation (certains mobiles tardent à émettre 'resize').
  window.addEventListener('orientationchange', function () { resize(); setTimeout(resize, 250); });

  // Bouton plein écran (entrer / sortir), avec préfixes navigateurs.
  (function fullscreenButton() {
    if (typeof document === 'undefined') return;
    var fsBtn = document.getElementById('fs');
    if (!fsBtn) return;
    function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement; }
    fsBtn.addEventListener('click', function () {
      var el = document.documentElement;
      if (!fsElement()) {
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) try { req.call(el); } catch (e) {}
      } else {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex) try { ex.call(document); } catch (e) {}
      }
    });
    function sync() { fsBtn.textContent = fsElement() ? '✕' : '⛶'; setTimeout(resize, 120); }
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
  })();
  resize();

  // ── Monde procédural infini (par chunks) ─────────────────────────────────
  // Plus de bornes : le monde se fabrique autour du joueur en "chunks" générés
  // de façon déterministe (même graine -> même endroit, donc aucun pop en
  // revenant sur ses pas). Le point de départ (0,0) = la maison (feu + hache).
  var HOME = { x: 0, y: 0 };
  var CHUNK = 640;       // taille d'un chunk (px monde)
  var HOME_CLEAR = 260;  // rayon dégagé autour de la maison

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // Graine déterministe par chunk (gère les coordonnées négatives).
  function hashChunk(cx, cy) {
    var h = Math.imul(cx | 0, 374761393) + Math.imul(cy | 0, 668265263) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return (h ^ h >>> 16) >>> 0;
  }

  // ── Bruit déterministe (value-noise + fbm) -> eau (lacs + rivières) ───────
  function vnHash(ix, iy) {
    var h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) | 0;
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function vnSmooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, y) {
    var x0 = Math.floor(x), y0 = Math.floor(y), xf = x - x0, yf = y - y0;
    var v00 = vnHash(x0, y0), v10 = vnHash(x0 + 1, y0), v01 = vnHash(x0, y0 + 1), v11 = vnHash(x0 + 1, y0 + 1);
    var u = vnSmooth(xf), v = vnSmooth(yf);
    return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
  }
  function fbm(x, y) {
    var t = 0, amp = 0.5, f = 1;
    for (var i = 0; i < 4; i++) { t += valueNoise(x * f, y * f) * amp; f *= 2; amp *= 0.5; }
    return t;
  }
  // Champ d'eau CONTINU (> 0 = eau) : combine lacs (bruit basse fréquence) +
  // rivières sinueuses. La valeur signée sert au marching-squares pour des berges
  // en diagonale lisses (pas de marches d'escalier). Maison (0,0) au sec.
  function waterField(x, y) {
    if ((x - HOME.x) * (x - HOME.x) + (y - HOME.y) * (y - HOME.y) < 360 * 360) return -1;
    var lake = 0.31 - fbm(x / 520 + 7.3, y / 520 + 2.1);                  // > 0 dans les lacs
    var river = 0.02 - Math.abs(fbm(x / 760 + 50.5, y / 760 - 30.2) - 0.5); // > 0 dans les rivières
    return lake > river ? lake : river;
  }
  function isWater(x, y) { return waterField(x, y) > 0; }

  // ── Assets dessinés à la main (détourés de la photo de Charlie) ──────────
  var ASSETS = {
    treeA: 'assets/tree_left.png',
    treeB: 'assets/tree_right.png',
    treeC: 'assets/tree_elaijah.png', // l'arbre dessiné par Elaijah, le fils de Charlie
    rockA: 'assets/rock_left.png',
    rockB: 'assets/rock_right.png',
    logA: 'assets/log1.png',
    logB: 'assets/log2.png',
    firepitBack: 'assets/firepit_back.png',   // plan ARRIÈRE du foyer (trou + pierres du fond)
    firepitFront: 'assets/firepit_front.png', // plan AVANT (arc de pierres devant)
    monster: 'assets/monster.png',            // 1er monstre d'Elaijah (entier, hazy)
    // 2e monstre d'Elaijah, redessiné + numéroté (6 pièces) pour le rig de marche
    mm_body: 'assets/mm_body.png', mm_head: 'assets/mm_head.png',
    mm_armL: 'assets/mm_armL.png', mm_armR: 'assets/mm_armR.png',
    mm_legL: 'assets/mm_legL.png', mm_legR: 'assets/mm_legR.png',
    heroHead: 'assets/hero_head.png',   // perso principal (dessiné par Charlie) : tête de croco
    heroBody: 'assets/hero_body.png',
    heroPack: 'assets/hero_pack.png',   // sac à dos + matelas rose
    heroShoes: 'assets/hero_shoes.png',
    heroArm: 'assets/hero_arm.png',     // même bras pour l'avant et l'arrière
    boat: 'assets/boat.png',            // voilier dessiné par Elaijah (voile rose + emblème croco)
    tent: 'assets/tent.png',            // tente violette d'Elaijah (on y dort)
    zzz: 'assets/zzz.png',              // Z du sommeil (détouré + passé en blanc)
  };
  var IMG = {};
  Object.keys(ASSETS).forEach(function (k) { var im = new Image(); im.src = ASSETS[k]; IMG[k] = im; });
  // hauteur cible a l'écran (world px) par type ; le sprite garde son ratio.
  var TARGET_H = { tree: 122, rock: 46 };

  // ── Décor procédural par chunks ──────────────────────────────────────────
  var removedTrees = {};  // ids d'arbres abattus (persistent même chunk déchargé)
  var chunks = {};        // "cx,cy" -> { decos:[...] } (cache déterministe)
  function genChunk(cx, cy) {
    var rnd = mulberry32(hashChunk(cx, cy));
    var list = [];
    var count = 5 + ((rnd() * 5) | 0);      // 5..9 décors par chunk
    for (var i = 0; i < count; i++) {
      var x = (cx + rnd()) * CHUNK, y = (cy + rnd()) * CHUNK;
      var isTree = rnd() < 0.62, tv = rnd(), pick = rnd();
      if (Math.hypot(x - HOME.x, y - HOME.y) < HOME_CLEAR) continue; // dégager la maison
      if (isWater(x, y)) continue; // pas de décor sur l'eau
      var id = cx + '_' + cy + '_' + i;
      if (removedTrees[id]) continue;
      var key = isTree ? (tv < 0.4 ? 'treeA' : (tv < 0.76 ? 'treeB' : 'treeC')) // ~24% = arbre d'Elaijah
                       : (pick < 0.5 ? 'rockA' : 'rockB');
      var s = 0.82 + rnd() * 0.42;
      // Rayon de collision au SOL : tronc étroit pour les arbres, corps plus large pour les rochers.
      var cr = isTree ? 9 * s : 15 * s;
      var deco = { id: id, ck: cx + ',' + cy, key: key, type: isTree ? 'tree' : 'rock', x: x, y: y, s: s, cr: cr };
      if (isTree) { deco.hp = 5; deco.dead = false; deco.felling = null; } // 5 coups pour l'abattre
      list.push(deco);
    }
    return { decos: list };
  }
  function ensureChunk(cx, cy) {
    var k = cx + ',' + cy;
    return chunks[k] || (chunks[k] = genChunk(cx, cy));
  }
  function removeFromChunk(d) {
    var ch = chunks[d.ck]; if (!ch) return;
    var i = ch.decos.indexOf(d); if (i >= 0) ch.decos.splice(i, 1);
  }
  // Fenêtre active : décors des chunks visibles + marge. `decos` = set de
  // travail courant (toutes les boucles existantes itèrent dessus). Reconstruit
  // quand le joueur avance assez -> coût par frame constant sur un monde infini.
  var decos = [];
  var refCellX = null, refCellY = null;
  var REFRESH = 256;     // seuil de reconstruction de la fenêtre (px monde)
  function refreshActive() {
    var cam = camera(), m = 320;
    var cx0 = Math.floor((cam.x - m) / CHUNK), cx1 = Math.floor((cam.x + W + m) / CHUNK);
    var cy0 = Math.floor((cam.y - m) / CHUNK), cy1 = Math.floor((cam.y + H + m) / CHUNK);
    decos = [];
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) {
      var ch = ensureChunk(cx, cy);
      for (var i = 0; i < ch.decos.length; i++) {
        var d = ch.decos[i];
        if (!d.dead || d.felling != null) decos.push(d); // garde les arbres en pleine chute
      }
    }
    buildNav();
  }

  // ── Hache à ramasser + messages flottants ────────────────────────────────
  IMG.axe = new Image(); IMG.axe.src = 'assets/axe.png'; // dessin de Charlie (sinon placeholder vectoriel)
  var axe = { x: HOME.x + 130, y: HOME.y + 40, picked: false };
  var hasAxe = false;
  // Feu de camp = élément à DEUX plans (fond + devant) ; les bûches/flammes se
  // rendent ENTRE les deux (nichées dans le foyer). `contents` = ce qu'on met
  // dedans (démo : 2 bûches, en attendant la mécanique de dépôt + flammes).
  var campfire = {
    x: HOME.x - 135, y: HOME.y - 6,
    cr: 24,          // collision totale : on ne passe pas à travers
    contents: []     // vide pour l'instant (Charlie : pas de bûches dedans)
  };
  // Tente d'Elaijah (au campement) : cliquer dessus pour aller dormir.
  var tent = { x: HOME.x + 175, y: HOME.y - 45, cr: 20 };
  var inTent = false;
  var zs = [];        // Z's du sommeil qui s'envolent au-dessus de la tente
  var zAccum = 0;
  var floaters = [];
  function floater(text, wx, wy) { floaters.push({ text: text, x: wx, y: wy, t: 0 }); }
  // éclats de bois : couleurs échantillonnées sur les copeaux dessinés par Charlie
  // (le détourage des vraies formes ne sortait pas net, aquarelle pâle sur papier).
  // Chaque copeau = petit quad, taille + rotation + spin aléatoires -> chaos.
  var parts = [];
  var CHIP_COLS = ['#7d4940', '#8d6851', '#6d3a31', '#98785f', '#a5896f', '#bba187'];
  // Bûches ramassables (drop d'un arbre abattu). z = hauteur du hop de spawn.
  var logs = [];
  var logCount = 0;
  function spawnLogs(wx, wy, dir) {
    dir = dir || 1;                          // sens de chute de l'arbre (horizontal)
    var n = 2 + ((Math.random() * 2) | 0);   // 2 ou 3
    var span = 52 + n * 16;                  // longueur d'étalement ~ arbre couché
    for (var i = 0; i < n; i++) {
      var frac = n > 1 ? i / (n - 1) : 0.5;
      var along = (frac - 0.35) * span;      // réparti sur toute la longueur, dans le sens de la chute
      logs.push({
        x: wx + along * dir + (Math.random() - 0.5) * 10,
        y: wy + (Math.random() - 0.5) * 24,  // léger étalement perpendiculaire (axe Y)
        vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 10,
        z: 0, vz: 85 + Math.random() * 55,   // le mini-saut
        key: Math.random() < 0.5 ? 'logA' : 'logB',
        rot: (Math.random() - 0.5) * 0.5, sz: 0.85 + Math.random() * 0.3,
        grounded: false, t: 0
      });
    }
  }
  function spawnChips(wx, wy, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 165;
      parts.push({
        x: wx, y: wy,
        vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a) * sp) - 40 - Math.random() * 95,
        life: 0.3 + Math.random() * 0.45, t: 0,
        c: CHIP_COLS[(Math.random() * CHIP_COLS.length) | 0],
        w: 2 + Math.random() * 3, h: 1.5 + Math.random() * 2.5,       // tailles légèrement différentes
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 13 // orientations + spin variés
      });
    }
  }
  // Éclaboussures (bascule terre<->eau) : gouttelettes bleutées qui giclent.
  function spawnSplash(wx, wy, n) {
    var cols = ['#bfe3f5', '#8fc7ea', '#6fb0dd', '#dff2fc'];
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 45 + Math.random() * 150;
      parts.push({
        x: wx, y: wy,
        vx: Math.cos(a) * sp, vy: -Math.abs(Math.sin(a) * sp) - 60 - Math.random() * 90,
        life: 0.3 + Math.random() * 0.35, t: 0,
        c: cols[(Math.random() * cols.length) | 0],
        w: 2 + Math.random() * 2.6, h: 2 + Math.random() * 2.6,
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 11
      });
    }
  }

  // ── Audio (WebAudio) : slots de sons nommés, décodés une fois ────────────
  // Un fichier manquant => slot vide => no-op : on peut brancher les sons de
  // Charlie au fur et à mesure sans casser le comportement.
  var AC = null, footParity = false;
  var SFX = { step: 'assets/step.mp3', axe: 'assets/sfx_axe.mp3', treehit: 'assets/sfx_treehit.mp3', leaves: 'assets/sfx_leaves.mp3', treefall: 'assets/sfx_treefall.mp3', mstep: 'assets/sfx_mstep.mp3' };
  var sfxBuf = {};
  var ambBuf = {};            // ambiances environnementales (vent / oiseaux)
  var ambNextT = 1e9;         // prochain déclenchement d'ambiance (s)
  var STEP_DIST = 56;         // un pas tous les ~56 px parcourus
  var stepAccum = STEP_DIST;  // plein au départ -> 1er pas dès qu'on bouge
  function initAudio() {
    if (AC) { if (AC.state === 'suspended') { try { AC.resume(); } catch (e) {} } return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; return; }
    ambNextT = T + 5; // 1re ambiance ~5 s après le démarrage du son
    Object.keys(SFX).forEach(function (name) {
      fetch(SFX[name]).then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(); })
        .then(function (ab) { return AC.decodeAudioData(ab); })
        .then(function (buf) { sfxBuf[name] = buf; })
        .catch(function () {}); // fichier absent -> slot vide
    });
    ['wind', 'bird'].forEach(function (k) {
      fetch('assets/env_' + k + '.mp3').then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(); })
        .then(function (ab) { return AC.decodeAudioData(ab); })
        .then(function (buf) { ambBuf[k] = buf; }).catch(function () {});
    });
  }
  // Ambiance occasionnelle (vent / oiseaux) : très discret, avec dégradé montée->descente.
  function playAmbient() {
    if (!AC) return;
    var keys = []; if (ambBuf.wind) keys.push('wind'); if (ambBuf.bird) keys.push('bird');
    if (!keys.length) return;
    var key = keys[(Math.random() * keys.length) | 0], buf = ambBuf[key];
    var src = AC.createBufferSource(); src.buffer = buf; src.playbackRate.value = 0.96 + Math.random() * 0.08;
    var g = AC.createGain();
    var t0 = AC.currentTime, dur = buf.duration;
    var peak = key === 'wind' ? 0.12 : 0.16;                       // vraiment pas fort
    var fadeIn = key === 'wind' ? 3 : 0.6, fadeOut = key === 'wind' ? 3.5 : 1.4;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(fadeIn, dur * 0.45));
    g.gain.setValueAtTime(peak, t0 + Math.max(fadeIn, dur - fadeOut));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g); g.connect(AC.destination);
    try { src.start(t0); src.stop(t0 + dur + 0.1); } catch (e) {}
  }
  function playSound(name, rate, gain, delay) {
    if (!AC || !sfxBuf[name]) return;
    var s = AC.createBufferSource(); s.buffer = sfxBuf[name];
    s.playbackRate.value = rate || 1;
    var g = AC.createGain(); g.gain.value = (gain == null ? 0.8 : gain);
    s.connect(g); g.connect(AC.destination);
    try { s.start(AC.currentTime + (delay || 0)); } catch (e) {}
  }
  function playStep() {
    var base = footParity ? 1.06 : 0.95; footParity = !footParity; // pied G / D
    playSound('step', base * (0.94 + Math.random() * 0.12), 0.5 + Math.random() * 0.35);
  }
  // pas d'un monstre : pitch random + volume SPATIALISÉ (lié à la distance au joueur).
  function walkerStep(mo) {
    var d = Math.hypot(player.x - mo.x, player.y - mo.y);
    var vol = (1 - d / 620) * 0.25;  // max abaissé de 50% (Charlie) ; > ~620 px = inaudible
    if (vol <= 0.02) return;
    playSound('mstep', 0.82 + Math.random() * 0.38, vol);
  }

  // Monstre d'Elaijah : erre doucement dans la forêt avec une anim d'idle
  // (respiration + dandinement + balancement). Segmentation/rig = plus tard.
  var monster = {
    x: HOME.x + 300, y: HOME.y - 220,
    hx: HOME.x + 300, hy: HOME.y - 220, // point d'ancrage (zone d'errance)
    tx: HOME.x + 300, ty: HOME.y - 220, retarget: 0, t: 0
  };

  // Créatures qui MARCHENT (2e monstre d'Elaijah, riggé en pièces). Plusieurs
  // errent dans la forêt avec un cycle de marche. Pas d'interaction pour l'instant.
  var walkers = [];
  (function seedWalkers() {
    for (var i = 0; i < 3; i++) {
      var wx = HOME.x + (Math.random() - 0.5) * 1500;
      var wy = HOME.y + (Math.random() - 0.5) * 1500;
      if (Math.hypot(wx - HOME.x, wy - HOME.y) < 340) { wx += 420; wy -= 300; }
      walkers.push({ x: wx, y: wy, hx: wx, hy: wy, tx: wx, ty: wy, retarget: 0, phase: Math.random() * 6, face: 1, sz: 0.85 + Math.random() * 0.35, foot: 0 });
    }
  })();

  // ── Personnage (forme simple) ────────────────────────────────────────────
  var player = { x: HOME.x, y: HOME.y, vx: 0, vy: 0, speed: 245, facing: { x: 0, y: 1 } };
  var hasBoat = true;   // bateau dans l'inventaire dès le départ
  var onWater = false;  // le perso est-il en train de naviguer ?
  var boatFlip = null;  // horodatage de la dernière bascule terre<->eau (anim)
  var saveAccum = 0;    // cadence d'auto-sauvegarde

  // ── Brouillard de guerre (lissé) + mini-carte radar ──────────────────────
  // Monde infini -> exploré stocké en dictionnaire creux "col,row". Le fog est
  // rendu via un masque basse résolution ré-étalé en LISSANT : les bords des
  // cases se fondent en courbe fluide au lieu de marches d'escalier (Charlie).
  var CELL = 40;
  var explored = {};
  function isExplored(c, r) { return explored[c + ',' + r] === 1; }

  var fog = document.createElement('canvas');
  var fogCtx = fog.getContext('2d');
  fog.width = W; fog.height = H;
  var revealCv = document.createElement('canvas'); // masque de révélation basse résolution
  var revealCtx = revealCv.getContext('2d');

  var VISION = 165; // rayon de vision claire autour du perso (px)

  function reveal() {
    var pc = Math.floor(player.x / CELL), pr = Math.floor(player.y / CELL), R = 4;
    for (var r = -R; r <= R; r++) for (var c = -R; c <= R; c++) {
      if (c * c + r * r > R * R) continue;
      explored[(pc + c) + ',' + (pr + r)] = 1;
    }
  }

  // ── Contrôles ─────────────────────────────────────────────────────────────
  var started = false;
  var keys = {};
  var pointer = { active: false };
  var marker = null;
  var goActive = false;
  var navPath = null, navI = 0;   // waypoints calculés + index courant
  var pendingAction = null;       // { type:'chop'|'pickup', tree, range }
  var swing = null;               // { tree, t0, impacted } animation de frappe

  function setKey(e, down) {
    if (!started) return;
    var k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w' || k === 'z') keys.up = down;
    else if (k === 'arrowdown' || k === 's') keys.down = down;
    else if (k === 'arrowleft' || k === 'a' || k === 'q') keys.left = down;
    else if (k === 'arrowright' || k === 'd') keys.right = down;
    else return;
    e.preventDefault();
    if (down) { if (inTent) exitTent(); marker = null; goActive = false; navPath = null; pendingAction = null; } // le clavier reprend la main
  }
  window.addEventListener('keydown', function (e) { setKey(e, true); });
  window.addEventListener('keyup', function (e) { setKey(e, false); });

  function pointToWorld(e) {
    var cam = camera();
    return { x: e.clientX + cam.x, y: e.clientY + cam.y };
  }
  canvas.addEventListener('pointerdown', function (e) {
    if (!started) return;
    initAudio(); // reprend l'AudioContext si le mobile l'a suspendu
    pointer.active = true;
    marker = pointToWorld(e);
    goActive = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!pointer.active) return;
    marker = pointToWorld(e);
  });
  function endPointer() {
    if (!pointer.active) return;
    pointer.active = false;
    if (!marker) return;
    var mx = marker.x, my = marker.y;
    // 0) réveil si on dort ; un clic sur la tente = juste se réveiller.
    if (inTent) { exitTent(); if (tentAt(mx, my)) { marker = null; return; } }
    // 0b) clic sur la tente (éveillé) = aller dormir.
    if (!inTent && tentAt(mx, my)) { startAction('sleep', tent, tent.cr + PR + 12); return; }
    // 1) clic sur la hache au sol ?
    if (!hasAxe && !axe.picked && Math.hypot(mx - axe.x, my - axe.y) < 30) {
      startAction('pickup', null, PR + 26); return;
    }
    // 2) clic sur un arbre ?
    var tree = treeAt(mx, my);
    if (tree) {
      if (!hasAxe) {
        floater('You need an axe', tree.x, tree.y - 44);
        var adj0 = adjacencyPoint(tree.x, tree.y, tree.cr + PR + 8);
        navPath = findPath(player.x, player.y, adj0.x, adj0.y); navI = 0; goActive = !!navPath; pendingAction = null;
        return;
      }
      startAction('chop', tree, tree.cr + PR + 20); return;
    }
    // 3) déplacement normal
    pendingAction = null;
    navPath = findPath(player.x, player.y, mx, my); navI = 0; goActive = !!navPath;
  }

  // Arbre sous le point monde (mx,my) : dans les bornes du sprite, le plus au
  // premier plan (plus grand y) en cas de chevauchement.
  function treeAt(mx, my) {
    var best = null;
    for (var i = 0; i < decos.length; i++) {
      var d = decos[i]; if (d.type !== 'tree' || d.dead) continue;
      var im = IMG[d.key]; if (!im || !im.naturalWidth) continue;
      var h = TARGET_H[d.type] * d.s, w = h * (im.naturalWidth / im.naturalHeight);
      if (mx > d.x - w * 0.5 && mx < d.x + w * 0.5 && my > d.y - h && my < d.y + 6) {
        if (!best || d.y > best.y) best = d;
      }
    }
    return best;
  }
  function adjacencyPoint(tx, ty, r) {
    var dx = player.x - tx, dy = player.y - ty, d = Math.hypot(dx, dy);
    if (d < 1) { dx = 0; dy = 1; d = 1; }
    return { x: tx + (dx / d) * r, y: ty + (dy / d) * r };
  }
  // Tente : détection du clic + entrée (dormir) / sortie (se réveiller).
  function tentAt(mx, my) {
    var im = IMG.tent, h = 68, w = im && im.naturalWidth ? h * (im.naturalWidth / im.naturalHeight) : 60;
    return mx > tent.x - w * 0.55 && mx < tent.x + w * 0.55 && my > tent.y - h && my < tent.y + 12;
  }
  function enterTent() {
    inTent = true; player.vx = 0; player.vy = 0;
    navPath = null; goActive = false; marker = null; zAccum = 0.3;
  }
  function exitTent() {
    if (!inTent) return; inTent = false;
    floater('*yawn*', player.x, player.y - 46);
  }
  function spawnZ() {
    zs.push({ x: tent.x + 4, y: tent.y - 58, t: 0, life: 2.6, drift: Math.random() * 6.28, dir: Math.random() < 0.5 ? -1 : 1 });
  }
  function startAction(type, target, range) {
    pendingAction = { type: type, target: target, range: range };
    var tx = target ? target.x : axe.x, ty = target ? target.y : axe.y;
    if (Math.hypot(player.x - tx, player.y - ty) <= range) { executeAction(); return; }
    var adj = adjacencyPoint(tx, ty, range - 4);
    navPath = findPath(player.x, player.y, adj.x, adj.y); navI = 0; goActive = !!navPath;
    if (!navPath) executeAction();
  }
  function executeAction() {
    if (!pendingAction) return;
    var a = pendingAction; pendingAction = null; navPath = null; goActive = false;
    if (a.type === 'pickup') {
      hasAxe = true; axe.picked = true;
      floater('Axe picked up', player.x, player.y - 46);
      playSound('axe', 1.0, 0.5);
    } else if (a.type === 'chop') {
      startSwing(a.target);
    } else if (a.type === 'sleep') {
      enterTent();
    }
  }
  function startSwing(tree) {
    swing = { tree: tree, t0: T, impacted: false };
    var dx = tree.x - player.x, dy = tree.y - player.y, d = Math.hypot(dx, dy) || 1;
    player.facing.x = dx / d; player.facing.y = dy / d;
    // le son part à l'impact (mi-course), pas au début du geste.
  }
  function fellTree(tree) {
    tree.dead = true;
    tree.felling = T;
    tree.fallDir = (tree.x >= player.x ? 1 : -1); // tombe du côté opposé au joueur
    tree.cr = 0;
    // son de chute, décalé pour tomber quand l'arbre touche le sol (~mi-chute).
    playSound('treefall', 0.97 + Math.random() * 0.06, 1.0, 0.42);
    buildNav(); // la grille de nav oublie l'arbre abattu -> on peut traverser
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  var titleEl = document.getElementById('title');
  document.getElementById('ver').textContent = 'v' + VERSION;

  // ── Sauvegarde (localStorage) : "New Game" / "Continue" ──────────────────
  var SAVE_KEY = 'cacayou_save_v1';
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function saveGame() {
    try {
      var ek = Object.keys(explored);
      if (ek.length > 120000) return; // garde-fou taille de sauvegarde
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1, px: player.x, py: player.y, logCount: logCount,
        hasAxe: hasAxe, axePicked: axe.picked,
        explored: ek, removed: Object.keys(removedTrees)
      }));
    } catch (e) {}
  }
  function applySave(s) {
    explored = {}; if (s.explored) for (var i = 0; i < s.explored.length; i++) explored[s.explored[i]] = 1;
    removedTrees = {}; if (s.removed) for (var j = 0; j < s.removed.length; j++) removedTrees[s.removed[j]] = 1;
    chunks = {};
    logCount = s.logCount || 0; hasAxe = !!s.hasAxe; axe.picked = !!s.axePicked;
    player.x = s.px || HOME.x; player.y = s.py || HOME.y; player.vx = 0; player.vy = 0;
    refCellX = null; refCellY = null; refreshActive();
  }
  function newGame() {
    explored = {}; removedTrees = {}; chunks = {};
    logs.length = 0; parts.length = 0; floaters.length = 0;
    logCount = 0; hasAxe = false; axe.picked = false;
    player.x = HOME.x; player.y = HOME.y; player.vx = 0; player.vy = 0;
    refCellX = null; refCellY = null;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    refreshActive();
  }
  function startGame() {
    started = true; titleEl.style.display = 'none';
    initAudio(); // le clic = geste utilisateur -> débloque l'AudioContext
  }
  (function initMenu() {
    var contBtn = document.getElementById('continueBtn');
    var newBtn = document.getElementById('playBtn');
    if (hasSave() && contBtn) { contBtn.style.display = ''; if (newBtn) newBtn.className = 'secondary'; }
    if (contBtn) contBtn.addEventListener('click', function () {
      var ok = false;
      try { applySave(JSON.parse(localStorage.getItem(SAVE_KEY))); ok = true; } catch (e) {}
      if (!ok) newGame();
      startGame();
    });
    if (newBtn) newBtn.addEventListener('click', function () { newGame(); startGame(); });
  })();
  window.addEventListener('beforeunload', function () { if (started) saveGame(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && started) saveGame(); });

  // ── Collisions & évitement ───────────────────────────────────────────────
  var PR = 9; // rayon du perso au sol

  // Repousse le perso hors des cercles de collision (troncs/rochers). Deux
  // passes pour gérer proprement un coin entre deux obstacles. Le glissement
  // le long de l'obstacle est naturel (on pousse selon la normale).
  function resolveCollisions() {
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < decos.length; i++) {
        var d = decos[i]; if (d.dead) continue;
        var dx = player.x - d.x, dy = player.y - d.y;
        var dist = Math.hypot(dx, dy), min = d.cr + PR;
        if (dist < min) {
          if (dist < 0.001) { dx = 1; dy = 0; dist = 1; }
          var push = min - dist;
          player.x += (dx / dist) * push;
          player.y += (dy / dist) * push;
        }
      }
      // feu de camp : collision totale (on ne traverse pas).
      var cdx = player.x - campfire.x, cdy = player.y - campfire.y;
      var cdist = Math.hypot(cdx, cdy), cmin = campfire.cr + PR;
      if (cdist < cmin) {
        if (cdist < 0.001) { cdx = 1; cdy = 0; cdist = 1; }
        var cp = cmin - cdist; player.x += (cdx / cdist) * cp; player.y += (cdy / cdist) * cp;
      }
    }
  }

  // ── Pathfinding : A* sur grille de navigation + lissage (string-pulling) ──
  // Obstacles STATIQUES -> la grille bloquée est précalculée UNE fois ; A* ne
  // tourne qu'au moment d'un tap. Cellules bloquées = obstacles gonflés du
  // rayon du perso, pour qu'il contourne sans frotter.
  // Grille de nav FENÊTRÉE autour de la caméra (monde infini : une grille
  // globale exploserait). Origine monde = (navOX,navOY). Reconstruite à chaque
  // rafraîchissement de la fenêtre active et à chaque arbre abattu.
  var NAV = 30;
  var navOX = 0, navOY = 0, NCOLS = 0, NROWS = 0;
  var blocked = new Uint8Array(0);
  function w2c(x) { return Math.floor((x - navOX) / NAV); }
  function w2r(y) { return Math.floor((y - navOY) / NAV); }
  function blockCircle(x, y, R) {
    var cA = Math.max(0, w2c(x - R)), cB = Math.min(NCOLS - 1, w2c(x + R));
    var rA = Math.max(0, w2r(y - R)), rB = Math.min(NROWS - 1, w2r(y + R));
    for (var r = rA; r <= rB; r++) for (var c = cA; c <= cB; c++) {
      var ex = navOX + c * NAV + NAV / 2 - x, ey = navOY + r * NAV + NAV / 2 - y;
      if (ex * ex + ey * ey <= R * R) blocked[r * NCOLS + c] = 1;
    }
  }
  function buildNav() {
    var cam = camera(), m = 340;
    navOX = Math.floor(cam.x - m); navOY = Math.floor(cam.y - m);
    NCOLS = Math.ceil((W + m * 2) / NAV); NROWS = Math.ceil((H + m * 2) / NAV);
    if (blocked.length !== NCOLS * NROWS) blocked = new Uint8Array(NCOLS * NROWS);
    else blocked.fill(0);
    for (var i = 0; i < decos.length; i++) { var d = decos[i]; if (d.dead) continue; blockCircle(d.x, d.y, d.cr + PR + 4); }
    blockCircle(campfire.x, campfire.y, campfire.cr + PR + 4); // le feu bloque aussi le pathfinding
  }
  function navBlocked(c, r) { return c < 0 || r < 0 || c >= NCOLS || r >= NROWS || blocked[r * NCOLS + c] === 1; }
  function cellCenter(c, r) { return { x: navOX + c * NAV + NAV / 2, y: navOY + r * NAV + NAV / 2 }; }

  function hasLOS(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy);
    var steps = Math.max(1, Math.ceil(dist / (NAV * 0.5)));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps, x = ax + dx * t, y = ay + dy * t;
      if (navBlocked(w2c(x), w2r(y))) return false;
    }
    return true;
  }
  function nearestFree(c, r) {
    if (!navBlocked(c, r)) return { c: c, r: r };
    for (var rad = 1; rad < 50; rad++) {
      for (var dr = -rad; dr <= rad; dr++) for (var dc = -rad; dc <= rad; dc++) {
        if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
        if (!navBlocked(c + dc, r + dr)) return { c: c + dc, r: r + dr };
      }
    }
    return null;
  }
  function aStar(sc, sr, gc, gr) {
    var N = NCOLS * NROWS;
    var gScore = new Float32Array(N).fill(Infinity);
    var fScore = new Float32Array(N).fill(Infinity);
    var came = new Int32Array(N).fill(-1);
    var open = new Uint8Array(N);
    var heap = [];
    function h(c, r) { var dx = Math.abs(c - gc), dy = Math.abs(r - gr); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); }
    function push(idx) { heap.push(idx); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (fScore[heap[p]] <= fScore[heap[i]]) break; var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, rr = 2 * i + 2, m = i; if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l; if (rr < heap.length && fScore[heap[rr]] < fScore[heap[m]]) m = rr; if (m === i) break; var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m; } } return top; }
    var si = sr * NCOLS + sc, gi = gr * NCOLS + gc;
    gScore[si] = 0; fScore[si] = h(sc, sr); push(si); open[si] = 1;
    var dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    var iter = 0;
    while (heap.length && iter++ < 40000) {
      var cur = pop(); open[cur] = 0;
      if (cur === gi) break;
      var cc = cur % NCOLS, cr = (cur / NCOLS) | 0;
      for (var k = 0; k < 8; k++) {
        var nc = cc + dirs[k][0], nr = cr + dirs[k][1];
        if (navBlocked(nc, nr)) continue;
        if (dirs[k][0] && dirs[k][1] && (navBlocked(cc + dirs[k][0], cr) || navBlocked(cc, cr + dirs[k][1]))) continue;
        var ni = nr * NCOLS + nc, tentative = gScore[cur] + dirs[k][2];
        if (tentative < gScore[ni]) { came[ni] = cur; gScore[ni] = tentative; fScore[ni] = tentative + h(nc, nr); if (!open[ni]) { push(ni); open[ni] = 1; } }
      }
    }
    if (gi !== si && came[gi] === -1) return null;
    var path = [gi], node = gi;
    while (node !== si && came[node] !== -1) { node = came[node]; path.push(node); }
    path.reverse();
    return path;
  }
  // Renvoie une liste de waypoints monde (lissée), ou null si pas de chemin.
  function findPath(sx, sy, tx, ty) {
    var sc = w2c(sx), sr = w2r(sy);
    var gc = w2c(tx), gr = w2r(ty);
    var sf = nearestFree(sc, sr); if (!sf) return null;
    var gf = nearestFree(gc, gr); if (!gf) return null;
    var cells = aStar(sf.c, sf.r, gf.c, gf.r); if (!cells) return null;
    var pts = [{ x: sx, y: sy }].concat(cells.map(function (idx) { return cellCenter(idx % NCOLS, (idx / NCOLS) | 0); }));
    if (!navBlocked(gc, gr)) pts[pts.length - 1] = { x: tx, y: ty };
    // string-pulling : sauter au waypoint le plus loin encore en ligne de vue
    var out = [], i = 0;
    while (i < pts.length - 1) {
      var j = pts.length - 1;
      for (; j > i + 1; j--) if (hasLOS(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) break;
      out.push(pts[j]); i = j;
    }
    return out.length ? out : [{ x: tx, y: ty }];
  }

  // ── Mise à jour ──────────────────────────────────────────────────────────
  function update(dt) {
    if (!started) return;
    var tvx = 0, tvy = 0;
    var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    var klen = Math.hypot(dx, dy);

    if (klen > 0) {
      dx /= klen; dy /= klen;
      tvx = dx * player.speed; tvy = dy * player.speed;
    } else if (goActive && navPath) {
      // Suit les waypoints ; avance à celui d'après quand on l'atteint.
      var wp = navPath[navI];
      while (wp) {
        var last = (navI === navPath.length - 1);
        if (Math.hypot(wp.x - player.x, wp.y - player.y) <= (last ? 7 : 13)) { navI++; wp = navPath[navI]; }
        else break;
      }
      if (!wp) { navPath = null; goActive = false; marker = null; }
      else {
        var bx = wp.x - player.x, by = wp.y - player.y, bd = Math.hypot(bx, by) || 1;
        tvx = (bx / bd) * player.speed * 0.85;
        tvy = (by / bd) * player.speed * 0.85;
      }
    }

    var k = 1 - Math.pow(0.0006, dt);
    player.vx += (tvx - player.vx) * k;
    player.vy += (tvy - player.vy) * k;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    resolveCollisions(); // repousse hors des troncs/rochers (monde infini : pas de bornes)
    // Le joueur a avancé assez -> reconstruit la fenêtre active (décors + nav).
    var rcx = Math.round(player.x / REFRESH), rcy = Math.round(player.y / REFRESH);
    if (rcx !== refCellX || rcy !== refCellY) { refCellX = rcx; refCellY = rcy; refreshActive(); }
    // Bateau : sur l'eau on navigue (déplacement normal) ; bascule = anim + éclaboussures.
    var nowWater = hasBoat && isWater(player.x, player.y);
    if (nowWater !== onWater) { onWater = nowWater; boatFlip = T; spawnSplash(player.x, player.y - 4, 14); shake = Math.max(shake, 3.5); }

    if (Math.hypot(player.vx, player.vy) > 12) {
      var s = Math.hypot(player.vx, player.vy);
      player.facing.x = player.vx / s; player.facing.y = player.vy / s;
    }

    // Cadence de pas : basée sur la distance réellement parcourue ce frame.
    var moved = Math.hypot(player.vx, player.vy) * dt;
    if (moved > 0.5) {
      stepAccum += moved;
      if (stepAccum >= STEP_DIST) { stepAccum -= STEP_DIST; playStep(); }
    } else {
      stepAccum = STEP_DIST; // à l'arrêt : le prochain mouvement déclenche un pas tout de suite
    }

    // Action en attente (ramasser / frapper) : exécute une fois à portée.
    if (pendingAction) {
      var atx = pendingAction.target ? pendingAction.target.x : axe.x;
      var aty = pendingAction.target ? pendingAction.target.y : axe.y;
      if (Math.hypot(player.x - atx, player.y - aty) <= pendingAction.range) executeAction();
    }
    // Frappe : impact à mi-course -> l'arbre tremble + sons.
    if (swing) {
      var se = T - swing.t0;
      if (!swing.impacted && se >= 0.13) {   // impact = l'instant où le geste s'arrête net
        swing.impacted = true;
        var tr = swing.tree; tr.wobbleT0 = T;
        if (tr.hp != null) tr.hp -= 1;
        var fell = (tr.hp != null && tr.hp <= 0 && !tr.dead);
        // pitch + volume variés à chaque coup ; le coup FATAL = le plus fort + le plus aigu.
        var pitch = fell ? 1.28 : (0.88 + Math.random() * 0.26);
        var vol = fell ? 1.0 : (0.55 + Math.random() * 0.35);
        playSound('axe', pitch, vol);
        playSound('treehit', pitch * 0.98, vol * 0.9);
        playSound('leaves', 0.95 + Math.random() * 0.1, fell ? 0.7 : 0.4);
        spawnChips(player.x + player.facing.x * 22, player.y - 12 + player.facing.y * 22, fell ? 18 : 10);
        shake = fell ? 6 : 3; // petit choc d'écran
        if (fell) fellTree(tr);
      }
      if (se >= 0.34) swing = null;
    }
    // messages flottants
    for (var fi = floaters.length - 1; fi >= 0; fi--) { floaters[fi].t += dt; floaters[fi].y -= 22 * dt; if (floaters[fi].t > 1.4) floaters.splice(fi, 1); }
    // particules (éclats de bois)
    for (var pi = parts.length - 1; pi >= 0; pi--) { var pp = parts[pi]; pp.t += dt; pp.x += pp.vx * dt; pp.y += pp.vy * dt; pp.vy += 340 * dt; pp.rot += pp.vrot * dt; if (pp.t >= pp.life) parts.splice(pi, 1); }
    // arbre abattu : après la chute (~0.4s) il DESPAWN en copeaux + lâche 2-3 bûches.
    for (var di = decos.length - 1; di >= 0; di--) {
      var dd = decos[di];
      if (dd.felling != null && (T - dd.felling) >= 0.4) {
        spawnChips(dd.x, dd.y - 22, 24);
        spawnLogs(dd.x, dd.y, dd.fallDir || 1); // étalées le long de la chute
        shake = Math.max(shake, 5);
        removedTrees[dd.id] = 1;   // persiste même si le chunk est rechargé plus tard
        removeFromChunk(dd);       // retire de la liste du chunk
        decos.splice(di, 1);
      }
    }
    // monstre d'Elaijah : errance lente vers des cibles aléatoires autour du home.
    monster.t += dt; monster.retarget -= dt;
    if (monster.retarget <= 0) {
      monster.retarget = 2.5 + Math.random() * 3.5;
      monster.tx = monster.hx + (Math.random() - 0.5) * 260;
      monster.ty = monster.hy + (Math.random() - 0.5) * 210;
    }
    var mdx = monster.tx - monster.x, mdy = monster.ty - monster.y, mdd = Math.hypot(mdx, mdy);
    if (mdd > 4) {
      monster.x += (mdx / mdd) * 26 * dt; monster.y += (mdy / mdd) * 26 * dt;
      monster.step = (monster.step || 0) + 26 * dt;         // pas spatialisés pour le 1er monstre aussi
      if (monster.step >= 46) { monster.step -= 46; walkerStep(monster); }
    }

    // créatures qui marchent : errance + cycle de marche (phase avance en marchant).
    for (var wk = 0; wk < walkers.length; wk++) {
      var mo = walkers[wk];
      mo.retarget -= dt;
      if (mo.retarget <= 0) { mo.retarget = 2 + Math.random() * 4.5; mo.tx = mo.hx + (Math.random() - 0.5) * 480; mo.ty = mo.hy + (Math.random() - 0.5) * 480; }
      var wdx = mo.tx - mo.x, wdy = mo.ty - mo.y, wdd = Math.hypot(wdx, wdy);
      if (wdd > 5) {
        mo.x += (wdx / wdd) * 34 * dt; mo.y += (wdy / wdd) * 34 * dt;
        if (Math.abs(wdx) > 2) mo.face = wdx < 0 ? -1 : 1;
        mo.phase += dt * 9;
        var fi = Math.floor(mo.phase / Math.PI);   // 1 pas par demi-cycle
        if (fi !== mo.foot) { mo.foot = fi; walkerStep(mo); }
      } else { mo.phase += dt * 2.2; mo.foot = Math.floor(mo.phase / Math.PI); }
    }

    // ambiances environnementales : de temps en temps, un souffle de vent ou des oiseaux.
    if (AC && T >= ambNextT) { ambNextT = T + 14 + Math.random() * 24; playAmbient(); }

    // tente : Z's du sommeil qui s'envolent quand on dort dedans
    if (inTent) { zAccum += dt; if (zAccum >= 0.85) { zAccum = 0; spawnZ(); } }
    for (var zi = zs.length - 1; zi >= 0; zi--) { zs[zi].t += dt; if (zs[zi].t >= zs[zi].life) zs.splice(zi, 1); }

    // bûches : mini-saut de spawn, puis ramassables à proximité.
    for (var li = logs.length - 1; li >= 0; li--) {
      var lg = logs[li]; lg.t += dt;
      if (!lg.grounded) {
        lg.z += lg.vz * dt; lg.vz -= 380 * dt;
        lg.x += lg.vx * dt; lg.y += lg.vy * dt; lg.vx *= 0.88; lg.vy *= 0.88;
        if (lg.z <= 0) { lg.z = 0; lg.vz = 0; lg.grounded = true; }
      } else if (Math.hypot(player.x - lg.x, player.y - lg.y) < 30) {
        logCount++; floater('+1 log', lg.x, lg.y - 22); logs.splice(li, 1);
      }
    }

    reveal();

    // auto-sauvegarde périodique
    saveAccum += dt;
    if (saveAccum >= 4) { saveAccum = 0; saveGame(); }
  }

  function camera() {
    // Monde infini : la caméra suit le perso, aucune borne.
    return { x: player.x - W / 2, y: player.y - H / 2 };
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  function drawGround(cam) {
    // Sol d'herbe pastel UNI, puis l'eau (lacs/rivières) par-dessus.
    ctx.fillStyle = '#c2e0a6';
    ctx.fillRect(-8, -8, W + 16, H + 16); // léger débord pour la secousse d'écran
    drawWater(cam);
  }
  // Eau en MARCHING SQUARES : rendu vectoriel NET (pas de flou). Les berges sont
  // des diagonales lisses (interpolées sur le champ) au lieu de marches d'escalier.
  // Un seul fill() pour tout : les bords internes entre cases se fondent sans
  // couture, seul le contour eau/terre reste. (Charlie : net pour l'eau.)
  function drawWater(cam) {
    var GS = 24;
    var c0 = Math.floor(cam.x / GS) - 1, r0 = Math.floor(cam.y / GS) - 1;
    var c1 = Math.ceil((cam.x + W) / GS) + 1, r1 = Math.ceil((cam.y + H) / GS) + 1;
    var NC = c1 - c0 + 1, NR = r1 - r0 + 1;
    var fld = new Float32Array(NC * NR);
    for (var rr = 0; rr < NR; rr++) for (var cc = 0; cc < NC; cc++)
      fld[rr * NC + cc] = waterField((c0 + cc) * GS, (r0 + rr) * GS);

    ctx.save();
    ctx.fillStyle = '#7fb8e6';
    ctx.beginPath();
    function edge(ax, ay, fa, bx, by, fb) { var t = fa / (fa - fb); return [ax + (bx - ax) * t, ay + (by - ay) * t]; }
    function poly(pts) {
      if (pts.length < 3) return;
      ctx.moveTo(pts[0][0] - cam.x, pts[0][1] - cam.y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] - cam.x, pts[i][1] - cam.y);
      ctx.closePath();
    }
    for (var r = 0; r < NR - 1; r++) for (var c = 0; c < NC - 1; c++) {
      var fTL = fld[r * NC + c], fTR = fld[r * NC + c + 1], fBR = fld[(r + 1) * NC + c + 1], fBL = fld[(r + 1) * NC + c];
      if (fTL <= 0 && fTR <= 0 && fBR <= 0 && fBL <= 0) continue;
      var x0 = (c0 + c) * GS, y0 = (r0 + r) * GS, x1 = x0 + GS, y1 = y0 + GS;
      if (fTL > 0 && fTR > 0 && fBR > 0 && fBL > 0) { poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); continue; }
      var cx = [x0, x1, x1, x0], cy = [y0, y0, y1, y1], f = [fTL, fTR, fBR, fBL];
      var saddle = (fTL > 0 && fBR > 0 && fTR <= 0 && fBL <= 0) || (fTR > 0 && fBL > 0 && fTL <= 0 && fBR <= 0);
      if (saddle) {
        for (var k = 0; k < 4; k++) if (f[k] > 0) {
          var pr = (k + 3) % 4, nx = (k + 1) % 4;
          var mA = edge(cx[k], cy[k], f[k], cx[pr], cy[pr], f[pr]);
          var mB = edge(cx[k], cy[k], f[k], cx[nx], cy[nx], f[nx]);
          poly([[cx[k], cy[k]], mB, mA]);
        }
        continue;
      }
      var pts = [];
      for (var k2 = 0; k2 < 4; k2++) {
        var n2 = (k2 + 1) % 4;
        if (f[k2] > 0) pts.push([cx[k2], cy[k2]]);
        if ((f[k2] > 0) !== (f[n2] > 0)) pts.push(edge(cx[k2], cy[k2], f[k2], cx[n2], cy[n2], f[n2]));
      }
      poly(pts);
    }
    ctx.fill();
    ctx.restore();
  }

  // Sprite de décor (sapin / rocher), ancré par sa base. Pas d'ombre : Charlie
  // fera les siennes (plus jolies) sur les assets.
  function drawSprite(deco, sx, sy) {
    var im = IMG[deco.key];
    if (!im || !im.complete || !im.naturalWidth) return;
    var h = TARGET_H[deco.type] * deco.s;
    var w = h * (im.naturalWidth / im.naturalHeight);
    // Arbre abattu : bascule au sol (pivot à la base) puis reste couché.
    if (deco.felling != null) {
      var fe = T - deco.felling, fall = Math.min(1, fe / 0.4);
      var ang = fall * fall * 1.5 * (deco.fallDir || 1);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang); ctx.globalAlpha = 1 - 0.1 * fall;
      ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore(); ctx.globalAlpha = 1;
      return;
    }
    // Tremblement à l'impact de la hache : rotation amortie, pivot à la base.
    var wob = 0;
    if (deco.wobbleT0 != null) {
      var e = T - deco.wobbleT0;
      if (e < 0.45) wob = Math.sin(e * 42) * (1 - e / 0.45) * 0.10;
      else deco.wobbleT0 = null;
    }
    if (wob) {
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(wob);
      ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore();
    } else {
      ctx.drawImage(im, sx - w / 2, sy - h, w, h);
    }
  }

  // Perso principal = personnage assemblé (dessin de Charlie) : chaussures →
  // corps → tête croco, sac à dos derrière-gauche. Regarde à droite par défaut,
  // se retourne selon le déplacement, petit rebond en marche. (Assemblage = mon
  // interprétation, offsets à ajuster.)
  function drawPlayer(sx, sy) {
    // fallback galet tant que les pièces ne sont pas chargées
    if (!IMG.heroBody || !IMG.heroBody.complete || !IMG.heroBody.naturalWidth) {
      ctx.fillStyle = '#ef8a68'; ctx.strokeStyle = '#b8543a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(sx, sy - 12, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return;
    }
    var spd = Math.hypot(player.vx, player.vy), moving = spd > 25;
    var bob = moving ? Math.abs(Math.sin(T * 9)) * 2.4 : Math.sin(T * 2.2) * 0.6;
    var faceRight = player.facing.x >= -0.05;
    ctx.save(); ctx.globalAlpha = 0.17; ctx.fillStyle = '#3c5028';
    ctx.beginPath(); ctx.ellipse(sx, sy, 14, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(sx, sy);
    if (!faceRight) ctx.scale(-1, 1); // la tête croco est dessinée vers la DROITE
    function part(key, ox, bottomY, th) {
      var im = IMG[key]; if (!im || !im.complete || !im.naturalWidth) return;
      var h = th, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, ox - w / 2, bottomY - h, w, h);
    }
    // bras : même sprite pour l'arrière et l'avant, épaule = coin manche, balance opposée.
    var swing = moving ? Math.sin(T * 9) * 0.4 : Math.sin(T * 2) * 0.06;
    function arm(ox, oy, ang, alpha) {
      var im = IMG.heroArm; if (!im || !im.complete || !im.naturalWidth) return;
      var w = 19, h = w * (im.naturalHeight / im.naturalWidth);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(ox, oy); ctx.rotate(ang);
      ctx.drawImage(im, 0, -h * 0.42, w, h); ctx.restore(); ctx.globalAlpha = 1;
    }
    arm(-1, -22 - bob, 0.15 + swing, 0.9);  // bras ARRIÈRE : épaule recentrée sur le corps
    part('heroPack', -8, -8 - bob, 27);     // sac à dos + matelas (derrière-gauche)
    part('heroShoes', 1, 0, 13);            // chaussures au sol (pas de rebond)
    part('heroBody', 1, -8 - bob, 24);      // corps
    arm(2, -21 - bob, 0.15 - swing, 1);     // bras AVANT : épaule recentrée
    part('heroHead', 9, -26 - bob, 21);     // tête croco décalée à droite (cou au-dessus du corps)
    ctx.restore();
  }

  // Perso EN BATEAU (sur l'eau) : le voilier d'Elaijah, tangage doux + sillage +
  // petit saut à la bascule terre<->eau. sy = ligne d'eau (base de la coque).
  function drawBoat(sx, sy) {
    var bob = Math.sin(T * 2.6) * 1.8;
    var tilt = Math.sin(T * 1.7) * 0.04;
    var hop = 0;
    if (boatFlip != null) { var e = T - boatFlip; if (e < 0.4) hop = Math.sin(e / 0.4 * Math.PI) * 6; }
    // sillage
    ctx.save(); ctx.globalAlpha = 0.20; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(sx, sy + 3, 24, 8, 0, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke(); ctx.restore();
    // ombre sur l'eau
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#1f4a63';
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, 22, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    var im = IMG.boat;
    if (im && im.complete && im.naturalWidth) {
      var h = 72, w = h * (im.naturalWidth / im.naturalHeight);
      var faceRight = player.facing.x >= -0.05;
      ctx.save(); ctx.translate(sx, sy - bob - hop); ctx.rotate(tilt);
      if (!faceRight) ctx.scale(-1, 1);
      ctx.drawImage(im, -w / 2, -h + 4, w, h); // coque posée ~au niveau de l'eau
      ctx.restore();
    } else {
      // placeholder tant que l'asset n'est pas chargé
      ctx.save(); ctx.translate(sx, sy - bob - hop);
      ctx.fillStyle = '#b07a44'; ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(20, -6);
      ctx.quadraticCurveTo(16, 8, 0, 9); ctx.quadraticCurveTo(-16, 8, -20, -6); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }

  // Silhouette en pointillé quand le perso est masqué par un feuillage/élément.
  function drawPlayerGhost(sx, sy) {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#fff3ea';
    ctx.beginPath(); ctx.arc(sx, sy - 12, 15, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(239,138,104,0.28)';
    ctx.beginPath(); ctx.arc(sx, sy - 12, 15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Hache au sol : dessin de Charlie si présent, sinon placeholder vectoriel.
  function drawAxe(sx, sy) {
    var im = IMG.axe;
    if (im && im.complete && im.naturalWidth) {
      var h = 36, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, sx - w / 2, sy - h, w, h);
    } else {
      ctx.save(); ctx.translate(sx, sy - 14); ctx.rotate(-0.5);
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -12); ctx.stroke();
      ctx.fillStyle = '#c9ced6'; ctx.strokeStyle = '#5f6670'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-1, -12); ctx.lineTo(11, -17); ctx.lineTo(12, -5); ctx.lineTo(-1, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    var p = 0.5 + 0.5 * Math.sin(T * 3);
    ctx.save(); ctx.globalAlpha = 0.22 * p; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy - 10, 20, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  // Feu de camp : 3 couches -> fond (pierres arrière + trou), CONTENU (bûches /
  // flammes nichées), devant (arc de pierres). sy = base avant du foyer.
  function drawCampfire(cf, sx, sy) {
    var ib = IMG.firepitBack, iff = IMG.firepitFront;
    if (!ib || !ib.naturalWidth || !iff || !iff.naturalWidth) return;
    var w = 66; // ~moitié de la taille précédente
    var hB = w * (ib.naturalHeight / ib.naturalWidth);
    var hF = w * (iff.naturalHeight / iff.naturalWidth);
    // 1) FOND (trou + pierres arrière) : bas ~4px au-dessus de la base.
    ctx.drawImage(ib, sx - w / 2, sy - 4 - hB, w, hB);
    // 2) CONTENU : entre les deux plans (bûches/flammes) — vide pour l'instant.
    for (var i = 0; i < cf.contents.length; i++) {
      var ct = cf.contents[i], im = IMG[ct.key];
      if (!im || !im.naturalWidth) continue;
      var lh = 12 * ct.sz, lw = lh * (im.naturalWidth / im.naturalHeight);
      ctx.save(); ctx.translate(sx + ct.ox, sy - 14 + ct.oy); ctx.rotate(ct.rot);
      ctx.drawImage(im, -lw / 2, -lh * 0.7, lw, lh); ctx.restore();
    }
    // 3) DEVANT (arc) : bas ~2px sous la base -> chevauche bien le fond (pas de sol visible).
    ctx.drawImage(iff, sx - w / 2, sy + 2 - hF, w, hF);
  }

  // Tente : sprite ancré à la base ; "respire" (ronflement) quand on dort dedans.
  function drawTent(tt, sx, sy) {
    var im = IMG.tent;
    var breath = inTent ? (Math.sin(T * 2.3) * 0.05 + Math.sin(T * 0.7) * 0.02) : 0;
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#3c5028';
    ctx.beginPath(); ctx.ellipse(sx, sy, 30, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    if (im && im.complete && im.naturalWidth) {
      var h = 68 * (1 + breath), w = 68 * (im.naturalWidth / im.naturalHeight) * (1 - breath * 0.45);
      ctx.drawImage(im, sx - w / 2, sy - h, w, h);
    } else {
      ctx.save(); ctx.fillStyle = '#8a6bb0'; ctx.strokeStyle = '#3a2a4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy - 60); ctx.lineTo(sx + 30, sy); ctx.lineTo(sx - 30, sy); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  // Z's du sommeil : montent en ondulant, grandissent, s'estompent (rendu écran).
  function drawZs(cam) {
    var im = IMG.zzz;
    for (var i = 0; i < zs.length; i++) {
      var z = zs[i], p = z.t / z.life;
      var a = p < 0.15 ? p / 0.15 : (1 - (p - 0.15) / 0.85);
      var sx = z.x - cam.x + Math.sin(z.t * 2 + z.drift) * 12 + z.dir * z.t * 8;
      var sy = z.y - cam.y - z.t * 30;
      var sc = 0.55 + z.t * 0.3;
      ctx.save(); ctx.globalAlpha = Math.max(0, a) * 0.95;
      if (im && im.complete && im.naturalWidth) {
        var h = 22 * sc, w = h * (im.naturalWidth / im.naturalHeight);
        ctx.drawImage(im, sx - w / 2, sy - h, w, h);
      } else {
        ctx.fillStyle = '#fff'; ctx.font = '700 ' + Math.round(18 * sc) + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Z', sx, sy);
      }
      ctx.restore();
    }
  }

  // 2e monstre d'Elaijah, riggé en pièces, avec un cycle de MARCHE.
  // Assemblage = interprétation (les pièces sont dessinées détachées).
  function drawWalker(mo, sx, sy) {
    if (!IMG.mm_body || !IMG.mm_body.complete || !IMG.mm_body.naturalWidth) return;
    var p = mo.phase, s = mo.sz;
    var bob = Math.sin(p * 2) * 1.7;      // rebond du corps/tête
    var legSw = 0.42, armSw = 0.42;
    function limb(key, ax, ay, th, ang) {
      var im = IMG[key]; if (!im || !im.complete || !im.naturalWidth) return;
      var h = th * s, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.save(); ctx.translate(ax * s, ay * s); ctx.rotate(ang); ctx.drawImage(im, -w / 2, 0, w, h); ctx.restore();
    }
    function part(key, ax, ay, th) {
      var im = IMG[key]; if (!im || !im.complete || !im.naturalWidth) return;
      var h = th * s, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, ax * s - w / 2, ay * s - h, w, h);
    }
    ctx.save(); ctx.globalAlpha = 0.14; ctx.fillStyle = '#3c5028';
    ctx.beginPath(); ctx.ellipse(sx, sy, 15 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    ctx.save();
    ctx.translate(sx, sy);
    if (mo.face < 0) ctx.scale(-1, 1);   // orientation de marche
    limb('mm_legR', 6, -13, 21, Math.sin(p + Math.PI) * legSw);        // jambe droite (arrière)
    limb('mm_legL', -6, -13, 21, Math.sin(p) * legSw);                 // jambe gauche (avant)
    limb('mm_armL', -10, -28, 17, Math.sin(p + Math.PI) * armSw - 0.3); // bras gauche (derrière)
    part('mm_body', 0, -11 + bob, 24);                                 // corps
    limb('mm_armR', 10, -28, 17, Math.sin(p) * armSw + 0.3);           // bras droit (devant)
    part('mm_head', 0, -33 + bob * 1.1, 27);                           // tête (au-dessus)
    ctx.restore();
  }

  // 1er monstre d'Elaijah : anim d'idle (respiration + dandinement + balancement).
  function drawMonster(sx, sy) {
    var im = IMG.monster;
    if (!im || !im.complete || !im.naturalWidth) return;
    var breathe = 1 + 0.045 * Math.sin(monster.t * 3);
    var bob = Math.sin(monster.t * 4.2) * 3.2;      // dandinement vertical
    var sway = Math.sin(monster.t * 2.1) * 0.07;    // léger balancement
    var h = 88 * breathe, w = h * (im.naturalWidth / im.naturalHeight);
    ctx.save(); ctx.globalAlpha = 0.14; ctx.fillStyle = '#3c5028';
    ctx.beginPath(); ctx.ellipse(sx, sy, w * 0.3, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(sx, sy - bob); ctx.rotate(sway);
    ctx.drawImage(im, -w / 2, -h, w, h); ctx.restore();
  }

  // Bûche au sol (drop d'arbre), avec l'offset du hop de spawn + ombre.
  function drawLog(lg, sx, sy) {
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#3c5028';
    ctx.beginPath(); ctx.ellipse(sx, sy, 13 * lg.sz, 4.5 * lg.sz, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    var im = IMG[lg.key];
    if (!im || !im.complete || !im.naturalWidth) return;
    var h = 24 * lg.sz, w = h * (im.naturalWidth / im.naturalHeight);
    ctx.save(); ctx.translate(sx, sy - lg.z); ctx.rotate(lg.rot);
    ctx.drawImage(im, -w / 2, -h * 0.72, w, h); ctx.restore();
  }

  // Compteur de bûches (HUD haut-gauche) — icône = l'asset bûche de Charlie.
  function drawLogHud() {
    var x = 16, y = 56;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.strokeStyle = 'rgba(59,90,46,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, 86, 32); ctx.fill(); ctx.stroke();
    var im = IMG.logA;
    if (im && im.complete && im.naturalWidth) {
      var h = 17, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, x + 7, y + 16 - h / 2, w, h);
    }
    ctx.fillStyle = '#3b5a2e'; ctx.font = '700 16px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('' + logCount, x + 56, y + 22);
    ctx.restore();
  }

  // Animation de frappe placeholder : balayage de hache vers l'arbre.
  function drawSwing(sx, sy) {
    if (!swing) return;
    var se = T - swing.t0; if (se < 0 || se > 0.34) return;
    var ang = Math.atan2(player.facing.y, player.facing.x);
    var IMP = 0.13, off;
    if (se < IMP) { var p = se / IMP; off = -1.5 + (p * p) * 1.85; }             // accélère vers l'impact
    else { var r = (se - IMP) / (0.34 - IMP); off = 0.35 - Math.sin(r * Math.PI) * 0.18; } // arrêt net + petit recul
    ctx.save(); ctx.translate(sx, sy - 12); ctx.rotate(ang + off);
    ctx.strokeStyle = 'rgba(120,82,48,0.95)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(24, 0); ctx.stroke();
    ctx.fillStyle = '#c9ced6'; ctx.beginPath(); ctx.arc(25, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // flash bref au point d'impact
    if (swing.impacted && se < IMP + 0.09) {
      ctx.save(); ctx.globalAlpha = 0.6 * (1 - (se - IMP) / 0.09); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx + player.facing.x * 20, sy - 12 + player.facing.y * 20, 12, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }

  function drawParts(cam) {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], a = 1 - p.t / p.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.translate(p.x - cam.x, p.y - cam.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters(cam) {
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '600 15px system-ui, sans-serif';
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i], a = 1 - f.t / 1.4;
      ctx.globalAlpha = Math.max(0, a);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,40,15,0.6)'; ctx.fillStyle = '#fff';
      ctx.strokeText(f.text, f.x - cam.x, f.y - cam.y);
      ctx.fillText(f.text, f.x - cam.x, f.y - cam.y);
    }
    ctx.restore();
  }

  function drawAxeHud() {
    if (!hasAxe) return;
    var x = W - 34, y = 36; // coin haut-droit
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.strokeStyle = 'rgba(59,90,46,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    var im = IMG.axe; // l'asset hache de Charlie
    if (im && im.complete && im.naturalWidth) {
      var h = 28, w = h * (im.naturalWidth / im.naturalHeight);
      ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
    }
    ctx.restore();
  }

  // Chemin calculé par le pathfinding (pointillé, au-dessus du brouillard).
  function drawNavPath(cam) {
    if (!navPath || navI >= navPath.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2; ctx.setLineDash([4, 6]); ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x - cam.x, player.y - cam.y);
    for (var i = navI; i < navPath.length; i++) ctx.lineTo(navPath[i].x - cam.x, navPath[i].y - cam.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var k = navI; k < navPath.length - 1; k++) { ctx.beginPath(); ctx.arc(navPath[k].x - cam.x, navPath[k].y - cam.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  function drawDestMarker(cam, now) {
    if (!marker) return;
    var mx = marker.x - cam.x, my = marker.y - cam.y;
    var base = goActive ? 0.7 : 0.45;
    var pulse = base + 0.3 * Math.sin(now / 220);
    ctx.save();
    ctx.translate(mx, my);
    ctx.strokeStyle = 'rgba(255,255,255,' + pulse.toFixed(3) + ')';
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    var r = 11;
    ctx.beginPath();
    ctx.moveTo(-r, -r); ctx.lineTo(r, r);
    ctx.moveTo(r, -r); ctx.lineTo(-r, r);
    ctx.stroke();
    ctx.restore();
  }

  function renderFog(cam) {
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.clearRect(0, 0, W, H);
    // Inconnu = voile sombre et doux (pas noir pur, pour rester dans le pastel).
    fogCtx.fillStyle = 'rgba(28,38,30,0.92)';
    fogCtx.fillRect(0, 0, W, H);
    // Masque de révélation BASSE RÉSOLUTION : 1 texel = 1 cellule (+1 de marge).
    // On le ré-étale ensuite en LISSANT -> l'interpolation transforme les cases
    // carrées en dégradé, donc la frontière du brouillard suit une courbe fluide
    // (l'effet bevel/Bézier demandé) au lieu de marches d'escalier.
    var c0 = Math.floor(cam.x / CELL) - 1, r0 = Math.floor(cam.y / CELL) - 1;
    var c1 = Math.ceil((cam.x + W) / CELL) + 1, r1 = Math.ceil((cam.y + H) / CELL) + 1;
    var cols = c1 - c0 + 1, rows = r1 - r0 + 1;
    revealCv.width = cols; revealCv.height = rows;
    revealCtx.clearRect(0, 0, cols, rows);
    revealCtx.fillStyle = 'rgba(255,255,255,0.6)';  // mémoire (exploré hors vision) = éclairci partiel
    for (var rr = r0; rr <= r1; rr++) for (var cc = c0; cc <= c1; cc++) {
      if (isExplored(cc, rr)) revealCtx.fillRect(cc - c0, rr - r0, 1, 1);
    }
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.imageSmoothingEnabled = true;
    fogCtx.drawImage(revealCv, c0 * CELL - cam.x, r0 * CELL - cam.y, cols * CELL, rows * CELL);
    // Vision claire autour du perso (cercle dégradé) : efface à fond.
    var px = player.x - cam.x, py = player.y - cam.y;
    var grad = fogCtx.createRadialGradient(px, py, VISION * 0.42, px, py, VISION);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    fogCtx.fillStyle = grad;
    fogCtx.beginPath(); fogCtx.arc(px, py, VISION, 0, Math.PI * 2); fogCtx.fill();
    fogCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(fog, 0, 0, W, H);
  }

  // Mini-carte = RADAR centré sur le perso (monde infini : pas de carte globale).
  // Montre les cases explorées autour de lui, la maison, et le perso au centre.
  function renderMiniMap() {
    var size = Math.round(Math.min(132, Math.min(W, H) * 0.32));
    var pad = 12;
    var mx = pad, my = H - size - pad - 8;
    var RC = 26;                       // rayon affiché, en cellules
    var cell = size / (RC * 2 + 1);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(mx - 3, my - 3, size + 6, size + 6);
    ctx.strokeStyle = 'rgba(59,90,46,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(mx - 3, my - 3, size + 6, size + 6);
    // clip au cadre pour ne rien déborder
    ctx.beginPath(); ctx.rect(mx, my, size, size); ctx.clip();
    ctx.fillStyle = '#23301f'; ctx.fillRect(mx, my, size, size); // inexploré
    var pc = Math.floor(player.x / CELL), pr = Math.floor(player.y / CELL);
    ctx.fillStyle = '#8fc47a';                                   // exploré (vert pastel)
    for (var r = -RC; r <= RC; r++) for (var c = -RC; c <= RC; c++) {
      if (!isExplored(pc + c, pr + r)) continue;
      ctx.fillRect(mx + (c + RC) * cell, my + (r + RC) * cell, cell + 0.6, cell + 0.6);
    }
    // repère maison si dans la fenêtre
    var hc = Math.floor(HOME.x / CELL) - pc, hr = Math.floor(HOME.y / CELL) - pr;
    if (Math.abs(hc) <= RC && Math.abs(hr) <= RC) {
      ctx.fillStyle = '#e6b34d';
      ctx.beginPath(); ctx.arc(mx + (hc + RC + 0.5) * cell, my + (hr + RC + 0.5) * cell, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    // perso au centre
    ctx.fillStyle = '#ef8a68';
    ctx.beginPath(); ctx.arc(mx + size / 2, my + size / 2, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.restore();
  }

  function render(now) {
    var cam = camera();
    ctx.save();
    if (shake > 0.1) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawGround(cam);

    // Depth-sort : sapins/rochers + perso, triés par y (base) pour que le perso
    // passe devant ce qui est plus haut et derrière ce qui est plus bas.
    var items = [];
    for (var i = 0; i < decos.length; i++) {
      var d = decos[i];
      var sx = d.x - cam.x, sy = d.y - cam.y;
      if (sx < -180 || sx > W + 180 || sy < -240 || sy > H + 140) continue;
      items.push({ y: d.y, sx: sx, sy: sy, deco: d });
    }
    items.push({ y: player.y, sx: player.x - cam.x, sy: player.y - cam.y, player: true });
    if (!axe.picked) items.push({ y: axe.y, sx: axe.x - cam.x, sy: axe.y - cam.y, axe: true });
    for (var lgi = 0; lgi < logs.length; lgi++) { items.push({ y: logs[lgi].y, sx: logs[lgi].x - cam.x, sy: logs[lgi].y - cam.y, log: logs[lgi] }); }
    items.push({ y: campfire.y, sx: campfire.x - cam.x, sy: campfire.y - cam.y, campfire: true });
    items.push({ y: tent.y, sx: tent.x - cam.x, sy: tent.y - cam.y, tent: true });
    items.push({ y: monster.y, sx: monster.x - cam.x, sy: monster.y - cam.y, monster: true });
    for (var wi = 0; wi < walkers.length; wi++) { items.push({ y: walkers[wi].y, sx: walkers[wi].x - cam.x, sy: walkers[wi].y - cam.y, walker: walkers[wi] }); }
    items.sort(function (a, b) { return a.y - b.y; });
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.player) { if (!inTent) { if (onWater) drawBoat(it.sx, it.sy); else drawPlayer(it.sx, it.sy); } }
      else if (it.axe) drawAxe(it.sx, it.sy);
      else if (it.log) drawLog(it.log, it.sx, it.sy);
      else if (it.campfire) drawCampfire(campfire, it.sx, it.sy);
      else if (it.tent) drawTent(tent, it.sx, it.sy);
      else if (it.monster) drawMonster(it.sx, it.sy);
      else if (it.walker) drawWalker(it.walker, it.sx, it.sy);
      else drawSprite(it.deco, it.sx, it.sy);
    }

    // Perso masqué par un élément dessiné devant lui -> silhouette pointillée
    // par-dessus, pour qu'on le voie toujours (feuillage, etc.).
    var ppx = player.x - cam.x, ppy = player.y - cam.y, occluded = false;
    for (var oi = 0; oi < decos.length; oi++) {
      var od = decos[oi];
      if (od.y <= player.y) continue; // seulement le décor rendu DEVANT le perso
      var oim = IMG[od.key]; if (!oim || !oim.naturalWidth) continue;
      var oh = TARGET_H[od.type] * od.s, ow = oh * (oim.naturalWidth / oim.naturalHeight);
      var odx = od.x - cam.x, ody = od.y - cam.y;
      if (ppx > odx - ow * 0.42 && ppx < odx + ow * 0.42 && (ppy - 18) > ody - oh && ppy < ody + 4) { occluded = true; break; }
    }
    if (occluded && !inTent) drawPlayerGhost(ppx, ppy);
    if (!inTent) drawSwing(ppx, ppy);
    drawParts(cam);

    renderFog(cam);
    drawNavPath(cam);
    drawDestMarker(cam, now);
    renderMiniMap();
    drawZs(cam);
    drawFloaters(cam);
    drawAxeHud();
    drawLogHud();
    ctx.restore();
  }

  // Amorce le monde (décors + nav) autour de la maison avant la 1re frame.
  var booted = false;
  refreshActive();
  booted = true;

  // ── Boucle ───────────────────────────────────────────────────────────────
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 34);
    update(dt);
    render(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
