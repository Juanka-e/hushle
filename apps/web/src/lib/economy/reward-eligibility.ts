import type { SystemSettings } from "@/types/system-settings";
import type { RoomMatchSnapshot } from "@/lib/socket/game-socket";
import { resolveMatchRewardCoin } from "@/lib/system-settings/economy";
import { createHash } from "node:crypto";
import type {
    RewardEligibilityResult,
    RewardReviewFlag,
    RewardRoomMetrics,
} from "@/lib/economy/reward-types";

function buildRoomMetrics(room: RoomMatchSnapshot | null): RewardRoomMetrics {
    if (!room) {
        return {
            totalPlayers: 0,
            authenticatedPlayers: 0,
            guestPlayers: 0,
            matchStartedAt: null,
            sureSeconds: null,
            lineupPlayers: [],
            lineupIdentities: [],
        };
    }

    const totalPlayers = room.oyuncular.length;
    const authenticatedPlayers = room.oyuncular.filter((player) => Number.isInteger(player.userId) && player.userId !== null).length;

    return {
        totalPlayers,
        authenticatedPlayers,
        guestPlayers: Math.max(0, totalPlayers - authenticatedPlayers),
        matchStartedAt: room.matchStartedAt,
        sureSeconds: room.sureSeconds,
        lineupPlayers: room.oyuncular.map((player) => {
            if (player.takim === "A" || player.takim === "B") {
                return `${player.ad} (${player.takim})`;
            }

            return player.ad;
        }),
        lineupIdentities: room.oyuncular.map((player) => ({
            playerId: player.playerId,
            userId: player.userId,
            identityType: player.identityType,
            usernameSnapshot: player.usernameSnapshot,
            displayNameSnapshot: player.ad,
            team: player.takim,
            roleAtStart: player.roleAtStart,
        })),
    };
}

function buildReviewFlags(metrics: RewardRoomMetrics): RewardReviewFlag[] {
    const flags: RewardReviewFlag[] = [];

    if (metrics.totalPlayers > 1 && metrics.authenticatedPlayers === 1) {
        flags.push("single_authenticated_player_room");
    }

    if (metrics.guestPlayers > metrics.authenticatedPlayers) {
        flags.push("guest_majority_room");
    }

    if (metrics.totalPlayers > 0 && metrics.totalPlayers < 4) {
        flags.push("small_room_lineup");
    }

    return flags;
}

function buildLineupKey(room: RoomMatchSnapshot | null): string | null {
    if (!room || room.oyuncular.length === 0) {
        return null;
    }

    const identities = room.oyuncular
        .map((player) =>
            Number.isInteger(player.userId) && player.userId !== null
                ? `u:${player.userId}`
                : `g:${player.playerId}`
        )
        .sort()
        .join("|");

    if (!identities) {
        return null;
    }

    return createHash("sha256").update(identities).digest("hex").slice(0, 48);
}

export function evaluateMatchRewardEligibility(input: {
    userId: number;
    room: RoomMatchSnapshot | null;
    existingMatchResult: {
        coinEarned: number;
        won: boolean;
    } | null;
    settings: SystemSettings;
    now: Date;
}): RewardEligibilityResult {
    const { userId, room, existingMatchResult, settings, now } = input;
    const roomMetrics = buildRoomMetrics(room);
    const reviewFlags = buildReviewFlags(roomMetrics);
    const lineupKey = buildLineupKey(room);

    if (existingMatchResult) {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["already_claimed"],
            reviewFlags,
            roomMetrics,
        };
    }

    if (!room) {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["room_not_found"],
            reviewFlags,
            roomMetrics,
        };
    }

    if (
        room.oyunAktifMi ||
        room.matchStartedAt === null ||
        room.matchEndedAt === null
    ) {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["match_not_completed"],
            reviewFlags,
            roomMetrics,
        };
    }

    const participant = room.oyuncular.find((player) => player.userId === userId);
    if (!participant) {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["participant_not_found"],
            reviewFlags,
            roomMetrics,
        };
    }

    if (participant.roleAtStart === "İzleyici") {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["spectator_not_eligible"],
            reviewFlags,
            roomMetrics,
        };
    }

    const winner =
        room.skor.A === room.skor.B ? "Berabere" : room.skor.A > room.skor.B ? "A" : "B";
    const won = winner !== "Berabere" && participant.takim === winner;
    const baseRewardCoin =
        winner === "Berabere"
            ? settings.economy.drawRewardCoin
            : won
                ? settings.economy.winRewardCoin
                : settings.economy.lossRewardCoin;

    if (!Number.isFinite(baseRewardCoin) || baseRewardCoin < 0) {
        return {
            source: "match_reward",
            decision: "deny",
            reasonCodes: ["invalid_base_reward"],
            reviewFlags,
            roomMetrics,
        };
    }

    const reward = resolveMatchRewardCoin(baseRewardCoin, settings, now);

    return {
        source: "match_reward",
        decision: "allow_full",
        reasonCodes: [],
        reviewFlags,
        roomMetrics,
        baseRewardCoin: reward.baseRewardCoin,
        finalRewardCoin: reward.finalRewardCoin,
        won,
        modifiers: {
            rewardMultiplier: reward.multiplier,
            weekendBoostApplied: reward.weekendBoostApplied,
            reducedByRules: false,
        },
        participantPlayerId: participant.playerId,
        participantTeam: participant.takim,
        lineupKey,
    };
}
