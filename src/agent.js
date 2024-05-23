import dotenv from "dotenv";
import {
  Finding,
  FindingSeverity,
  FindingType,
  Label,
  EntityType,
} from "@fortanetwork/forta-bot";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { dirname as getDirName } from "path";
import fetch from "node-fetch";
import shell from "shelljs";
import { ethers } from "ethers";
import { DynamicTest, DefaultInjector } from "./detectors.js";

dotenv.config();

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
// TODO: Get other networks fully working before request changes be merged into parent
// const OPTIMISM_ETHERSCAN_API_KEY = process.env.OPTIMISM_ETHERSCAN_API_KEY;
// const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;
// const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY;
// const FTMSCAN_API_KEY = process.env.FTMSCAN_API_KEY;
// const ARBISCAN_API_KEY = process.env.ARBISCAN_API_KEY;
// const SNOWTRACE_API_KEY = process.env.SNOWTRACE_API_KEY;

const taskQueue = [];
let findingsCache = [];
let consumerStarted = false;
let exitConsumer = false;

const getCreatedContractAddress = async (txEvent) => {
  if (!txEvent.to) {
    return ethers.utils.getAddress(
      ethers.utils.getContractAddress({
        from: txEvent.from,
        nonce: txEvent.transaction.nonce,
      })
    );
  }
  return null;
};

const getSourceCode = async (txEvent, contractAddress) => {
  let apiEndpoint;
  const network = parseInt(txEvent.network);
  if (network === 1) {
    apiEndpoint = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${ETHERSCAN_API_KEY}`;
    // TODO: Get other networks fully working before request changes be merged into parent
    // } else if (network === 10) {
    //   apiEndpoint = `https://api-optimistic.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${OPTIMISM_ETHERSCAN_API_KEY}`;
    // } else if (network === 56) {
    //   apiEndpoint = `https://api.bscscan.com/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${BSCSCAN_API_KEY}`;
    // } else if (network === 137) {
    //   apiEndpoint = `https://api.polygonscan.com/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${POLYGONSCAN_API_KEY}`;
    // } else if (network === 250) {
    //   apiEndpoint = `https://api.ftmscan.com/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${FTMSCAN_API_KEY}`;
    // } else if (network === 42161) {
    //   apiEndpoint = `https://api.arbiscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${ARBISCAN_API_KEY}`;
    // } else if (network === 43114) {
    //   apiEndpoint = `https://api.snowtrace.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${SNOWTRACE_API_KEY}`;
  } else {
    // TODO: support arbitrary RPC
    throw new Error("Network not supported");
  }

  const response = await fetch(apiEndpoint);
  const data = await response.json();
  return data.result[0].SourceCode;
};

