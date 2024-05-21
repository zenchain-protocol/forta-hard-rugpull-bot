import { scanEthereum, runHealthCheck } from "@fortanetwork/forta-bot";
import { handleTransaction } from "./agent.js";

async function main() {
    // TODO: scan other supported networks including an arbitrary RPC
    scanEthereum({
      rpcUrl: "https://cloudflare-eth.com/",
      handleTransaction,
    });

    // health checks are required to run on scan nodes
    runHealthCheck();
}

// only run main() method if this file is directly invoked (vs imported for testing)
if (import.meta.url === new URL(import.meta.url).href) {
    main();
}
