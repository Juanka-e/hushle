import assert from 'node:assert/strict';
import {createSession, ranking, beginRound, acceptGuess, pause, resume, skipRound, tick, endSession, seedScenario, publicSnapshot} from './session.mjs';
const card = {target: 'KUTUP IŞIKLARI', taboos: ['Gökyüzü', 'Kuzey', 'Yeşil', 'Gece', 'Aurora']};
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
  const dto = publicSnapshot(s, 3, {target: 'SECRET', taboos: ['SECRET2']}); assert.equal(dto.schemaVersion, 4);
  assert.equal(dto.scores.length, 3); assert.equal(dto.participants, 3); assert.equal(dto.reveal, null);
  const json = JSON.stringify(dto);
  for (const forbidden of ['SECRET', 'TOKEN', 'playerId', 'seenMessages', 'target', 'taboos']) assert.ok(!json.includes(forbidden));
});
test('the card is revealed only after its round is over', () => {
  const s = connected(); const hidden = () => assert.equal(publicSnapshot(s, 1, card).reveal, null);
  hidden(); beginRound(s, 0); hidden(); pause(s, 5000); hidden(); resume(s, 6000); hidden();
  guess(s, {}, 9000);
  assert.deepEqual(publicSnapshot(s, 2, card).reveal, {target: 'KUTUP IŞIKLARI', taboos: card.taboos, solved: true});
  beginRound(s, 10000); hidden(); tick(s, 70000);
  assert.equal(publicSnapshot(s, 3, card).reveal.solved, false, 'time ran out: revealed, not solved');
  beginRound(s, 71000); skipRound(s, 72000); hidden(); endSession(s, 73000); hidden();
});
test('the revealed card is bounded', () => {
  const s = connected(); beginRound(s, 0); tick(s, 61000);
  const reveal = publicSnapshot(s, 1, {target: 'X'.repeat(90), taboos: ['Y'.repeat(50), 2, 3, 4, 5, 6, 7]}).reveal;
  assert.equal(reveal.target.length, 40); assert.equal(reveal.taboos.length, 5);
  assert.equal(reveal.taboos[0].length, 24); assert.equal(reveal.taboos[1], '2');
  assert.equal(publicSnapshot(s, 2, {taboos: []}).reveal, null, 'a card without a word reveals nothing');
});
test('solve time counts the clock, not pauses', () => {
  const s = connected(); beginRound(s, 0); guess(s, {}, 3800); assert.equal(s.lastCorrect.solveMs, 3800);
  beginRound(s, 5000); pause(s, 15000); resume(s, 55000); guess(s, {}, 57000);
  assert.equal(s.lastCorrect.solveMs, 12000);
});
test('theme, camera and channel fall back to safe values', () => {
  const s = connected(); assert.equal(publicSnapshot(s, 1).theme, 'oyun-gecesi'); assert.equal(publicSnapshot(s, 1).camera, 'br');
  assert.equal(publicSnapshot(s, 1).cameraSize, 'm'); assert.equal(publicSnapshot(s, 1).channel, null);
  s.broadcastTheme = '<img src=x>'; s.camera = 'top'; s.cameraSize = 'xl'; s.showCardName = 'yes'; s.streamCard = '3';
  s.channel = {platform: 'tiktok', name: 'x'};
  const dto = publicSnapshot(s, 2);
  assert.equal(dto.theme, 'oyun-gecesi'); assert.equal(dto.camera, 'none'); assert.equal(dto.cameraSize, 'm'); assert.equal(dto.showCardName, false); assert.equal(dto.cardBack, null);
  assert.equal(dto.channel, null);
  for (const slot of ['tl', 'tr', 'bl', 'br', 'left', 'right', 'none']) { s.camera = slot; assert.equal(publicSnapshot(s, 3).camera, slot); }
  s.channel = {platform: 'twitch', name: 'x'.repeat(40) + ''}; assert.equal(publicSnapshot(s, 4).channel.name.length, 25);
  s.broadcastTheme = 'sakura'; s.streamCard = 7; assert.deepEqual(publicSnapshot(s, 3).cardBack, {collection: 7, variant: 0});
  assert.equal(publicSnapshot(s, 3).theme, 'sakura');
  s.broadcastTheme = 'sade'; assert.equal(publicSnapshot(s, 4).theme, 'sade');
});
test('a pass names the passed round and turns the passed card face up', () => {
  const s = connected(); beginRound(s, 0); skipRound(s, 1000, card);
  assert.equal(publicSnapshot(s, 1).passedRound, 1); assert.equal(s.round, 2);
  assert.deepEqual(publicSnapshot(s, 1).passed, {round: 1, target: 'KUTUP IŞIKLARI'});
  assert.equal(publicSnapshot(s, 1, card).reveal, null, "the new round's card stays hidden");
  skipRound(s, 2000); assert.equal(publicSnapshot(s, 2).passed, null, 'a pass without a card reveals nothing');
  endSession(s, 3000); beginRound(s, 4000); assert.equal(publicSnapshot(s, 3).passedRound, null); assert.equal(publicSnapshot(s, 3).passed, null);
});
test('the timer look is a theme template until the streamer picks one', () => {
  const s = connected(); assert.equal(publicSnapshot(s, 1).clock, null, 'null means: use the theme template');
  s.timerStyle = 'sundial'; assert.equal(publicSnapshot(s, 2).clock, null);
  for (const style of ['hourglass', 'candle', 'bulbs', 'incense', 'ring', 'counter']) { s.timerStyle = style; assert.equal(publicSnapshot(s, 3).clock, style); }
});
test('new session clears score and last correct', () => {
  const s = connected(); seedScenario(s, 'race'); endSession(s); beginRound(s, 0);
  assert.equal(s.players.size, 0); assert.equal(s.lastCorrect, null); assert.equal(s.round, 1);
});
console.log(count + ' checks passed. Local prototype model only; not production backend validation.');
