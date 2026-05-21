import { request } from "../client.ts";

export const usersTools = [
  {
    name: "list_users",
    description:
      "List all auth.users across the EkoBase instance (id, email, created_at, updated_at), most recent first.",
    inputSchema: {},
    handler: async () => request("/users"),
  },
] as const;
