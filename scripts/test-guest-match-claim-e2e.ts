import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcryptjs from "bcryptjs";
import { io, type Socket } from "socket.io-client";
import { prisma } from "@hushle/platform-db";
import { closeRedisClient } from "@hushle/platform-cache";
import { invalidateCategoryCache } from "../apps/web/src/lib/socket/category-service";
import { getSystemSettings } from "../apps/web/src/lib/system-settings/service";
import { resolveMatchRewardCoin } from "../apps/web/src/lib/system-settings/economy";

// Guest plays a real match on a running server, then moves it to an account through
// sign-up, sign-in and email verification. Needs a built server (see SOCKET_TEST_URL).
const serverUrl = process.env.SOCKET_TEST_URL ?? "http://127.0.0.1:3301";
const timeoutMs = 30_000;

interface LobbyPlayer {
    playerId: string;
    ad: string;
    takim: "A" | "B" | null;
}
interface LobbyPayload {
    odaKodu: string;
    oyuncular: LobbyPlayer[];
}
interface Seat {
    name: string;
    socket: Socket;
    playerId: string;
    guestToken: string | null;
}

function assertSafeTarget(): void {
    assert.equal(process.env.GUEST_MATCH_CLAIM_E2E_TEST, "true", "GUEST_MATCH_CLAIM_E2E_TEST=true is required");
    const url = new URL(serverUrl);
    assert.ok(url.hostname === "127.0.0.1" || url.hostname === "localhost", "loopback server only");
}

