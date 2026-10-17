import {
    PASSWORD_MAX_UTF8_BYTES,
    PASSWORD_MIN_LENGTH,
    type PasswordPolicyResult,
} from "@hushle/auth-policy";
import {
    PlayerErrorCode,
    playerError,
    type PlayerErrorBody,
} from "@/lib/errors/player-error";

/** Error body for a rejected password: the first failing rule, in the order the policy lists its issues. */
export function passwordPolicyError(
    password: string,
    policy: Pick<PasswordPolicyResult, "utf8Bytes">
): PlayerErrorBody {
    if (password.length < PASSWORD_MIN_LENGTH) {
        return playerError(PlayerErrorCode.PASSWORD_TOO_SHORT, { min: PASSWORD_MIN_LENGTH });
    }
    if (policy.utf8Bytes > PASSWORD_MAX_UTF8_BYTES) {
        return playerError(PlayerErrorCode.PASSWORD_TOO_LONG_BYTES, {
            max: PASSWORD_MAX_UTF8_BYTES,
        });
    }
    return playerError(PlayerErrorCode.PASSWORD_TOO_WEAK);
}
