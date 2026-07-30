// ============================================================================
// Jest configuration for AXIOM FanvueCRM unit tests
// ============================================================================
// Uses ts-jest to transpile TypeScript test files on the fly.
// Module aliases (@axiom/*) resolve to packages/*/src for clean imports.
// ============================================================================
const config = {
    // Use ts-jest as the default transformer for .ts/.tsx files
    preset: "ts-jest",
    // Node environment (not jsdom) since this is a backend/monorepo project
    testEnvironment: "node",
    // Where to find test files
    testMatch: ["**/*.test.ts"],
    // Module path aliases matching the @axiom/* convention in tsconfig paths
    moduleNameMapper: {
        "^@axiom/core(.*)$": "<rootDir>/packages/core/src$1",
        "^@axiom/db(.*)$": "<rootDir>/packages/db/src$1",
        "^@axiom/auth(.*)$": "<rootDir>/packages/auth/src$1",
        "^@axiom/api(.*)$": "<rootDir>/packages/api/src$1",
    },
    // TypeScript config base
    // Falls back gracefully: tries tsconfig.json first, then tsconfig.base.json
    globals: {
        "ts-jest": {
            tsconfig: "tsconfig.json",
        },
    },
    // Collect coverage from source files (exclude test files, dist, etc.)
    collectCoverageFrom: [
        "packages/*/src/**/*.ts",
        "!packages/*/src/**/*.test.ts",
        "!packages/*/src/**/*.spec.ts",
        "!**/node_modules/**",
        "!**/dist/**",
    ],
    // Increase timeout for integration-heavy tests
    testTimeout: 30_000,
    // Clear mocks between tests by default
    clearMocks: true,
    // Verbose output
    verbose: true,
};
export default config;
//# sourceMappingURL=jest.config.js.map