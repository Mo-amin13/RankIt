import { createHash, randomBytes } from "node:crypto"

// Anonymous ownership: each browser gets a random secret in an HttpOnly
// cookie, and rankings are saved under a SHA-256 hash of it. The database
// never holds the secret itself, so a leaked database cannot be used to act
// as anyone.

export const OWNER_COOKIE = "rankit_owner"

// Browsers cap cookie lifetimes at about 400 days; refreshed on every visit.
export const OWNER_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

// 32 random bytes in base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export function newOwnerToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

// Returns the owner token from a Cookie header, or undefined when it is
// missing or not something this server could have issued.
export function readOwnerToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined
  }

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=")
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()

    if (separator > 0 && name === OWNER_COOKIE && TOKEN_PATTERN.test(value)) {
      return value
    }
  }

  return undefined
}
