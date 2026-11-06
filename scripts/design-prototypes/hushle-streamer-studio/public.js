'use strict';
// The public stream screen. It renders only the allowlisted snapshot the host panel sends
// (or a built-in demo); it never imports the word packs or the host script.
const params = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const THEMES = ['oyun-gecesi', 'studyo', 'gece-altini', 'sakura', 'sade'];
const PHASES = ['ready', 'running', 'paused', 'finished', 'ended'];
const SLOTS = ['none', 'tl', 'tr', 'bl', 'br', 'left', 'right'];
// Timer looks. Each theme ships with one (a ready-made template); the snapshot may name another.
const CLOCKS = ['hourglass', 'candle', 'bulbs', 'incense', 'ring', 'counter'];
const THEME_CLOCK = {'oyun-gecesi': 'hourglass', studyo: 'bulbs', 'gece-altini': 'candle', sakura: 'incense', sade: 'counter'};
const BULBS = 36, SEGMENTS = 20;
const SIZES = { s: [480, 270], m: [560, 315], l: [640, 360] };
const PLATFORM_NAMES = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube' };
// Crops of reference-cards.png: [x, y, w, h] for the front and the back of each family.
const COLLECTIONS = [
  {name: 'Gece Altını', front: [8, 6, 249, 370], back: [266, 6, 249, 370], light: false},
  {name: 'Parşömen', front: [541, 6, 252, 370], back: [800, 6, 252, 370], light: true},
  {name: 'Gece Mavisi', front: [8, 387, 249, 365], back: [266, 387, 249, 365], light: false},
  {name: 'Prizma', front: [541, 387, 252, 365], back: [800, 387, 252, 365], light: false},
  {name: 'Rüya Tozu', front: [8, 759, 249, 348], back: [266, 759, 249, 348], light: true},
  {name: 'Sakura', front: [541, 759, 252, 348], back: [800, 759, 252, 348], light: true},
  {name: 'Ejderha', front: [8, 1118, 249, 350], back: [266, 1118, 249, 350], light: false},
  {name: 'Bastet', front: [541, 1118, 252, 350], back: [800, 1118, 252, 350], light: true},
];
const CLASSIC = -1;
// The card each theme shows when the streamer keeps "the theme's card".
const THEME_CARD = {'oyun-gecesi': CLASSIC, studyo: 3, 'gece-altini': 0, sakura: 5, sade: CLASSIC};
const ROMAN = ['I', 'II', 'III'];
const SCORE_TITLES = {'oyun-gecesi': 'Skor', studyo: 'Liderler', 'gece-altini': 'Bu gecenin skoru', sakura: 'En çok bilenler', sade: 'Skor'};

const integer = (value, min, max, fallback = min) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
const text = (value, max = 40) => typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim().slice(0, max) : '';

// ---------------------------------------------------------------- layouts

// Where the webcam hole sits on the 1920x1080 canvas (70px from the edges; halves are exact).
function cameraRect(slot, size) {
  const [w, h] = SIZES[size] || SIZES.m;
  switch (slot) {
    case 'tl': return {x: 70, y: 70, w, h};
    case 'tr': return {x: 1850 - w, y: 70, w, h};
    case 'bl': return {x: 70, y: 1010 - h, w, h};
    case 'br': return {x: 1850 - w, y: 1010 - h, w, h};
    case 'left': return {x: 0, y: 0, w: 960, h: 1080};
    case 'right': return {x: 960, y: 0, w: 960, h: 1080};
    default: return null;
  }
}
window.cameraRect = cameraRect;

// The page can be a 1920x1080 scene, a standalone 960x1080 column (?layout=half) or a
// 1920x220 strip (?overlay=top|bottom). The scene's layout follows the camera slot.
const mode = params.get('overlay') ? 'strip' : params.get('layout') === 'half' ? 'half' : 'scene';
const CANVAS = {scene: [1920, 1080], half: [960, 1080], strip: [1920, 220]}[mode];
const stage = $('stage');
function fit() {
  const scale = mode === 'strip' ? innerWidth / CANVAS[0] : Math.min(innerWidth / CANVAS[0], innerHeight / CANVAS[1]);
  stage.style.setProperty('--scale', String(scale));
}
addEventListener('resize', fit); fit();
document.body.dataset.mode = mode;
if (mode === 'strip') document.body.dataset.strip = params.get('overlay') === 'top' ? 'top' : 'bottom';
// OBS browser sources expose window.obsstudio; the page is see-through outside the stage
// and inside the camera hole, so the webcam under it shows. The preview adds a dark backdrop.
if (params.get('preview') === '1' || params.has('demo')) document.body.classList.add('preview');

