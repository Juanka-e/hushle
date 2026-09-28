import { Prisma, prisma } from "@hushle/platform-db";
import { z } from "zod";

const profilePatchSchema = z
    .object({
        displayName: z.preprocess(
            (value) => {
                if (typeof value !== "string") return value;
                const trimmed = value.trim();
                return trimmed.length === 0 ? null : trimmed;
            },
            z.string().trim().min(1).max(60).nullable().optional()
        ),
        bio: z.string().trim().max(300).optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.displayName !== undefined ||
            value.bio !== undefined,
        { message: "At least one profile field is required." }
    );

export type PlayerProfilePatch = z.infer<typeof profilePatchSchema>;

export type PlayerAuditContext = {
    actorRole: string;
    ipAddress?: string | null;
    userAgent?: string | null;
};

export type PlayerCoreView = {
    id: number;
    username: string;
    email: string | null;
    emailVerifiedAt: string | null;
    wallet: {
        coinBalance: number;
    };
    profile: {
        displayName: string | null;
        bio: string | null;
        avatarItemId: number | null;
        frameItemId: number | null;
        cardBackItemId: number | null;
        cardFaceItemId: number | null;
    };
};

export class PlayerCoreError extends Error {
    constructor(
        public readonly code:
            | "invalid_profile"
            | "user_not_found",
        message: string = code
    ) {
        super(message);
        this.name = "PlayerCoreError";
    }
}

export function parsePlayerProfilePatch(input: unknown): PlayerProfilePatch {
    const parsed = profilePatchSchema.safeParse(input);
    if (!parsed.success) {
        throw new PlayerCoreError(
            "invalid_profile",
            parsed.error.issues[0]?.message ?? "Profile payload is invalid."
        );
    }
    return parsed.data;
}

export async function getPlayerCore(userId: number): Promise<PlayerCoreView> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            email: true,
            emailVerifiedAt: true,
            wallet: { select: { coinBalance: true } },
            profile: {
                select: {
                    displayName: true,
                    bio: true,
                    avatarItemId: true,
                    frameItemId: true,
                    cardBackItemId: true,
                    cardFaceItemId: true,
                },
            },
        },
    });
    if (!user) throw new PlayerCoreError("user_not_found");

    return {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        wallet: {
            coinBalance: user.wallet?.coinBalance ?? 0,
        },
        profile: {
            displayName: user.profile?.displayName ?? null,
            bio: user.profile?.bio ?? null,
            avatarItemId: user.profile?.avatarItemId ?? null,
            frameItemId: user.profile?.frameItemId ?? null,
            cardBackItemId: user.profile?.cardBackItemId ?? null,
            cardFaceItemId: user.profile?.cardFaceItemId ?? null,
        },
    };
}

function buildAuditData(input: {
    userId: number;
    role: string;
    action: string;
    summary: string;
    metadata: Prisma.InputJsonObject;
    context: PlayerAuditContext;
}): Prisma.AuditLogCreateManyInput {
    return {
        actorUserId: input.userId,
        actorRole: input.role.slice(0, 20),
        action: input.action.slice(0, 80),
        resourceType: "user_profile",
        resourceId: String(input.userId),
        ipAddress: input.context.ipAddress?.slice(0, 64) || null,
        userAgent: input.context.userAgent?.slice(0, 255) || null,
        summary: input.summary.slice(0, 255),
        metadata: input.metadata,
    };
}

export async function updatePlayerProfile(input: {
    userId: number;
    patch: unknown;
    auditContext: PlayerAuditContext;
}) {
    const patch = parsePlayerProfilePatch(input.patch);

    const currentUser = await prisma.user.findUnique({
        where: { id: input.userId },
        select: {
            email: true,
            username: true,
            profile: { select: { displayName: true } },
        },
    });
    if (!currentUser) throw new PlayerCoreError("user_not_found");

    const requestedDisplayName =
        patch.displayName === undefined
            ? undefined
            : patch.displayName?.trim() ?? null;
    const previousDisplayName =
        currentUser.profile?.displayName?.trim() ?? null;
    const displayNameChanged =
        requestedDisplayName !== undefined &&
        requestedDisplayName !== previousDisplayName;

    const profile = await prisma.$transaction(async (tx) => {
        const updated = await tx.userProfile.upsert({
            where: { userId: input.userId },
            create: {
                userId: input.userId,
                ...(patch.displayName !== undefined
                    ? { displayName: patch.displayName }
                    : {}),
                ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
            },
            update: {
                ...(patch.displayName !== undefined
                    ? { displayName: patch.displayName }
                    : {}),
                ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
            },
            include: {
                avatarItem: true,
                frameItem: true,
                cardBackItem: true,
                cardFaceItem: true,
            },
        });

        const auditRows: Prisma.AuditLogCreateManyInput[] = [
            buildAuditData({
                userId: input.userId,
                role: input.auditContext.actorRole,
                action: "user.profile.update",
                summary: `Updated user profile ${input.userId}`,
                metadata: {
                    hasDisplayName: updated.displayName !== null,
                    hasBio: updated.bio !== null,
                    hasEmail: currentUser.email !== null,
                },
                context: input.auditContext,
            }),
        ];
        if (displayNameChanged) {
            auditRows.push(
                buildAuditData({
                    userId: input.userId,
                    role: input.auditContext.actorRole,
                    action: "user.profile.display_name_update",
                    summary: `Updated display name for user ${currentUser.username}`,
                    metadata: {
                        previousDisplayName,
                        nextDisplayName: updated.displayName,
                    },
                    context: input.auditContext,
                })
            );
        }
        await tx.auditLog.createMany({ data: auditRows });
        return updated;
    });

    return {
        profile,
        changes: { emailChanged: false, displayNameChanged },
    };
}
