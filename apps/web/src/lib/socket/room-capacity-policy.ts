import type { CapacitySettings } from "@/types/system-settings";

export const ROOM_HARD_MAX_PLAYERS = 20;
export const TEAM_HARD_MAX_PLAYERS = 10;
export const ROOM_MINIMUM_PLAYERS = 4;
export const TEAM_MINIMUM_PLAYERS = 2;

export type CapacityAdmissionLevel =
    | "normal"
    | "warning"
    | "critical"
    | "closed";

export interface CapacityTotals {
    activeRooms: number;
    onlinePlayers: number;
}

export interface RoomRulePlayer {
    identityType: "registered" | "guest";
    team: "A" | "B" | null;
    role: string;
    online: boolean;
}

export interface RoomStartDecision {
    allowed: boolean;
    minimumPlayers: number;
    activePlayers: number;
    registeredPlayers: number;
    teamAPlayers: number;
    teamBPlayers: number;
    message?: string;
}

export interface CapacityAdmissionDecision {
    level: CapacityAdmissionLevel;
    allowCreate: boolean;
    allowJoin: boolean;
    roomUsagePercent: number;
    playerUsagePercent: number;
    message: string | null;
}

function percentage(value: number, maximum: number): number {
    if (maximum <= 0) {
        return 100;
    }

    return Math.min(100, Math.max(0, Math.round((value / maximum) * 100)));
}

export function getEffectiveRoomMaxPlayers(settings: CapacitySettings): number {
    return Math.min(
        ROOM_HARD_MAX_PLAYERS,
        Math.max(ROOM_MINIMUM_PLAYERS, settings.roomMaxPlayers)
    );
}

export function getEffectiveTeamMaxPlayers(settings: CapacitySettings): number {
    return Math.min(
        TEAM_HARD_MAX_PLAYERS,
        Math.max(TEAM_MINIMUM_PLAYERS, settings.teamMaxPlayers)
    );
}

export function resolveRoomStartDecision(
    players: RoomRulePlayer[]
): RoomStartDecision {
    const activePlayers = players.filter(
        (player) =>
            player.online &&
            player.role !== "İzleyici" &&
            (player.team === "A" || player.team === "B")
    );
    const registeredPlayers = activePlayers.filter(
        (player) => player.identityType === "registered"
    ).length;
    const minimumPlayers = ROOM_MINIMUM_PLAYERS;
    const teamAPlayers = activePlayers.filter(
        (player) => player.team === "A"
    ).length;
    const teamBPlayers = activePlayers.filter(
        (player) => player.team === "B"
    ).length;

    if (activePlayers.length < minimumPlayers) {
        return {
            allowed: false,
            minimumPlayers,
            activePlayers: activePlayers.length,
            registeredPlayers,
            teamAPlayers,
            teamBPlayers,
            message: "Oyunu başlatmak için en az 4 aktif oyuncu gerekir.",
        };
    }

    if (
        teamAPlayers < TEAM_MINIMUM_PLAYERS ||
        teamBPlayers < TEAM_MINIMUM_PLAYERS
    ) {
        return {
            allowed: false,
            minimumPlayers,
            activePlayers: activePlayers.length,
            registeredPlayers,
            teamAPlayers,
            teamBPlayers,
            message: "Oyunu başlatmak için her takımda en az 2 aktif oyuncu bulunmalı.",
        };
    }

    return {
        allowed: true,
        minimumPlayers,
        activePlayers: activePlayers.length,
        registeredPlayers,
        teamAPlayers,
        teamBPlayers,
    };
}

export function chooseJoinTeam(
    players: RoomRulePlayer[],
    settings: CapacitySettings
): "A" | "B" | null {
    const maximum = getEffectiveTeamMaxPlayers(settings);
    const teamAPlayers = players.filter(
        (player) =>
            player.online && player.role !== "İzleyici" && player.team === "A"
    ).length;
    const teamBPlayers = players.filter(
        (player) =>
            player.online && player.role !== "İzleyici" && player.team === "B"
    ).length;

    if (teamAPlayers >= maximum && teamBPlayers >= maximum) {
        return null;
    }

    if (teamAPlayers >= maximum) {
        return "B";
    }

    if (teamBPlayers >= maximum) {
        return "A";
    }

    return teamAPlayers <= teamBPlayers ? "A" : "B";
}

export function canMoveToTeam(
    players: RoomRulePlayer[],
    targetTeam: "A" | "B",
    settings: CapacitySettings
): boolean {
    const targetCount = players.filter(
        (player) =>
            player.online &&
            player.role !== "İzleyici" &&
            player.team === targetTeam
    ).length;

    return targetCount < getEffectiveTeamMaxPlayers(settings);
}

export function evaluateCapacityAdmission(
    totals: CapacityTotals,
    settings: CapacitySettings
): CapacityAdmissionDecision {
    const roomUsagePercent = percentage(
        totals.activeRooms,
        settings.maxActiveRooms
    );
    const playerUsagePercent = percentage(
        totals.onlinePlayers,
        settings.maxOnlinePlayers
    );
    const peakUsagePercent = Math.max(roomUsagePercent, playerUsagePercent);
    const message = settings.capacityMessage.trim() || null;

    if (settings.admissionMode === "closed") {
        return {
            level: "closed",
            allowCreate: false,
            allowJoin: false,
            roomUsagePercent,
            playerUsagePercent,
            message,
        };
    }

    const roomFull = totals.activeRooms >= settings.maxActiveRooms;
    const playersFull = totals.onlinePlayers >= settings.maxOnlinePlayers;

    if (playersFull) {
        return {
            level: "closed",
            allowCreate: false,
            allowJoin: false,
            roomUsagePercent,
            playerUsagePercent,
            message,
        };
    }

    if (roomFull) {
        return {
            level: "critical",
            allowCreate: false,
            allowJoin: true,
            roomUsagePercent,
            playerUsagePercent,
            message,
        };
    }

    if (settings.admissionMode === "open") {
        return {
            level: "normal",
            allowCreate: true,
            allowJoin: true,
            roomUsagePercent,
            playerUsagePercent,
            message: null,
        };
    }

    if (peakUsagePercent >= settings.criticalThresholdPercent) {
        return {
            level: "critical",
            allowCreate: false,
            allowJoin: true,
            roomUsagePercent,
            playerUsagePercent,
            message,
        };
    }

    if (peakUsagePercent >= settings.warningThresholdPercent) {
        return {
            level: "warning",
            allowCreate: true,
            allowJoin: true,
            roomUsagePercent,
            playerUsagePercent,
            message: null,
        };
    }

    return {
        level: "normal",
        allowCreate: true,
        allowJoin: true,
        roomUsagePercent,
        playerUsagePercent,
        message: null,
    };
}
