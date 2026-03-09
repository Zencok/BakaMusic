/**
 * Lyric Decryption for Desktop (JS implementation)
 * Ported from MusicFree mobile's customDES.ts + musicDecrypter.ts
 *
 * Supports:
 * - QRC (QQ Music): Custom Triple-DES + Zlib decompression
 * - Kuwo: Base64 + Zlib + optional XOR decryption
 */

import pako from "pako";
import iconv from "iconv-lite";

// ============ QRC Custom DES Implementation ============
// Ported from MusicFree mobile src/utils/customDES.ts
// This is NOT standard DES - it's QQ Music's custom variant

const S_BOX1 = new Uint8Array([
    14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
]);
const S_BOX2 = new Uint8Array([
    15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
]);
const S_BOX3 = new Uint8Array([
    10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
]);
const S_BOX4 = new Uint8Array([
    7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
]);
const S_BOX5 = new Uint8Array([
    2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
]);
const S_BOX6 = new Uint8Array([
    12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
]);
const S_BOX7 = new Uint8Array([
    4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
]);
const S_BOX8 = new Uint8Array([
    13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
]);

const enum DESMode {
    DES_ENCRYPT = 0,
    DES_DECRYPT = 1,
}

function bitNum(a: Uint8Array, b: number, c: number): number {
    const byteIndex = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
    const bitPosition = 7 - (b % 8);
    const extractedBit = (a[byteIndex] >> bitPosition) & 0x01;
    return extractedBit << c;
}

function bitNumIntR(a: number, b: number, c: number): number {
    const extractedBit = (a >>> (31 - b)) & 0x00000001;
    return extractedBit << c;
}

function bitNumIntL(a: number, b: number, c: number): number {
    const extractedBit = ((a << b) & 0x80000000) >>> 0;
    return (extractedBit >>> c) >>> 0;
}

function sBoxBit(a: number): number {
    return (a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4);
}

function ipPermutation(state: Uint32Array, inBytes: Uint8Array): Uint32Array {
    state[0] = (
        bitNum(inBytes, 57, 31) | bitNum(inBytes, 49, 30) | bitNum(inBytes, 41, 29) |
        bitNum(inBytes, 33, 28) | bitNum(inBytes, 25, 27) | bitNum(inBytes, 17, 26) |
        bitNum(inBytes, 9, 25) | bitNum(inBytes, 1, 24) | bitNum(inBytes, 59, 23) |
        bitNum(inBytes, 51, 22) | bitNum(inBytes, 43, 21) | bitNum(inBytes, 35, 20) |
        bitNum(inBytes, 27, 19) | bitNum(inBytes, 19, 18) | bitNum(inBytes, 11, 17) |
        bitNum(inBytes, 3, 16) | bitNum(inBytes, 61, 15) | bitNum(inBytes, 53, 14) |
        bitNum(inBytes, 45, 13) | bitNum(inBytes, 37, 12) | bitNum(inBytes, 29, 11) |
        bitNum(inBytes, 21, 10) | bitNum(inBytes, 13, 9) | bitNum(inBytes, 5, 8) |
        bitNum(inBytes, 63, 7) | bitNum(inBytes, 55, 6) | bitNum(inBytes, 47, 5) |
        bitNum(inBytes, 39, 4) | bitNum(inBytes, 31, 3) | bitNum(inBytes, 23, 2) |
        bitNum(inBytes, 15, 1) | bitNum(inBytes, 7, 0)
    ) >>> 0;
    state[1] = (
        bitNum(inBytes, 56, 31) | bitNum(inBytes, 48, 30) | bitNum(inBytes, 40, 29) |
        bitNum(inBytes, 32, 28) | bitNum(inBytes, 24, 27) | bitNum(inBytes, 16, 26) |
        bitNum(inBytes, 8, 25) | bitNum(inBytes, 0, 24) | bitNum(inBytes, 58, 23) |
        bitNum(inBytes, 50, 22) | bitNum(inBytes, 42, 21) | bitNum(inBytes, 34, 20) |
        bitNum(inBytes, 26, 19) | bitNum(inBytes, 18, 18) | bitNum(inBytes, 10, 17) |
        bitNum(inBytes, 2, 16) | bitNum(inBytes, 60, 15) | bitNum(inBytes, 52, 14) |
        bitNum(inBytes, 44, 13) | bitNum(inBytes, 36, 12) | bitNum(inBytes, 28, 11) |
        bitNum(inBytes, 20, 10) | bitNum(inBytes, 12, 9) | bitNum(inBytes, 4, 8) |
        bitNum(inBytes, 62, 7) | bitNum(inBytes, 54, 6) | bitNum(inBytes, 46, 5) |
        bitNum(inBytes, 38, 4) | bitNum(inBytes, 30, 3) | bitNum(inBytes, 22, 2) |
        bitNum(inBytes, 14, 1) | bitNum(inBytes, 6, 0)
    ) >>> 0;
    return state;
}

