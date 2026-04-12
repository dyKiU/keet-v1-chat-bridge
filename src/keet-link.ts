import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const hypercoreId = require("hypercore-id-encoding") as {
  decode(value: string): Buffer;
};
const hypercoreCrypto = require("hypercore-crypto") as {
  discoveryKey(value: Buffer): Buffer;
};

const z32KeyLength = 52;

export function deriveTopicFromKeetInvite(value: string): string {
  return deriveTopicCandidatesFromKeetInvite(value)[0]?.topicHex ?? failNoCandidates();
}

export interface KeetTopicCandidate {
  label: string;
  topicHex: string;
}

export function deriveTopicCandidatesFromKeetInvite(value: string): KeetTopicCandidate[] {
  const invite = extractInvitePayload(value);
  const candidates: KeetTopicCandidate[] = [];

  if (looksLikeZ32(invite)) {
    for (let offset = 0; offset + z32KeyLength <= invite.length; offset += z32KeyLength) {
      const key = hypercoreId.decode(invite.slice(offset, offset + z32KeyLength));
      pushKeyCandidates(candidates, `z32[${offset}:${offset + z32KeyLength}]`, key);
    }
    return candidates;
  }

  const decoded = decodeBase64Invite(invite);
  const offsets = candidateOffsets(decoded);

  for (const offset of offsets) {
    const key = decoded.subarray(offset, offset + 32);
    pushKeyCandidates(candidates, `base64[${offset}:${offset + 32}]`, key);
  }

  return candidates;
}

function extractInvitePayload(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Keet invite is empty");

  if (trimmed.startsWith("pear://keet/")) {
    return trimmed.slice("pear://keet/".length).split(/[?#]/)[0] ?? "";
  }

  if (trimmed.startsWith("keet://")) {
    return trimmed.slice("keet://".length).split(/[?#]/)[0] ?? "";
  }

  return trimmed.split(/[?#/]/)[0] ?? "";
}

function looksLikeZ32(value: string): boolean {
  return value.length >= z32KeyLength && /^[ybndrfg8ejkmcpqxot1uwisza345h769]+$/i.test(value.slice(0, z32KeyLength));
}

function decodeBase64Invite(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.length < 32) throw new Error("Keet invite payload did not decode to enough bytes for a topic candidate");
  return decoded;
}

function candidateOffsets(buffer: Buffer): number[] {
  const offsets = new Set<number>([0]);

  // The binary Keet invite observed locally begins with a small header followed
  // by a 32-byte key at offset 4, then repeats other key-like segments around
  // readable room/name markers. Keep this small and labelled for smoke testing.
  for (const offset of [4, 48, 52, 84, 88, 96, 112, 128, 144, 160, 176, 192, 208, 224, 240]) {
    if (offset + 32 <= buffer.length) offsets.add(offset);
  }

  return [...offsets];
}

function pushKeyCandidates(candidates: KeetTopicCandidate[], label: string, key: Buffer): void {
  candidates.push({ label: `${label}:raw`, topicHex: key.toString("hex") });
  candidates.push({ label: `${label}:discovery`, topicHex: hypercoreCrypto.discoveryKey(key).toString("hex") });
}

function failNoCandidates(): never {
  throw new Error("No Keet topic candidates could be derived");
}
