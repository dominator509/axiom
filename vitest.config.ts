// ============================================================================
// Vitest configuration for AXIOM FanvueCRM unit tests
// ============================================================================
// Alternative test runner with Vite-style speed and native TypeScript support.
// Uses the 'forks' pool for isolation and the v8 coverage provider.
// ============================================================================

import { defineConfig } from "vitest/config";
import path from "path";
import fs from "fs";
import type { Plugin } from "vite";

// ----------------------------------------------------------------------------
// preferTsSource
// ----------------------------------------------------------------------------
// The monorepo keeps compiled .js/.d.ts artifacts next to the TypeScript
// sources inside packages/*/src. NodeNext-style relative imports written as
// './file.js' would otherwise resolve to those (possibly stale) compiled
// artifacts instead of the real source. This plugin redirects relative .js
// specifiers to the sibling .ts file when one exists, so tests always exercise
// the actual TypeScript source (mirroring the @axiom/* -> packages/*/src
// alias configuration below).
// ----------------------------------------------------------------------------
function preferTsSource(): Plugin {
  return {
    name: "prefer-ts-source",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith(".") || !source.endsWith(".js")) return null;
      const tsPath = path.resolve(
        path.dirname(importer),
        source.slice(0, -3) + ".ts",
      );
      if (fs.existsSync(tsPath)) {
        return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [preferTsSource()],

  test: {
    // Where to find test files
    include: ["**/*.test.ts"],

    // Use forks pool for process-level isolation (more robust than threads)
    pool: "forks",

    // Enable coverage with v8 provider
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/*.test.ts",
        "**/*.spec.ts",
      ],
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
    },

    // Node environment
    environment: "node",

    // Global test utilities
    globals: true,

    // Timeout
    testTimeout: 30_000,
  },

  // Resolve aliases matching @axiom/* -> packages/*/src
  resolve: {
    alias: {
      "@axiom/core": path.resolve(__dirname, "packages/core/src"),
      "@axiom/db": path.resolve(__dirname, "packages/db/src"),
      "@axiom/auth": path.resolve(__dirname, "packages/auth/src"),
      "@axiom/api": path.resolve(__dirname, "packages/api/src"),
    },
  },
});
