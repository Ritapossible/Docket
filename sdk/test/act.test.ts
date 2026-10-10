/**
 * Regression tests for the one thing this SDK exists to get right.
 *
 * Invariant I2 says a policy violation never reverts: the mandate emits `Denied` and returns
 * false, so the transaction succeeds. `act()` turns that into a thrown error so that ordinary
 * control flow is correct by default.
 *
 * The inverse case was missed for the whole life of the SDK. A transaction that genuinely
 * reverts - out of gas, most often - produces no logs at all, which fell straight through the
 * event loop and was returned as success. An integrator would have been told their action
 * executed when nothing happened and nothing was recorded.
 *
 * These use stub clients rather than a chain, so they run in the offline suite. The thing
 * under test is the decision made from a receipt, and a receipt is cheap to fabricate.
 */
import {strict as assert} from "node:assert";
import {test} from "node:test";

import {encodeAbiParameters, encodeEventTopics, type Hex} from "viem";

import {mandateAbi} from "../src/abi.ts";
import {act} from "../src/mandate.ts";
import {ActRevertedError, DeniedError, NoRecordError, TargetFailedError} from "../src/errors.ts";

const MANDATE = "0x2EC195646731F274c0e500f3B671C04189446Ae9" as const;
const TARGET = "0x000000000000000000000000000000000000c0DE" as const;
const AGENT = "0x0536468C3565198672Ad61A178f822C3D997c65C" as const;
const TX = "0xfeed000000000000000000000000000000000000000000000000000000000001" as Hex;

/** A receipt whose logs are whatever the test needs them to be. */
function clients(receipt: {status: "success" | "reverted"; logs: unknown[]}) {
  return {
    public: {
      simulateContract: async () => ({request: {}, result: [true, "0xdeadbeef"] as const}),
      waitForTransactionReceipt: async () => receipt,
    },
    wallet: {account: AGENT, writeContract: async () => TX},
  } as never;
}

/**
 * Build a real log for one of the mandate's events, topics and data both, so the test
 * exercises the SDK's actual decoding rather than a shape that happens to satisfy it. An
 * earlier version left `data` empty; every log failed to decode, was skipped by the catch,
 * and three tests "passed" against the fallthrough they were written to check.
 */
function log(eventName: "Allowed" | "Denied" | "Failed", args: Record<string, unknown>) {
  const abiEvent = mandateAbi.find((e) => e.type === "event" && e.name === eventName)!;
  const inputs = (abiEvent as {inputs: readonly {name: string; indexed?: boolean}[]}).inputs;
  const unindexed = inputs.filter((i) => !i.indexed);
  return {
    address: MANDATE,
    topics: encodeEventTopics({abi: mandateAbi, eventName, args} as never),
    data: encodeAbiParameters(unindexed as never, unindexed.map((i) => args[i.name]) as never),
  };
}

test("a reverted act throws rather than reporting success", async () => {
  // The exact shape of the bug: status reverted, no logs, nothing recorded on chain.
  await assert.rejects(
    () => act(clients({status: "reverted", logs: []}), MANDATE, {target: TARGET}),
    (e: Error) => e instanceof ActRevertedError,
  );
});

test("a successful act that emitted nothing throws rather than reporting success", async () => {
  await assert.rejects(
    () => act(clients({status: "success", logs: []}), MANDATE, {target: TARGET}),
    (e: Error) => e instanceof NoRecordError,
  );
});

test("a refusal still throws DeniedError, and is not confused with a revert", async () => {
  const denied = log("Denied", {
    id: 1n, rule: 4, target: TARGET, selector: "0x00000000",
    value: 0n, dataHash: `0x${"00".repeat(32)}` as Hex, keyEpoch: 0,
  });
  await assert.rejects(
    () => act(clients({status: "success", logs: [denied]}), MANDATE, {target: TARGET}),
    (e: Error) => e instanceof DeniedError && !(e instanceof ActRevertedError),
  );
});

test("a target revert still throws TargetFailedError", async () => {
  const failed = log("Failed", {
    id: 1n, target: TARGET, selector: "0x00000000", returnData: "0x" as Hex,
  });
  await assert.rejects(
    () => act(clients({status: "success", logs: [failed]}), MANDATE, {target: TARGET}),
    (e: Error) => e instanceof TargetFailedError,
  );
});

test("an allowed act returns, and carries the simulated return data", async () => {
  const allowed = log("Allowed", {
    id: 1n, target: TARGET, selector: "0x00000000",
    value: 0n, dataHash: `0x${"00".repeat(32)}` as Hex, keyEpoch: 0,
  });
  const result = await act(clients({status: "success", logs: [allowed]}), MANDATE, {
    target: TARGET,
  });
  assert.equal(result.txHash, TX);
  // Previously hardcoded "0x" while the type documented it as the target's return data.
  assert.equal(result.returnData, "0xdeadbeef");
});
