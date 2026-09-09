// Default Expo Metro config. In SDK 51+ this enables tsconfig `paths`
// (the `@/*` alias) out of the box.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
