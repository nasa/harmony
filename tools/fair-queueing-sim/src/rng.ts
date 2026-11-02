//
// Seeded random number generation. Every random draw in a simulation comes from a stream derived
// from the scenario seed plus a stable key (e.g. a job name and work item index), so the same
// work item gets the same duration no matter which policy is running or in what order items are
// scheduled. This keeps policy comparisons free of sampling noise ("common random numbers").
//

export type Random = () => number;

/**
 * Hashes a string to a 32 bit unsigned integer (cyrb53 folded to 32 bits).
 *
 * @param str - the string to hash
 * @returns a 32 bit unsigned integer
 */
export function hashString(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/**
 * Returns a mulberry32 pseudo random number generator producing floats in [0, 1).
 *
 * @param seed - a 32 bit integer seed
 * @returns the generator function
 */
export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns an independent random stream for the given seed and keys.
 *
 * @param seed - the scenario seed
 * @param keys - values identifying the stream, e.g. a job name and work item index
 * @returns the generator function
 */
export function rngFor(seed: number, ...keys: (string | number)[]): Random {
  return mulberry32(hashString(`${seed}:${keys.join(':')}`));
}

/**
 * Returns a deterministic, well formed version 4 UUID drawn from the given stream.
 *
 * @param random - the random stream to draw from
 * @returns the UUID
 */
export function uuidFrom(random: Random): string {
  const hex = [];
  for (let i = 0; i < 32; i++) {
    hex.push(Math.floor(random() * 16).toString(16));
  }
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/**
 * Draws a standard normal value using the Box-Muller transform.
 *
 * @param random - the random stream to draw from
 * @returns a normally distributed value with mean 0 and standard deviation 1
 */
export function standardNormal(random: Random): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
