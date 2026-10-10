import {
  decodeEventLog,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

import {mandateAbi} from "./abi.ts";
import {
  ActRevertedError,
  DeniedError,
  NoRecordError,
  TargetFailedError,
  toRule,
  type Rule,
} from "./errors.ts";

export interface Outflow {
  asset: Address;
  /** Must be sorted strictly ascending by `asset` across the array; native goes in `value`. */
  amount: bigint;
}

export interface ActionInput {
  target: Address;
  value?: bigint;
  /**
   * What the agent intends to spend, per ERC20. This single field drives the per-asset caps,
   * the spend windows, the exact allowance granted for the duration of the call, and the
   * post-execution balance assertion. Under-declaring does not help: the assertion measures
   * the real outflow and reverts if it exceeds the declaration.
   */
  declared?: Outflow[];
  data?: Hex;
  /** Unix seconds. 0 (the default) means no deadline. */
  deadline?: bigint;
}

export interface ActResult {
  txHash: Hex;
  /**
   * What the target call returned, taken from the pre-flight simulation.
   *
   * It comes from the simulation and not from the receipt because the `Allowed` event does
   * not carry return data - only `Failed` does - so there is nowhere on chain to read it
   * back from. In the ordinary case the simulated and executed states are the same and so is
   * this value; if the target's output depends on state that moved between simulating and
   * mining, it will differ. Do not treat it as a receipt.
   */
  returnData: Hex;
}

/** Sorts declarations into the strictly-ascending order the contract requires. */
export function normalizeDeclared(declared: Outflow[] = []): Outflow[] {
  const sorted = [...declared].sort((a, b) => {
    const x = a.asset.toLowerCase();
    const y = b.asset.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const previous = sorted[i - 1]!;
    if (current.asset.toLowerCase() === previous.asset.toLowerCase()) {
      throw new Error(`Duplicate asset in declared outflows: ${current.asset}`);
    }
  }
  return sorted;
}

function toAction(input: ActionInput) {
  return {
    target: input.target,
    value: input.value ?? 0n,
    declared: normalizeDeclared(input.declared),
    data: (input.data ?? "0x") as Hex,
    deadline: input.deadline ?? 0n,
  } as const;
}

/**
 * Ask the mandate what it would do, without spending anything.
 *
 * Worth calling before `act` when you want to explain a refusal to a user rather than record
 * one: a denial is permanent and public, and it weighs on the mandate's score if it is a hard
 * breach. A dry run costs nothing and leaves no trace.
 */
export async function evaluate(
  client: PublicClient,
  mandate: Address,
  input: ActionInput,
): Promise<Rule | "Unknown"> {
  const rule = await client.readContract({
    address: mandate,
    abi: mandateAbi,
    functionName: "evaluate",
    args: [toAction(input)],
  });
  return toRule(rule as number);
}

/**
 * Perform one agent action.
 *
 * @throws {DeniedError} if the mandate refused the action.
 * @throws {TargetFailedError} if the policy passed but the target call reverted.
 *
 * The contract does NOT revert on a policy violation - it emits `Denied` and returns false, so
 * that the refused attempt survives as a public record (invariant I2). That means a successful
 * receipt does not imply the action executed. This function reads the emitted events and turns
 * a refusal into a thrown error, so ordinary control flow is correct by default.
 *
 * If you call the contract directly instead of through this function, check the return value.
 * Do not trust the receipt status.
 */
export async function act(
  clients: {public: PublicClient; wallet: WalletClient},
  mandate: Address,
  input: ActionInput,
  options: {account?: Account | Address} = {},
): Promise<ActResult> {
  const action = toAction(input);
  const account = options.account ?? clients.wallet.account;
  if (!account) throw new Error("act() requires an account on the wallet client");

  const {request, result} = await clients.public.simulateContract({
    address: mandate,
    abi: mandateAbi,
    functionName: "act",
    args: [action],
    account,
  });
  const simulated = (result as readonly [boolean, Hex] | undefined)?.[1] ?? "0x";

  const txHash = await clients.wallet.writeContract(request);
  const receipt = await clients.public.waitForTransactionReceipt({hash: txHash});

  // A refusal does not revert, so the receipt status says nothing about the policy decision.
  // It does say whether the mandate ran at all, and this function used to skip it entirely:
  // a reverted act - out of gas, most often - produced no logs, fell through the loop below
  // and was returned as success. That is precisely the failure this SDK exists to prevent,
  // one layer up from the one it was written to catch.
  if (receipt.status !== "success") throw new ActRevertedError({txHash});

  let allowed = false;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== mandate.toLowerCase()) continue;

    let decoded;
    try {
      decoded = decodeEventLog({abi: mandateAbi, data: log.data, topics: log.topics});
    } catch {
      continue; // an event from a newer contract version than this SDK knows about
    }

    if (decoded.eventName === "Denied") {
      const args = decoded.args as unknown as {rule: number; target: Address; selector: Hex};
      throw new DeniedError({
        rule: toRule(args.rule),
        target: args.target,
        selector: args.selector,
        txHash,
      });
    }

    if (decoded.eventName === "Failed") {
      const args = decoded.args as unknown as {target: Address; returnData: Hex};
      throw new TargetFailedError({target: args.target, txHash, returnData: args.returnData});
    }

    // Observe-mode acts emit WouldDeny and then execute, so they are allowed outcomes and
    // reach Allowed too. Only Allowed proves the action ran.
    if (decoded.eventName === "Allowed") allowed = true;
  }

  // Every act emits exactly one of Allowed, Denied, WouldDeny or Failed. Reaching here means
  // the transaction succeeded and the mandate said nothing, which should be impossible -
  // returning success on no evidence is the one outcome this SDK must never produce.
  if (!allowed) throw new NoRecordError({txHash});

  return {txHash, returnData: simulated};
}
