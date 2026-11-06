import {
    normalizeGuess,
    PASSED_TARGET_MAX,
    type BroadcastTheme,
    type CameraSize,
    type CameraSlot,
    type ChannelPlatform,
    type ClockStyle,
    type LastCorrect,
    type PassedCard,
    type PublicStreamSnapshot,
    type ResolvedCardThemeLike,
    type StreamCardBack,
    type StreamPhase,
} from "@hushle/domain-streamer";
import type { LiveStreamSession } from "@/lib/streamer/session-runtime";
import type { CosmeticMotionPreset, CosmeticPattern } from "@/types/economy";

// The public room's leak guard: streamer-socket.ts checks every state bound for a stream screen
// with assertNoSecret before it is sent, and sends only the copy the guard returns.

/** Which rule refused a public state: tests and reports name the rule, never the text it matched. */
export type StreamerLeakRule =
    | "not-public"
    | "host-field"
    | "early-reveal"
    | "no-reference"
    | "no-target"
    | "target"
    | "taboo"
    | "passed-target";

export class StreamerSecretLeakError extends Error {
    readonly rule: StreamerLeakRule;

    constructor(rule: StreamerLeakRule, reason: string) {
        super(`public state blocked (${rule}): ${reason}`);
        this.name = "StreamerSecretLeakError";
        this.rule = rule;
    }
}

const HOST_ONLY_FIELDS = ["card", "players", "tolerance", "pool"] as const;

// A path is a list of segments: an object key (a string, whatever it holds) or an array index
// (a number). A pattern matches segment by segment; INDEX matches any array index and nothing
// else, so a key spelt "*", "channel.name" or "reveal.x" never forges an exempt path.
type PathSegment = string | number;
const INDEX = Symbol("array index");
type Pattern = ReadonlyArray<string | typeof INDEX>;

function matches(pattern: Pattern, path: readonly PathSegment[]): boolean {
    return pattern.length === path.length && pattern.every((segment, at) => (segment === INDEX ? typeof path[at] === "number" : segment === path[at]));
}

// Fields filled from a fixed vocabulary: a member carries no card data, even when a taboo is
// spelt the same (the taboo "Candle" and the candle clock). Any other value there is compared.
// Each vocabulary is an exhaustive record of its union: a new member fails tsc until listed here.
const TYPES: Record<PublicStreamSnapshot["type"], true> = { "public-state": true };
const PHASES: Record<StreamPhase, true> = { ready: true, running: true, paused: true, finished: true, ended: true };
const THEMES: Record<BroadcastTheme, true> = { "oyun-gecesi": true, studyo: true, "gece-altini": true, sakura: true, sade: true };
const CAMERAS: Record<CameraSlot, true> = { none: true, tl: true, tr: true, bl: true, br: true, left: true, right: true };
const CAMERA_SIZES: Record<CameraSize, true> = { s: true, m: true, l: true };
const CLOCKS: Record<ClockStyle, true> = { hourglass: true, candle: true, bulbs: true, incense: true, ring: true, counter: true };
const PACKS: Record<PublicStreamSnapshot["pack"], true> = { TR: true, EN: true };
const CHANNEL_PLATFORMS: Record<ChannelPlatform, true> = { twitch: true, kick: true, youtube: true };
const PATTERNS: Record<CosmeticPattern, true> = { none: true, grid: true, dots: true, diagonal: true, chevrons: true, rings: true, noise: true };
const MOTIONS: Record<CosmeticMotionPreset, true> = { none: true, pulse: true, drift: true, shimmer: true };

function vocabulary(pattern: Pattern, members: Record<string, true>): readonly [Pattern, ReadonlySet<string>] {
    return [pattern, new Set(Object.keys(members))];
}

const VOCABULARY_FIELDS = [
    vocabulary(["type"], TYPES),
    vocabulary(["phase"], PHASES),
    vocabulary(["theme"], THEMES),
    vocabulary(["camera"], CAMERAS),
    vocabulary(["cameraSize"], CAMERA_SIZES),
    vocabulary(["clock"], CLOCKS),
    vocabulary(["pack"], PACKS),
    vocabulary(["channel", "platform"], CHANNEL_PLATFORMS),
    vocabulary(["cardBack", "theme", "pattern"], PATTERNS),
    vocabulary(["cardBack", "theme", "motionPreset"], MOTIONS),
];

