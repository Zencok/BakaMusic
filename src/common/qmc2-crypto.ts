/**
 * QMC2 Decryption Engine — Pure TypeScript
 *
 * Faithfully ported from MusicFree Android (Mp3UtilModule.kt).
 * Supports mflac / mgg / mmp4 / mflac0 encrypted audio streams.
 *
 * Two decryption modes based on decoded key length:
 *   - MapL  (key <= 300 bytes): compressed key + XOR transform
 *   - RC4   (key > 300 bytes): RC4 stream cipher with pre-cached keystream
 */

// ---------------------------------------------------------------------------
// TEA Cipher (16 rounds, QQ custom double-IV CBC)
// ---------------------------------------------------------------------------

const TEA_ROUNDS = 16;
const TEA_DELTA = 0x9e3779b9;
const SALT_LEN = 2;
const ZERO_LEN = 7;
const FIXED_PADDING_LEN = 1 + SALT_LEN + ZERO_LEN; // 10

/**
 * All TEA/uint32 arithmetic uses `>>> 0` to stay in unsigned 32-bit range.
 * This matches Kotlin's `toUInt32(v: Long) = v and 0xffffffffL`.
 */

function readU32BE(buf: Buffer, off: number): number {
    return (
        (((buf[off] & 0xff) << 24) |
            ((buf[off + 1] & 0xff) << 16) |
            ((buf[off + 2] & 0xff) << 8) |
            (buf[off + 3] & 0xff)) >>> 0
    );
}

function writeU32BE(buf: Buffer, off: number, v: number): void {
    buf[off] = (v >>> 24) & 0xff;
    buf[off + 1] = (v >>> 16) & 0xff;
    buf[off + 2] = (v >>> 8) & 0xff;
    buf[off + 3] = v & 0xff;
}

function ecbSingleRound(value: number, sum: number, key1: number, key2: number): number {
    const left = (((value << 4) >>> 0) + key1) >>> 0;
    const right = ((value >>> 5) + key2) >>> 0;
    const mid = (sum + value) >>> 0;
    return (left ^ mid ^ right) >>> 0;
}

function decryptBlock(blockHi: number, blockLo: number, keyWords: number[]): [number, number] {
    let y = blockHi >>> 0;
    let z = blockLo >>> 0;
    let sum = (TEA_DELTA * TEA_ROUNDS) >>> 0;
    for (let round = 0; round < TEA_ROUNDS; round++) {
        const tmp1 = ecbSingleRound(y, sum, keyWords[2], keyWords[3]);
        z = (z - tmp1) >>> 0;
        const tmp0 = ecbSingleRound(z, sum, keyWords[0], keyWords[1]);
        y = (y - tmp0) >>> 0;
        sum = (sum - TEA_DELTA) >>> 0;
    }
    return [y, z];
}

/**
 * QQ-TEA decrypt (custom double-IV CBC mode).
 * Ported from Kotlin tcTeaDecrypt.
 */
function tcTeaDecrypt(cipher: Buffer, key: Buffer): Buffer | null {
    if (cipher.length % 8 !== 0 || cipher.length < FIXED_PADDING_LEN) {
        return null;
    }
    const keyWords = [
        readU32BE(key, 0),
        readU32BE(key, 4),
        readU32BE(key, 8),
        readU32BE(key, 12),
    ];
    const plain = Buffer.alloc(cipher.length);
    let iv1Hi = 0, iv1Lo = 0;
    let iv2Hi = 0, iv2Lo = 0;
    let off = 0;
    while (off < cipher.length) {
        const cHi = readU32BE(cipher, off);
        const cLo = readU32BE(cipher, off + 4);
        const xHi = (cHi ^ iv2Hi) >>> 0;
        const xLo = (cLo ^ iv2Lo) >>> 0;
        const [dHi, dLo] = decryptBlock(xHi, xLo, keyWords);
        const pHi = (dHi ^ iv1Hi) >>> 0;
        const pLo = (dLo ^ iv1Lo) >>> 0;
        writeU32BE(plain, off, pHi);
        writeU32BE(plain, off + 4, pLo);
        iv1Hi = cHi;
        iv1Lo = cLo;
        iv2Hi = dHi;
        iv2Lo = dLo;
        off += 8;
    }
    const padSize = plain[0] & 0x07;
    const start = 1 + padSize + SALT_LEN;
    const end = cipher.length - ZERO_LEN;
    // Verify zero tail
    for (let i = end; i < plain.length; i++) {
        if (plain[i] !== 0) return null;
    }
    if (end <= start) return null;
    return plain.subarray(start, end);
}