function invIp(state: Uint32Array, inBytes: Uint8Array): Uint8Array {
    inBytes[3] = bitNumIntR(state[1], 7, 7) | bitNumIntR(state[0], 7, 6) |
        bitNumIntR(state[1], 15, 5) | bitNumIntR(state[0], 15, 4) |
        bitNumIntR(state[1], 23, 3) | bitNumIntR(state[0], 23, 2) |
        bitNumIntR(state[1], 31, 1) | bitNumIntR(state[0], 31, 0);
    inBytes[2] = bitNumIntR(state[1], 6, 7) | bitNumIntR(state[0], 6, 6) |
        bitNumIntR(state[1], 14, 5) | bitNumIntR(state[0], 14, 4) |
        bitNumIntR(state[1], 22, 3) | bitNumIntR(state[0], 22, 2) |
        bitNumIntR(state[1], 30, 1) | bitNumIntR(state[0], 30, 0);
    inBytes[1] = bitNumIntR(state[1], 5, 7) | bitNumIntR(state[0], 5, 6) |
        bitNumIntR(state[1], 13, 5) | bitNumIntR(state[0], 13, 4) |
        bitNumIntR(state[1], 21, 3) | bitNumIntR(state[0], 21, 2) |
        bitNumIntR(state[1], 29, 1) | bitNumIntR(state[0], 29, 0);
    inBytes[0] = bitNumIntR(state[1], 4, 7) | bitNumIntR(state[0], 4, 6) |
        bitNumIntR(state[1], 12, 5) | bitNumIntR(state[0], 12, 4) |
        bitNumIntR(state[1], 20, 3) | bitNumIntR(state[0], 20, 2) |
        bitNumIntR(state[1], 28, 1) | bitNumIntR(state[0], 28, 0);
    inBytes[7] = bitNumIntR(state[1], 3, 7) | bitNumIntR(state[0], 3, 6) |
        bitNumIntR(state[1], 11, 5) | bitNumIntR(state[0], 11, 4) |
        bitNumIntR(state[1], 19, 3) | bitNumIntR(state[0], 19, 2) |
        bitNumIntR(state[1], 27, 1) | bitNumIntR(state[0], 27, 0);
    inBytes[6] = bitNumIntR(state[1], 2, 7) | bitNumIntR(state[0], 2, 6) |
        bitNumIntR(state[1], 10, 5) | bitNumIntR(state[0], 10, 4) |
        bitNumIntR(state[1], 18, 3) | bitNumIntR(state[0], 18, 2) |
        bitNumIntR(state[1], 26, 1) | bitNumIntR(state[0], 26, 0);
    inBytes[5] = bitNumIntR(state[1], 1, 7) | bitNumIntR(state[0], 1, 6) |
        bitNumIntR(state[1], 9, 5) | bitNumIntR(state[0], 9, 4) |
        bitNumIntR(state[1], 17, 3) | bitNumIntR(state[0], 17, 2) |
        bitNumIntR(state[1], 25, 1) | bitNumIntR(state[0], 25, 0);
    inBytes[4] = bitNumIntR(state[1], 0, 7) | bitNumIntR(state[0], 0, 6) |
        bitNumIntR(state[1], 8, 5) | bitNumIntR(state[0], 8, 4) |
        bitNumIntR(state[1], 16, 3) | bitNumIntR(state[0], 16, 2) |
        bitNumIntR(state[1], 24, 1) | bitNumIntR(state[0], 24, 0);
    return inBytes;
}

