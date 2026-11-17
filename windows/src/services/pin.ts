// The PIN that opens locked notebooks when Windows Hello can't. Only a salted hash is kept, in settings.json.

export function validPin(pin: string): boolean {
  return /^\d{4,32}$/.test(pin);
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** SHA-256 of the salt, a separator and the PIN, in hex. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`));
  return toHex(new Uint8Array(digest));
}

export async function pinMatches(pin: string, hash: string | null, salt: string | null): Promise<boolean> {
  if (!hash || !salt) return false;
  const attempt = await hashPin(pin, salt);
  // The same time whichever character differs first.
  let difference = attempt.length ^ hash.length;
  for (let index = 0; index < attempt.length; index++) difference |= attempt.charCodeAt(index) ^ (hash.charCodeAt(index) || 0);
  return difference === 0;
}
