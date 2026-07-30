// ============================================================================
// Vitest configuration for AXIOM FanvueCRM unit tests
// ============================================================================
// Alternative test runner with Vite-style speed and native TypeScript support.
// Uses the 'forks' pool for isolation and the v8 coverage provider.
// ============================================================================
import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
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
//# sourceMappingURL=vitest.config.js.map