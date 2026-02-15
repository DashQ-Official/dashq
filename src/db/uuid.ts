import { randomBytes } from "node:crypto";

// Module-level state for monotonic ordering within the same millisecond.
let lastTimestamp = 0;
let counter = 0;

/**
 * Generates a UUIDv7 identifier (RFC 9562).
 *
 * UUIDv7 embeds a millisecond-precision Unix timestamp in the first 48 bits,
 * making IDs naturally time-sortable while remaining globally unique.
 * Consecutive IDs generated within the same millisecond use a monotonic
 * counter to guarantee sort order.
 *
 * @returns A UUIDv7 string in standard 8-4-4-4-12 format (36 characters).
 */
export function generateId(): string {
  let now = Date.now();

  if (now === lastTimestamp) {
    counter = (counter + 1) & 0xfff;
    if (counter === 0) {
      // Counter overflow (>4095 IDs in 1 ms) — wait for next millisecond.
      while (Date.now() === now) {
        /* busy-wait */
      }
      now = Date.now();
      lastTimestamp = now;
      counter = randomBytes(2).readUInt16BE(0) & 0xfff;
    }
  } else {
    lastTimestamp = now;
    counter = randomBytes(2).readUInt16BE(0) & 0xfff;
  }

  // 16-byte buffer for the UUID
  const bytes = new Uint8Array(16);

  // Bytes 0-5: 48-bit timestamp (big-endian)
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now >>> 24) & 0xff;
  bytes[3] = (now >>> 16) & 0xff;
  bytes[4] = (now >>> 8) & 0xff;
  bytes[5] = now & 0xff;

  // Bytes 6-7: version (0111) + 12-bit counter
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  bytes[7] = counter & 0xff;

  // Bytes 8-15: variant (10) + 62 bits of random data
  const rand = randomBytes(8);
  bytes[8] = 0x80 | (rand[0] & 0x3f);
  bytes[9] = rand[1];
  bytes[10] = rand[2];
  bytes[11] = rand[3];
  bytes[12] = rand[4];
  bytes[13] = rand[5];
  bytes[14] = rand[6];
  bytes[15] = rand[7];

  return formatUuid(bytes);
}

function formatUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