// The card-back colours: skipped only while they hold a hex colour (`#DECADE` is no taboo
// "Decade"); any other value there is compared.
const COLOUR_KEYS: Record<Extract<keyof ResolvedCardThemeLike, `${string}Color`>, true> = {
    surfaceColor: true,
    borderColor: true,
    accentColor: true,
    secondaryColor: true,
    titleColor: true,
    detailColor: true,
    glowColor: true,
};
const COLOUR_FIELDS: Pattern[] = Object.keys(COLOUR_KEYS).map((key) => ["cardBack", "theme", key]);
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/i;

// Viewer, channel and card-back names are chat or catalogue text, never card data: a viewer
// whose name equals a taboo word is no leak, so those fields are not compared.
const NAME_FIELDS: Pattern[] = [["scores", INDEX, "name"], ["lastCorrect", "name"], ["channel", "name"], ["cardBack", "name"]];

// The previous pass's word stays on the stream screen. A taboo of the live card may be spelt the
// same (viewers never see the taboos); only the live word itself is a leak there.
const PASSED_WORD_FIELD: Pattern = ["passed", "target"];

// The projection's own keys, per object path: never compared. Any other key is card data until
// shown otherwise and is compared like a value. Exhaustive records again: a new projection field
// fails tsc until it is listed.
type Snapshot = PublicStreamSnapshot;
const ROOT_KEYS: Record<keyof Snapshot, true> = {
    type: true, schemaVersion: true, revision: true, phase: true, remaining: true, duration: true, round: true, passedRound: true,
    theme: true, camera: true, cameraSize: true, clock: true, showCardName: true, channel: true, passed: true, participants: true,
    pack: true, scores: true, lastCorrect: true, cardBack: true, connected: true, reveal: true,
};
const PASSED_KEYS: Record<keyof PassedCard, true> = { round: true, target: true };
const SCORE_KEYS: Record<keyof Snapshot["scores"][number], true> = { name: true, points: true, rank: true, tied: true };
const LAST_CORRECT_KEYS: Record<keyof LastCorrect, true> = { eventId: true, name: true, round: true, pointsGranted: true, solveMs: true };
const CHANNEL_KEYS: Record<keyof NonNullable<Snapshot["channel"]>, true> = { platform: true, name: true };
const CARD_BACK_KEYS: Record<keyof StreamCardBack, true> = { itemId: true, name: true, theme: true, imageUrl: true };
const THEME_KEYS: Record<keyof ResolvedCardThemeLike, true> = {
    renderSpecVersion: true, requestedRenderSpecVersion: true, usedRenderSpecFallback: true, surfaceColor: true, borderColor: true,
    accentColor: true, secondaryColor: true, titleColor: true, detailColor: true, pattern: true, patternOpacity: true, patternScale: true,
    motionPreset: true, motionSpeedMs: true, glowColor: true, glowBlur: true, glowOpacity: true, overlayImageUrl: true, overlayOpacity: true,
};
const REVEAL_KEYS: Record<keyof NonNullable<Snapshot["reveal"]>, true> = { target: true, taboos: true, solved: true };

