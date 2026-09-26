#!/usr/bin/env node
import {createPublicClient, http, isAddress, type Address} from "viem";

import {score, SPEC_VERSION} from "./dcs1.ts";
import {replay} from "./replay.ts";

const USAGE = `
docket score <mandate> [options]

  --rpc <url>       RPC endpoint (default: $MONAD_TESTNET_RPC, else Monad testnet)
  --at <block>      compute as of this block (default: latest)
  --from <block>    first block to scan. REQUIRED: public RPCs cap eth_getLogs by range,
                    so a scan from genesis is not practical. Use the mandate's deployment
                    block, published as ERC-8004 metadata under docket:deployBlock.
  --chunk <n>       blocks per getLogs request (default: 100, Monad testnet's cap)
  --verify <score>  recompute and exit non-zero unless the result matches
  --json            machine-readable output

Exit codes: 0 ok, 1 usage or RPC error, 2 verification mismatch.
`.trim();

interface Options {
  mandate: Address;
  rpc: string;
  at?: bigint;
  from: bigint;
  chunk: bigint;
  verify?: number;
  json: boolean;
}

function parse(argv: string[]): Options {
  const args = argv.slice(2);
  if (args[0] === "score") args.shift();

  const mandate = args.shift();
  if (!mandate || !isAddress(mandate)) throw new Error("expected a mandate address");

  const options: Options = {
    mandate: mandate as Address,
    rpc: process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz",
    from: -1n,
    chunk: 100n,
    json: false,
  };

  while (args.length > 0) {
    const flag = args.shift()!;
    switch (flag) {
      case "--rpc":
        options.rpc = required(args.shift(), flag);
        break;
      case "--at":
        options.at = BigInt(required(args.shift(), flag));
        break;
      case "--from":
        options.from = BigInt(required(args.shift(), flag));
        break;
      case "--chunk":
        options.chunk = BigInt(required(args.shift(), flag));
        break;
      case "--verify":
        options.verify = Number(required(args.shift(), flag));
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  if (options.from < 0n) {
    throw new Error("--from is required (use the mandate's deployment block)");
  }
  return options;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined) throw new Error(`${flag} needs a value`);
  return value;
}

async function main(): Promise<number> {
  let options: Options;
  try {
    options = parse(process.argv);
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`);
    return 1;
  }

  const client = createPublicClient({transport: http(options.rpc)});
  const result = await replay(client, options.mandate, {
    fromBlock: options.from,
    asOfBlock: options.at,
    chunkSize: options.chunk,
    // A full scan of an aged mandate is thousands of paced requests and takes minutes. To
    // stderr so --json stays machine-readable.
    onProgress: options.json
      ? undefined
      : (chunk, total, logs) => {
          const pct = Math.floor((chunk / total) * 100);
          process.stderr.write(`\rscanning ${pct}%  ${chunk}/${total} chunks  ${logs} logs`);
          if (chunk >= total) process.stderr.write("\n");
        },
  });
  const breakdown = score(result.history);

  const payload = {
    mandate: options.mandate,
    specVersion: SPEC_VERSION,
    asOf: result.asOfBlock.toString(),
    inputHash: result.inputHash,
    score: breakdown.score,
    terms: {
      experiencePpm: breakdown.experiencePpm.toString(),
      agePpm: breakdown.agePpm.toString(),
      authorityPpm: breakdown.authorityPpm.toString(),
      breachPpm: breakdown.breachPpm.toString(),
      twaCapWei: breakdown.twaCapWei.toString(),
    },
    inputs: {
      logs: result.logCount,
      allowedActs: result.history.allowedActs.toString(),
      denials: result.history.denials.length,
    },
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`mandate      ${payload.mandate}`);
    console.log(`spec         ${payload.specVersion}`);
    console.log(`as of block  ${payload.asOf}`);
    console.log(`input hash   ${payload.inputHash}`);
    console.log(`logs         ${payload.inputs.logs}`);
    console.log(`allowed acts ${payload.inputs.allowedActs}`);
    console.log(`denials      ${payload.inputs.denials}`);
    console.log("");
    console.log(`experience   ${payload.terms.experiencePpm} ppm`);
    console.log(`age          ${payload.terms.agePpm} ppm`);
    console.log(`authority    ${payload.terms.authorityPpm} ppm (twa cap ${payload.terms.twaCapWei} wei)`);
    console.log(`breach       ${payload.terms.breachPpm} ppm`);
    console.log("");
    console.log(`SCORE        ${payload.score} / 1000`);
  }

  if (options.verify !== undefined) {
    if (options.verify !== breakdown.score) {
      // A published score that cannot be reproduced is not a low score - it is a broken
      // publisher, and should be treated as one (spec/DCS-1.md §7).
      console.error(
        `\nVERIFY FAILED: published ${options.verify}, recomputed ${breakdown.score} at block ${payload.asOf}.`,
      );
      return 2;
    }
    console.error(`\nVERIFY OK: reproduced ${breakdown.score} from a cold sync.`);
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
