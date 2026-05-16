import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@local/jwt": `${root}packages/jwt/src/index.ts`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