function feistelF(state: number, key: Uint8Array): number {
    const lrgstate = new Uint8Array(6);
    state = state >>> 0;

    const t1 = (
        bitNumIntL(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitNumIntL(state, 4, 5) |
        bitNumIntL(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitNumIntL(state, 8, 11) |
        bitNumIntL(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitNumIntL(state, 12, 17) |
        bitNumIntL(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitNumIntL(state, 16, 23)
    ) >>> 0;
    const t2 = (
        bitNumIntL(state, 15, 0) | ((state & 0x0000f000) << 15) | bitNumIntL(state, 20, 5) |
        bitNumIntL(state, 19, 6) | ((state & 0x00000f00) << 13) | bitNumIntL(state, 24, 11) |
        bitNumIntL(state, 23, 12) | ((state & 0x000000f0) << 11) | bitNumIntL(state, 28, 17) |
        bitNumIntL(state, 27, 18) | ((state & 0x0000000f) << 9) | bitNumIntL(state, 0, 23)
    ) >>> 0;

    lrgstate[0] = (t1 >>> 24) & 0xff;
    lrgstate[1] = (t1 >>> 16) & 0xff;
    lrgstate[2] = (t1 >>> 8) & 0xff;
    lrgstate[3] = (t2 >>> 24) & 0xff;
    lrgstate[4] = (t2 >>> 16) & 0xff;
    lrgstate[5] = (t2 >>> 8) & 0xff;

    for (let i = 0; i < 6; i++) lrgstate[i] ^= key[i];

    state = (
        (S_BOX1[sBoxBit(lrgstate[0] >> 2)] << 28) |
        (S_BOX2[sBoxBit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] << 24) |
        (S_BOX3[sBoxBit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >> 6))] << 20) |
        (S_BOX4[sBoxBit(lrgstate[2] & 0x3f)] << 16) |
        (S_BOX5[sBoxBit(lrgstate[3] >> 2)] << 12) |
        (S_BOX6[sBoxBit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] << 8) |
        (S_BOX7[sBoxBit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >> 6))] << 4) |
        S_BOX8[sBoxBit(lrgstate[5] & 0x3f)]
    ) >>> 0;

    state = (
        bitNumIntL(state, 15, 0) | bitNumIntL(state, 6, 1) | bitNumIntL(state, 19, 2) |
        bitNumIntL(state, 20, 3) | bitNumIntL(state, 28, 4) | bitNumIntL(state, 11, 5) |
        bitNumIntL(state, 27, 6) | bitNumIntL(state, 16, 7) | bitNumIntL(state, 0, 8) |
        bitNumIntL(state, 14, 9) | bitNumIntL(state, 22, 10) | bitNumIntL(state, 25, 11) |
        bitNumIntL(state, 4, 12) | bitNumIntL(state, 17, 13) | bitNumIntL(state, 30, 14) |
        bitNumIntL(state, 9, 15) | bitNumIntL(state, 1, 16) | bitNumIntL(state, 7, 17) |
        bitNumIntL(state, 23, 18) | bitNumIntL(state, 13, 19) | bitNumIntL(state, 31, 20) |
        bitNumIntL(state, 26, 21) | bitNumIntL(state, 2, 22) | bitNumIntL(state, 8, 23) |
        bitNumIntL(state, 18, 24) | bitNumIntL(state, 12, 25) | bitNumIntL(state, 29, 26) |
        bitNumIntL(state, 5, 27) | bitNumIntL(state, 21, 28) | bitNumIntL(state, 10, 29) |
        bitNumIntL(state, 3, 30) | bitNumIntL(state, 24, 31)
    ) >>> 0;

    return state;
}

function desKeySetup(key: Uint8Array, schedule: Uint8Array[], mode: DESMode): void {
    const keyRndShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    const keyPermC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17,
        9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
    const keyPermD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21,
        13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
    const keyCompression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9,
        22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
        40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47,
        43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];

    let c = 0;
    let d = 0;
    for (let i = 0; i < 28; i++) {
        c |= bitNum(key, keyPermC[i], 31 - i);
        d |= bitNum(key, keyPermD[i], 31 - i);
    }

    for (let i = 0; i < 16; i++) {
        c = (((c << keyRndShift[i]) | (c >>> (28 - keyRndShift[i]))) & 0xfffffff0) >>> 0;
        d = (((d << keyRndShift[i]) | (d >>> (28 - keyRndShift[i]))) & 0xfffffff0) >>> 0;
        const toGen = mode === DESMode.DES_DECRYPT ? 15 - i : i;
        schedule[toGen] = new Uint8Array(6);
        for (let j = 0; j < 24; j++) {
            schedule[toGen][Math.floor(j / 8)] |= bitNumIntR(c, keyCompression[j], 7 - (j % 8));
        }
        for (let j = 24; j < 48; j++) {
            schedule[toGen][Math.floor(j / 8)] |= bitNumIntR(d, keyCompression[j] - 27, 7 - (j % 8));
        }
    }
}

function desCrypt(inputBytes: Uint8Array, keySchedule: Uint8Array[]): Uint8Array {
    const state = new Uint32Array(2);
    ipPermutation(state, inputBytes);
    for (let idx = 0; idx < 15; idx++) {
        const t = state[1];
        state[1] = (feistelF(state[1], keySchedule[idx]) ^ state[0]) >>> 0;
        state[0] = t;
    }
    state[0] = (feistelF(state[1], keySchedule[15]) ^ state[0]) >>> 0;
    invIp(state, inputBytes);
    return inputBytes;
}

