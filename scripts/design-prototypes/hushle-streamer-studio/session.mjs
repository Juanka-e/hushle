export function createSession() {
  return {
    connected: false, phase: 'ready', duration: 60, remaining: 60,
    round: 1, index: 0, deadline: 0, winner: null, lastCorrect: null,
    players: new Map(), participants: new Set(), seenMessages: new Set(),
    eventCounter: 0, broadcastTheme: 'dark', language: 'tr', category: 'general',
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
    session.round = 1; session.index = 0; session.lastCorrect = null;
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

export function skipRound(session, now = Date.now()) {
  if (!['running', 'paused'].includes(session.phase)) return false;
  if (session.phase === 'running') {
    tick(session, now);
    if (session.phase !== 'running') return false;
  }
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
  session.lastCorrect = {eventId: 'sample-' + (++session.eventCounter), name: 'Luna', round: 6, pointsGranted: 1};
}

export function publicSnapshot(session, revision) {
  // Explicit projection: no answers, taboo words, chat bodies or account credentials.
  return {
    type: 'public-state', schemaVersion: 2, revision,
    phase: session.phase, remaining: session.remaining, duration: session.duration,
    round: session.round, theme: session.broadcastTheme,
    connected: session.connected, participants: session.participants.size,
    pack: session.language === 'en' ? 'EN' : 'TR',
    scores: ranking(session).slice(0, 3).map(player => ({
      name: player.name, points: player.points, rank: player.rank, tied: player.tied,
    })),
    lastCorrect: session.lastCorrect ? {...session.lastCorrect} : null,
    cardBack: session.equipped ? {collection: session.equipped.collection, variant: session.equipped.variant} : null,
  };
}
