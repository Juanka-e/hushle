/**
 * Database error details across Prisma's error shapes.
 *
 * Prisma 6's engine put the unique index of a P2002 in `meta.target` and the MySQL error
 * number of a failed raw query (P2010) in `meta.code`. With Prisma 7's driver adapter the
 * same details sit in `meta.driverAdapterError.cause` (`constraint.index`, `originalCode`).
 * These helpers read both, so callers keep working whichever shape an error has.
 */
interface DriverAdapterCause {
    kind?: unknown;
    originalCode?: unknown;
    constraint?: { index?: unknown; fields?: unknown };
}

interface DatabaseErrorShape {
    code?: unknown;
    meta?: {
        target?: unknown;
        code?: unknown;
        driverAdapterError?: { cause?: DriverAdapterCause };
    };
}

function asShape(error: unknown): DatabaseErrorShape | null {
    return typeof error === "object" && error !== null ? (error as DatabaseErrorShape) : null;
}

/** The unique index (or its fields, comma-separated) a P2002 names, or null for any other error. */
export function getUniqueConstraintTarget(error: unknown): string | null {
    const shape = asShape(error);
    if (shape?.code !== "P2002") return null;
    const constraint = shape.meta?.driverAdapterError?.cause?.constraint;
    const target = shape.meta?.target ?? constraint?.index ?? constraint?.fields;
    if (target === undefined || target === null) return null;
    return Array.isArray(target) ? target.map(String).join(",") : String(target);
}

/**
 * True for a deadlock or write conflict MySQL asks to retry: P2034 from Prisma's own queries,
 * or P2010 with MySQL error 1213 from raw SQL.
 */
export function isRetryableWriteConflict(error: unknown): boolean {
    const shape = asShape(error);
    if (shape?.code === "P2034") return true;
    if (shape?.code !== "P2010") return false;
    const cause = shape.meta?.driverAdapterError?.cause;
    return (
        String(shape.meta?.code ?? cause?.originalCode ?? "") === "1213" ||
        cause?.kind === "TransactionWriteConflict"
    );
}
