require("dotenv").config();
import { provideHandleTransaction } from "./agent.js";
import { TransactionEvent, Network, EventType } from "@fortanetwork/forta-bot";
import { enableMocks, resetMocks } from "jest-fetch-mock";

// TODO: Get a test like below actually working, post-upgrade

jest.mock("shelljs", () => ({
  exec: jest.fn(() => ({
    toString: () =>
      JSON.stringify({
        "test/test.sol:DynamicHoneypotTest": {
          test_results: {
            invariant_transfer: {
              success: false,
              reason: "assertion failed",
              counterexample: { Sequence: [] },
            },
          },
        },
      }),
  })),
}));

enableMocks();

jest.mock("@fortanetwork/forta-bot", () => ({
  ...jest.requireActual("@fortanetwork/forta-bot"),
  getEthersProvider: () => ({
    getCode: jest.fn(
      () =>
        "0x6080604052600436106100565760003560e01c8063cfae32171461005b578063cfae3217146100b0575b600080fd5b34801561006757600080fd5b506100706100ee565b6040518082815260200191505060405180910390f35b6100b8600480360360208110156100c657600080fd5b50356001600160a01b0316610114565b604051808215151515815260200191505060405180910390f35b60008060008360001961010060018403600019863780820191505092915050565b6000806000806060858703121561014957600080fd5b843573ffffffffffffffffffffffffffffffffffffffff8116811461016d57600080fd5b94602093909301359350505056fea26469706673582212209e4dc60b64c87550405eaa8d10ea8b8e2b2da98a99478001e76bc0240376c71864736f6c634300080a0033"
    ),
  }),
}));

describe("agent.js", () => {
  let handleTransaction;
  const ETHERSCAN_API_KEY = "fakekey";

  const mockTxEvent = new TransactionEvent({
    type: EventType.BLOCK,
    network: Network.MAINNET, // Assuming this is MAINNET
    transaction: {
      hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      from: "0x0000000000000000000000000000000000000000",
      to: null, // Contract creation
      nonce: 1,
      data: "0x60806040",
      gas: "0x5208",
      gasPrice: "0x3b9aca00",
      value: "0x0",
      r: "0x1c",
      s: "0x1c",
      v: "0x1c",
    },
    traces: [],
    addresses: {},
    block: {
      hash: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef",
      number: 12345,
      timestamp: 1609459200,
    },
    logs: [],
    contractAddress: "0x5a443704dd4B594B382c22a083e2BD3090A6feF3",
  });

  const mockResponse = {
    status: "1",
    message: "OK",
    result: [
      {
        SourceCode:
          '{"sources": {"MyContract.sol": {"content": "pragma solidity ^0.8.0; contract MyContract { function mint() public {} }"}}}',
        ABI: "Contract ABI",
        ContractName: "MyContract",
        CompilerVersion: "v0.8.0+commit.c7dfd78e",
        OptimizationUsed: "1",
        Runs: "200",
        ConstructorArguments: "",
        EVMVersion: "Default",
        Library: "",
        LicenseType: "MIT",
        Proxy: "0",
        Implementation: "",
        SwarmSource: "ipfs://...",
      },
    ],
  };

  beforeAll(() => {
    handleTransaction = provideHandleTransaction;
    fetchMock.mockResponseOnce(JSON.stringify(mockResponse));
  });

  afterEach(() => {
    resetMocks();
  });

  it("should handle a transaction and return findings", async () => {
    jest.setTimeout(10000); // Increase the timeout for the test
    const findings = await provideHandleTransaction(mockTxEvent.type, true);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toContain("HARD-RUG-PULL");
    expect(findings[0].metadata).toHaveProperty(
      "attacker_deployer_address",
      "0x0000000000000000000000000000000000000000"
    );
  });
});