function applyLayout(state) {
  const body = document.body;
  const layout = mode === 'strip' ? 'strip' : mode === 'half' ? 'half' : state.camera === 'none' ? 'full' : state.camera;
  body.dataset.layout = layout;
  const column = ['left', 'right', 'half'].includes(layout);
  body.dataset.scores = layout === 'strip' ? 'row' : column ? 'stack' : 'wide';
  body.dataset.last = column ? 'card' : 'wide';
  body.dataset.timer = column || layout === 'strip' ? 'compact' : 'tall';
  body.dataset.card = ['tl', 'bl'].includes(layout) ? 'small' : 'normal';
  const cam = mode === 'scene' ? cameraRect(state.camera, state.cameraSize) : null;
  body.dataset.camera = cam ? state.camera : 'none';
  // On <body>, so the layout table (also on <body>) can place slots relative to the hole.
  for (const key of ['x', 'y', 'w', 'h']) body.style.setProperty('--cam-' + key, (cam ? cam[key] : 0) + 'px');
  return layout;
}

// ---------------------------------------------------------------- theme scenery

const FILIGREE = '<path d="M6 114V40C6 20 20 6 40 6h74M18 114V48c0-17 13-30 30-30h66M40 6c0 18 6 30 22 34M6 40c18 0 30 6 34 22" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="46" cy="46" r="5" fill="currentColor"/>';
const SCENERY = {
  sade: '',
  'oyun-gecesi': `
    <svg class="tea" viewBox="0 0 150 190">
      <defs>
        <linearGradient id="tea-body" x1="0" x2="1"><stop offset="0" stop-color="#6e1a07"/><stop offset=".35" stop-color="#b8400f"/><stop offset=".6" stop-color="#8f2c08"/><stop offset="1" stop-color="#5a1405"/></linearGradient>
        <linearGradient id="saucer" x1="0" x2="1"><stop offset="0" stop-color="#d9d4ca"/><stop offset=".5" stop-color="#fbf9f4"/><stop offset="1" stop-color="#cfc9bd"/></linearGradient>
      </defs>
      <ellipse cx="75" cy="172" rx="70" ry="15" fill="url(#saucer)"/>
      <ellipse cx="75" cy="170" rx="70" ry="13" fill="none" stroke="#b8322a" stroke-width="3"/>
      <path d="M44 34C44 64 58 82 58 100 58 120 46 136 48 164H102C104 136 92 120 92 100 92 82 106 64 106 34Z" fill="url(#tea-body)"/>
      <path d="M38 14C38 52 56 78 56 100 56 122 42 138 44 166H106C108 138 94 122 94 100 94 78 112 52 112 14Z" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="2.5"/>
      <ellipse cx="75" cy="34" rx="31" ry="5" fill="#d0561a" opacity=".85"/>
      <path d="M48 22C50 52 64 78 63 100M52 130C50 142 50 152 51 160" stroke="rgba(255,255,255,.55)" stroke-width="4" stroke-linecap="round" fill="none"/>
      <path d="M100 6 84 96" stroke="#c6c6c0" stroke-width="4" stroke-linecap="round"/>
    </svg>`,
  studyo: `
    <div class="bulbs"></div>
    <div class="stage-floor"></div>`,
  'gece-altini': `
    <div class="cloth"></div>
    <div class="gilt-frame"></div>
    <svg class="filigree tl" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree tr" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree bl" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="filigree br" viewBox="0 0 120 120">${FILIGREE}</svg>
    <svg class="candle" viewBox="0 0 120 260">
      <defs><radialGradient id="flame" cx="50%" cy="70%" r="60%"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffb347"/><stop offset="1" stop-color="rgba(255,120,40,0)"/></radialGradient></defs>
      <ellipse cx="60" cy="246" rx="52" ry="10" fill="#2a1a10"/>
      <path d="M22 240 30 150 90 150 98 240Z" fill="#b48a3a"/>
      <rect x="40" y="48" width="40" height="110" rx="6" fill="#f1e2c0"/>
      <path d="M40 60C44 80 36 96 46 110 52 118 40 130 40 150H80C80 130 70 118 76 104 84 92 76 78 80 60Z" fill="#fbf1d8"/>
      <rect x="58" y="32" width="4" height="18" fill="#3a2a1a"/>
      <ellipse class="flame" cx="60" cy="24" rx="22" ry="34" fill="url(#flame)"/>
    </svg>`,
  sakura: `
    <svg class="hills" viewBox="0 0 1920 300" preserveAspectRatio="none"><path d="M0 210C160 150 260 120 420 170S700 120 860 150 1180 90 1380 160 1700 120 1920 170V300H0Z" fill="#231d3f"/><path d="M0 250C220 210 380 230 560 245S900 205 1120 235 1540 215 1920 240V300H0Z" fill="#1a1530"/></svg>
    <div class="veranda"></div>
    <svg class="branch" viewBox="0 0 900 260">
      <path d="M900 40C760 52 640 70 520 104 400 138 300 128 190 150 120 164 60 196 0 214" fill="none" stroke="#2b1b18" stroke-width="18" stroke-linecap="round"/>
      <path d="M560 96C600 60 650 40 720 30M330 132C300 100 290 70 300 30M760 52C790 90 800 120 790 160" fill="none" stroke="#2b1b18" stroke-width="8" stroke-linecap="round"/>
      <g class="blossoms">${[[700, 34], [300, 36], [790, 150], [520, 100], [610, 76], [420, 128], [180, 150], [250, 140], [860, 42], [96, 186], [660, 50], [360, 120]].map(([x, y], i) => `<g transform="translate(${x} ${y}) rotate(${i * 37}) scale(${0.8 + (i % 3) * 0.2})"><circle r="9" cx="0" cy="-12"/><circle r="9" cx="11" cy="-4"/><circle r="9" cx="7" cy="10"/><circle r="9" cx="-7" cy="10"/><circle r="9" cx="-11" cy="-4"/><circle r="4" class="heart"/></g>`).join('')}</g>
    </svg>
    <div class="petals"></div>`,
};
let sceneryTheme = '';
function setScenery(theme) {
  if (theme === sceneryTheme) return;
  sceneryTheme = theme;
  $('scene-art').innerHTML = SCENERY[theme]; // constant markup, no snapshot data
}