const KNOWN_KEYS = [
    vocabulary([], ROOT_KEYS),
    vocabulary(["passed"], PASSED_KEYS),
    vocabulary(["scores", INDEX], SCORE_KEYS),
    vocabulary(["lastCorrect"], LAST_CORRECT_KEYS),
    vocabulary(["channel"], CHANNEL_KEYS),
    vocabulary(["cardBack"], CARD_BACK_KEYS),
    vocabulary(["cardBack", "theme"], THEME_KEYS),
    vocabulary(["reveal"], REVEAL_KEYS),
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Folded as the domain drops a recycled pass (normal tolerance: ı/i, ş/s, ğ/g, ç/c, ö/o, ü/u).
function comparable(word: string): string {
    return normalizeGuess(word, "normal");
}

/**
 * Calls `visit` with every string value and its path, and `visitKey` with every object key that is
 * not one of the projection's own at that path (with the path of the object holding it).
 */
function eachString(
    value: unknown,
    path: PathSegment[],
    visit: (path: readonly PathSegment[], text: string) => void,
    visitKey: (path: readonly PathSegment[], key: string) => void,
): void {
    if (typeof value === "string") visit(path, value);
    else if (Array.isArray(value)) value.forEach((item, index) => eachString(item, [...path, index], visit, visitKey));
    else if (isRecord(value)) {
        const known = KNOWN_KEYS.find(([pattern]) => matches(pattern, path))?.[1];
        for (const [key, child] of Object.entries(value)) {
            if (!known?.has(key)) visitKey(path, key);
            eachString(child, [...path, key], visit, visitKey);
        }
    }
}

// Socket.IO sends these as binary attachments, beside the JSON the guard reads: never sent.
function isBinary(value: unknown): boolean {
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
    if (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer) return true;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    // What a Buffer's toJSON leaves (its bytes as numbers): refused too, however it got there.
    return isRecord(value) && value.type === "Buffer" && Array.isArray(value.data);
}

/**
 * The JSON copy of `payload` the guard checks and the caller then sends: fails closed when it
 * cannot be sent as JSON or holds a binary value. The replacer looks at each value before and
 * after its toJSON.
 */
function onTheWire(payload: unknown): Record<string, unknown> {
    let wire: unknown;
    try {
        const json = JSON.stringify(payload, function (this: unknown, key: string, value: unknown) {
            if (isBinary(value) || (typeof this === "object" && this !== null && isBinary((this as Record<string, unknown>)[key]))) throw new StreamerSecretLeakError("not-public", "a binary value");
            return value;
        });
        wire = json === undefined ? undefined : JSON.parse(json);
    } catch {
        throw new StreamerSecretLeakError("not-public", "the payload does not serialize as plain JSON");
    }
    if (!isRecord(wire) || wire.type !== "public-state") throw new StreamerSecretLeakError("not-public", "not a public state");
    return wire;
}

/**
 * Returns the JSON copy of `payload` that may go to the public room of `live`, and throws
 * otherwise. The copy is what is checked and what the caller sends (nothing is read from the
 * payload again): a public projection with no host-only field, no binary value, no reveal while
 * the round is not over, and no string value, nor key outside the projection's own, equal to the
 * live card's word or one of its taboos once both are folded (normal tolerance). Names, a field's
 * fixed vocabulary and a card-back hex colour are not compared. The passed card's word is
 * compared with the live word only. A finished round's reveal is on the stream screen by design,
 * so it is not compared; the rest of that payload is. Fails closed when the live card has no word
 * to compare against. Each refusal names its rule (`StreamerSecretLeakError.rule`).
 */
export function assertNoSecret(payload: unknown, live: Pick<LiveStreamSession, "hostSnapshot">): Record<string, unknown> {
    const wire = onTheWire(payload);
    for (const field of HOST_ONLY_FIELDS) {
        if (field in wire) throw new StreamerSecretLeakError("host-field", `host-only field "${field}"`);
    }
    const host = live.hostSnapshot();
    const finished = host.phase === "finished";
    if (!finished && wire.reveal !== null && wire.reveal !== undefined) throw new StreamerSecretLeakError("early-reveal", "reveal before the round is over");
    const card = host.card;
    if (!card) return wire;
    const target = typeof card.target === "string" ? comparable(card.target) : "";
    if (!target) throw new StreamerSecretLeakError("no-target", "the live card has no word to compare against");
    // The passed card cuts its word: the live word cut the same way is the same leak.
    const shownTarget = comparable(card.target.slice(0, PASSED_TARGET_MAX));
    const taboos = new Set((Array.isArray(card.taboos) ? card.taboos : []).filter((word) => typeof word === "string").map(comparable).filter(Boolean));
    const secret = (text: string, where: string) => {
        const word = comparable(text);
        if (!word) return;
        if (word === target) throw new StreamerSecretLeakError("target", `the live word ${where}`);
        if (taboos.has(word)) throw new StreamerSecretLeakError("taboo", `a taboo of the live card ${where}`);
    };
    eachString(
        wire,
        [],
        (path, text) => {
            if (NAME_FIELDS.some((pattern) => matches(pattern, path))) return;
            if (finished && path[0] === "reveal") return;
            if (VOCABULARY_FIELDS.some(([pattern, members]) => members.has(text) && matches(pattern, path))) return;
            if (HEX_COLOUR.test(text) && COLOUR_FIELDS.some((pattern) => matches(pattern, path))) return;
            if (matches(PASSED_WORD_FIELD, path)) {
                const word = comparable(text);
                if (word && (word === target || word === shownTarget)) throw new StreamerSecretLeakError("passed-target", "the live word in the passed card");
                return;
            }
            secret(text, "in the payload");
        },
        (path, key) => {
            if (finished && path[0] === "reveal") return;
            secret(key, "as a key of the payload");
        },
    );
    return wire;
}
