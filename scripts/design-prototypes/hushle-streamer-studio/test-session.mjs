import assert from 'node:assert/strict';
import {createSession, ranking, beginRound, acceptGuess, pause, resume, skipRound, tick, endSession, seedScenario, publicSnapshot} from './session.mjs';
let count = 0;
function test(name, run) { run(); count++; console.log('PASS ' + name); }
function connected() { const session = createSession(); session.connected = true; return session; }
function guess(session, overrides = {}, time = 1000) {
  return acceptGuess(session, {messageId: 'message-' + session.round, roundId: session.round,
    playerId: 'luna', name: 'Luna', text: 'Kutup ışıkları', target: 'KUTUP IŞIKLARI', ...overrides}, time);
}
test('disconnected start is rejected', () => assert.equal(beginRound(createSession(), 0), false));
test('winner is unique and last correct survives next round', () => {
  const s = connected(); beginRound(s, 0); assert.equal(guess(s), 'correct');
  const last = s.lastCorrect; assert.equal(guess(s, {playerId: 'deniz', messageId: 'other'}), 'closed');
  assert.equal(s.players.get('luna').points, 1); beginRound(s, 2000);
  assert.equal(s.winner, null); assert.equal(s.lastCorrect, last);
});
test('duplicate and stale guesses cannot score', () => {
  const s = connected(); beginRound(s, 0); assert.equal(guess(s, {text: 'Yanlış'}), 'wrong');
  assert.equal(guess(s), 'duplicate'); assert.equal(guess(s, {messageId: 'late', roundId: 0}), 'stale');
  assert.equal(s.players.get('luna').points, 0); assert.equal(s.participants.size, 1);
});
test('ties share rank, next correct changes leader', () => {
  const s = connected(); seedScenario(s, 'tie'); assert.deepEqual(ranking(s).map(p => p.rank), [1, 1, 3]);
  beginRound(s, 0); guess(s); assert.equal(ranking(s)[0].id, 'luna'); assert.equal(ranking(s)[0].points, 7);
});
test('pause blocks guesses and reconnect requires manual resume', () => {
  const s = connected(); beginRound(s, 0); pause(s, 12000); s.connected = false;
  assert.equal(resume(s, 20000), false); s.connected = true; assert.equal(s.phase, 'paused');
  assert.equal(guess(s), 'closed'); resume(s, 20000); assert.equal(s.remaining, 48);
  tick(s, 68000); assert.equal(s.phase, 'finished'); assert.equal(s.remaining, 0);
});
test('expired guesses reject before interval tick and timer never becomes negative', () => {
  const s = connected(); beginRound(s, 0); assert.equal(guess(s, {}, 60000), 'closed');
  tick(s, 999999); assert.equal(s.remaining, 0); assert.equal(s.players.size, 0);
});
test('skip preserves last correct and pause state', () => {
  const s = connected(); seedScenario(s, 'race'); const last = s.lastCorrect;
  beginRound(s, 0); pause(s, 1000); skipRound(s, 2000);
  assert.equal(s.phase, 'paused'); assert.equal(s.lastCorrect, last); assert.equal(s.round, 8);
});
test('same nickname is not same player identity', () => {
  const s = connected(); beginRound(s, 0); guess(s, {playerId: 'one', name: 'Aynı'});
  beginRound(s, 2000); guess(s, {playerId: 'two', name: 'Aynı', messageId: 'new'}, 3000);
  assert.equal(s.players.size, 2); assert.equal(s.participants.size, 2);
});
test('public projection is bounded and excludes secret fields', () => {
  const s = connected(); seedScenario(s, 'race'); s.target = 'SECRET'; s.taboos = ['SECRET2']; s.token = 'TOKEN';
  const dto = publicSnapshot(s, 3); assert.equal(dto.schemaVersion, 2); assert.equal(dto.scores.length, 3);
  assert.equal(dto.participants, 3); const json = JSON.stringify(dto);
  for (const forbidden of ['SECRET', 'TOKEN', 'playerId', 'seenMessages', 'target', 'taboos']) assert.ok(!json.includes(forbidden));
});
test('new session clears score and last correct', () => {
  const s = connected(); seedScenario(s, 'race'); endSession(s); beginRound(s, 0);
  assert.equal(s.players.size, 0); assert.equal(s.lastCorrect, null); assert.equal(s.round, 1);
});
console.log(count + ' checks passed. Local prototype model only; not production backend validation.');