// ---------------------------------------------------------------------------
// EKey Decryption
// ---------------------------------------------------------------------------

const EKEY_V2_PREFIX = "UVFNdXNpYyBFbmNWMixLZXk6"; // base64("QQMusic EncV2,Key:")
const EKEY_V2_KEY1 = Buffer.from([
    0x33, 0x38, 0x36, 0x5a, 0x4a, 0x59, 0x21, 0x40,
    0x23, 0x2a, 0x24, 0x25, 0x5e, 0x26, 0x29, 0x28,
]);
const EKEY_V2_KEY2 = Buffer.from([
    0x2a, 0x2a, 0x23, 0x21, 0x28, 0x23, 0x24, 0x25,
    0x26, 0x5e, 0x61, 0x31, 0x63, 0x5a, 0x2c, 0x54,
]);

function makeSimpleKey(len = 8): Buffer {
    const result = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        const value = 106.0 + i * 0.1;
        const t = Math.tan(value);
        const scaled = Math.abs(t) * 100.0;
        result[i] = Math.floor(scaled) & 0xff;
    }
    return result;
}

export function normalizeEkey(input: string): string {
    const s = input.trim();
    return s.length > 704 ? s.slice(s.length - 704) : s;
}

function decryptEKeyV1(base64Str: string): Buffer | null {
    const decoded = Buffer.from(base64Str, "base64");
    if (decoded.length < 12) return null;
    const header = decoded.subarray(0, 8);
    const cipher = decoded.subarray(8);
    const simpleKey = makeSimpleKey(8);
    const teaKey = Buffer.alloc(16);
    for (let i = 0; i < 8; i++) {
        teaKey[i * 2] = simpleKey[i];
        teaKey[i * 2 + 1] = header[i];
    }
    const recovered = tcTeaDecrypt(cipher, teaKey);
    if (!recovered) return null;
    return Buffer.concat([header, recovered]);
}

function decryptEKeyV2(base64Str: string): Buffer | null {
    let payload = base64Str;
    if (payload.startsWith(EKEY_V2_PREFIX)) {
        payload = payload.substring(EKEY_V2_PREFIX.length);
    }
    let data: Buffer | null = Buffer.from(payload, "base64");
    data = tcTeaDecrypt(data, EKEY_V2_KEY1);
    if (!data) return null;
    data = tcTeaDecrypt(data, EKEY_V2_KEY2);
    if (!data) return null;
    // Trim trailing zeros
    let end = data.length;
    while (end > 0 && data[end - 1] === 0) end--;
    const trimmed = data.subarray(0, end).toString("utf8");
    return decryptEKeyV1(trimmed);
}

