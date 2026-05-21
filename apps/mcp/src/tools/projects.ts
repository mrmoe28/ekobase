import { z } from "zod";
import { request } from "../client.ts";

export const projectsTools = [
  {
    name: "list_projects",
    description:
      "List all EkoBase projects with their id, name, schema_name, owner_email, region, and timestamps.",
    inputSchema: {},
    handler: async () => request("/projects"),
  },
  {
    name: "get_project",
    description: "Get details for a single EkoBase project by id.",
    inputSchema: {
      project_id: z.string().uuid().describe("The project's UUID"),
    },
    handler: async (args: { project_id: string }) =>
      request(`/projects/${args.project_id}`),
  },
  {
    name: "create_project",
    description:
      "Create a new EkoBase project. Automatically provisions a dedicated Postgres schema named proj_<first-16-of-uuid>. Returns the project record including schema_name.",
    inputSchema: {
      name: z.string().min(1).describe("Project name (required)"),
      description: z.string().optional(),
      owner_id: z
        .string()
        .uuid()
        .optional()
        .describe("UUID of an existing auth user to own the project"),
      region: z.string().optional().describe("Defaults to us-east-1"),
    },
    handler: async (args: {
      name: string;
      description?: string;
      owner_id?: string;
      region?: string;
    }) => request("/projects", { method: "POST", body: args }),
  },
  {
    name: "get_project_keys",
    description:
      "Returns the anon_key and service_role_key JWTs for a project. Both are 100-year tokens. Treat service_role_key as a secret.",
    inputSchema: {
      project_id: z.string().uuid(),
    },
    handler: async (args: { project_id: string }) =>
      request(`/projects/${args.project_id}/keys`),
  },
] as const;
