// Metro config for the pnpm monorepo.
//
// pnpm keeps every dependency in a per-package node_modules with symlinks into
// the root store, so Metro must be able to resolve from both the app's own
// node_modules and the workspace root's node_modules, and must watch the whole
// workspace (shared packages like @axiom/api live outside this folder).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
