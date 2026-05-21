import { z } from "zod";
import { request } from "../client.ts";

export const functionsTools = [
  {
    name: "list_edge_functions",
    description:
      "List edge functions for a project, including each function's latest_version and last_deployed_at.",
    inputSchema: {
      project_id: z.string().uuid(),
    },
    handler: async (args: { project_id: string }) =>
      request(`/projects/${args.project_id}/functions`),
  },
  {
    name: "deploy_edge_function",
    description:
      "Create a new deployment for an edge function. Auto-increments the version. If status is 'deployed', the parent function's status is also flipped to deployed.",
    inputSchema: {
      project_id: z.string().uuid(),
      function_id: z.string().uuid(),
      source: z
        .string()
        .optional()
        .describe("Function source code (TypeScript or JavaScript)"),
      status: z
        .enum(["created", "deployed", "failed"])
        .optional()
        .describe("Defaults to 'created'"),
    },
    handler: async (args: {
      project_id: string;
      function_id: string;
      source?: string;
      status?: "created" | "deployed" | "failed";
    }) =>
      request(
        `/projects/${args.project_id}/functions/${args.function_id}/deployments`,
        {
          method: "POST",
          body: { source: args.source, status: args.status },
        },
      ),
  },
] as const;
