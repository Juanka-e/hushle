Critical Findings

  [VULN-001] Admin API Authorization Bypass (Critical)

  - Location:
    - apps/web/src/app/api/admin/dashboard-stats/route.ts:7
    - apps/web/src/app/api/admin/words/route.ts:8,62
    - apps/web/src/app/api/admin/words/[id]/route.ts:9,37,106
    - apps/web/src/app/api/admin/categories/route.ts:9,31
    - apps/web/src/app/api/admin/categories/[id]/route.ts:17,49
    - apps/web/src/app/api/admin/announcements/route.ts:8,28
    - apps/web/src/app/api/admin/announcements/[id]/route.ts:20,57
  - Confidence: High
  - Issue: Multiple admin API endpoints completely lack authorization checks. While some endpoints use requireAdminSession(), these endpoints have NO
  authentication/authorization whatsoever.

  Affected Endpoints:
  - GET /api/admin/dashboard-stats - Exposes system metrics
  - GET /api/admin/words - Lists all game words (can be used to cheat)
  - POST /api/admin/words - Creates new words (data manipulation)
  - GET /api/admin/words/[id] - Exposes specific word details
  - PUT /api/admin/words/[id] - Modifies words (cheating)
  - DELETE /api/admin/words/[id] - Deletes words
  - GET /api/admin/categories - Lists all categories
  - POST /api/admin/categories - Creates categories
  - PUT /api/admin/categories/[id] - Updates categories
  - DELETE /api/admin/categories/[id] - Deletes categories
  - GET /api/admin/announcements - Lists announcements
  - POST /api/admin/announcements - Creates announcements
  - PUT /api/admin/announcements/[id] - Updates announcements
  - DELETE /api/admin/announcements/[id] - Deletes announcements

  Impact: An attacker can:
  1. View all game words to cheat in gameplay
  2. Manipulate game content (add/remove/modify words, categories)
  3. Access dashboard statistics without authentication
  4. Create malicious announcements
  5. Disrupt game integrity

  Evidence:
  // apps/web/src/app/api/admin/dashboard-stats/route.ts:7
  export async function GET() {
      try {
          // NO AUTHORIZATION CHECK!
          const [totalWords, easyCount, mediumCount, hardCount, totalCategories] =
              await Promise.all([...]);
          return NextResponse.json({...});
      }
  }

  // apps/web/src/app/api/admin/words/route.ts:8
  export async function GET(request: NextRequest) {
      // NO AUTHORIZATION CHECK!
      const [words, total] = await Promise.all([...]);
      return NextResponse.json({ words, total, ... });
  }

  Fix: Add requireAdminSession() to all admin endpoints:
  export async function GET() {
      const adminSession = await requireAdminSession();
      if (adminSession instanceof NextResponse) {
          return adminSession; // Returns 401 if not admin
      }
      // ... rest of the code
  }

  ---
  [VULN-002] WebSocket Player Identity Spoofing (Critical)

  - Location:
    - apps/web/src/lib/socket/game-socket.ts:718-723
    - apps/web/src/app/room/[code]/page.tsx:47-52
  - Confidence: High
  - Issue: Players can supply their own playerId which is persisted in localStorage on the client. An attacker can modify their localStorage to impersonate
  another player.

  Impact:
  1. Impersonate other players in rooms
  2. Claim match rewards on behalf of other users
  3. Access other players' game statistics
  4. Potential coin balance manipulation through reward fraud

  Evidence:
  // Client-side - any user can modify localStorage
  const [myPlayerId, setMyPlayerId] = useState(() => {
      if (typeof window !== "undefined") {
          return localStorage.getItem("tabu_playerId") || "";
      }
      return "";
  });

  // Server-side accepts client-provided playerId with only UUID format validation
  const { kullaniciAdi, odaKodu, playerId, authUserId } = parsed.data;
  let effectivePlayerId = playerId; // Trusts client input!
  if (!effectivePlayerId) {
      effectivePlayerId = uuidv4(); // Only generates if not provided
  }

  The only validation is Zod schema:
  const OdaIstegiSchema = z.object({
      kullaniciAdi: z.string().min(1).max(50),
      odaKodu: z.string().max(10).optional(),
      playerId: z.string().uuid().optional(), // Only validates UUID format!
      authUserId: z.number().int().positive().optional(),
  });

  Fix: Never trust client-provided playerId. Always generate server-side and bind to authenticated session:
  // Generate player ID server-side based on authenticated user
  const effectivePlayerId = authUserId
      ? `auth_${authUserId}_${uuidv4()}` // Bind to auth
      : uuidv4(); // Anonymous gets new ID each session

  ---
  [VULN-003] Match Finalization Reward Fraud (Critical)

  - Location: apps/web/src/app/api/game/match/finalize/route.ts:13-47
  - Confidence: High
  - Issue: The match finalization endpoint only verifies that the playerId matches in the room snapshot, but the room snapshot is stored in memory on the
  WebSocket server. An attacker who can spoof a playerId (see VULN-002) can claim rewards for any match participant.

  Impact:
  1. Claim coins on behalf of other players
  2. Inflate match statistics fraudulently
  3. Economic system exploitation

  Evidence:
  const participant = room.oyuncular.find(
      (p) => p.playerId === playerId && p.userId === sessionUser.id
  );
  if (!participant) {
      return NextResponse.json({ error: "Oyuncu dogrulanamadi." }, { status: 403 });
  }

  The check validates playerId (client-provided) AND userId (from session). However, if an attacker can spoof playerId to match another player in the room
  who has userId === null (anonymous player), they could claim rewards.

  Fix:
  1. Never accept client-provided playerId - use session-bound IDs only
  2. Require authentication for match finalization
  3. Add rate limiting per user
  4. Validate that the session user was actually in the room

  ---
  [VULN-004] Admin Session Disclosure via Middleware (High)

  - Location: apps/web/src/middleware.ts:20-24
  - Confidence: High
  - Issue: The middleware returns different error messages for /api/admin routes based on authentication status, allowing user enumeration. Additionally,
  the middleware checks are bypassable if the matcher patterns don't cover all routes.

  Impact:
  1. User enumeration against admin accounts
  2. Information disclosure about authentication status

  Evidence:
  if (pathname.startsWith("/api/admin")) {
      if (!isAuthed(req) || role !== "admin") {
          return NextResponse.json({ error: "Yetkisiz erisim." }, { status: 401 });
      }
  }

  The matcher configuration only protects specific paths:
  export const config = {
      matcher: [
          "/admin/:path*",
          "/api/admin/:path*",
          // ... other paths
      ],
  };

  However, some /api/admin/* routes might not match correctly if they have different patterns.

  ---
  High Findings

  [VULN-005] Information Disclosure via Error Messages (High)

  - Location: Throughout the codebase
  - Confidence: Medium
  - Issue: Error messages often expose internal implementation details and stack traces in development mode.

  Evidence:
  socket.emit("hata", (error as Error).message || "Kelime alınamadı.");

  While production may not show stack traces, the error messages can still leak information about database structure and internal logic.

  ---
  [VULN-006] WebSocket Authorization Bypass Potential (High)

  - Location: apps/web/src/lib/socket/game-socket.ts:1290-1308
  - Confidence: Medium
  - Issue: WebSocket authentication relies solely on JWT token validation from cookies. If cookies are stolen (XSS, MITM), an attacker can fully impersonate
   a user.

  Evidence:
  async function getSocketAuthUserId(socket: Socket): Promise<number | null> {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader || !process.env.AUTH_SECRET) {
          return null; // No auth = anonymous access allowed!
      }
      const token = await getToken({...});
      const userId = Number(token?.sub);
      return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  If AUTH_SECRET is not set, the function returns null, allowing anonymous access. This could be misconfigured in production.

  Fix:
  1. Require authentication for production
  2. Implement additional CSRF protection
  3. Consider IP-based rate limiting

  ---
  [VULN-007] Missing CSRF Protection (High)

  - Location: All API endpoints
  - Confidence: High
  - Issue: No visible CSRF token implementation for state-changing operations. While Next.js has some built-in protections, they may not be sufficient.

  ---
  Medium Findings

  [VULN-008] Verbose Error Logging (Medium)

  - Location: Multiple files using console.error
  - Confidence: Low
  - Issue: Extensive console logging may expose sensitive information in server logs.

  ---
  [VULN-009] User Enumeration via Login (Medium)

  - Location: apps/web/src/lib/auth.ts:20-23
  - Confidence: Medium
  - Issue: Different responses for "user not found" vs "invalid password" could enable user enumeration.

  Evidence:
  const user = await prisma.user.findUnique({
      where: { username: credentials.username as string },
  });
  if (!user) return null; // User not found

  const isValid = await bcryptjs.compare(
      credentials.password as string,
      user.password
  );
  if (!isValid) return null; // Wrong password

  Both cases return null, but timing differences could still allow enumeration.

  ---
  [VULN-010] Missing Rate Limiting on Sensitive Endpoints (Medium)

  - Location:
    - apps/web/src/app/api/auth/register/route.ts
    - apps/web/src/app/api/store/purchase/route.ts
  - Confidence: Medium
  - Issue: No rate limiting on registration or purchase operations, allowing:
    - Account creation spam
    - Automated purchase attempts
    - Potential coin farming exploits

  Recommendation: Add rate limiting using middleware or a rate-limiting library.

  ---
  Needs Verification

  [VERIFY-001] CORS Configuration

  - Location: Application configuration
  - Question: Is CORS properly configured to prevent cross-origin attacks? Check Next.js configuration.

  [VERIFY-002] Session Secret Configuration

  - Location: Environment variables
  - Question: Is AUTH_SECRET and NEXTAUTH_SECRET properly set with strong values in production?

  [VERIFY-003] Database Connection Security

  - Location: apps/web/src/lib/prisma.ts
  - Question: Are database credentials properly secured? Is connection pooling configured safely?

  ---
  Priority Remediation Order

  1. IMMEDIATE: Fix VULN-001 (Admin Authorization Bypass) - Add requireAdminSession() to all affected endpoints
  2. IMMEDIATE: Fix VULN-002 (Player Identity Spoofing) - Stop trusting client-provided playerId
  3. HIGH: Fix VULN-003 (Match Reward Fraud) - Require authentication for match finalization
  4. HIGH: Implement rate limiting across all sensitive endpoints
  5. MEDIUM: Review and harden WebSocket authentication
  6. MEDIUM: Implement proper CSRF protection
  7. LOW: Improve error handling and logging practices

  Güvenlik Raporu: Misafir + Auth Kullanıcı Mimarisi

  Mevcut Mimari Analizi

  Mevcut sistemde üç farklı "kimlik" kavramı var:

  ┌───────────┬──────────────────────────────────────────────────────────┬──────────────────────────────────────────┐
  │    Tür    │                         Açıklama                         │            Güvenlik Seviyesi             │
  ├───────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────┤
  │ socket.id │ Socket.IO tarafından otomatik oluşturulan bağlantı ID'si │ ✅ Güvenli (server-side)                 │
  ├───────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────┤
  │ playerId  │ İstemci tarafından sağlanan UUID                         │ ❌ GÜVENSİZ (client-manipüle edilebilir) │
  ├───────────┼──────────────────────────────────────────────────────────┼──────────────────────────────────────────┤
  │ userId    │ NextAuth session'dan gelen veritabanı user ID            │ ✅ Güvenli (server-side JWT)             │
  └───────────┴──────────────────────────────────────────────────────────┴──────────────────────────────────────────┘

  ---
  🔴 Kritik Güvenlik Açıkları

  [VULN-001] Client-Side PlayerId Spoofing

  Sorun: playerId tamamen istemci kontrolünde:

  // İstemci (localStorage'dan okur)
  const [myPlayerId, setMyPlayerId] = useState(() => {
      return localStorage.getItem("tabu_playerId") || "";
  });

  // Server (istemciye güvenir!)
  let effectivePlayerId = playerId; // Client input!
  if (!effectivePlayerId) {
      effectivePlayerId = uuidv4();
  }

  Saldırı Vektörü:
  1. Kullanıcı A'nın playerId'sini localStorage'dan kopyala
  2. Kendi localStorage'ına yapıştır
  3. Odaya katıl - artık Kullanıcı A olarak tanınıyorsun
  4. Match finalization API'si ile onun adına ödül al

  ---
  [VULN-002] Misafir Kullanıcılarda Kalıcı Kimlik Eksikliği

  Sorun: Misafir oyuncuların userId'si null:

  interface PlayerData {
      id: string;        // socket.id (geçici)
      playerId: string;  // client-provided (SPOOFABLE!)
      userId: number | null;  // null for guests
      ad: string;
      // ...
  }

  Bu durumda:
  - Misafir oyuncuların geçici kimliği güvenilir değil
  - Aynı misafir bir sonraki seferde farklı kişi olarak tanınabilir
  - Cosmetics ve coinler misafirler için saklanamaz (veya exploit edilebilir)

  ---
  🛡️ Önerilen Güvenli Mimari

  ┌─────────────────────────────────────────────────────────────────┐
  │                     IDENTITY LAYER                              │
  ├─────────────────────────────────────────────────────────────────┤
  │                                                                   │
  │  ┌──────────────────┐      ┌──────────────────┐                │
  │  │  AUTHENTICATED   │      │     GUEST        │                │
  │  │  (Registered)    │      │  (Anonymous)     │                │
  │  ├──────────────────┤      ├──────────────────┤                │
  │  │ userId: 123      │      │ userId: null     │                │
  │  │ persistentId     │      │ guestId          │  ← SERVER SIDE  │
  │  │ (DB account)     │      │ (session-based)  │                │
  │  └──────────────────┘      └──────────────────┘                │
  │           │                          │                          │
  │           └──────────┬───────────────┘                          │
  │                      ▼                                          │
  │              ┌─────────────────┐                                │
  │              │  UnifiedPlayer  │                                │
  │              │       Identity   │                                │
  │              ├─────────────────┤                                │
  │              │ id: server_gen  │  ← NEVER trust client!         │
  │              │ type: auth/guest│                                │
  │              │ userId: 123/null│                                │
  │              │ verified: true  │                                │
  │              └─────────────────┘                                │
  └─────────────────────────────────────────────────────────────────┘

  ---
  📋 Detaylı Öneriler

  1. Server-Side Identity Management

  Yeni Kimlik Yapısı:

  // lib/identity.ts

  export interface ServerPlayerIdentity {
      // Server-generated unique ID (NEVER exposed to client)
      readonly id: string;

      // Player type
      readonly type: 'authenticated' | 'guest';

      // Authenticated user ID (null for guests)
      readonly userId: number | null;

      // Guest session ID (null for authenticated)
      readonly guestId: string | null;

      // Cryptographic signature
      readonly signature: string;
  }

  export class IdentityManager {
      private readonly idCache = new Map<string, ServerPlayerIdentity>();
      private readonly guestSessions = new Map<string, ServerPlayerIdentity>();

      // Generate identity for authenticated user
      async forAuthenticatedUser(
          socket: Socket,
          userId: number
      ): Promise<ServerPlayerIdentity> {
          const cached = this.idCache.get(socket.id);
          if (cached && cached.userId === userId) {
              return cached;
          }

          const identity: ServerPlayerIdentity = {
              id: this.generateSecureId(),
              type: 'authenticated',
              userId,
              guestId: null,
              signature: this.signIdentity(userId),
          };

          this.idCache.set(socket.id, identity);
          return identity;
      }

      // Generate identity for guest
      async forGuest(socket: Socket): Promise<ServerPlayerIdentity> {
          const cached = this.idCache.get(socket.id);
          if (cached && cached.type === 'guest') {
              return cached;
          }

          // Generate persistent guest ID for this socket session
          const guestId = crypto.randomUUID();

          const identity: ServerPlayerIdentity = {
              id: this.generateSecureId(),
              type: 'guest',
              userId: null,
              guestId,
              signature: this.signIdentity(guestId),
          };

          this.guestSessions.set(guestId, identity);
          this.idCache.set(socket.id, identity);
          return identity;
      }

      // Verify identity signature
      verify(identity: ServerPlayerIdentity): boolean {
          return this.verifySignature(identity);
      }

      private generateSecureId(): string {
          // Use cryptographically secure random generation
          return crypto.randomUUID();
      }

      private signIdentity(key: string | number): string {
          // HMAC signature with server secret
          const hmac = crypto.createHmac('sha256', process.env.IDENTITY_SECRET!);
          hmac.update(String(key));
          hmac.update(Date.now().toString());
          return hmac.digest('hex');
      }

      private verifySignature(identity: ServerPlayerIdentity): boolean {
          // Verify signature hasn't been tampered with
          // Implementation depends on signing method
          return true; // Placeholder
      }
  }

  ---
  2. WebSocket Connection Handler Güncellemesi

  // lib/socket/game-socket.ts

  const identityManager = new IdentityManager();

  io.on("connection", async (socket: Socket) => {
      // Step 1: Get authenticated user ID from JWT
      const authUserId = await getSocketAuthUserId(socket);

      // Step 2: Generate server-controlled identity
      const identity = authUserId
          ? await identityManager.forAuthenticatedUser(socket, authUserId)
          : await identityManager.forGuest(socket);

      // Step 3: Client sends their requested player identity (for continuity)
      socket.on("odaİsteği", async (rawPayload: unknown) => {
          const parsed = OdaIstegiSchema.safeParse(rawPayload);
          if (!parsed.success) {
              socket.emit("hata", "Geçersiz istek verisi.");
              return;
          }

          const { kullaniciAdi, odaKodu, clientPlayerId } = parsed.data;

          // IGNORE client-provided playerId for security!
          // Use server-generated identity instead

          // For returning players, try to match by server identity
          const existingPlayer = room.oyuncular.find(
              (player) => player.serverIdentity?.id === identity.id
          );

          if (existingPlayer) {
              // Reconnect existing player
              existingPlayer.id = socket.id;
              existingPlayer.online = true;
          } else {
              // New player - use server identity
              const yeniOyuncu: PlayerData = {
                  id: socket.id,
                  playerId: identity.id, // ← SERVER GENERATED, NOT CLIENT!
                  userId: identity.userId,
                  guestId: identity.guestId,
                  ad: sanitizePlayerName(kullaniciAdi),
                  serverIdentity: identity, // Store full identity for verification
                  takim: isSpectator ? null : "A",
                  online: true,
                  rol: isSpectator ? "İzleyici" : "Oyuncu",
                  ip: getClientIp(socket),
                  cosmetics: await getPlayerCosmetics(identity),
              };
              room.oyuncular.push(yeniOyuncu);
          }
      });
  });

  ---
  3. Match Finalization Güvenliği

  // app/api/game/match/finalize/route.ts

  export async function POST(req: Request) {
      const sessionUser = await getSessionUser();

      try {
          const body = await req.json();
          const { roomCode, identityToken } = finalizeSchema.parse(body);

          // CRITICAL: Verify identity was NOT tampered with
          const room = getRoomMatchSnapshot(roomCode.toUpperCase());
          if (!room) {
              return NextResponse.json({ error: "Oda bulunamadi." }, { status: 404 });
          }

          // Find participant by SERVER identity, not client-provided playerId
          let participant: PlayerData | undefined;

          if (sessionUser) {
              // Authenticated user - match by userId
              participant = room.oyuncular.find(
                  (p) => p.userId === sessionUser.id && p.serverIdentity?.userId === sessionUser.id
              );
          } else {
              // Guest - match by identity token
              const identity = verifyIdentityToken(identityToken);
              if (!identity) {
                  return NextResponse.json({ error: "Geçersiz kimlik." }, { status: 403 });
              }
              participant = room.oyuncular.find(
                  (p) => p.serverIdentity?.id === identity.id
              );
          }

          if (!participant) {
              return NextResponse.json({ error: "Oyuncu dogrulanamadi." }, { status: 403 });
          }

          // Double-check: Verify the identity hasn't been tampered
          if (!identityManager.verify(participant.serverIdentity!)) {
              console.error("Identity tampering detected!", {
                  roomId: roomCode,
                  participant: participant.playerId
              });
              return NextResponse.json({ error: "Güvenlik doğrulaması başarısız." }, { status: 403 });
          }

          // ... rest of reward logic
      }
  }

  ---
  4. Guest Session Persistence (Misafirler İçin Devamlılık)

  Sorun: Misafirler sayfayı yenileyince kimliklerini kaybediyorlar.

  Çözüm: Session-based guest identity with cryptographic tokens:

  // lib/guest-session.ts

  export interface GuestSession {
      guestId: string;
      username: string;
      createdAt: Date;
      lastSeen: Date;
      cosmeticData: PlayerCosmetics;
  }

  export class GuestSessionManager {
      private readonly sessions = new Map<string, GuestSession>();
      private readonly tokens = new Map<string, string>(); // token -> guestId

      // Create new guest session
      create(username: string): { guestId: string; token: string } {
          const guestId = crypto.randomUUID();
          const token = this.generateToken(guestId);

          const session: GuestSession = {
              guestId,
              username: sanitizePlayerName(username),
              createdAt: new Date(),
              lastSeen: new Date(),
              cosmeticData: createEmptyPlayerCosmetics(),
          };

          this.sessions.set(guestId, session);
          this.tokens.set(token, guestId);

          // Return token to client (store in sessionStorage, not localStorage)
          return { guestId, token };
      }

      // Verify guest token and return session
      verify(token: string): GuestSession | null {
          const guestId = this.tokens.get(token);
          if (!guestId) return null;

          const session = this.sessions.get(guestId);
          if (!session) return null;

          // Update last seen
          session.lastSeen = new Date();
          return session;
      }

      private generateToken(guestId: string): string {
          // JWT-like token for guest session
          const payload = {
              guestId,
              exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
          };

          return jwt.sign(payload, process.env.GUEST_SESSION_SECRET!);
      }
  }

  ---
  5. Cosmetics Sistemi Güvenliği

  Mevcut Sorun: Misafirler cosmetics kullanabilir mi?

  Öneri:

  // Misafir Cosmetics Kuralı:
  // - Guests CANNOT purchase cosmetics (no persistent wallet)
  // - Guests CAN use default/free cosmetics
  // - Guests earn coins during session but DON'T persist

  // Authenticated Cosmetics Kuralı:
  // - Auth users CAN purchase cosmetics
  // - Auth users cosmetics persist in database
  // - Auth users coin balance persists

  export async function getPlayerCosmetics(
      identity: ServerPlayerIdentity
  ): Promise<PlayerCosmetics> {
      if (identity.type === 'authenticated' && identity.userId) {
          // Load from database
          return getPersistentCosmetics(identity.userId);
      } else {
          // Return default cosmetics for guests
          return getDefaultCosmetics();
      }
  }

  export async function canPurchaseItem(
      identity: ServerPlayerIdentity
  ): Promise<boolean> {
      // Only authenticated users can purchase
      return identity.type === 'authenticated';
  }

  ---
  6. Client-Side Güvenlik İyileştirmeleri

  // hooks/usePlayerIdentity.ts

  export function usePlayerIdentity() {
      const { data: session } = useSession();
      const [guestToken, setGuestToken] = useState<string | null>(null);

      useEffect(() => {
          if (!session) {
              // Load guest token from sessionStorage (NOT localStorage!)
              const token = sessionStorage.getItem('guest_token');
              setGuestToken(token);
          }
      }, [session]);

      const connectToRoom = useCallback((roomCode: string, username: string) => {
          if (socket) {
              socket.emit("odaİsteği", {
                  kullaniciAdi: username,
                  odaKodu: roomCode,
                  // NEVER send playerId - let server generate it!
                  guestToken: session ? null : guestToken, // For guest continuity
              });
          }
      }, [socket, session, guestToken]);

      return { connectToRoom, isGuest: !session };
  }

  ---
  📊 Özet: Önerilen Değişiklikler

  ┌──────────────────────────┬──────────────────────────────┬──────────────────────────────────┬─────────────┐
  │         Bileşen          │            Mevcut            │             Önerilen             │   Öncelik   │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ PlayerId Generation      │ Client-side UUID             │ Server-side crypto               │ 🔴 CRITICAL │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Guest Identity           │ localStorage + client UUID   │ Session token + server ID        │ 🔴 CRITICAL │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Match Rewards            │ Client playerId verification │ Server identity verification     │ 🔴 CRITICAL │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Admin API                │ Missing auth                 │ requireAdminSession() everywhere │ 🔴 CRITICAL │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Cosmetics for Guests     │ Undefined                    │ Default cosmetics only           │ 🟡 HIGH     │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Coin Persistence         │ All users                    │ Auth users only                  │ 🟡 HIGH     │
  ├──────────────────────────┼──────────────────────────────┼──────────────────────────────────┼─────────────┤
  │ Guest Session Continuity │ None                         │ Session tokens                   │ 🟢 MEDIUM   │
  └──────────────────────────┴──────────────────────────────┴──────────────────────────────────┴─────────────┘

  ---
  🔧 Implementasyon Öncelik Sırası

  1. FASE 1 - KRİTİK (Hemen):
    - Server-side identity manager ekle
    - Client-provided playerId'yi iptal et
    - Admin API'lerine authorization ekle
  2. FASE 2 - YÜKSEK (1 hafta):
    - Match finalization güvenliğini düzelt
    - Guest session token sistemi ekle
    - Identity verification ekle
  3. FASE 3 - ORTA (2 hafta):
    - Guest cosmetics kuralını netleştir
    - Session continuity ekle
    - Rate limiting ekle
  4. FASE 4 - DÜŞÜK (1 ay):
    - Audit logging
    - Security monitoring
    - Additional hardening
## Remediation Status (9 March 2026)

### Fixed in current code
- Added route-level `requireAdminSession()` checks to all remaining `apps/web/src/app/api/admin/*` route handlers.
- Hardened announcement create/update/read flow:
  - announcement HTML is sanitized server-side before storage
  - legacy/public announcement output is sanitized before render
  - media URLs are normalized and restricted to safe `https` / relative image URLs and YouTube embed URLs
- Hardened announcement rendering:
  - existing modal continues using rich content, but now receives sanitized HTML and sanitized media URLs
  - YouTube iframe now uses tighter loading / referrer / sandbox attributes
- Hardened shop item upload:
  - file extension is derived from trusted MIME mapping, not original filename
  - image magic-byte signatures are validated for PNG/JPEG/WebP/GIF
- Added smoke coverage:
  - `npm run test:admin-guards`
  - `npm run test:announcement-security`
- Added baseline security headers in `next.config.ts`:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Still open after this remediation slice
- Client-controlled `playerId` in socket room join flow
- Reward claim coupling to client-provided `playerId`
- Missing HTTP rate limiting on register / store / coupon preview endpoints
- No full CSP yet; current hardening is header-level but not nonce-based script control

### Current assessment vs original report
- Original admin API finding is now fully remediated with route-level guards.
- Original XSS risk around admin-generated rich content has been reduced materially, but a future CSP would still improve blast-radius control.
- Original socket identity and match-finalize concerns remain the top unresolved items.

## Remediation Status (9 March 2026 - Promotion Limits)

### Fixed in current code
- Discount campaigns now have the same quantity-control surface as coupons:
  - `usageLimit`
  - `usedCount`
- Admin can define campaign limits from `/admin/promotions`.
- Store pricing now excludes exhausted campaigns before checkout.
- Item and bundle checkout now reserve promotion usage atomically with `updateMany` guards inside the transaction.
- Coupon usage reservation was also moved to the same atomic pattern, closing the previously reported race.

### Still open after this slice
- Client-controlled `playerId` in socket room join flow
- Reward claim coupling to client-provided `playerId`
- Missing HTTP rate limiting on register / store / coupon preview endpoints
- No nonce-based CSP yet

### Security review note
- This slice closes the promotion oversubscription class for both discount campaigns and coupons.
- It does not change guest gameplay or authentication boundaries; store and cosmetics remain login-gated.

## Remediation Status (9 March 2026 - Identity and Rate Limits)

### Fixed in current code
- Socket room join no longer accepts client-provided `playerId`.
- Authenticated players now receive a server-controlled identity in the form `user:{userId}`.
- Guest players now receive a signed guest token and server-controlled identity in the form `guest:{guestId}`.
- `match/finalize` no longer accepts `playerId` from the client; it verifies participation directly from the authenticated `userId` in the room snapshot.
- Added HTTP rate limiting for:
  - `POST /api/auth/register`
  - `POST /api/game/match/finalize`
  - `POST /api/store/purchase`
  - `POST /api/store/bundles/purchase`
  - `POST /api/store/coupons/preview`
  - `POST /api/store/equip`
  - `PATCH /api/user/profile`
- Added same-origin enforcement for state-changing matched API routes in middleware.
- Added socket origin validation on connection.

### Remaining after this slice
- No nonce-based CSP yet
- No centralized audit log for security-sensitive mutations
- Guest identity is now signed, but still browser-session scoped rather than persisted server-side

### Verification
- `npm run test:player-identity`
- `npm run test:request-security`
- `npm run test:store-pricing`
- `npm run test:promotions`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Remediation Status (9 March 2026 - Audit Logging)

### Fixed in current code
- Added a new `AuditLog` persistence model for security-sensitive mutations:
  - actor user id / role
  - action name
  - resource type / resource id
  - request IP and user-agent
  - short summary
  - bounded primitive metadata payload
- Added a shared audit helper at `apps/web/src/lib/security/audit-log.ts`.
- Added audit writes for admin mutations:
  - announcements create / update / delete
  - shop items create / update / delete / upload
  - promotion bundles create / update / delete
  - promotion discounts create / update / delete
  - promotion coupons create / update / delete
- Added audit writes for user/economy-sensitive mutations:
  - profile update
  - item purchase
  - bundle purchase
  - match finalize reward claim
- Audit metadata is normalized to primitive / primitive-array values only; arbitrary nested objects are not stored.

### Remaining after this slice
- No nonce-based CSP yet
- No dedicated admin audit-log viewer UI yet
- Guest identity continuity is still browser-session scoped, not server-persisted across browser restarts

### Verification
- `npx prisma db push`
- `npx prisma generate --no-engine`
- `npm run test:audit-log`
- `npm run test:player-identity`
- `npm run test:request-security`
- `npm run test:store-pricing`
- `npm run test:promotions`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Remediation Status (9 March 2026 - Nonce CSP and Proxy Migration)

### Fixed in current code
- Replaced deprecated `apps/web/src/middleware.ts` with `apps/web/src/proxy.ts` for Next.js 16 compatibility.
- Added nonce-based CSP generation in `apps/web/src/lib/security/content-security-policy.ts`.
- HTML page requests now receive:
  - per-request nonce
  - `Content-Security-Policy` response header
  - `x-nonce` request/response header bridge for server rendering
- Root layout now reads `x-nonce` and applies it to:
  - the inline hydration-warning suppression script
  - the `next-themes` theme bootstrap script
- CSP currently enforces:
  - nonce-based `script-src`
  - `script-src-attr 'none'`
  - `object-src 'none'`
  - `frame-ancestors 'none'`
  - restricted YouTube-only `frame-src`
  - bounded `connect-src`, `img-src`, `font-src`, and `media-src`
- The earlier Next.js build warning about `middleware` deprecation is now gone.

### Remaining after this slice
- No admin audit-log viewer/filter UI yet
- Guest identity continuity is still browser-session scoped, not server-persisted across browser restarts
- CSP reporting endpoint / report ingestion is not implemented yet

### Verification
- `npm run test:csp`
- `npm run test:request-security`
- `npm run test:player-identity`
- `npm run test:audit-log`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm audit --omit=dev`

## Hardening Note (9 March 2026 - Rich Cosmetic JSON)

### Added guardrails
- Template cosmetic config is no longer flat-only, but the richer JSON surface is still bounded:
  - max object depth: `3`
  - max keys per object: `24`
  - max scalar-array length: `12`
  - no object arrays
- Supported value types are limited to:
  - string
  - number
  - boolean
  - null
  - scalar arrays
  - nested objects
- Arbitrary CSS and JS injection is still not supported.
- Renderer resolvers sanitize:
  - hex colors
  - enum-like pattern/motion/frame-style values
  - numeric ranges for blur, opacity, speed, scale, thickness, radius

### Security assessment
- This keeps cosmetic authoring expressive enough for premium effects without opening a general-purpose style/script injection surface.

## Current Review (9 March 2026 - Admin Panel and Store Abuse)

### Admin panel external access
- I did not find a direct unauthenticated or non-admin bypass into the current admin panel.
- Current protection is layered:
  - `apps/web/src/proxy.ts` blocks `/admin/*` and `/api/admin/*` for non-admin sessions
  - admin API routes also use `requireAdminSession()` server-side
- Practical result:
  - a normal user cannot reach admin data or admin mutations just by calling the routes directly
  - a guest session cannot reach admin data or admin mutations

### Remaining admin risk model
- Admin access is still fully compromiseable if any of these happen:
  - admin credentials are leaked
  - an admin session cookie is stolen
  - `AUTH_SECRET` is weak or misconfigured in production
- So the open risk is no longer route bypass; it is session/account compromise hardening.

### Store / coin bypass review
- I did not find a client-side coin bypass in the current purchase flow.
- The client does not send the final price or resulting balance as trusted input.
- Server-side flow computes everything again in `apps/web/src/lib/economy.ts`:
  - resolves active discount campaign
  - resolves optional coupon
  - clamps discount amount
  - computes `finalPriceCoin`
  - checks wallet balance
  - decrements wallet in the transaction
  - writes inventory and purchase rows in the same transaction
- Practical result:
  - changing price in DevTools does not help
  - changing coin balance in the UI does not help
  - re-sending the same request still depends on current server wallet state

### Residual store risks
- Abuse is still possible through normal attack classes, not direct price bypass:
  - stolen authenticated session
  - distributed request spam beyond in-memory rate limit scope
  - future business-logic bugs in new promotion rules
- Current in-memory rate limits are good for baseline protection but are not multi-instance durable.

### Current conclusion
- No direct admin-panel auth bypass found in current code.
- No direct coin or store-price bypass found in current code.
- Highest remaining practical risks are:
  - session theft / admin account compromise
  - future business-logic regressions in socket/store flows
  - lack of centralized persistent rate limiting for scaled deployments

## Review Update (9 March 2026 - Narrator Cosmetic Broadcast)

### Security posture
- Narrator card cosmetics are now broadcast from the server, not fetched from the active client's own `/api/user/me` state.
- This does not widen purchase/equip permissions:
  - guests still cannot buy cosmetics
  - guests still cannot equip cosmetics
  - guests can only see the authenticated narrator's already-authorized equipped card theme
- Practical result:
  - product visibility increases in-room
  - auth and economy boundaries remain unchanged

## Dependency Hardening (10 March 2026)

### DOMPurify advisory closure
- `npm audit --omit=dev` room-ui-stability slice during review found a moderate advisory for `dompurify`.
- The dependency tree was updated to a patched `dompurify` release (`^3.3.2`).
- Post-update verification:
  - `npm audit --omit=dev` -> `0 vulnerabilities`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- Enforced a single active primary inspector on the opponent side per turn.
- Added a server-side `tabu` authorization guard so non-primary opponent players cannot mutate score even if they emit socket events manually.

## Review Update (13 March 2026 - Runtime Settings Gates)

### What changed
- Added a centralized runtime settings layer with a short-lived server cache.
- Store and registration gates now depend on typed server-side settings instead of purely hardcoded behavior.
- Room create/join requests now evaluate server-side maintenance and guest/entry feature flags before a lobby mutation occurs.

### Security implications
- This reduces the risk of emergency response via ad-hoc code edits when abuse or instability occurs.
- Admin can now close:
  - registrations
  - guest gameplay
  - room creation
  - room joining
  - store access
  without a redeploy.
- Captcha settings are persisted and surfaced, but actual provider enforcement is not claimed yet in this slice.

### Remaining hardening note
- The system-settings cache is process-local.
- For multi-instance deployments, the next hardening step is shared cache invalidation or Redis-backed settings reads.

## 13 March 2026 Update - Captcha Runtime Enforcement

- Runtime captcha settings are no longer display-only; they now affect real request gates.
- `security.captcha.*` settings now drive these flows:
  - register
  - login
  - room create
  - guest join
- `turnstile` is treated as the primary low-friction provider.
- `recaptcha_v3` is available as an alternate provider.
- `soft_fail` only soft-passes provider outage or missing provider configuration.
- Missing token, invalid token, low score, or action mismatch still fail hard.
- This avoids turning `soft_fail` into a user-controlled bypass.

## 13 March 2026 Update - Moderation Foundation

- Added first-class user moderation state to the database:
  - `users.is_suspended`
  - `users.suspended_at`
  - `users.suspended_until`
  - `users.suspension_reason`
  - `user_moderation_events`
- Added secure admin moderation routes for:
  - listing users
  - suspend
  - reactivate
  - internal note logging
- Moderation actions now require explicit reason text and are also mirrored into `audit_logs`.
- Admin-on-admin moderation is intentionally blocked in this foundation slice to avoid accidental operator lockout.
- Suspended accounts are now denied at these entry points:
  - credentials login
  - session-backed protected page/API checks through `getSessionUser`
  - socket-based room create/join resolution
- Authenticated non-admin users are now redirected away from `/admin` and `/admin/login` to `/dashboard`.
  - This is primarily a UX and route-hygiene fix.
  - It is not treated as a security vulnerability that the admin login page existed for unauthenticated users.
- Unauthenticated `/admin` root requests are now redirected to `/`.
  - Direct `/admin/login` remains the explicit admin entry point.
  - This reduces accidental exposure of the admin login screen from the public root path.
- Only internal `note` moderation events are deletable.
  - suspend/reactivate records stay immutable to preserve audit integrity.

### Remaining hardening note
- Because auth still uses JWT sessions, `proxy.ts` cannot independently verify suspension state at the edge.
- Protection is enforced in the server entry points that actually execute user operations.
- If full edge-time suspension invalidation is later required, the next step is a session-version or database-session design.
## Dependency Hotfix - Undici Advisory (March 14, 2026)

- `npm audit --omit=dev` release prep sirasinda `undici` icin high severity advisory verdi.
- Kaynak zincir:
  - `isomorphic-dompurify`
  - `jsdom`
  - `undici`
- Hotfix yaklasimi:
  - dogrudan uygulama kodunu degistirmek yerine `package.json` icinde `overrides.undici = 7.24.2` tanimlandi
  - lockfile bu surume sabitlendi
- Sonuc:
  - `npm audit --omit=dev` tekrar `0 vulnerabilities`
  - `npm run lint`, `npx tsc --noEmit`, `npm run build` gecti

## 15 March 2026 Update - Security Review Remediation

- Login ve admin login ekranlarindaki `callbackUrl` sink'i kapatildi.
  - sadece internal / same-origin callback path'leri kabul ediliyor
- Duyuru sistemi structured content modeline tasindi.
  - `announcements.content_blocks` JSON alani eklendi
  - admin create/update artik blok semasi uzerinden calisiyor
  - oyuncu tarafi duyuru render zincirinden `dangerouslySetInnerHTML` kaldirildi
  - eski HTML duyurular legacy uyumlulukla okunuyor
- Abuse hardening genisletildi:
  - `/api/store/catalog`
  - `/api/admin/words`
  - `/api/admin/categories`
  - `/api/admin/announcements`
  - `/api/announcements/visible`
  read rate limit altina alindi
- `/api/support/*` ve `/api/coin-grants/*` state-changing endpoint'leri proxy origin kontrol kapsaminda tutuluyor
- AI raporunda kritik diye yazilan Prisma `fields.usageLimit` iddiasi repo icinde smoke test ile yanlislandi
  - `test:promotion-field-references`

## 8 August 2026 Update - Adaptive Turnstile Launch Policy

- Varsayilan yeni Turnstile modu `managed` oldu; mevcut kaydedilmis operator ayarlari korunur.
- Sayfa acilisinda token uretilmez. Kullanici niyetinde config ve provider scripti prewarm edilir, token submit sirasinda alinir.
- Siteverify exact action, production hostname allowlist, 2048 karakter token siniri ve 5 saniye timeout ile fail-closed calisir.
- Production preflight `TURNSTILE_ALLOWED_HOSTNAMES` icinde public site hostname'ini zorunlu tutar.
- Redis rate limit, Turnstile karari ve ekonomi guardrail'leri birbirinden bagimsiz kalir; captcha icin uygulama ici cezalandirici skor eklenmemistir.
- Operasyon ve test sozlesmesi: `docs/security/adaptive-turnstile-policy.md`.

## 15 March 2026 Update - Captcha Provider Policy

- Captcha politikasi tek aktif provider modeline cekildi.
  - ayni anda sadece bir provider aktif kalir
  - provider degisimi admin panelden operator kontrollu yapilir
- Varsayilan provider normalize edildi:
  - `turnstile`
- Production ortaminda effective captcha fail mode zorunlu olarak `hard_fail`
  - saved `soft_fail` degeri production'da savunmayi gevsetmez
- Turnstile deneyimi icin runtime `turnstileMode` ayari eklendi:
  - `invisible`
  - `non_interactive`
  - `managed`
- Admin panel captcha karti sadeleştirildi:
  - fail mode secicisi kaldirildi
  - provider secimi + korunan akislar + turnstile mode + readiness + production policy bilgisi korunuyor
## Realtime Oyun Payload Sertleştirmesi (30 Temmuz 2026)

- Genel `oyunDurumuGuncelle` olayı yalnız whitelist ile oluşturulan public state
  gönderir. `aktifKart`, socket id'leri, dahili anlatıcı/gözetmen kimlikleri ve
  `creatorId` bu payload'a girmez.
- Kart yalnız sunucunun rol ve takım kontrolünden sonra `yeniTurBilgisi` veya
  `kartGuncelle` ile yetkili oyuncuya gönderilir.
- Lobi oyuncu listesi socket id, IP, user id, identity type ve username snapshot
  içermez. Kalıcı `playerId`, host/kick/self eşleştirmesi için public oyun
  kimliği olarak kalır ve tek başına yetki sağlamaz.
- Oyun başlatma, yönetici devri ve oyuncu atma payload'ları Zod ile doğrulanır.
  Eksik veya bozuk F12/socket payload'ları handler destructuring hatası
  üretemez.
- Aktif maç yeniden başlatılamaz veya takımlar F12 üzerinden karıştırılamaz.
  Kelime aksiyonları oda bazlı lock ile seri işlenir.
- Redis oda kilitleri sahiplik token'ı ve atomik compare-and-delete ile bırakılır;
  süresi dolan eski bir işlem yeni sahibin kilidini silemez.
- Kategori ID'leri hem ayar güncellemesinde hem oyun başlangıcında sunucunun
  görünür kategori whitelist'iyle kesiştirilir. Takım değişimleri de kapasite
  yarışlarını önlemek için oda bazında seri işlenir.
- Bütün kritik yetkiler istemci görünümünden bağımsız olarak sunucuda güncel
  socket üyeliği ve `creatorPlayerId`/rol üzerinden tekrar doğrulanır.

Regresyon kapısı:

```powershell
npm run test:room-socket-security
```

### Geçici transitive bağımlılık sabitlemeleri

- Next.js `16.2.12` güncel sürümü eski PostCSS ve Sharp sürümlerini taşıdığı için
  kök `package.json` içinde PostCSS `8.5.25` ve Sharp `0.35.3` override edilir.
- Override'lar kaldırılmadan önce `npm audit --omit=dev --audit-level=high`,
  production build ve multiplayer Playwright paketi yeniden çalıştırılmalıdır.
