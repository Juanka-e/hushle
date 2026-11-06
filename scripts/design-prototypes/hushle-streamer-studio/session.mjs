export const BROADCAST_THEMES = ['oyun-gecesi', 'studyo', 'gece-altini', 'sakura', 'sade'];
// Where the streamer's webcam shows through the stream screen, and how big a corner hole is.
export const CAMERA_SLOTS = ['none', 'tl', 'tr', 'bl', 'br', 'left', 'right'];
export const CAMERA_SIZES = ['s', 'm', 'l'];
// Timer looks the stream screen knows. Each theme has its own template; `timerStyle` stays
// null until streamers get to mix and match.
export const TIMER_STYLES = ['hourglass', 'candle', 'bulbs', 'incense', 'ring', 'counter'];
export const PLATFORMS = ['twitch', 'kick', 'youtube'];

export function createSession() {
  return {
    connected: false, phase: 'ready', duration: 60, remaining: 60,
    round: 1, index: 0, deadline: 0, winner: null, lastCorrect: null, passedRound: null,
    players: new Map(), participants: new Set(), seenMessages: new Set(),
    eventCounter: 0, language: 'tr', category: 'general',
    broadcastTheme: BROADCAST_THEMES[0], camera: 'br', cameraSize: 'm', timerStyle: null, showCardName: true, streamCard: null,
    channel: null, passedCard: null,
  };
}

export function ranking(session) {
  const players = [...session.players.values()].filter(player => player.points > 0)
    .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id, 'en'));
  const counts = new Map();
  for (const player of players) counts.set(player.points, (counts.get(player.points) || 0) + 1);
  let rank = 0;
  return players.map((player, index) => {
    if (index === 0 || player.points !== players[index - 1].points) rank = index + 1;
    return {...player, rank, tied: counts.get(player.points) > 1};
  });
}

export function beginRound(session, now = Date.now()) {
  if (!session.connected || ['running', 'paused'].includes(session.phase)) return false;
  if (session.phase === 'ended') {
    session.players.clear(); session.participants.clear(); session.seenMessages.clear();
    session.round = 1; session.index = 0; session.lastCorrect = null; session.passedRound = null; session.passedCard = null;
  } else if (session.phase === 'finished') {
    session.round++; session.index++;
  }
  session.remaining = session.duration; session.winner = null;
  session.phase = 'running'; session.deadline = now + session.remaining * 1000;
  return true;
}

export function tick(session, now = Date.now()) {
  if (session.phase !== 'running') return false;
  const remaining = Math.max(0, Math.ceil((session.deadline - now) / 1000));
  const changed = remaining !== session.remaining;
  session.remaining = remaining;
  if (remaining === 0) session.phase = 'finished';
  return changed;
}

export function pause(session, now = Date.now()) {
  if (session.phase !== 'running') return false;
  tick(session, now);
  if (session.phase !== 'running') return false;
  session.phase = 'paused'; return true;
}

export function resume(session, now = Date.now()) {
  if (!session.connected || session.phase !== 'paused') return false;
  session.phase = 'running'; session.deadline = now + session.remaining * 1000;
  return true;
}

export function skipRound(session, now = Date.now(), card = null) {
  if (!['running', 'paused'].includes(session.phase)) return false;
  if (session.phase === 'running') {
    tick(session, now);
    if (session.phase !== 'running') return false;
  }
  session.passedRound = session.round;
  // A passed card is turned face up for everyone, as at a real table.
  session.passedCard = card && typeof card.target === 'string' ? {round: session.round, target: card.target.slice(0, 40)} : null;
  session.round++; session.index++; session.winner = null;
  session.remaining = session.duration; session.deadline = now + session.remaining * 1000;
  return true;
}

export function endSession(session, now = Date.now()) {
  if (session.phase === 'ended') return false;
  tick(session, now); session.phase = 'ended'; return true;
}

function normalize(text, language) {
  return text.normalize('NFC').toLocaleLowerCase(language === 'tr' ? 'tr-TR' : 'en-US')
    .replace(/[\s\p{P}]+/gu, '');
}

