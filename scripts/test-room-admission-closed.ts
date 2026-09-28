import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { Prisma, prisma } from "@hushle/platform-db";
import type { SystemSettings } from "../apps/web/src/types/system-settings";

const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3000";
const timeoutMs = 15_000;

interface SocketIdentity {
    playerId: string;
    guestToken: string;
}

interface LobbyPayload {
    odaKodu: string;
    oyuncular: Array<{
        playerId: string;
        ad: string;
        online: boolean;
        takim: "A" | "B" | null;
    }>;
    startReadiness: {
        activePlayers: number;
    };
}

interface ConnectedGuest {
    socket: Socket;
    identity: SocketIdentity;
    lobby: LobbyPayload;
}

interface CapacityBlock {
    level: string;
    retryAfterSeconds: number;
    message: string;
}

interface CapacityHealth {
    redis: {
        available: boolean;
    };
    cluster: {
        activeRooms: number;
        onlinePlayers: number;
        connectedSockets: number;
    };
    admission: {
        level: "normal" | "warning" | "critical" | "closed";
        allowCreate: boolean;
        allowJoin: boolean;
    };
}

function assertSafeMutationTarget(): void {
    assert.equal(
        process.env.CAPACITY_ADMISSION_MUTATION_TEST,
        "true",
        "CAPACITY_ADMISSION_MUTATION_TEST=true is required"
    );
    const url = new URL(serverUrl);
    assert.ok(
        url.hostname === "127.0.0.1" || url.hostname === "localhost",
        "Admission mutation test only supports a loopback server"
    );
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies
        .map((cookie) => cookie.split(";", 1)[0])
        .filter(Boolean)
        .join("; ");
}

async function loginAdmin(
    username: string,
    password: string
): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.ok, true);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callbackResponse = await fetch(
        `${serverUrl}/api/auth/callback/credentials`,
        {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                cookie: cookieHeaderFrom(csrfCookies),
            },
            body: new URLSearchParams({
                csrfToken: csrf.csrfToken,
                username,
                password,
                portal: "admin",
                callbackUrl: `${serverUrl}/admin`,
            }),
            redirect: "manual",
        }
    );
    assert.ok(
        callbackResponse.status === 200 ||
            callbackResponse.status === 302 ||
            callbackResponse.status === 303
    );
    const allCookies = [
        ...csrfCookies,
        ...callbackResponse.headers.getSetCookie(),
    ];
    assert.ok(
        allCookies.some((cookie) =>
            cookie.includes("authjs.session-token")
        )
    );
    return cookieHeaderFrom(allCookies);
}

async function readSettings(cookie: string): Promise<SystemSettings> {
    const response = await fetch(`${serverUrl}/api/admin/system-settings`, {
        headers: { cookie },
    });
    const payload = (await response.json()) as {
        settings?: SystemSettings;
        error?: string;
    };
    assert.equal(response.ok, true, payload.error);
    assert.ok(payload.settings);
    return payload.settings;
}