// ---------------------------------------------------------------- text fitting

// Shrink a one-line node's font until it fits its box; beyond the floor the CSS ellipsis takes over.
function fitLine(node, max, min) {
  node.style.fontSize = max + 'px';
  let size = max;
  while (size > min && node.scrollWidth > node.clientWidth + 1) { size -= 2; node.style.fontSize = size + 'px'; }
}

// The revealed word: shrink until its longest word fits and it takes at most three lines;
// a single word too long even at the smallest size breaks across lines.
function fitWord(node, word) {
  const block = document.createElement('span'); block.className = 'words';
  word.split(/\s+/).forEach((part, i) => {
    if (i) block.append(' ');
    const span = document.createElement('span'); span.textContent = part; block.append(span);
  });
  node.replaceChildren(block);
  let size = 76;
  const fits = () => Math.max(...[...block.children].map(span => span.offsetWidth)) <= block.clientWidth && block.offsetHeight <= size * 1.08 * 3 + 2;
  node.style.fontSize = size + 'px';
  while (size > 22 && !fits()) { size -= 2; node.style.fontSize = size + 'px'; }
  if (fits()) return;
  block.classList.add('breakable');
  size = 44; node.style.fontSize = size + 'px';
  while (size > 24 && block.offsetHeight > size * 1.08 * 3 + 2) { size -= 2; node.style.fontSize = size + 'px'; }
}
window.fitWord = fitWord;

// ---------------------------------------------------------------- cards

function crop(rect) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', rect.join(' ')); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('class', 'art');
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  image.setAttribute('href', 'reference-cards.png'); image.setAttribute('width', '1065'); image.setAttribute('height', '1477');
  svg.append(image); return svg;
}
function classicBack() {
  const node = document.createElement('div'); node.className = 'classic-back';
  const mark = document.createElement('span'); mark.className = 'classic-mark'; mark.textContent = 'H';
  node.append(mark); return node;
}
let cardSignature = '';
function renderCard(collection) {
  if (String(collection) === cardSignature) return;
  cardSignature = String(collection);
  const family = COLLECTIONS[collection];
  $('card-back').replaceChildren(family ? crop(family.back) : classicBack());
  $('front-art').replaceChildren(...(family ? [crop(family.front)] : []));
  $('card-front').dataset.art = family ? (family.light ? 'light' : 'dark') : 'classic';
  document.body.style.setProperty('--deck-tone', family ? 'var(--deck-art)' : 'var(--deck-classic)');
}

// ---------------------------------------------------------------- scores

function tally(points) {
  if (points < 1 || points > 20) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const groups = Math.ceil(points / 5);
  svg.setAttribute('viewBox', `0 0 ${groups * 58} 50`); svg.setAttribute('class', 'tally'); svg.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < points; i++) {
    const group = Math.floor(i / 5), inGroup = i % 5, x = group * 58;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', inGroup === 4 ? `M${x - 2} 40 L${x + 42} 8` : `M${x + 4 + inGroup * 10} ${6 + (inGroup % 2) * 2} L${x + 2 + inGroup * 10} 46`);
    svg.append(line);
  }
  return svg;
}

