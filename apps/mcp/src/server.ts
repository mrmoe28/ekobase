import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { projectsTools } from "./tools/projects.ts";
import { schemaTools } from "./tools/schema.ts";
import { usersTools } from "./tools/users.ts";
import { functionsTools } from "./tools/functions.ts";
import { secretsTools } from "./tools/secrets.ts";

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: never) => Promise<unknown>;
};

const allTools: readonly ToolDef[] = [
  ...projectsTools,
  ...schemaTools,
  ...usersTools,
  ...functionsTools,
  ...secretsTools,
] as readonly ToolDef[];

export function buildServer(): McpServer {
  const server = new McpServer({
    name: "ekobase-mcp",
    version: "0.1.0",
  });

  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: tool.inputSchema as any,
      },
      async (args: unknown) => {
        try {
          const result = await tool.handler(args as never);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: err instanceof Error ? err.message : String(err),
              },
            ],
          };
        }
      },
    );
  }

  return server;
}
