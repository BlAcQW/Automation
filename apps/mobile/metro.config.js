// Default Expo Metro config. In SDK 51+ this enables tsconfig `paths`
// (the `@/*` alias) out of the box.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// apps/web pins React 18, so the workspace-root node_modules holds React 18
// while this app uses React 19. Packages that npm hoists to the root and this
// app depends on (@react-navigation/*, @tanstack/react-query) resolve `react`
// from there, which puts two copies of React in one bundle and fails at
// runtime with "Invalid hook call" / "Cannot read property 'useRef' of null".
//
// Resolve every `react` request as if it came from this app, so the hoisted
// packages share the app's single React 19 copy.
const appOrigin = path.join(projectRoot, 'index.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = context.resolveRequest;

  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return resolve({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }

  return resolve(context, moduleName, platform);
};

module.exports = config;