async function writeSettings(
    cookie: string,
    settings: SystemSettings
): Promise<SystemSettings> {
    const response = await fetch(`${serverUrl}/api/admin/system-settings`, {
        method: "PUT",
        headers: {
            "content-type": "application/json",
            cookie,
            origin: serverUrl,
            "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify(settings),
    });
    const payload = (await response.json()) as {
        settings?: SystemSettings;
        error?: string;
    };
    assert.equal(response.ok, true, payload.error);
    assert.ok(payload.settings);
    return payload.settings;
}

async function readCapacityHealth(cookie: string): Promise<CapacityHealth> {
    const response = await fetch(`${serverUrl}/api/admin/capacity-health`, {
        headers: { cookie },
    });
    const payload = (await response.json()) as CapacityHealth & {
        error?: string;
    };
    assert.equal(response.ok, true, payload.error);
    return payload;
}

function connectGuest(options: {
    name: string;
    roomCode?: string;
    guestToken?: string;
}): Promise<ConnectedGuest> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: {
                Origin: serverUrl,
            },
        });
        let identity: SocketIdentity | null = null;
        let lobby: LobbyPayload | null = null;
        let settled = false;

        const finish = () => {
            if (settled || !identity || !lobby) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ socket, identity, lobby });
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.disconnect();
            reject(error);
        };
        const timeout = setTimeout(
            () => fail(new Error(`${options.name} request timed out`)),
            timeoutMs
        );

        socket.on("connect", () => {
            socket.emit("room:request", {
                kullaniciAdi: options.name,
                ...(options.roomCode ? { odaKodu: options.roomCode } : {}),
                ...(options.guestToken
                    ? { guestToken: options.guestToken }
                    : {}),
            });
        });
        socket.on("kimlikAta", (nextIdentity: SocketIdentity) => {
            identity = nextIdentity;
            finish();
        });
        socket.on("lobiGuncelle", (nextLobby: LobbyPayload) => {
            if (
                options.roomCode &&
                nextLobby.odaKodu !== options.roomCode
            ) {
                return;
            }
            lobby = nextLobby;
            finish();
        });
        socket.on("connect_error", (error) => fail(error));
        socket.on("hata", (message: string) =>
            fail(new Error(String(message)))
        );
    });
}

