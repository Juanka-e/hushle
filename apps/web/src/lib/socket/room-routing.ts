import type { RoomOwnershipCoordinator } from "./room-ownership";

export const ROOM_ROUTING_JOIN_ERROR =
    "Odaya şu anda bağlanılamıyor. Lütfen kısa süre sonra tekrar deneyin.";

export type RoomRouteDecisionKind =
    | "local"
    | "missing"
    | "remote-owner"
    | "local-state-missing"
    | "ownership-mismatch"
    | "unavailable";

export interface RoomRouteDecision {
    kind: RoomRouteDecisionKind;
}

export interface RoomRoutingStatus {
    enabled: boolean;
    available: boolean;
    mode: "observe-and-reject";
    routingReady: false;
    decisions: number;
    localDecisions: number;
    missingDecisions: number;
    remoteOwnerRequests: number;
    localStateMissing: number;
    ownershipMismatches: number;
    lookupFailures: number;
    lastDecisionAt: string | null;
}

export interface RoomRouteResolver {
    resolve(
        roomCode: string,
        localRoomPresent: boolean
    ): Promise<RoomRouteDecision>;
    getStatus(): RoomRoutingStatus;
}

export function shouldRejectRoomRoute(
    decision: RoomRouteDecision,
    localRoomPresent: boolean
): boolean {
    return (
        decision.kind === "remote-owner" ||
        decision.kind === "local-state-missing" ||
        decision.kind === "ownership-mismatch" ||
        (decision.kind === "unavailable" && !localRoomPresent)
    );
}

export function createRoomRouteResolver(
    ownership: RoomOwnershipCoordinator
): RoomRouteResolver {
    const enabled = ownership.getConfig().enabled;
    let available = enabled && ownership.getStatus().available;
    let decisions = 0;
    let localDecisions = 0;
    let missingDecisions = 0;
    let remoteOwnerRequests = 0;
    let localStateMissing = 0;
    let ownershipMismatches = 0;
    let lookupFailures = 0;
    let lastDecisionAt: string | null = null;

    function record(kind: RoomRouteDecisionKind): void {
        decisions += 1;
        lastDecisionAt = new Date().toISOString();
        if (kind === "local") localDecisions += 1;
        else if (kind === "missing") missingDecisions += 1;
        else if (kind === "remote-owner") remoteOwnerRequests += 1;
        else if (kind === "local-state-missing") localStateMissing += 1;
        else if (kind === "ownership-mismatch") ownershipMismatches += 1;
        else lookupFailures += 1;
    }

    return {
        async resolve(roomCode, localRoomPresent) {
            if (!enabled) {
                const kind = localRoomPresent ? "local" : "missing";
                record(kind);
                return { kind };
            }

            try {
                const ownerInstanceId = await ownership.getOwner(roomCode);
                const localInstanceId = ownership.getStatus().instanceId;
                available = true;

                let kind: RoomRouteDecisionKind;
                if (localRoomPresent) {
                    kind =
                        ownerInstanceId === localInstanceId
                            ? "local"
                            : "ownership-mismatch";
                } else if (ownerInstanceId === null) {
                    kind = "missing";
                } else if (ownerInstanceId === localInstanceId) {
                    kind = "local-state-missing";
                } else {
                    kind = "remote-owner";
                }

                record(kind);
                return { kind };
            } catch {
                available = false;
                record("unavailable");
                return { kind: "unavailable" };
            }
        },
        getStatus: () => ({
            enabled,
            available,
            mode: "observe-and-reject",
            routingReady: false,
            decisions,
            localDecisions,
            missingDecisions,
            remoteOwnerRequests,
            localStateMissing,
            ownershipMismatches,
            lookupFailures,
            lastDecisionAt,
        }),
    };
}
