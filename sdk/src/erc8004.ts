/**
 * ERC-8004 (Trustless Agents) registry bindings.
 *
 * Addresses verified against chain state on 25 September 2026, not taken from documentation -
 * Monad's own guide still publishes two addresses that have no code at all, and a call to an
 * address with no code succeeds and returns empty rather than reverting. See spec/ERC8004.md.
 *
 * Only the functions Docket actually calls are declared. A registry ABI is a large surface and
 * an unused entry is an untested one.
 */
import type {Address} from "viem";

/** Chain id these addresses are valid for. Asserted at call time, never assumed. */
export const MONAD_TESTNET_CHAIN_ID = 10143;

export const IDENTITY_REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY: Address = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

/** `tag1` on every DCS-1 publication. Namespaces the score apart from ordinary client reviews. */
export const DCS1_TAG = "docket:dcs-1";

export const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentURI", type: "string"},
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          {name: "metadataKey", type: "string"},
          // (string, bytes) - NOT (string, string). The string-valued signature is not on the
          // contract and reverts; an earlier draft of spec/ERC8004.md had it wrong.
          {name: "metadataValue", type: "bytes"},
        ],
      },
    ],
    outputs: [{name: "agentId", type: "uint256"}],
  },
  {
    type: "function",
    name: "setAgentWallet",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "newWallet", type: "address"},
      {name: "deadline", type: "uint256"},
      {name: "signature", type: "bytes"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "newURI", type: "string"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{name: "agentId", type: "uint256"}],
    outputs: [{type: "address"}],
  },
  {
    type: "function",
    name: "getMetadata",
    stateMutability: "view",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "metadataKey", type: "string"},
    ],
    outputs: [{type: "bytes"}],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{name: "tokenId", type: "uint256"}],
    outputs: [{type: "address"}],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{name: "tokenId", type: "uint256"}],
    outputs: [{type: "string"}],
  },
  {
    type: "event",
    name: "Registered",
    inputs: [
      {name: "agentId", type: "uint256", indexed: true},
      {name: "agentURI", type: "string", indexed: false},
      {name: "owner", type: "address", indexed: true},
    ],
  },
] as const;

export const reputationRegistryAbi = [
  {
    type: "function",
    name: "giveFeedback",
    stateMutability: "nonpayable",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "value", type: "int128"},
      {name: "valueDecimals", type: "uint8"},
      {name: "tag1", type: "string"},
      {name: "tag2", type: "string"},
      {name: "endpoint", type: "string"},
      {name: "feedbackURI", type: "string"},
      {name: "feedbackHash", type: "bytes32"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getClients",
    stateMutability: "view",
    inputs: [{name: "agentId", type: "uint256"}],
    outputs: [{type: "address[]"}],
  },
  {
    type: "function",
    name: "getLastIndex",
    stateMutability: "view",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "clientAddress", type: "address"},
    ],
    outputs: [{type: "uint64"}],
  },
  {
    type: "function",
    name: "readFeedback",
    stateMutability: "view",
    inputs: [
      {name: "agentId", type: "uint256"},
      {name: "clientAddress", type: "address"},
      {name: "feedbackIndex", type: "uint64"},
    ],
    outputs: [
      {name: "value", type: "int128"},
      {name: "valueDecimals", type: "uint8"},
      {name: "tag1", type: "string"},
      {name: "tag2", type: "string"},
      {name: "isRevoked", type: "bool"},
    ],
  },
  {
    type: "event",
    name: "NewFeedback",
    inputs: [
      {name: "agentId", type: "uint256", indexed: true},
      {name: "clientAddress", type: "address", indexed: true},
      {name: "feedbackIndex", type: "uint64", indexed: false},
      {name: "value", type: "int128", indexed: false},
      {name: "valueDecimals", type: "uint8", indexed: false},
      {name: "indexedTag1", type: "string", indexed: true},
      {name: "tag1", type: "string", indexed: false},
      {name: "tag2", type: "string", indexed: false},
      {name: "endpoint", type: "string", indexed: false},
      {name: "feedbackURI", type: "string", indexed: false},
      {name: "feedbackHash", type: "bytes32", indexed: false},
    ],
  },
] as const;

/** EIP-712 domain for `setAgentWallet`, from the registry's `__EIP712_init`. */
export const identityEip712Domain = (chainId: number) =>
  ({
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId,
    verifyingContract: IDENTITY_REGISTRY,
  }) as const;

export const agentWalletSetTypes = {
  AgentWalletSet: [
    {name: "agentId", type: "uint256"},
    {name: "newWallet", type: "address"},
    {name: "owner", type: "address"},
    {name: "deadline", type: "uint256"},
  ],
} as const;