const runInvarianceTest = async (txEvent, createdContract, provider) => {
  let sourceCode = await getSourceCode(txEvent, createdContract);
  if (!sourceCode) return;
  console.log(`Found source code for ${createdContract}...`);

  if (sourceCode.startsWith("{")) {
    // remove files under working
    if (existsSync("./working")) {
      rmSync("./working", { recursive: true });
    }

    // multiple contracts in the same file
    let responseType = 0;
    if (sourceCode[1] === "{") responseType = 1;

    let inner;
    if (responseType === 0) {
      inner = JSON.parse(sourceCode);
    } else if (responseType === 1) {
      inner = JSON.parse(sourceCode.slice(1, -1)).sources;
    }

    for (const [contractName, contractSourceCode] of Object.entries(inner)) {
      // write files locally
      mkdirSync(getDirName(`./working/${contractName}`), { recursive: true });
      writeFileSync(`./working/${contractName}`, contractSourceCode.content);
    }

    // forge flatten
    let longestFlattenedContractLength = 0;
    for (const contractName of Object.keys(inner)) {
      const contractCode = await shell
        .exec(`forge flatten --root ./working ./working/${contractName}`, {
          silent: true,
        })
        .toString();
      if (contractCode.length > longestFlattenedContractLength) {
        sourceCode = contractCode;
        longestFlattenedContractLength = contractCode.length;
      }
    }
  }

  const deploymentData = txEvent.transaction.data;
  const code = await provider.getCode(createdContract);
  const loc = deploymentData.lastIndexOf(code.slice(-32));
  if (loc < 0) return;

  const constructArguments = deploymentData.slice(loc + 32);

  let localFindingsCount = 0;
  let testing;

  if (existsSync("./out")) {
    rmSync("./out", { recursive: true });
  }

  const injectedSourceCode = await DefaultInjector(sourceCode);
  testing = new DynamicTest(injectedSourceCode, constructArguments);

  const results = await testing.test(txEvent, provider);
  const rugpullTechniques = [];

  for (const [key, value] of Object.entries(results)) {
    if (!key.startsWith("test/test.sol")) continue;
    const testName = key.split(":")[1];
    const result = value["test_results"];
    let success = true;
    let reason = null;
    let conterexample = null;
    for (const [subTestName, testResult] of Object.entries(result)) {
      if (subTestName === "setUp()") continue;
      success = success && testResult["success"];
      reason = testResult["reason"];
      conterexample = testResult["counterexample"];
    }

    if (!!reason && reason.startsWith("EvmError")) continue;

    if (!success) {
      rugpullTechniques.push(testName.slice(7, -4).toUpperCase());
      findingsCache.push(
        Finding.fromObject({
          name: `HARD-RUG-PULL-${testName.slice(7, -4).toUpperCase()}-DYNAMIC`,
          alertId: `HARD-RUG-PULL-${testName
            .slice(7, -4)
            .toUpperCase()}-DYNAMIC`,
          description: `${txEvent.transaction.from} deployed a token contract ${createdContract} that may result in a hard rug pull`,
          severity: FindingSeverity.Medium,
          type: FindingType.Suspicious,
          metadata: {
            attacker_deployer_address: txEvent.transaction.from,
            token_contract_address: createdContract,
            reason: !!reason ? reason : "Assertion failed",
            counterexample: !!conterexample
              ? JSON.stringify(conterexample)
              : "{Sequence:[]}",
          },
          labels: [
            Label.fromObject({
              entity: txEvent.transaction.from,
              entityType: EntityType.Address,
              label: "scam",
              confidence: 0.5,
            }),
            Label.fromObject({
              entity: createdContract,
              entityType: EntityType.Address,
              label: "scam-contract",
              confidence: 0.5,
            }),
          ],
          source: {
            chains: [{chainId: txEvent.network}]
          }
        })
      );
      localFindingsCount += 1;
    }
  }

  if (localFindingsCount > 1) {
    findingsCache.push(
      Finding.fromObject({
        name: `HARD-RUG-PULL-1`,
        alertId: `HARD-RUG-PULL-1`,
        description: `${txEvent.transaction.from} deployed a token contract ${createdContract} that may result in a hard rug pull`,
        severity: FindingSeverity.High,
        type: FindingType.Suspicious,
        metadata: {
          attacker_deployer_address: txEvent.transaction.from,
          token_contract_address: createdContract,
          rugpull_techniques: rugpullTechniques.join(", "),
        },
        labels: [
          Label.fromObject({
            entity: txEvent.transaction.from,
            entityType: EntityType.Address,
            label: "scam",
            confidence: 0.8,
          }),
          Label.fromObject({
            entity: createdContract,
            entityType: EntityType.Address,
            label: "scam-contract",
            confidence: 0.8,
          }),
        ],
        source: {
          chains: [{chainId: txEvent.network}]
        }
      })
    );
  }
};

const runTaskConsumer = async (testingContext) => {
  console.log("Starting task consumer...");
  if (consumerStarted) {
    console.log("Task consumer already started.");
    return;
  }
  consumerStarted = true;
  while (true) {
    if (exitConsumer) {
      return;
    }

    if (taskQueue.length === 0) {
      if (testingContext) {
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        await new Promise((r) => setTimeout(r, 1000 * 10));
      }
      continue;
    }

    try {
      const { txEvent, createdContract, provider } = taskQueue.shift();
      console.log(`Running task for ${txEvent.transaction.hash}...`);

      await runInvarianceTest(txEvent, createdContract, provider);
    } catch (e) {
      console.error(e);
    }
  }
};

export const provideHandleTransaction = async (
  txEvent,
  provider,
  testingContext
) => {
  let findings = [];

  if (!consumerStarted) {
    runTaskConsumer(testingContext, provider);
  }

  const createdContract = await getCreatedContractAddress(txEvent);
  if (!createdContract) {
    // console.log(`No contract created in transaction ${txEvent.transaction.hash}.`)
    return findings;
  }
  console.log(
    `Found contract creation transaction ${txEvent.transaction.hash}: ${createdContract}...`
  );

  taskQueue.push({ txEvent, createdContract, provider });
  console.log(
    `[${taskQueue.length}] Added task for ${txEvent.transaction.hash}...`
  );

  if (testingContext) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * 100));
  }

  if (findingsCache.length > 0) {
    findings = findingsCache;
    findingsCache = [];
  }

  if (testingContext) {
    exitConsumer = true;
  }

  return findings;
};

export const handleTransaction = async (txEvent, provider) => {
  return await provideHandleTransaction(txEvent, provider, true);
};

export const initialize = async () => {
  runTaskConsumer(true);
};