let scoreSignature = '', previousLeader;
function renderScores(state) {
  const {scores, theme, phase} = state;
  const variant = document.body.dataset.scores;
  const signature = [theme, variant, phase === 'ended', JSON.stringify(scores)].join('|');
  if (signature === scoreSignature) return;
  scoreSignature = signature;
  const list = $('scores'); list.replaceChildren();
  // Tallies stay a column: once anyone passes 20 the whole column goes numeric.
  const tallies = theme === 'oyun-gecesi' && variant === 'wide' && scores.every(entry => entry.points <= 20);
  for (let slot = 0; slot < 3; slot++) {
    const entry = scores[slot];
    const item = document.createElement('li');
    item.className = 'score' + (entry ? '' : ' empty');
    item.dataset.slot = String(slot + 1);
    item.dataset.rank = String(Math.min(3, entry ? entry.rank : slot + 1));
    if (entry?.tied) item.dataset.tied = '';
    const rank = document.createElement('span'); rank.className = 'score-rank';
    const rankNumber = entry ? entry.rank : slot + 1;
    rank.textContent = theme === 'gece-altini' && variant !== 'row' ? (ROMAN[rankNumber - 1] || String(rankNumber)) : String(rankNumber);
    const name = document.createElement('span'); name.className = 'score-name';
    name.textContent = entry ? entry.name : '';
    if (entry) name.title = entry.name;
    const points = document.createElement('b'); points.className = 'score-points';
    points.textContent = entry ? String(entry.points) : '';
    item.append(rank, name);
    const marks = entry && tallies ? tally(entry.points) : null;
    if (marks) item.append(marks);
    item.append(points);
    if (entry?.tied) { const tie = document.createElement('span'); tie.className = 'score-tie'; tie.textContent = 'eşit'; item.append(tie); }
    list.append(item);
  }
  // Long chat names shrink before they are cut.
  for (const name of list.querySelectorAll('.score-name')) fitLine(name, parseFloat(getComputedStyle(name).fontSize), 28);
  const leader = scores[0] && !scores[0].tied ? scores[0].name : null;
  if (leader && previousLeader !== undefined && leader !== previousLeader && !reducedMotion.matches) {
    list.querySelector('[data-slot="1"]').classList.add('new-leader');
  }
  previousLeader = leader;
}

// ---------------------------------------------------------------- snapshot

