export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().toUpperCase();
  let out = "";
  for (let index = 0; index < 36; index++) {
    if (index === 8 || index === 13 || index === 18 || index === 23) out += "-";
    else if (index === 14) out += "4";
    else if (index === 19) out += ((Math.random() * 4) | 8).toString(16);
    else out += ((Math.random() * 16) | 0).toString(16);
  }
  return out.toUpperCase();
}

/** The 64-bit FNV-1a hash of a string's UTF-8 bytes, in hex. */
export function fnv1a(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** A small seeded generator, for cover patterns that must come out the same every time. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
}

export function seedOf(id: string): number {
  return parseInt(fnv1a(id).slice(0, 8), 16) >>> 0;
}
