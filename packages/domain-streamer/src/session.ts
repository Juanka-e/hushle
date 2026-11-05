import { guessMatches, normalizeGuess } from "./guess";
import type {
    ChatGuess,
    GuessResult,
    RankedPlayer,
    StreamCard,
    StreamScreenSettings,
    StreamSessionState,
} from "./types";

const MAX_SEEN_MESSAGES = 256;
/** The passed card shows its word cut to this many UTF-16 units. */
export const PASSED_TARGET_MAX = 40;

export function createStreamSession(settings: StreamScreenSettings, now: number): StreamSessionState {
    return {
        phase: "ready",
        duration: settings.duration,
        remaining: settings.duration,
        round: 1,
        roundStartedAt: now,
        deadline: 0,
        winner: null,
        lastCorrect: null,
        passedRound: null,
        passedCard: null,
        card: null,
        tolerance: settings.tolerance === "strict" ? "strict" : "normal",
        settings,
        players: new Map(),
        participants: new Set(),
        seenMessages: [],
        eventCounter: 0,
    };
}

export function ranking(state: StreamSessionState): RankedPlayer[] {
    const players = [...state.players.values()]
        .filter((player) => player.points > 0)
        .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id, "en"));
    const counts = new Map<number, number>();
    for (const player of players) counts.set(player.points, (counts.get(player.points) ?? 0) + 1);
    let rank = 0;
    return players.map((player, index) => {
        if (index === 0 || player.points !== players[index - 1].points) rank = index + 1;
        return { ...player, rank, tied: (counts.get(player.points) ?? 0) > 1 };
    });
}

/**
 * The passed card stays face up until the next pass. When the card just dealt is that same word,
 * it would show the live word: the passed card goes. Compared folded (the normal tolerance, the
 * widest notion of one word) and cut as the passed card shows it.
 */
function dropRecycledPass(state: StreamSessionState): void {
    const passed = state.passedCard;
    const card = state.card;
    if (!passed || !card || typeof card.target !== "string") return;
    if (normalizeGuess(passed.target, "normal") === normalizeGuess(card.target.slice(0, PASSED_TARGET_MAX), "normal")) {
        state.passedCard = null;
    }
}

export function beginRound(state: StreamSessionState, card: StreamCard, now: number): boolean {
    if (state.phase === "running" || state.phase === "paused") return false;
    if (state.phase === "ended") {
        state.players.clear();
        state.participants.clear();
        state.seenMessages = [];
        state.round = 1;
        state.lastCorrect = null;
        state.passedRound = null;
        state.passedCard = null;
    } else if (state.phase === "finished") {
        state.round++;
    }
    state.card = card;
    dropRecycledPass(state);
    state.remaining = state.duration;
    state.winner = null;
    state.phase = "running";
    state.roundStartedAt = now;
    state.deadline = now + state.remaining * 1000;
    return true;
}

export function tick(state: StreamSessionState, now: number): boolean {
    if (state.phase !== "running") return false;
    const remaining = Math.max(0, Math.ceil((state.deadline - now) / 1000));
    const changed = remaining !== state.remaining;
    state.remaining = remaining;
    if (remaining === 0) state.phase = "finished";
    return changed;
}

export function pause(state: StreamSessionState, now: number): boolean {
    if (state.phase !== "running") return false;
    tick(state, now);
    if (state.phase !== "running") return false;
    state.phase = "paused";
    return true;
}

export function resume(state: StreamSessionState, now: number): boolean {
    if (state.phase !== "paused") return false;
    state.phase = "running";
    state.deadline = now + state.remaining * 1000;
    return true;
}

/**
 * Passes the current card (it is turned face up for everyone) and moves to the next round
 * in the same phase. `nextCard` is the card for the new round; without one, guesses stay
 * closed until the caller supplies it. Returns null when there is nothing to skip.
 */
export function skipRound(
    state: StreamSessionState,
    now: number,
    nextCard: StreamCard | null = null,
): { passed: StreamCard } | null {
    if (state.phase !== "running" && state.phase !== "paused") return null;
    if (state.phase === "running") {
        tick(state, now);
        if (state.phase !== "running") return null;
    }
    const passed = state.card;
    if (!passed) return null;
    state.passedRound = state.round;
    state.passedCard = { round: state.round, target: passed.target.slice(0, PASSED_TARGET_MAX) };
    state.round++;
    state.card = nextCard;
    dropRecycledPass(state);
    state.winner = null;
    state.remaining = state.duration;
    state.roundStartedAt = now;
    state.deadline = now + state.remaining * 1000;
    return { passed };
}

export function endSession(state: StreamSessionState, now: number): boolean {
    if (state.phase === "ended") return false;
    tick(state, now);
    state.phase = "ended";
    return true;
}

export function acceptGuess(state: StreamSessionState, guess: ChatGuess, now: number): GuessResult {
    tick(state, now);
    if (state.phase !== "running" || state.winner || !state.card) return "closed";
    if (guess.sentAt < state.roundStartedAt) return "stale";
    if (state.seenMessages.includes(guess.messageId)) return "duplicate";
    const text = String(guess.text ?? "").trim().slice(0, 80);
    const name = String(guess.name ?? "").replace(/\p{Cc}/gu, "").trim().slice(0, 40);
    const platformUserId = String(guess.platformUserId ?? "");
    if (!name || !platformUserId || !guess.messageId || !normalizeGuess(text, state.tolerance)) return "invalid";
    state.seenMessages.push(guess.messageId);
    while (state.seenMessages.length > MAX_SEEN_MESSAGES) state.seenMessages.shift();
    const id = `${guess.platform}:${platformUserId}`;
    state.participants.add(id);
    const player = state.players.get(id) ?? { id, name, points: 0 };
    player.name = name;
    state.players.set(id, player);
    if (!guessMatches(text, state.card.target, state.tolerance)) return "wrong";
    player.points++;
    state.winner = { id: player.id, name: player.name };
    state.lastCorrect = {
        eventId: `correct-${state.round}-${++state.eventCounter}`,
        name: player.name,
        round: state.round,
        pointsGranted: 1,
        // Time on the clock, so pauses do not count.
        solveMs: Math.max(0, state.duration * 1000 - Math.max(0, state.deadline - now)),
    };
    state.phase = "finished";
    return "correct";
}