function expectCapacityBlock(options: {
    name: string;
    roomCode?: string;
}): Promise<CapacityBlock> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: {
                Origin: serverUrl,
            },
        });
        let capacityBlock: CapacityBlock | null = null;
        const timeout = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${options.name} capacity block timed out`));
        }, timeoutMs);

        socket.on("connect", () => {
            socket.emit("room:request", {
                kullaniciAdi: options.name,
                ...(options.roomCode ? { odaKodu: options.roomCode } : {}),
            });
        });
        socket.on("kapasiteEngeli", (block: CapacityBlock) => {
            capacityBlock = block;
        });
        socket.on("hata", () => {
            if (!capacityBlock) return;
            clearTimeout(timeout);
            socket.disconnect();
            resolve(capacityBlock);
        });
        socket.on("lobiGuncelle", () => {
            clearTimeout(timeout);
            socket.disconnect();
            reject(new Error(`${options.name} was admitted unexpectedly`));
        });
        socket.on("connect_error", (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

function waitForActivePlayers(
    socket: Socket,
    activePlayers: number
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("lobiGuncelle", handleLobby);
            reject(new Error(`Active player count ${activePlayers} timed out`));
        }, timeoutMs);
        const handleLobby = (lobby: LobbyPayload) => {
            if (lobby.startReadiness.activePlayers !== activePlayers) return;
            clearTimeout(timeout);
            socket.off("lobiGuncelle", handleLobby);
            resolve();
        };
        socket.on("lobiGuncelle", handleLobby);
    });
}

function waitForSocketError(
    socket: Socket,
    action: () => void,
    expected: RegExp
): Promise<string> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off("hata", handleError);
            reject(new Error(`Expected socket error ${expected} timed out`));
        }, timeoutMs);
        const handleError = (message: string) => {
            if (!expected.test(String(message))) return;
            clearTimeout(timeout);
            socket.off("hata", handleError);
            resolve(String(message));
        };
        socket.on("hata", handleError);
        action();
    });
}

async function waitForCapacityHealth(
    cookie: string,
    predicate: (health: CapacityHealth) => boolean,
    label: string
): Promise<CapacityHealth> {
    const deadline = Date.now() + timeoutMs;
    let latest: CapacityHealth | null = null;

    while (Date.now() < deadline) {
        latest = await readCapacityHealth(cookie);
        if (predicate(latest)) return latest;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(
        `${label} capacity health timed out: ${JSON.stringify(latest)}`
    );
}

async function restoreRawSettingsRows(
    originalRows: Array<{
        key: string;
        value: Prisma.JsonValue;
        updatedByUserId: number | null;
    }>
): Promise<void> {
    const originalKeys = new Set(originalRows.map((row) => row.key));
    if (originalKeys.size === 0) {
        await prisma.systemSetting.deleteMany();
    } else {
        await prisma.systemSetting.deleteMany({
            where: { key: { notIn: [...originalKeys] } },
        });
    }
    for (const row of originalRows) {
        await prisma.systemSetting.upsert({
            where: { key: row.key },
            create: {
                key: row.key,
                value: row.value as Prisma.InputJsonValue,
                updatedByUserId: row.updatedByUserId,
            },
            update: {
                value: row.value as Prisma.InputJsonValue,
                updatedByUserId: row.updatedByUserId,
            },
        });
    }
}

async function run(): Promise<void> {
    assertSafeMutationTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const username = `capacity_admin_${suffix}`;
    const password = `CapacityAdmin-${suffix}!`;
    const sockets: Socket[] = [];
    const originalRows = await prisma.systemSetting.findMany({
        select: {
            key: true,
            value: true,
            updatedByUserId: true,
        },
    });
    let adminId: number | null = null;
    let adminCookie: string | null = null;
    let originalSettings: SystemSettings | null = null;
    let settingsChanged = false;

    try {
        const admin = await prisma.user.create({
            data: {
                username,
                password: await bcryptjs.hash(password, 10),
                role: "admin",
            },
        });
        adminId = admin.id;
        adminCookie = await loginAdmin(username, password);
        originalSettings = await readSettings(adminCookie);

        const host = await connectGuest({ name: "ClosedModeHost" });
        const reconnectTarget = await connectGuest({
            name: "ClosedModeReconnect",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(host.socket, reconnectTarget.socket);

        const third = await connectGuest({
            name: "DynamicLimitThird",
            roomCode: host.lobby.odaKodu,
        });
        const fourth = await connectGuest({
            name: "DynamicLimitFourth",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(third.socket, fourth.socket);

        const warningSettings = await writeSettings(adminCookie, {
            ...originalSettings,
            capacity: {
                ...originalSettings.capacity,
                admissionMode: "automatic",
                maxActiveRooms: 2,
                maxOnlinePlayers: 100,
                warningThresholdPercent: 50,
                criticalThresholdPercent: 75,
            },
        });
        settingsChanged = true;
        assert.equal(warningSettings.capacity.admissionMode, "automatic");
        const warningHealth = await waitForCapacityHealth(
            adminCookie,
            (health) => health.admission.level === "warning",
            "warning"
        );
        assert.equal(warningHealth.redis.available, true);
        assert.equal(warningHealth.admission.allowCreate, true);
        assert.equal(warningHealth.admission.allowJoin, true);
        assert.ok(warningHealth.cluster.activeRooms >= 1);
        assert.ok(warningHealth.cluster.onlinePlayers >= 4);
        assert.ok(warningHealth.cluster.connectedSockets >= 4);

        await writeSettings(adminCookie, {
            ...warningSettings,
            capacity: {
                ...warningSettings.capacity,
                maxActiveRooms: 1,
            },
        });
        const criticalHealth = await waitForCapacityHealth(
            adminCookie,
            (health) => health.admission.level === "critical",
            "critical"
        );
        assert.equal(criticalHealth.admission.allowCreate, false);
        assert.equal(criticalHealth.admission.allowJoin, true);
        const criticalCreateBlock = await expectCapacityBlock({
            name: "CriticalModeCreate",
        });
        assert.equal(criticalCreateBlock.level, "critical");

        const criticalJoin = await connectGuest({
            name: "CriticalModeJoin",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(criticalJoin.socket);

        const loweredSettings = await writeSettings(adminCookie, {
            ...warningSettings,
            capacity: {
                ...warningSettings.capacity,
                admissionMode: "open",
                roomMaxPlayers: 4,
                teamMaxPlayers: 2,
                maxActiveRooms: 100,
            },
        });
        const loweredHealth = await waitForCapacityHealth(
            adminCookie,
            (health) => health.admission.level === "normal",
            "open mode"
        );
        assert.equal(loweredHealth.admission.allowCreate, true);
        assert.equal(loweredHealth.admission.allowJoin, true);
        assert.equal(
            criticalJoin.lobby.oyuncular.filter((player) => player.online)
                .length,
            5
        );

        await assert.rejects(
            connectGuest({
                name: "LoweredRoomJoin",
                roomCode: host.lobby.odaKodu,
            }),
            /oda dolu/i
        );

        const switchCandidate =
            criticalJoin.lobby.oyuncular.find(
                (player) => player.playerId === third.identity.playerId
            ) ?? criticalJoin.lobby.oyuncular[0];
        const switchSocket =
            switchCandidate.playerId === third.identity.playerId
                ? third.socket
                : host.socket;
        await waitForSocketError(
            switchSocket,
            () => switchSocket.emit("takim_degistir"),
            /takımı dolu/i
        );

        const raisedSettings = await writeSettings(adminCookie, {
            ...loweredSettings,
            capacity: {
                ...loweredSettings.capacity,
                roomMaxPlayers: 6,
                teamMaxPlayers: 3,
            },
        });
        const resumedJoin = await connectGuest({
            name: "RaisedLimitJoin",
            roomCode: host.lobby.odaKodu,
        });
        sockets.push(resumedJoin.socket);
        assert.equal(
            resumedJoin.lobby.oyuncular.filter((player) => player.online)
                .length,
            6
        );

        const closedSettings = await writeSettings(adminCookie, {
            ...raisedSettings,
            capacity: {
                ...raisedSettings.capacity,
                admissionMode: "closed",
            },
        });
        assert.equal(closedSettings.capacity.admissionMode, "closed");
        const closedHealth = await waitForCapacityHealth(
            adminCookie,
            (health) => health.admission.level === "closed",
            "closed"
        );
        assert.equal(closedHealth.admission.allowCreate, false);
        assert.equal(closedHealth.admission.allowJoin, false);

        const createBlock = await expectCapacityBlock({
            name: "ClosedModeCreate",
        });
        assert.equal(createBlock.level, "closed");
        const joinBlock = await expectCapacityBlock({
            name: "ClosedModeJoin",
            roomCode: host.lobby.odaKodu,
        });
        assert.equal(joinBlock.level, "closed");

        const offlinePromise = waitForActivePlayers(host.socket, 5);
        reconnectTarget.socket.disconnect();
        await offlinePromise;
        const reconnected = await connectGuest({
            name: "ClosedModeReconnect",
            roomCode: host.lobby.odaKodu,
            guestToken: reconnectTarget.identity.guestToken,
        });
        sockets.push(reconnected.socket);
        assert.equal(
            reconnected.identity.playerId,
            reconnectTarget.identity.playerId
        );
        assert.equal(reconnected.lobby.startReadiness.activePlayers, 6);
        assert.equal(reconnected.lobby.oyuncular.length, 6);

        console.log(
            JSON.stringify({
                result: "closed admission reconnect test passed",
                createBlocked: true,
                joinBlocked: true,
                reconnectAllowed: true,
                loweredLimitsPreservedPlayers: true,
                raisedLimitsResumedAdmission: true,
                healthLevelsVerified: [
                    "warning",
                    "critical",
                    "closed",
                ],
            })
        );
    } finally {
        for (const socket of sockets) {
            socket.disconnect();
        }
        if (
            settingsChanged &&
            adminCookie &&
            originalSettings
        ) {
            await writeSettings(adminCookie, originalSettings);
        }
        await restoreRawSettingsRows(originalRows);
        if (adminId !== null) {
            await prisma.auditLog.deleteMany({
                where: { actorUserId: adminId },
            });
            await prisma.user.deleteMany({ where: { id: adminId } });
        }
        await prisma.$disconnect();
    }
}

void run();
