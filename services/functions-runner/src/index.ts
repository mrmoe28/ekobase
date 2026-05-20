import { pathToFileURL } from "node:url";
import path from "node:path";
import Fastify from "fastify";

type HttpResponseShape = {
  statusCode: number;
  headers?: Record<string, string | number>;
  body?: unknown;
};

type FunctionModule = {
  handler: (request: {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    query: unknown;
  }) => Promise<unknown> | unknown;
};

function isHttpResponseShape(value: unknown): value is HttpResponseShape {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { statusCode?: unknown }).statusCode === "number"
  );
}

const port = Number(process.env.FUNCTIONS_PORT ?? 54322);
const functionsDir =
  process.env.FUNCTIONS_DIR ??
  path.resolve(process.env.INIT_CWD ?? process.cwd(), "examples/functions");

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.all("/:functionName", async (request, reply) => {
  const { functionName } = request.params as { functionName: string };
  const functionPath = path.join(functionsDir, functionName, "index.ts");
  const mod = (await import(pathToFileURL(functionPath).href)) as FunctionModule;

  if (typeof mod.handler !== "function") {
    return reply.code(500).send({ error: `Function ${functionName} has no handler export` });
  }

  const result = await mod.handler({
    method: request.method,
    headers: request.headers,
    body: request.body,
    query: request.query,
  });

  if (isHttpResponseShape(result)) {
    reply.code(result.statusCode);
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        reply.header(k, v);
      }
    }
    return reply.send(result.body ?? "");
  }

  return reply.send(result);
});

await app.listen({ host: "0.0.0.0", port });
