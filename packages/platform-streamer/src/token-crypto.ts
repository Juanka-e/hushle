import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Platform tokens at rest: AES-256-GCM with a versioned keyring so the key can be
// rotated without re-encrypting every row at once. The ciphertext is bound to its
// connection through the AAD, so a value copied into another row does not decrypt.
//
// Encoded form: `v<version>.<iv>.<tag>.<ciphertext>` (base64url, 12-byte IV, 16-byte tag).

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGORITHM = "aes-256-gcm";

export class StreamerConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StreamerConfigError";
    }
}

export type TokenDecryptReason = "unknown_version" | "tampered" | "malformed";

export class TokenDecryptError extends Error {
    readonly reason: TokenDecryptReason;

    constructor(reason: TokenDecryptReason) {
        super(`stored token could not be decrypted (${reason})`);
        this.name = "TokenDecryptError";
        this.reason = reason;
    }
}

export interface TokenKey {
    version: number;
    key: Buffer;
}

export interface TokenKeyring {
    current: TokenKey;
    previous?: TokenKey;
}

export interface TokenKeyringEnvironment {
    STREAMER_TOKEN_KEY?: string;
    STREAMER_TOKEN_KEY_VERSION?: string;
    STREAMER_TOKEN_KEY_PREVIOUS?: string;
    STREAMER_TOKEN_KEY_PREVIOUS_VERSION?: string;
}

function decodeKey(name: string, value: string | undefined): Buffer {
    if (!value || !/^[A-Za-z0-9+/=_-]+$/.test(value.trim())) {
        throw new StreamerConfigError(`${name} must be 32 bytes base64`);
    }
    const key = Buffer.from(value.trim(), "base64");
    if (key.length !== KEY_BYTES) {
        throw new StreamerConfigError(`${name} must be 32 bytes base64`);
    }
    return key;
}

function parseVersion(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value === "") return fallback;
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1) {
        throw new StreamerConfigError(`${name} must be an integer >= 1`);
    }
    return version;
}

export function loadTokenKeyring(env: TokenKeyringEnvironment): TokenKeyring {
    const current: TokenKey = {
        version: parseVersion("STREAMER_TOKEN_KEY_VERSION", env.STREAMER_TOKEN_KEY_VERSION, 1),
        key: decodeKey("STREAMER_TOKEN_KEY", env.STREAMER_TOKEN_KEY),
    };
    const hasPrevious = Boolean(env.STREAMER_TOKEN_KEY_PREVIOUS) || Boolean(env.STREAMER_TOKEN_KEY_PREVIOUS_VERSION);
    if (!hasPrevious) return { current };

    const previous: TokenKey = {
        version: parseVersion("STREAMER_TOKEN_KEY_PREVIOUS_VERSION", env.STREAMER_TOKEN_KEY_PREVIOUS_VERSION, NaN),
        key: decodeKey("STREAMER_TOKEN_KEY_PREVIOUS", env.STREAMER_TOKEN_KEY_PREVIOUS),
    };
    if (!Number.isInteger(previous.version)) {
        throw new StreamerConfigError("STREAMER_TOKEN_KEY_PREVIOUS_VERSION must be an integer >= 1");
    }
    if (previous.version === current.version) {
        throw new StreamerConfigError("STREAMER_TOKEN_KEY_PREVIOUS_VERSION must differ from STREAMER_TOKEN_KEY_VERSION");
    }
    return { current, previous };
}

export function connectionAad(platform: string, platformUserId: string): string {
    return `streamer:${platform}:${platformUserId}`;
}

export function encryptToken(plain: string, keyring: TokenKeyring, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, keyring.current.key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
        `v${keyring.current.version}`,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

function keyForVersion(keyring: TokenKeyring, version: number): Buffer | null {
    if (keyring.current.version === version) return keyring.current.key;
    if (keyring.previous && keyring.previous.version === version) return keyring.previous.key;
    return null;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function decryptToken(encoded: string, keyring: TokenKeyring, aad: string): string {
    const parts = typeof encoded === "string" ? encoded.split(".") : [];
    if (parts.length !== 4) throw new TokenDecryptError("malformed");
    const [versionPart, ivPart, tagPart, ciphertextPart] = parts;
    const versionMatch = /^v([1-9][0-9]{0,5})$/.exec(versionPart);
    if (!versionMatch || ![ivPart, tagPart, ciphertextPart].every((part) => BASE64URL.test(part))) {
        throw new TokenDecryptError("malformed");
    }
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    const ciphertext = Buffer.from(ciphertextPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new TokenDecryptError("malformed");

    const key = keyForVersion(keyring, Number(versionMatch[1]));
    if (!key) throw new TokenDecryptError("unknown_version");

    try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
        throw new TokenDecryptError("tampered");
    }
}
