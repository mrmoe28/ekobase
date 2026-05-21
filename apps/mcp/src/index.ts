#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.ts";

async function main() {
  if (!process.env.EKOBASE_ADMIN_TOKEN) {
    process.stderr.write(
      "ekobase-mcp: EKOBASE_ADMIN_TOKEN is not set. See apps/mcp/README.md.\n",
    );
    process.exit(1);
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(
    `ekobase-mcp: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
