import { request } from "../client.ts";

export const secretsTools = [
  {
    name: "list_secrets",
    description:
      "List function secrets stored in EkoBase. Returns name, a sha256 digest prefix of the value (not the value itself), and updated_at.",
    inputSchema: {},
    handler: async () => request("/secrets"),
  },
] as const;