function funcDes(buff: Uint8Array, key: Uint8Array, length: number): Uint8Array {
    const schedule: Uint8Array[] = Array(16).fill(null);
    desKeySetup(key, schedule, DESMode.DES_ENCRYPT);
    const output = new Uint8Array(length);
    for (let i = 0; i < length; i += 8) {
        const block = buff.slice(i, i + 8);
        const encrypted = desCrypt(block, schedule);
        output.set(encrypted, i);
    }
    return output;
}

function funcDdes(buff: Uint8Array, key: Uint8Array, length: number): Uint8Array {
    const schedule: Uint8Array[] = Array(16).fill(null);
    desKeySetup(key, schedule, DESMode.DES_DECRYPT);
    const output = new Uint8Array(length);
    for (let i = 0; i < length; i += 8) {
        const block = buff.slice(i, i + 8);
        const decrypted = desCrypt(block, schedule);
        output.set(decrypted, i);
    }
    return output;
}

// Three DES keys from QQ Music client (same as mobile customDES.ts)
const KEY1 = new TextEncoder().encode("!@#)(NHLiuy*$%^&");
const KEY2 = new TextEncoder().encode("123ZXC!@#)(*$%^&");
const KEY3 = new TextEncoder().encode("!@#)(*$%^&abcDEF");

/**
 * QRC lyric decode (Custom Triple-DES)
 * KEY1 decrypt -> KEY2 encrypt -> KEY3 decrypt
 */
function lyricDecode(content: Uint8Array): Uint8Array {
    const length = content.length;
    let result = funcDdes(content, KEY1, length);
    result = funcDes(result, KEY2, length);
    result = funcDdes(result, KEY3, length);
    return result;
}

// ============ Safety Limits ============

const MAX_INPUT_LENGTH = 2 * 1024 * 1024; // 2MB max input
const MAX_DECOMPRESSED_LENGTH = 5 * 1024 * 1024; // 5MB max decompressed

function safeInflate(data: Uint8Array): Uint8Array {
    if (data.length > MAX_INPUT_LENGTH) {
        throw new Error("Input too large for decompression");
    }
    const result = pako.inflate(data);
    if (result.length > MAX_DECOMPRESSED_LENGTH) {
        throw new Error("Decompressed output exceeds safety limit");
    }
    return result;
}

function safeInflateRaw(data: Uint8Array): Uint8Array {
    if (data.length > MAX_INPUT_LENGTH) {
        throw new Error("Input too large for decompression");
    }
    const result = pako.inflateRaw(data);
    if (result.length > MAX_DECOMPRESSED_LENGTH) {
        throw new Error("Decompressed output exceeds safety limit");
    }
    return result;
}

// ============ QRC Public API ============

export function isQRCEncrypted(lyrics: string): boolean {
    if (!lyrics) return false;
    const trimmed = lyrics.trim();
    if (trimmed.length < 32) return false;
    if (trimmed.length % 16 !== 0) return false;
    if (!/^[0-9A-Fa-f]+$/.test(trimmed)) return false;
    if (/\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(trimmed)) return false;
    return true;
}

export function decryptQRCLyric(encryptedHex: string): string {
    const trimmed = encryptedHex.trim();
    // Hex string to Uint8Array
    const bytes = new Uint8Array(trimmed.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(trimmed.substring(i * 2, i * 2 + 2), 16);
    }
    // Custom Triple-DES decrypt
    const decrypted = lyricDecode(bytes);
    // Zlib decompress
    const decompressed = safeInflate(decrypted);
    return new TextDecoder("utf-8").decode(decompressed);
}

// ============ QRC XML to LRC Conversion ============

export function isQrcXml(text: string): boolean {
    if (!text) return false;
    return text.includes("<?xml") && text.includes("LyricContent");
}

export function convertQrcXmlToLrc(xml: string): string {
    const lines: string[] = [];
    const lineRegex = /\[(\d+),\d+\](.*?)(?=\[\d+,\d+\]|$)/gs;
    let match: RegExpExecArray | null;

    while ((match = lineRegex.exec(xml)) !== null) {
        const startMs = parseInt(match[1]);
        const text = match[2]
            .replace(/\(\d+(?:,\d+)?\)/g, "")
            .replace(/\[kana:.*?\]/g, "")
            .trim();
        if (!text) continue;

        const minutes = Math.floor(startMs / 60000);
        const seconds = Math.floor((startMs % 60000) / 1000);
        const ms = Math.floor((startMs % 1000) / 10);

        lines.push(
            `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(2, "0")}]${text}`,
        );
    }
    return lines.join("\n");
}

