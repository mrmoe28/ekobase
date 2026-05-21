import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
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

async function invokeFunction(functionPath: string, request: { method: string; headers: Record<string, string | string[] | undefined>; body: unknown; query: unknown }) {
  if (!existsSync(functionPath)) {
    return { notFound: true as const };
  }
  const mod = (await import(pathToFileURL(functionPath).href)) as FunctionModule;
  if (typeof mod.handler !== "function") {
    return { handlerMissing: true as const };
  }
  return { result: await mod.handler(request) };
}

app.all("/projects/:projectId/:slug", async (request, reply) => {
  const { projectId, slug } = request.params as { projectId: string; slug: string };
  const functionPath = path.join(functionsDir, projectId, slug, "index.ts");
  const outcome = await invokeFunction(functionPath, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    query: request.query,
  });

  if ("notFound" in outcome) {
    return reply.code(404).send({ error: `Function ${projectId}/${slug} not deployed` });
  }
  if ("handlerMissing" in outcome) {
    return reply.code(500).send({ error: `Function ${slug} has no handler export` });
  }

  if (isHttpResponseShape(outcome.result)) {
    reply.code(outcome.result.statusCode);
    if (outcome.result.headers) {
      for (const [k, v] of Object.entries(outcome.result.headers)) {
        reply.header(k, v);
      }
    }
    return reply.send(outcome.result.body ?? "");
  }
  return reply.send(outcome.result);
});

app.all("/:functionName", async (request, reply) => {
  const { functionName } = request.params as { functionName: string };
  const functionPath = path.join(functionsDir, functionName, "index.ts");
  const outcome = await invokeFunction(functionPath, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    query: request.query,
  });

  if ("notFound" in outcome) {
    return reply.code(404).send({ error: `Function ${functionName} not found` });
  }
  if ("handlerMissing" in outcome) {
    return reply.code(500).send({ error: `Function ${functionName} has no handler export` });
  }

  if (isHttpResponseShape(outcome.result)) {
    reply.code(outcome.result.statusCode);
    if (outcome.result.headers) {
      for (const [k, v] of Object.entries(outcome.result.headers)) {
        reply.header(k, v);
      }
    }
    return reply.send(outcome.result.body ?? "");
  }
  return reply.send(outcome.result);
});

await app.listen({ host: "0.0.0.0", port });