export function decryptEKey(base64Str: string): Buffer | null {
    try {
        if (base64Str.startsWith(EKEY_V2_PREFIX)) {
            return decryptEKeyV2(base64Str);
        }
        return decryptEKeyV1(base64Str);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// QMC Helper — matches Kotlin QmcHelper object exactly
// ---------------------------------------------------------------------------

/**
 * Kotlin uses Long arithmetic (64-bit) for the hash accumulation, then
 * returns Double. JS numbers are 64-bit floats (safe up to 2^53).
 * We replicate the Kotlin logic: accumulate as a positive integer,
 * mask to 32-bit unsigned, then return as a JS number (which is
 * effectively a double, matching Kotlin's `.toDouble()`).
 *
 * CRITICAL: The old code used `(hash * v) & 0xffffffff` which produces
 * a SIGNED 32-bit int in JS. For values >= 2^31 this goes negative,
 * causing the `next <= hash` check to break the loop prematurely.
 * Fix: use `>>> 0` to stay unsigned.
 */
function calculateQMCHash(key: Buffer): number {
    let hash = 1;
    for (let i = 0; i < key.length; i++) {
        const v = key[i] & 0xff;
        if (v === 0) continue;
        // Kotlin: val next = (hash * v) and 0xffffffffL
        // In JS, hash * v can be up to ~(2^32 * 255) ≈ 1.09e12, within safe integer range.
        // Use `>>> 0` to get unsigned 32-bit result (not `& 0xffffffff` which gives signed).
        const next = (hash * v) >>> 0;
        if (next === 0 || next <= hash) break;
        hash = next;
    }
    // Kotlin: return (hash and 0xffffffffL).toDouble()
    return hash >>> 0;
}

/**
 * Kotlin: fun getSegmentKey(id: Long, seed: Int, hash: Double): Long
 * Returns floor(hash / ((id+1) * seed) * 100.0) as integer.
 */
function getSegmentKey(id: number, seed: number, hash: number): number {
    if (seed === 0) return 0;
    const denominator = (id + 1) * seed;
    const result = (hash / denominator) * 100.0;
    return Math.floor(result);
}

function keyCompress(longKey: Buffer): Buffer {
    const INDEX_OFFSET = 71214;
    const V1_KEY_SIZE = 128;
    const n = longKey.length;
    if (n === 0) return Buffer.alloc(0);
    const result = Buffer.alloc(V1_KEY_SIZE);
    for (let i = 0; i < V1_KEY_SIZE; i++) {
        const index = (i * i + INDEX_OFFSET) % n;
        const k = longKey[index] & 0xff;
        const shift = (index + 4) % 8;
        const leftShift = (k << shift) & 0xff;
        const rightShift = (k >>> shift) & 0xff;
        result[i] = (leftShift | rightShift) & 0xff;
    }
    return result;
}

function qmc1Transform(compressedKey: Buffer, value: number, offset: number): number {
    const V1_OFFSET_BOUNDARY = 0x7fff;
    const V1_KEY_SIZE = 128;
    let off = offset;
    if (off > V1_OFFSET_BOUNDARY) off %= V1_OFFSET_BOUNDARY;
    return value ^ (compressedKey[off % V1_KEY_SIZE] & 0xff);
}

// ---------------------------------------------------------------------------
// RC4
// ---------------------------------------------------------------------------

class RC4 {
    private n: number;
    private state: Buffer;
    private i: number;
    private j: number;

    constructor(key: Buffer) {
        this.n = key.length;
        this.state = Buffer.alloc(this.n);
        for (let i = 0; i < this.n; i++) this.state[i] = i & 0xff;
        let j = 0;
        for (let i = 0; i < this.n; i++) {
            j = (j + (this.state[i] & 0xff) + (key[i % this.n] & 0xff)) % this.n;
            const tmp = this.state[i];
            this.state[i] = this.state[j];
            this.state[j] = tmp;
        }
        this.i = 0;
        this.j = 0;
    }

    private generate(): number {
        this.i = (this.i + 1) % this.n;
        this.j = (this.j + (this.state[this.i] & 0xff)) % this.n;
        const tmp = this.state[this.i];
        this.state[this.i] = this.state[this.j];
        this.state[this.j] = tmp;
        const iVal = this.state[this.i] & 0xff;
        const jVal = this.state[this.j] & 0xff;
        const index = (iVal + jVal) % this.n;
        return this.state[index] & 0xff;
    }

    derive(buf: Buffer): void {
        for (let k = 0; k < buf.length; k++) {
            buf[k] = (buf[k] ^ this.generate()) & 0xff;
        }
    }
}

// ---------------------------------------------------------------------------
// QMC2 Decoder — matches Kotlin QMC2Decoder class exactly
// ---------------------------------------------------------------------------

const FIRST_SEGMENT_SIZE = 0x80;   // 128
const OTHER_SEGMENT_SIZE = 0x1400; // 5120

export class QMC2Decoder {
    private mode: "MapL" | "RC4";
    private compressedKey: Buffer | null;
    private key: Buffer | null;
    private keyStream: Buffer | null;
    private hash: number;

    constructor(rawKey: Buffer) {
        const keyLen = rawKey.length;
        if (keyLen <= 300) {
            this.mode = "MapL";
            this.compressedKey = keyCompress(rawKey);
            this.key = null;
            this.keyStream = null;
            this.hash = 0;
        } else {
            this.mode = "RC4";
            this.compressedKey = null;
            this.key = rawKey;
            this.hash = calculateQMCHash(rawKey);
            const RC4_STREAM_CACHE_SIZE = 0x1400 + 512;
            const rc4 = new RC4(rawKey);
            this.keyStream = Buffer.alloc(RC4_STREAM_CACHE_SIZE);
            rc4.derive(this.keyStream);
        }
    }

    decrypt(offset: number, buf: Buffer): void {
        if (this.mode === "MapL") {
            this.decryptMapL(offset, buf);
        } else {
            this.decryptRC4(offset, buf);
        }
    }

    private decryptMapL(startOffset: number, buf: Buffer): void {
        const ck = this.compressedKey;
        if (!ck) {
            return;
        }
        for (let i = 0; i < buf.length; i++) {
            buf[i] = qmc1Transform(ck, buf[i] & 0xff, startOffset + i) & 0xff;
        }
    }

    /**
     * RC4 mode decryption — ported from Kotlin decryptChunk().
     *
     * Three regions:
     *   1. First 128 bytes (0x80): XOR with key[segmentKey % n]
     *   2. Alignment to 5120-byte boundary
     *   3. Remaining full 5120-byte segments: XOR with cached keystream
     */
    private decryptRC4(startOffset: number, buf: Buffer): void {
        const k = this.key;
        const ks = this.keyStream;
        if (!k || !ks) {
            return;
        }
        const n = k.length;
        const hash = this.hash;
        let offset = startOffset;
        let position = 0;

        // Kotlin: fun processFirst(data: ByteArray, off: Int)
        const processFirst = (data: Buffer, off: number): void => {
            for (let i = 0; i < data.length; i++) {
                const current = off + i;
                const seed = k[current % n] & 0xff;
                const idx = getSegmentKey(current, seed, hash);
                // Kotlin: (idx % n).toInt()
                const keyIdx = ((idx % n) + n) % n;
                data[i] = ((data[i] & 0xff) ^ (k[keyIdx] & 0xff)) & 0xff;
            }
        };

        // Kotlin: fun processOther(data: ByteArray, off: Int)
        const processOther = (data: Buffer, off: number): void => {
            const id = Math.floor(off / OTHER_SEGMENT_SIZE);
            const blockOffset = off % OTHER_SEGMENT_SIZE;
            const seed = k[id % n] & 0xff;
            // Kotlin: (getSegmentKey(...) and 0x1ff).toInt()
            const skip = getSegmentKey(id, seed, hash) & 0x1ff;
            for (let i = 0; i < data.length; i++) {
                const streamIdx = skip + blockOffset + i;
                if (streamIdx < ks.length) {
                    data[i] = ((data[i] & 0xff) ^ (ks[streamIdx] & 0xff)) & 0xff;
                }
            }
        };

        // Process first 128 bytes (header region)
        // Kotlin: buf.copyOfRange() creates independent copy
        if (offset < FIRST_SEGMENT_SIZE) {
            const len = Math.min(FIRST_SEGMENT_SIZE - offset, buf.length);
            if (len > 0) {
                const seg = Buffer.from(buf.subarray(position, position + len));
                processFirst(seg, offset);
                seg.copy(buf, position);
                position += len;
                offset += len;
            }
        }

        // Align to segment boundary
        if (offset >= FIRST_SEGMENT_SIZE && offset % OTHER_SEGMENT_SIZE !== 0) {
            const excess = offset % OTHER_SEGMENT_SIZE;
            const alignment = Math.min(OTHER_SEGMENT_SIZE - excess, buf.length - position);
            if (alignment > 0) {
                const seg = Buffer.from(buf.subarray(position, position + alignment));
                processOther(seg, offset);
                seg.copy(buf, position);
                position += alignment;
                offset += alignment;
            }
        }

        // Process remaining full segments
        while (position < buf.length) {
            const segment = Math.min(OTHER_SEGMENT_SIZE, buf.length - position);
            const seg = Buffer.from(buf.subarray(position, position + segment));
            processOther(seg, offset);
            seg.copy(buf, position);
            position += segment;
            offset += segment;
        }
    }
}

// ---------------------------------------------------------------------------
// URL Detection
// ---------------------------------------------------------------------------

const MFLAC_EXTENSIONS = [".mflac", ".mgg", ".mmp4", ".mflac0"];

export function isMflacUrl(url: string): boolean {
    if (!url) return false;
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return MFLAC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
    } catch {
        const lower = url.split("?")[0].toLowerCase();
        return MFLAC_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }
}

export function getMimeType(url: string): string {
    const lower = url.split("?")[0].toLowerCase();
    if (lower.endsWith(".mgg")) return "audio/ogg";
    if (lower.endsWith(".mmp4")) return "audio/mp4";
    return "audio/flac";
}
