import { z } from "zod";
import { request } from "../client.ts";

type ColumnRow = {
  schema: string;
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  default: string | null;
  position: number;
  is_pk: boolean;
};

type TableSummary = {
  schema: string;
  table: string;
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
    is_pk: boolean;
  }>;
};

function groupColumns(rows: ColumnRow[], schemaFilter?: string): TableSummary[] {
  const filtered = schemaFilter
    ? rows.filter((r) => r.schema === schemaFilter)
    : rows;
  const map = new Map<string, TableSummary>();
  for (const row of filtered) {
    const key = `${row.schema}.${row.table}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { schema: row.schema, table: row.table, columns: [] };
      map.set(key, entry);
    }
    entry.columns.push({
      name: row.column,
      type: row.type,
      nullable: row.nullable,
      default: row.default,
      is_pk: row.is_pk,
    });
  }
  return [...map.values()];
}

export const schemaTools = [
  {
    name: "list_tables",
    description:
      "List tables and columns visible to EkoBase. Optionally filter to a single schema (e.g. 'admin', 'auth', or a per-project schema like 'proj_xxxxxxxxxxxxxxxx'). Returns one entry per table with its columns grouped.",
    inputSchema: {
      schema: z
        .string()
        .optional()
        .describe(
          "Schema name to filter by. Omit for all non-system schemas.",
        ),
    },
    handler: async (args: { schema?: string }) => {
      const rows = await request<ColumnRow[]>("/schema/tables");
      return groupColumns(rows, args.schema);
    },
  },
  {
    name: "execute_sql",
    description:
      "Execute arbitrary SQL against the EkoBase Postgres instance with full superuser-equivalent access. Returns rows, fields (name + dataTypeID), rowCount, and command. Use with care — this is unrestricted.",
    inputSchema: {
      sql: z.string().min(1).describe("The SQL query to execute"),
    },
    handler: async (args: { sql: string }) =>
      request("/sql", { method: "POST", body: { query: args.sql } }),
  },
] as const;
