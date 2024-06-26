import { scanEthereum, runHealthCheck } from "@fortanetwork/forta-bot";
import { handleTransaction, initialize } from "./agent.js";

const EVM_RPC = process.env.EVM_RPC;

async function main() {
    // TODO: scan other supported networks
    scanEthereum({
      rpcUrl: EVM_RPC,
      handleTransaction,
    });

    // health checks are required to run on scan nodes
    runHealthCheck();

    await initialize();
}

// only run main() method if this file is directly invoked (vs imported for testing)
if (import.meta.url === new URL(import.meta.url).href) {
    main();
}
