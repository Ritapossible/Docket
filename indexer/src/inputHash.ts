import {keccak256, type Hex} from "viem";

export interface HashableLog {
  blockNumber: bigint;
  logIndex: number;
  topics: readonly Hex[];
  data: Hex;
}

/**
 * spec/DCS-1.md §6.
 *
 * Commits to the exact event set a score was computed from, so a reader can re-derive the
 * number rather than trust whoever published it. Defined over a fixed byte layout rather than
 * over a JSON serialisation, because JSON key order and number formatting are not portable and
 * this hash has to be reproducible in any language.
 */
export function inputHash(logs: readonly HashableLog[]): Hex {
  const ordered = [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1,
  );

  const parts: Uint8Array[] = [];
  for (const log of ordered) {
    const buffer = new Uint8Array(8 + 4 + 32 + 32);
    const view = new DataView(buffer.buffer);
    view.setBigUint64(0, log.blockNumber, false);
    view.setUint32(8, log.logIndex, false);
    buffer.set(hexToBytes32(log.topics[0] ?? ("0x" + "00".repeat(32)) as Hex), 12);
    buffer.set(hexToBytes32(keccak256(log.data)), 44);
    parts.push(buffer);
  }

  return keccak256(concat(parts));
}

function hexToBytes32(hex: Hex): Uint8Array {
  const clean = hex.slice(2).padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(parts: readonly Uint8Array[]): Hex {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  let hex = "0x";
  for (const byte of out) hex += byte.toString(16).padStart(2, "0");
  return hex as Hex;
}