function seconds(ms) {
  return (ms / 1000).toLocaleString('tr-TR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
}

function readSnapshot(data) {
  if (!data || data.type !== 'public-state' || data.schemaVersion !== 4 || !Number.isInteger(data.revision)) return null;
  const phase = PHASES.includes(data.phase) ? data.phase : 'ready';
  const back = data.cardBack && Number.isInteger(data.cardBack.collection) && data.cardBack.collection >= CLASSIC && data.cardBack.collection < COLLECTIONS.length
    ? data.cardBack.collection : null;
  const reveal = phase === 'finished' && data.reveal && text(data.reveal.target) ? {
    target: text(data.reveal.target),
    taboos: (Array.isArray(data.reveal.taboos) ? data.reveal.taboos : []).slice(0, 5).map(word => text(word, 24)).filter(Boolean),
    solved: data.reveal.solved === true,
  } : null;
  const last = data.lastCorrect && text(data.lastCorrect.name) ? {
    eventId: text(data.lastCorrect.eventId, 80), name: text(data.lastCorrect.name), round: integer(data.lastCorrect.round, 1, 999, 1),
    solveMs: Number.isFinite(data.lastCorrect.solveMs) ? integer(data.lastCorrect.solveMs, 0, 600000) : null,
  } : null;
  const channel = data.channel && text(data.channel.name, 25) && PLATFORM_NAMES[data.channel.platform]
    ? {platform: data.channel.platform, name: text(data.channel.name, 25)} : null;
  const passed = data.passed && Number.isInteger(data.passed.round) && text(data.passed.target)
    ? {round: data.passed.round, target: text(data.passed.target)} : null;
  const duration = integer(data.duration, 1, 600, 60);
  return {
    revision: data.revision, phase,
    theme: THEMES.includes(data.theme) ? data.theme : THEMES[0],
    camera: SLOTS.includes(data.camera) ? data.camera : 'none',
    cameraSize: SIZES[data.cameraSize] ? data.cameraSize : 'm',
    clock: CLOCKS.includes(data.clock) ? data.clock : null,
    showCardName: data.showCardName === true,
    remaining: integer(data.remaining, 0, duration), duration,
    round: integer(data.round, 1, 999, 1), passedRound: Number.isInteger(data.passedRound) ? data.passedRound : null,
    connected: data.connected === true, participants: integer(data.participants, 0, 999999),
    scores: (Array.isArray(data.scores) ? data.scores : []).slice(0, 3).filter(entry => entry && text(entry.name))
      .map(entry => ({name: text(entry.name), points: integer(entry.points, 0, 99999), rank: integer(entry.rank, 1, 999, 1), tied: entry.tied === true})),
    lastCorrect: last, cardBack: back, reveal, channel, passed,
  };
}

function replay(node, className) {
  if (reducedMotion.matches) return;
  node.classList.remove(className); void node.offsetWidth; node.classList.add(className);
}

// ---------------------------------------------------------------- copy

function promptFor(state, lowTime) {
  const chat = state.channel ? PLATFORM_NAMES[state.channel.platform] + ' sohbetine' : 'sohbete';
  const leader = state.scores[0];
  const solver = state.reveal?.solved && state.lastCorrect ? state.lastCorrect.name : null;
  switch (state.phase) {
    case 'ready': return `Yayıncı başlatınca kelimeyi ${chat} yaz.\nİlk doğru yazan puanı alır.`;
    case 'running': return (lowTime ? 'Son 10 saniye!' : `Anlatılan kelimeyi ${chat} yaz.`) + '\nİlk doğru yazan puanı alır.';
    case 'paused': return state.connected ? 'Süre durdu, birazdan devam.' : 'Sohbet bağlantısı bekleniyor.';
    case 'finished': return solver ? `${solver} bildi!\nSıradaki kartı yayıncı açacak.` : 'Süre doldu, kimse bilemedi.\nSıradaki kartı yayıncı açacak.';
    case 'ended': return leader ? (leader.tied ? 'Oyun bitti, liderler berabere.' : `Oyun bitti. ${leader.name} önde bitirdi.`) : 'Oyun bitti. Bir sonrakinde görüşürüz.';
  }
  return '';
}

// ---------------------------------------------------------------- render

let previous = null, lastRevision = -1, secondaryTimer = null, transientTimer = null;

// Stamp in the timer slot: the verdict of a round, or a pass.
function showVerdict(kind, word, detail) {
  const verdict = $('verdict');
  verdict.dataset.kind = kind;
  $('verdict-word').textContent = word;
  $('verdict-detail').textContent = detail || '';
  verdict.classList.add('show');
  replay(verdict, 'stamping');
}
function hideVerdict() { $('verdict').classList.remove('show'); }

function renderPrimary(state) {
  const body = document.body;
  body.dataset.theme = state.theme; body.dataset.phase = state.phase;
  setScenery(state.theme);
  const layout = applyLayout(state);

  const channel = $('channel');
  channel.textContent = state.channel ? `@${state.channel.name} · ${PLATFORM_NAMES[state.channel.platform]}` : 'Anlat, sohbet bilsin';
  channel.classList.toggle('handle', !!state.channel);

  const collection = state.cardBack ?? THEME_CARD[state.theme];
  renderCard(collection);
  const family = COLLECTIONS[collection];
  $('card-name').hidden = !state.showCardName || !family || !['ready', 'running', 'paused'].includes(state.phase);
  $('card-name').textContent = family ? 'Yayıncının kartı: ' + family.name : '';
  $('front-round').textContent = String(state.round);

  // Timer: the sand (wax, stick, arc, lit bulbs) follows the remaining share of the round.
  const timer = document.querySelector('.timer');
  const idle = state.phase === 'ready' || state.phase === 'ended';
  const share = idle ? 1 : state.remaining / state.duration;
  timer.style.setProperty('--p', String(share));
  document.body.dataset.clock = state.clock || THEME_CLOCK[state.theme];
  const lit = state.phase === 'ended' ? 0 : Math.ceil(share * BULBS);
  $('bulb-ring').querySelectorAll('circle').forEach((bulb, index) => bulb.classList.toggle('lit', index < lit));
  const segments = state.phase === 'ended' ? 0 : Math.ceil(share * SEGMENTS);
  $('segment-bar').querySelectorAll('rect').forEach((segment, index) => segment.classList.toggle('lit', index < segments));
  const low = state.phase === 'running' && state.remaining <= 10;
  timer.classList.toggle('low', low);
  $('seconds').textContent = state.phase === 'ready' ? 'Hazır' : String(state.remaining);
  $('seconds-note').textContent = state.phase === 'ready' ? `${state.duration} sn` : state.phase === 'paused' ? 'durdu' : '';
  $('round').textContent = state.round + '. tur';

  const card = $('card');
  const started = previous && state.phase === 'running' && ['ready', 'finished', 'ended'].includes(previous.phase);
  const passed = previous && state.passedRound !== null && state.passedRound !== previous.passedRound;
  if (started || passed) replay(timer, 'turning');
  // The sand turns over; the other timers light up again.
  if (started) replay(timer, 'relight');
  if (passed) {
    replay(card, 'passing');
    if (state.passed && state.passed.round === state.passedRound) showVerdict('pass', 'Pas', state.passed.target);
    else showVerdict('pass', 'Pas', '');
    clearTimeout(transientTimer);
    transientTimer = setTimeout(() => { if (!previous?.reveal) hideVerdict(); }, 3200);
  }
  if (started && previous.reveal) replay(card, 'drawing');

  // Reveal: the card turns over once its round is over. Its word leaves the page with it,
  // because a later round may draw the same word again.
  if (state.reveal) {
    const taboos = $('reveal-taboos'); taboos.replaceChildren();
    for (const word of state.reveal.taboos) { const item = document.createElement('li'); item.textContent = word; taboos.append(item); }
    fitWord($('reveal-target'), state.reveal.target);
    document.fonts.ready.then(() => fitWord($('reveal-target'), state.reveal.target));
  } else {
    $('reveal-target').replaceChildren(); $('reveal-taboos').replaceChildren();
    if (card.classList.contains('flipped')) {
      card.classList.add('instant'); card.classList.remove('flipped'); void card.offsetWidth; card.classList.remove('instant');
    }
  }
  const entering = state.reveal && !previous?.reveal;
  if (state.reveal && !entering) card.classList.add('flipped');
  if (entering) {
    const solver = state.reveal.solved && state.lastCorrect ? state.lastCorrect : null;
    showVerdict(state.reveal.solved ? 'solved' : 'timeout', state.reveal.solved ? 'Bildi!' : 'Süre doldu',
      solver ? solver.name + (solver.solveMs !== null ? ` · ${seconds(solver.solveMs)} sn` : '') : '');
    if (reducedMotion.matches) card.classList.add('flipped');
    else setTimeout(() => card.classList.add('flipped'), 420);
    replay(document.querySelector('.scene'), 'celebrate');
    if (state.reveal.solved && state.theme === 'sakura') petals();
  }
  if (!state.reveal && !passed && !(previous && state.passedRound === previous.passedRound && $('verdict').dataset.kind === 'pass' && $('verdict').classList.contains('show'))) hideVerdict();

  // Finale: the winner takes the card's place, the hourglass lies down.
  const winner = $('winner');
  const leader = state.scores[0];
  winner.hidden = state.phase !== 'ended' || !leader;
  if (!winner.hidden) {
    const tied = state.scores.filter(entry => entry.tied && entry.rank === 1).map(entry => entry.name);
    $('winner-label').textContent = tied.length > 1 ? 'Berabere bitirdiler' : 'Gecenin kazananı';
    $('winner-name').textContent = tied.length > 1 ? tied.join(' · ') : leader.name;
    $('winner-points').textContent = `${leader.points} puan`;
    fitLine($('winner-name'), 72, 36);
  }
  $('pause-sign').textContent = state.connected ? 'Kısa bir ara' : 'Bağlantı bekleniyor';
  $('scores-title').textContent = state.phase === 'ended' ? 'Gecenin skoru' : SCORE_TITLES[state.theme];
  return {layout, low};
}

// Scores, the last-solver note and the prompt: on a solve these wait for the flip.
// The prompt keeps to two lines: it shrinks a little before it would wrap a third time.
function fitPrompt(node, copy) {
  node.textContent = copy;
  const max = parseFloat(getComputedStyle(document.body).getPropertyValue('--prompt-size')) || 44;
  let size = max;
  node.style.fontSize = size + 'px';
  while (size > 34 && node.scrollHeight > size * 1.3 * 2 + 4) { size -= 2; node.style.fontSize = size + 'px'; }
}

function renderSecondary(state, low) {
  fitPrompt($('prompt'), promptFor(state, low));
  renderScores(state);
  $('participants').textContent = state.participants ? state.participants + ' kişi tahmin etti' : 'Henüz tahmin yok';

  const last = state.lastCorrect;
  $('last').classList.toggle('is-empty', !last);
  $('last-name').textContent = last ? last.name : '';
  if (last) fitLine($('last-name'), parseFloat(getComputedStyle($('last-name')).fontSize), 32);
  $('last-detail').textContent = last ? `${last.round}. turda bildi` + (last.solveMs !== null ? ` · ${seconds(last.solveMs)} sn` : '') : 'İlk doğru tahmin buraya yazılır.';
  // "+1" means a point was just given: only while the solved round is still on screen.
  $('last-points').hidden = !(last && state.phase === 'finished' && state.reveal?.solved && last.round === state.round);
  if (last && previous && last.eventId !== previous.lastCorrect?.eventId) replay($('last'), 'celebrate');

  // The overlay strip gets the reveal as a chip, since it has no card.
  const chip = $('strip-chip');
  if (state.reveal) {
    chip.dataset.kind = state.reveal.solved ? 'solved' : 'timeout';
    chip.textContent = (state.reveal.solved ? 'Bildi! · ' : 'Süre doldu · ') + state.reveal.target + (state.reveal.taboos.length ? ' · yasaklar: ' + state.reveal.taboos.join(', ') : '');
  } else if (state.passed && state.passedRound === state.passed.round && previous && state.passedRound !== previous.passedRound) {
    chip.dataset.kind = 'pass'; chip.textContent = 'Pas · ' + state.passed.target;
  } else {
    chip.dataset.kind = 'info';
    chip.textContent = promptFor(state, low).split('\n')[0];
  }
}

function render(state) {
  clearTimeout(secondaryTimer);
  const entering = state.reveal && !previous?.reveal;
  const {low} = renderPrimary(state);
  if (entering && !reducedMotion.matches) {
    // Stamp first, then the card, then who scored.
    const snapshot = state;
    secondaryTimer = setTimeout(() => renderSecondary(snapshot, false), 1200);
  } else {
    renderSecondary(state, low);
  }
  previous = state;
}

function petals() {
  if (reducedMotion.matches) return;
  const box = document.querySelector('.petals'); if (!box) return;
  box.replaceChildren();
  for (let i = 0; i < 18; i++) {
    const petal = document.createElement('i');
    petal.style.setProperty('--x', (120 + ((i * 97) % 760)).toFixed(0) + 'px');
    petal.style.setProperty('--drift', (((i * 53) % 220) - 60).toFixed(0) + 'px');
    petal.style.setProperty('--delay', (((i * 37) % 90) / 100).toFixed(2) + 's');
    petal.style.setProperty('--spin', (((i * 71) % 540) - 270).toFixed(0) + 'deg');
    box.append(petal);
  }
}

// The studio board's bulbs: index 0 at the top, clockwise; like the ring's arc they go out from the far end.
(function buildBulbs() {
  const bar = $('segment-bar');
  for (let i = 0; i < SEGMENTS; i++) {
    const segment = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    segment.setAttribute('x', String(16 + i * 11.4)); segment.setAttribute('y', '154');
    segment.setAttribute('width', '9'); segment.setAttribute('height', '28'); segment.setAttribute('rx', '3');
    segment.setAttribute('class', 'seg');
    bar.append(segment);
  }
  const ring = $('bulb-ring');
  for (let i = 0; i < BULBS; i++) {
    const angle = (i / BULBS) * Math.PI * 2 - Math.PI / 2;
    const bulb = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bulb.setAttribute('cx', (150 + Math.cos(angle) * 131).toFixed(1));
    bulb.setAttribute('cy', (150 + Math.sin(angle) * 131).toFixed(1));
    bulb.setAttribute('r', '7'); bulb.setAttribute('class', 'bulb');
    ring.append(bulb);
  }
})();

function accept(data) {
  const state = readSnapshot(data);
  if (!state || state.revision <= lastRevision) return;
  lastRevision = state.revision;
  render(state);
}

// ---------------------------------------------------------------- live or demo

if (params.has('demo')) {
  startDemo(params.get('demo'));
} else {
  const channel = new BroadcastChannel('hushle-preview-' + (params.get('session') || 'demo'));
  channel.onmessage = ({data}) => accept(data);
  channel.postMessage({type: 'preview-ready'});
  addEventListener('pagehide', () => channel.close());
  // Until the panel speaks, the look chosen in the URL already shows (an OBS source that
  // lost its link keeps the streamer's theme and camera hole).
  accept({type: 'public-state', schemaVersion: 4, revision: 0, phase: 'ready', theme: params.get('theme'),
    camera: params.get('camera') || 'none', cameraSize: params.get('size') || 'm', clock: params.get('clock'), scores: []});
}

// Built-in sample states for the theme gallery. Demo words only; nothing from the host.
function startDemo(name) {
  const theme = THEMES.includes(params.get('theme')) ? params.get('theme') : THEMES[0];
  const camera = SLOTS.includes(params.get('camera')) ? params.get('camera') : 'br';
  const cameraSize = SIZES[params.get('size')] ? params.get('size') : 'm';
  const clock = CLOCKS.includes(params.get('clock')) ? params.get('clock') : null;
  const cardParam = params.get('card');
  const cardBack = cardParam === null || cardParam === 'theme' ? null : {collection: integer(Number(cardParam), CLASSIC, COLLECTIONS.length - 1, CLASSIC)};
  const channel = params.get('channel') === 'none' ? null : {platform: 'twitch', name: params.get('channel') || 'denizoynuyor'};
  const race = [{name: 'Luna', points: 7, rank: 1}, {name: 'Deniz', points: 6, rank: 2}, {name: 'Mert_TR', points: 4, rank: 3}];
  const after = [{name: 'Deniz', points: 7, rank: 1, tied: true}, {name: 'Luna', points: 7, rank: 1, tied: true}, {name: 'Mert_TR', points: 4, rank: 3}];
  const longNames = [{name: 'xXx_KaraSavasci_2004_xXx', points: 12, rank: 1}, {name: 'Ahmet Yılmaz | Günlük Vlog ve Oyun', points: 11, rank: 2}, {name: 'bir_ismin_tam_yirmi_bes_k', points: 9, rank: 3}];
  const card = {target: 'MANDALİNA', taboos: ['Portakal', 'Kış', 'Kabuk', 'Turuncu', 'Meyve']};
  const base = {type: 'public-state', schemaVersion: 4, theme, camera, cameraSize, clock, showCardName: true, cardBack, connected: true, channel,
    duration: 60, remaining: 60, round: 7, passedRound: null, passed: null, participants: 23, scores: race,
    lastCorrect: {eventId: 'demo-6', name: 'Luna', round: 6, solveMs: 14200}, reveal: null};
  const states = {
    empty: {...base, phase: 'ready', round: 1, participants: 0, scores: [], lastCorrect: null},
    ready: {...base, phase: 'ready'},
    running: {...base, phase: 'running', remaining: 38},
    low: {...base, phase: 'running', remaining: 7},
    paused: {...base, phase: 'paused', remaining: 38},
    offline: {...base, phase: 'paused', remaining: 38, connected: false},
    solved: {...base, phase: 'finished', remaining: 51, scores: after, participants: 24,
      lastCorrect: {eventId: 'demo-7', name: 'Deniz', round: 7, solveMs: 8400}, reveal: {...card, solved: true}},
    timeout: {...base, phase: 'finished', remaining: 0, reveal: {...card, solved: false}},
    passed: {...base, phase: 'running', remaining: 60, round: 8, passedRound: 7, passed: {round: 7, target: 'MANDALİNA'}},
    ended: {...base, phase: 'ended', scores: after, participants: 31},
    longnames: {...base, phase: 'running', remaining: 38, scores: longNames, participants: 212,
      lastCorrect: {eventId: 'demo-6', name: 'Ahmet Yılmaz | Günlük Vlog ve Oyun', round: 6, solveMs: 14200}, channel: {platform: 'youtube', name: 'ahmetyilmazgunlukvlogoyun'}},
  };
  let revision = 1;
  const show = state => accept({...state, revision: revision++});
  if (name !== 'play') { show(states[name] || states.running); return; }

  // A short scripted round loop so the motion can be judged: count down, a correct guess,
  // the next round, a pass, a round that runs out of time, and the finale.
  let state = {...states.ready};
  const steps = [];
  const at = (delay, change) => steps.push([delay, change]);
  at(1200, () => ({...state, phase: 'running', remaining: 60}));
  for (let s = 59; s >= 52; s--) at(1000, () => ({...state, remaining: s}));
  at(700, () => ({...state, ...states.solved, remaining: 52, lastCorrect: {eventId: 'play-' + revision, name: 'Deniz', round: state.round, solveMs: 8400}}));
  at(4800, () => ({...state, phase: 'running', round: state.round + 1, remaining: 60, reveal: null}));
  for (let s = 59; s >= 55; s--) at(1000, () => ({...state, remaining: s}));
  at(1000, () => ({...state, round: state.round + 1, passedRound: state.round, passed: {round: state.round, target: 'KUM SAATİ'}, remaining: 60}));
  for (let s = 59; s >= 50; s--) at(1000, () => ({...state, remaining: s}));
  at(600, () => ({...state, remaining: 11}));
  for (let s = 10; s >= 0; s--) at(1000, () => ({...state, remaining: s, phase: s === 0 ? 'finished' : 'running', reveal: s === 0 ? {...card, solved: false} : null}));
  at(4200, () => ({...state, phase: 'ended'}));
  at(5000, () => ({...states.ready, round: state.round + 1, scores: state.scores}));
  let index = 0;
  const next = () => {
    const [delay, change] = steps[index];
    setTimeout(() => {
      state = change(); show(state);
      index = (index + 1) % steps.length;
      if (index === 0) state = {...states.ready};
      next();
    }, delay);
  };
  show(state); next();
}