export function acceptGuess(session, input, now = Date.now()) {
  tick(session, now);
  if (!session.connected || session.phase !== 'running' || session.winner) return 'closed';
  if (input.roundId !== session.round) return 'stale';
  if (session.seenMessages.has(input.messageId)) return 'duplicate';
  const text = String(input.text || '').trim().slice(0, 80);
  const name = String(input.name || '').replace(/\p{Cc}/gu, '').trim().slice(0, 40);
  if (!text || !name || !input.playerId || !input.messageId) return 'invalid';
  session.seenMessages.add(input.messageId);
  while (session.seenMessages.size > 256) session.seenMessages.delete(session.seenMessages.values().next().value);
  session.participants.add(input.playerId);
  const player = session.players.get(input.playerId) || {id: input.playerId, name, points: 0};
  player.name = name; session.players.set(input.playerId, player);
  if (normalize(text, session.language) !== normalize(input.target, session.language)) return 'wrong';
  player.points++;
  session.winner = {id: player.id, name: player.name};
  session.lastCorrect = {
    eventId: 'correct-' + session.round + '-' + (++session.eventCounter),
    name: player.name, round: session.round, pointsGranted: 1,
    // Time on the clock, so pauses do not count.
    solveMs: Math.max(0, session.duration * 1000 - Math.max(0, session.deadline - now)),
  };
  session.phase = 'finished'; return 'correct';
}

export function seedScenario(session, scenario) {
  const scores = scenario === 'tie' ? [6, 6, 4] : [8, 6, 5];
  session.players.clear(); session.participants.clear(); session.seenMessages.clear();
  ['Deniz', 'Luna', 'Mert'].forEach((name, index) => {
    const id = ['deniz', 'luna', 'mert'][index];
    session.players.set(id, {id, name, points: scores[index]}); session.participants.add(id);
  });
  session.phase = 'ready'; session.round = 7; session.index = 0;
  session.remaining = session.duration; session.winner = null;
  session.passedRound = null; session.passedCard = null;
  session.lastCorrect = {eventId: 'sample-' + (++session.eventCounter), name: 'Luna', round: 6, pointsGranted: 1, solveMs: 14200};
}

// The card is revealed only once its round is over (guessed or out of time); while a round
// runs or waits, the projection never carries the word or its taboo list.
function revealedCard(session, card) {
  if (session.phase !== 'finished' || !card || typeof card.target !== 'string') return null;
  return {
    target: card.target.slice(0, 40),
    taboos: (Array.isArray(card.taboos) ? card.taboos : []).slice(0, 5).map(word => String(word).slice(0, 24)),
    solved: session.lastCorrect?.round === session.round,
  };
}

export function publicSnapshot(session, revision, card = null) {
  // Explicit projection: no live answers, chat bodies or account credentials.
  return {
    type: 'public-state', schemaVersion: 4, revision,
    phase: session.phase, remaining: session.remaining, duration: session.duration,
    round: session.round, passedRound: session.passedRound,
    theme: BROADCAST_THEMES.includes(session.broadcastTheme) ? session.broadcastTheme : BROADCAST_THEMES[0],
    camera: CAMERA_SLOTS.includes(session.camera) ? session.camera : 'none',
    cameraSize: CAMERA_SIZES.includes(session.cameraSize) ? session.cameraSize : 'm',
    clock: TIMER_STYLES.includes(session.timerStyle) ? session.timerStyle : null,
    showCardName: session.showCardName === true,
    channel: session.channel && PLATFORMS.includes(session.channel.platform) && typeof session.channel.name === 'string'
      ? {platform: session.channel.platform, name: session.channel.name.replace(/\p{Cc}/gu, '').slice(0, 25)} : null,
    passed: session.passedCard ? {...session.passedCard} : null,
    connected: session.connected, participants: session.participants.size,
    pack: session.language === 'en' ? 'EN' : 'TR',
    scores: ranking(session).slice(0, 3).map(player => ({
      name: player.name, points: player.points, rank: player.rank, tied: player.tied,
    })),
    lastCorrect: session.lastCorrect ? {...session.lastCorrect} : null,
    cardBack: Number.isInteger(session.streamCard) ? {collection: session.streamCard, variant: 0} : null,
    reveal: revealedCard(session, card),
  };
}