/**
 * QRC XML → 保留逐字时间轴的富格式
 * 输出格式: [lineStartMs,lineDurMs]text(wordStartMs,wordDurMs)text(wordStartMs,wordDurMs)...
 */
export function convertQrcXmlToRichQrc(xml: string): string {
    const lines: string[] = [];
    const lineRegex = /\[(\d+),(\d+)\]([\s\S]*?)(?=\[\d+,\d+\]|$)/g;
    const wordRegex = /([^()]*?)\((\d+),(\d+)\)/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(xml)) !== null) {
        const lineStart = lineMatch[1];
        const lineDur = lineMatch[2];
        const body = (lineMatch[3] || "").replace(/\[kana:.*?\]/g, "");

        const chunks: string[] = [];
        let wordMatch: RegExpExecArray | null;
        while ((wordMatch = wordRegex.exec(body)) !== null) {
            const text = wordMatch[1] ?? "";
            const wStart = wordMatch[2];
            const wDur = wordMatch[3];
            chunks.push(`${text}(${wStart},${wDur})`);
        }

        const lineText = chunks.join("");
        if (lineText.replace(/\(\d+,\d+\)/g, "").trim()) {
            lines.push(`[${lineStart},${lineDur}]${lineText}`);
        }
    }
    return lines.join("\n");
}

// ============ Kuwo Decryption ============

export function isKuwoEncrypted(lyrics: string): boolean {
    if (!lyrics) return false;
    const trimmed = lyrics.trim();
    if (trimmed.length < 50) return false;
    if (/\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(trimmed)) return false;

    const isValidBase64 = /^[A-Za-z0-9+/=]+$/.test(trimmed);
    const notPureHex = !/^[0-9A-Fa-f]+$/.test(trimmed);
    if (!isValidBase64 || !notPureHex) return false;

    try {
        const decoded = Buffer.from(trimmed, "base64").toString("utf8", 0, 20);
        return decoded.startsWith("tp=");
    } catch {
        return false;
    }
}

export function decryptKuwoLyric(lrcBase64: string, isGetLyricx = false): string {
    const raw = Buffer.from(lrcBase64.trim(), "base64");

    let headerEnd = -1;
    for (let i = 0; i < raw.length - 3; i++) {
        if (raw[i] === 0x0d && raw[i + 1] === 0x0a && raw[i + 2] === 0x0d && raw[i + 3] === 0x0a) {
            headerEnd = i + 4;
            break;
        }
    }
    if (headerEnd === -1) {
        throw new Error("Invalid Kuwo lyric format: no header end found");
    }

    const body = raw.subarray(headerEnd);

    let decompressed: Uint8Array;
    try {
        decompressed = safeInflate(body);
    } catch {
        decompressed = safeInflateRaw(body);
    }

    if (isGetLyricx) {
        const key = "yeelion";
        for (let i = 0; i < decompressed.length; i++) {
            decompressed[i] ^= key.charCodeAt(i % key.length);
        }
    }

    try {
        return iconv.decode(Buffer.from(decompressed), "gb18030");
    } catch {
        return new TextDecoder("utf-8").decode(decompressed);
    }
}

// ============ Auto Decrypt ============

export function autoDecryptLyric(lyrics: string): string {
    if (!lyrics) return "";

    if (isQRCEncrypted(lyrics)) {
        try {
            const decrypted = decryptQRCLyric(lyrics);
            if (isQrcXml(decrypted)) {
                return convertQrcXmlToRichQrc(decrypted);
            }
            return decrypted;
        } catch {
            return lyrics;
        }
    }

    if (isKuwoEncrypted(lyrics)) {
        try {
            // 先尝试逐字格式（lyricx），失败或乱码则回退普通格式
            try {
                const richLyric = decryptKuwoLyric(lyrics, true);
                if (richLyric && richLyric.trim()) {
                    // 校验是否为有效歌词格式（含时间标签）
                    const hasTimeTag = /\[\d{2}:\d{2}[.:]\d{2,3}\]/.test(richLyric) ||
                        /\[\d+,\d+\]/.test(richLyric) ||
                        /<\d{2}:\d{2}/.test(richLyric);
                    if (hasTimeTag) return richLyric;
                }
            } catch { /* fallback */ }
            return decryptKuwoLyric(lyrics, false);
        } catch {
            return lyrics;
        }
    }

    if (isQrcXml(lyrics)) {
        return convertQrcXmlToRichQrc(lyrics);
    }

    return lyrics;
}
