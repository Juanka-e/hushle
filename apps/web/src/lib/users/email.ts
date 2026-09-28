const EMAIL_MAX_LENGTH = 191;

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function sanitizeEmail(email: string): string {
    return email.trim();
}

export function isEmailWithinLimit(email: string): boolean {
    return sanitizeEmail(email).length <= EMAIL_MAX_LENGTH;
}

export function areEmailsEqual(left: string | null, right: string | null): boolean {
    if (!left && !right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return normalizeEmail(left) === normalizeEmail(right);
}
