// Monorepo-aware Metro config. This app lives in an npm-workspaces repo
// (apps/api, apps/web, apps/mobile), so dependencies hoist to the repo root.
// Metro must watch the workspace root and resolve modules from BOTH the app's
// and the root's node_modules, or it can't find hoisted packages like
// babel-preset-expo. In SDK 51+ this also enables tsconfig `paths` (@/*).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