function cookieHeaderFrom(setCookies: string[]): string {
    return setCookies.map((cookie) => cookie.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function login(username: string, password: string): Promise<string> {
    const csrfResponse = await fetch(`${serverUrl}/api/auth/csrf`);
    assert.equal(csrfResponse.ok, true);
    const csrf = (await csrfResponse.json()) as { csrfToken: string };
    const csrfCookies = csrfResponse.headers.getSetCookie();
    const callback = await fetch(`${serverUrl}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeaderFrom(csrfCookies) },
        body: new URLSearchParams({ csrfToken: csrf.csrfToken, username, password, portal: "user", callbackUrl: `${serverUrl}/dashboard` }),
        redirect: "manual",
    });
    const cookies = [...csrfCookies, ...callback.headers.getSetCookie()];
    assert.ok(cookies.some((cookie) => cookie.includes("authjs.session-token")), `login failed for ${username}`);
    return cookieHeaderFrom(cookies);
}

function connect(name: string, roomCode?: string, cookie?: string): Promise<{ seat: Seat; lobby: LobbyPayload }> {
    return new Promise((resolve, reject) => {
        const socket = io(serverUrl, {
            path: "/api/socketio",
            transports: ["websocket"],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: serverUrl, ...(cookie ? { Cookie: cookie } : {}) },
        });
        let identity: { playerId: string; guestToken: string | null } | null = null;
        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${name} join timed out`));
        }, timeoutMs);
        socket.on("connect", () => socket.emit("room:request", { kullaniciAdi: name, ...(roomCode ? { odaKodu: roomCode } : {}) }));
        socket.once("kimlikAta", (payload: { playerId: string; guestToken: string | null }) => {
            identity = payload;
        });
        socket.once("lobiGuncelle", (lobby: LobbyPayload) => {
            clearTimeout(timer);
            assert.ok(identity, `${name} got no identity before the lobby`);
            resolve({ seat: { name, socket, playerId: identity.playerId, guestToken: identity.guestToken }, lobby });
        });
        socket.on("connect_error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function waitFor<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${event} timed out`)), timeoutMs);
        socket.once(event, (payload: T) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${serverUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: serverUrl, ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json: Record<string, unknown> = {};
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch {
        // Non-JSON error pages are asserted through the status code.
    }
    return { status: response.status, body: json };
}

const claimPath = "/api/game/match/guest-claims";

async function run(): Promise<void> {
    assertSafeTarget();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const userIds: number[] = [];
    const guestPlayerIds: string[] = [];
    const sockets: Socket[] = [];
    let roomCode: string | null = null;
    let categoryId: number | null = null;
    let wordId: number | null = null;

    async function makeUser(label: string, options: { unverified?: boolean } = {}) {
        const username = `gc_${label}_${suffix}`.slice(0, 40);
        const password = `Claim-${suffix}-${label}!`;
        const email = `${username}@example.test`;
        const user = await prisma.user.create({
            data: {
                username,
                email,
                normalizedEmail: email,
                password: await bcryptjs.hash(password, 10),
                role: "user",
                ...(options.unverified
                    ? { accountStatus: "pending_email_verification" as const, emailVerificationRequiredAt: new Date() }
                    : {}),
            },
        });
        userIds.push(user.id);
        return { id: user.id, username, email, cookie: await login(username, password) };
    }

    try {
        const category = await prisma.category.create({ data: { name: `Guest claim e2e ${suffix}`, color: "#16a34a", isVisible: true } });
        categoryId = category.id;
        const word = await prisma.word.create({
            data: {
                wordText: `guest-claim-e2e-${suffix}`,
                difficulty: 1,
                tabooWords: { create: [{ tabooWordText: "test" }] },
                wordCategories: { create: [{ categoryId }] },
            },
        });
        wordId = word.id;
        await invalidateCategoryCache();
        const settings = await getSystemSettings();

        // A 3v3 match: one registered host and five guests, played to the score target.
        const host = await makeUser("host");
        const hostJoin = await connect(host.username, undefined, host.cookie);
        roomCode = hostJoin.lobby.odaKodu;
        sockets.push(hostJoin.seat.socket);
        const guests: Seat[] = [];
        let lobby = hostJoin.lobby;
        for (let index = 1; index <= 5; index += 1) {
            const nextLobby = waitFor<LobbyPayload>(hostJoin.seat.socket, "lobiGuncelle");
            const join = await connect(`Misafir${index}${suffix.slice(0, 4)}`, roomCode);
            sockets.push(join.seat.socket);
            assert.match(join.seat.playerId, /^guest:/);
            assert.ok(join.seat.guestToken, "guests receive a signed token");
            guests.push(join.seat);
            guestPlayerIds.push(join.seat.playerId);
            lobby = await nextLobby;
        }
        const teamOf = (playerId: string) => lobby.oyuncular.find((player) => player.playerId === playerId)?.takim ?? null;

        const roles = new Map<Socket, string>();
        const turnInfo = Promise.all(
            [hostJoin.seat, ...guests].map((seat) =>
                waitFor<{ rol: string }>(seat.socket, "yeniTurBilgisi").then((turn) => roles.set(seat.socket, turn.rol))
            )
        );
        const started = waitFor(hostJoin.seat.socket, "oyunBasladi");
        hostJoin.seat.socket.emit("oyun_baslat", {
            seciliKategoriler: [categoryId],
            seciliZorluklar: [1],
            ayarlar: { sure: 60, mod: "skor", deger: 10 },
        });
        await started;
        await turnInfo;
        const narrator = [...roles.entries()].find(([, role]) => role === "Anlatıcı")?.[0];
        assert.ok(narrator, "narrator not found");
        let ended = false;
        const finished = waitFor<{ kazananTakim: "A" | "B" }>(hostJoin.seat.socket, "oyunBitti").then((payload) => {
            ended = true;
            return payload;
        });
        for (let index = 0; index < 40 && !ended; index += 1) {
            narrator.emit("oyunVerisi", { eylem: "dogru" });
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        const { kazananTakim: winner } = await finished;
        for (const socket of sockets) socket.disconnect();

        let settlementId: number | null = null;
        for (let attempt = 0; attempt < 80 && settlementId === null; attempt += 1) {
            const row = await prisma.matchSettlement.findFirst({ where: { roomCode }, select: { id: true } });
            settlementId = row?.id ?? null;
            if (settlementId === null) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert.ok(settlementId, "match was recorded");
        const seats = await prisma.matchSettlementGuestSeat.findMany({ where: { settlementId } });
        assert.deepEqual(seats.map((seat) => seat.guestPlayerId).sort(), [...guestPlayerIds].sort(), "every guest got a seat");
        const settlement = await prisma.matchSettlement.findUniqueOrThrow({ where: { id: settlementId } });
        const reward = (playerId: string) =>
            resolveMatchRewardCoin(
                teamOf(playerId) === winner ? settings.economy.winRewardCoin : settings.economy.lossRewardCoin,
                settings,
                settlement.matchEndedAt
            ).finalRewardCoin;
        console.log(`[guest-claim-e2e] 3v3 match finished, team ${winner} won, 5 guest seats recorded`);

        const [signUpGuest, signInGuest, twinGuest, verifyGuest, spareGuest] = guests;

        // Sign-up carries the guest token and moves the match at once.
        {
            const username = `gc_new_${suffix}`;
            const response = await post("/api/auth/register", {
                username,
                email: `${username}@example.test`,
                password: `Yeni-hesap ${suffix} vapur 2026!`,
                guestToken: signUpGuest.guestToken,
            });
            assert.equal(response.status, 201, JSON.stringify(response.body));
            const userId = Number(response.body.userId);
            userIds.push(userId);
            assert.deepEqual(response.body.guestClaim, {
                status: "ok",
                matches: 1,
                settledNow: 1,
                coinEarnedNow: reward(signUpGuest.playerId),
                awaitingVerification: 0,
                alreadyMoved: 0,
            });
            const row = await prisma.matchResult.findFirstOrThrow({ where: { userId, roomCode } });
            assert.equal(row.team, teamOf(signUpGuest.playerId));
            assert.equal(row.won, teamOf(signUpGuest.playerId) === winner);
            const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
            assert.equal(Number(wallet.coinBalance), settings.economy.startingCoinBalance + row.coinEarned);
            console.log("[guest-claim-e2e] sign-up moved the match with its coins");
        }

        // Sign-in path: the client posts the kept token after logging in.
        const existing = await makeUser("existing");
        {
            const first = await post(claimPath, { guestToken: signInGuest.guestToken }, { cookie: existing.cookie });
            assert.equal(first.status, 200, JSON.stringify(first.body));
            assert.equal(first.body.settledNow, 1);
            assert.equal(first.body.coinEarnedNow, reward(signInGuest.playerId));
            const again = await post(claimPath, { guestToken: signInGuest.guestToken }, { cookie: existing.cookie });
            assert.equal(again.status, 200);
            assert.equal(again.body.settledNow, 0);
            assert.equal(again.body.alreadyMoved, 1);
            assert.equal(await prisma.matchResult.count({ where: { userId: existing.id, roomCode } }), 1);
            const audit = await prisma.auditLog.count({ where: { actorUserId: existing.id, action: "game.match.guest_claim" } });
            assert.equal(audit, 2, "every claim request is audited");
            console.log("[guest-claim-e2e] sign-in claim settles once and repeats safely");
        }

        // Ownership: a claimed guest refuses other accounts; a participant gains no second seat.
        {
            const stolen = await post(claimPath, { guestToken: signInGuest.guestToken }, { cookie: host.cookie });
            assert.equal(stolen.status, 409);
            assert.equal(stolen.body.code, "GUEST_CLAIM_LINKED_ELSEWHERE");
            const twin = await post(claimPath, { guestToken: twinGuest.guestToken }, { cookie: host.cookie });
            assert.equal(twin.status, 200);
            assert.equal(twin.body.settledNow, 0);
            assert.equal(twin.body.matches, 0);
            const twinSeat = seats.find((seat) => seat.guestPlayerId === twinGuest.playerId)!;
            const closed = await prisma.matchSettlementGuestSeat.findUniqueOrThrow({ where: { id: twinSeat.id } });
            assert.equal(closed.outcome, "already_participant");
            assert.equal(await prisma.matchResult.count({ where: { userId: host.id, roomCode } }), 1, "host keeps one result");
            console.log("[guest-claim-e2e] linked guest refused, participant cannot double up");
        }

        // Unverified account: the claim waits and email verification settles it.
        {
            const pending = await makeUser("pending", { unverified: true });
            const waiting = await post(claimPath, { guestToken: verifyGuest.guestToken }, { cookie: pending.cookie });
            assert.equal(waiting.status, 200, JSON.stringify(waiting.body));
            assert.equal(waiting.body.awaitingVerification, 1);
            assert.equal(await prisma.matchResult.count({ where: { userId: pending.id } }), 0);

            const tokenId = randomUUID();
            const rawToken = `${tokenId}.${randomBytes(32).toString("base64url")}`;
            await prisma.emailVerificationToken.create({
                data: {
                    id: tokenId,
                    userId: pending.id,
                    tokenHash: createHash("sha256").update(rawToken, "utf8").digest("hex"),
                    emailSnapshot: pending.email,
                    expiresAt: new Date(Date.now() + 60 * 60_000),
                },
            });
            const confirmed = await post("/api/auth/email-verification/confirm", { token: rawToken });
            assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
            const row = await prisma.matchResult.findFirst({ where: { userId: pending.id, roomCode } });
            assert.ok(row, "verification settles the waiting claim immediately");
            assert.equal(row.coinEarned, reward(verifyGuest.playerId));
            console.log("[guest-claim-e2e] unverified claim settled by the verification link");
        }

        // Bad requests never move anything.
        {
            const anonymous = await post(claimPath, { guestToken: spareGuest.guestToken });
            assert.equal(anonymous.status, 401);
            const fresh = await makeUser("fresh");
            const malformed = await post(claimPath, "{not json", { cookie: fresh.cookie });
            assert.equal(malformed.status, 400);
            const [payload, signature] = spareGuest.guestToken!.split(".");
            const forgedPayload = Buffer.from(JSON.stringify({ guestId: randomUUID(), exp: Date.now() + 60_000 })).toString("base64url");
            const forged = await post(claimPath, { guestToken: `${forgedPayload}.${signature}` }, { cookie: fresh.cookie });
            assert.equal(forged.status, 400);
            assert.equal(forged.body.code, "GUEST_CLAIM_INVALID");
            assert.ok(payload);
            const crossSite = await post(claimPath, { guestToken: spareGuest.guestToken }, { cookie: fresh.cookie, origin: "https://evil.example" });
            assert.equal(crossSite.status, 403, "cross-site requests are refused before the route");
            const spareSeat = seats.find((seat) => seat.guestPlayerId === spareGuest.playerId)!;
            assert.equal((await prisma.matchSettlementGuestSeat.findUniqueOrThrow({ where: { id: spareSeat.id } })).status, "unclaimed");

            // A broken or forged token never blocks the registration itself.
            const brokenName = `gc_broken_${suffix}`;
            const broken = await post("/api/auth/register", {
                username: brokenName,
                email: `${brokenName}@example.test`,
                password: `Bozuk-anahtar ${suffix} ada 2026!`,
                guestToken: "x",
            });
            assert.equal(broken.status, 201, JSON.stringify(broken.body));
            userIds.push(Number(broken.body.userId));
            assert.equal(broken.body.guestClaim, undefined);
            const forgedName = `gc_forged_${suffix}`;
            const forgedSignUp = await post("/api/auth/register", {
                username: forgedName,
                email: `${forgedName}@example.test`,
                password: `Sahte-anahtar ${suffix} koy 2026!`,
                guestToken: `${forgedPayload}.${signature}`,
            });
            assert.equal(forgedSignUp.status, 201, JSON.stringify(forgedSignUp.body));
            userIds.push(Number(forgedSignUp.body.userId));
            assert.equal((forgedSignUp.body.guestClaim as { status?: string } | undefined)?.status, "invalid_token");

            let limited = 0;
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const response = await post(claimPath, { guestToken: spareGuest.guestToken }, { cookie: fresh.cookie });
                if (response.status === 429) limited += 1;
            }
            assert.ok(limited > 0, "claims are rate limited");
            console.log("[guest-claim-e2e] anonymous, malformed, forged, cross-site and flooded requests refused");
        }

        console.log("guest match claim e2e checks passed");
    } finally {
        for (const socket of sockets) socket.disconnect();
        if (roomCode) await prisma.matchSettlement.deleteMany({ where: { roomCode } });
        if (guestPlayerIds.length > 0) await prisma.guestProgress.deleteMany({ where: { playerId: { in: guestPlayerIds } } });
        const realUserIds = userIds.filter((id) => Number.isInteger(id) && id > 0);
        if (realUserIds.length > 0) {
            await prisma.auditLog.deleteMany({ where: { actorUserId: { in: realUserIds } } });
            await prisma.user.deleteMany({ where: { id: { in: realUserIds } } });
        }
        if (categoryId !== null) {
            await prisma.category.deleteMany({ where: { id: categoryId } });
            await invalidateCategoryCache();
        }
        if (wordId !== null) await prisma.word.deleteMany({ where: { id: wordId } });
        await prisma.$disconnect();
        await closeRedisClient();
    }
}

void run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
