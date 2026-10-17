import { z } from "zod";
import { GAME_MODE_IDS } from "@hushle/domain-game";
import type { RoomMatchSnapshot } from "@/lib/socket/game-socket";
import {
    MATCH_END_REASONS,
    MATCH_PARTICIPANT_ROLES,
    MATCH_SETTLEMENT_SNAPSHOT_VERSION,
    type MatchEndReason,
    type MatchSettlementSnapshot,
    type RegisteredSettlementParticipant,
} from "./types";

export class SettlementSnapshotError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SettlementSnapshotError";
    }
}

const MAX_PARTICIPANTS = 40;

const participantSchema = z
    .object({
        playerId: z.string().min(1).max(128),
        userId: z.number().int().positive().nullable(),
        identityType: z.enum(["registered", "guest"]),
        usernameSnapshot: z.string().max(64).nullable(),
        displayName: z.string().min(1).max(64),
        team: z.enum(["A", "B"]).nullable(),
        roleAtStart: z.enum(MATCH_PARTICIPANT_ROLES),
    })
    .strict()
    .refine(
        (participant) =>
            (participant.identityType === "registered") === (participant.userId !== null),
        { message: "registered participants need a userId and guests must not have one" }
    );

const snapshotSchema = z
    .object({
        version: z.literal(MATCH_SETTLEMENT_SNAPSHOT_VERSION),
        endReason: z.enum(MATCH_END_REASONS),
        roomCode: z.string().regex(/^[A-Z0-9]{4,12}$/),
        gameMode: z.enum(GAME_MODE_IDS),
        matchStartedAt: z.string().datetime(),
        matchEndedAt: z.string().datetime(),
        durationSeconds: z.number().int().min(0).nullable(),
        matchFormat: z.enum(["tur", "skor"]),
        matchTarget: z.number().int().min(0).max(100_000),
        score: z
            .object({
                A: z.number().int().min(0).max(100_000),
                B: z.number().int().min(0).max(100_000),
            })
            .strict(),
        participants: z.array(participantSchema).max(MAX_PARTICIPANTS),
    })
    .strict()
    .refine(
        (snapshot) =>
            Date.parse(snapshot.matchEndedAt) >= Date.parse(snapshot.matchStartedAt),
        { message: "match cannot end before it starts" }
    );

export function parseSettlementSnapshot(value: unknown): MatchSettlementSnapshot {
    const parsed = snapshotSchema.safeParse(value);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const path = issue?.path.join(".") || "snapshot";
        throw new SettlementSnapshotError(
            `Invalid match settlement snapshot at ${path}: ${issue?.message ?? "unknown"}`
        );
    }
    return parsed.data as MatchSettlementSnapshot;
}

export function createSettlementSnapshot(
    room: RoomMatchSnapshot,
    endReason: MatchEndReason
): MatchSettlementSnapshot {
    if (room.oyunAktifMi || room.matchStartedAt === null || room.matchEndedAt === null) {
        throw new SettlementSnapshotError(
            `Room ${room.odaKodu} has no finished match to settle`
        );
    }

    return parseSettlementSnapshot({
        version: MATCH_SETTLEMENT_SNAPSHOT_VERSION,
        endReason,
        roomCode: room.odaKodu,
        gameMode: room.gameMode,
        matchStartedAt: room.matchStartedAt,
        matchEndedAt: room.matchEndedAt,
        durationSeconds: room.sureSeconds,
        matchFormat: room.matchFormat,
        matchTarget: room.matchTarget,
        score: { A: room.skor.A, B: room.skor.B },
        participants: room.oyuncular.map((player) => ({
            playerId: player.playerId,
            userId: player.userId,
            identityType: player.identityType,
            usernameSnapshot: normalizeLabel(player.usernameSnapshot),
            displayName: normalizeLabel(player.ad) ?? "Oyuncu",
            team: player.takim,
            roleAtStart: player.roleAtStart,
        })),
    });
}

/** Cosmetic labels must never make a finished match unrecordable. */
function normalizeLabel(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim().slice(0, 64);
    return trimmed.length > 0 ? trimmed : null;
}

/** Reward pipeline input in the same shape the live room snapshot uses. */
export function toRewardRoomSnapshot(snapshot: MatchSettlementSnapshot): RoomMatchSnapshot {
    return {
        odaKodu: snapshot.roomCode,
        gameMode: snapshot.gameMode,
        oyunAktifMi: false,
        skor: { A: snapshot.score.A, B: snapshot.score.B },
        matchStartedAt: snapshot.matchStartedAt,
        matchEndedAt: snapshot.matchEndedAt,
        sureSeconds: snapshot.durationSeconds,
        matchFormat: snapshot.matchFormat,
        matchTarget: snapshot.matchTarget,
        matchEndReason: snapshot.endReason,
        oyuncular: snapshot.participants.map((participant) => ({
            playerId: participant.playerId,
            userId: participant.userId,
            identityType: participant.identityType,
            usernameSnapshot: participant.usernameSnapshot,
            ad: participant.displayName,
            takim: participant.team,
            roleAtStart: participant.roleAtStart,
        })),
    };
}

/** One entry per registered account; a second tab of the same user is ignored. */
export function getRegisteredParticipants(
    snapshot: MatchSettlementSnapshot
): RegisteredSettlementParticipant[] {
    const seen = new Set<number>();
    const participants: RegisteredSettlementParticipant[] = [];
    for (const participant of snapshot.participants) {
        if (participant.userId === null || seen.has(participant.userId)) continue;
        seen.add(participant.userId);
        participants.push({ ...participant, userId: participant.userId });
    }
    return participants;
}
