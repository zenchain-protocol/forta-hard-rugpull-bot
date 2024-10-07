import { scanEthereum, runHealthCheck } from "@fortanetwork/forta-bot";
import { handleTransaction, initialize } from "./agent.js";

const EVM_RPC = process.env.EVM_RPC;

async function main() {
    await initialize();

    void scanEthereum({
      rpcUrl: EVM_RPC,
      handleTransaction,
    });

    // health checks are required to run on scan nodes
    void runHealthCheck();
}

// only run main() method if this file is directly invoked (vs imported for testing)
if (import.meta.url === new URL(import.meta.url).href) {
    void main();
}
