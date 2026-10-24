/**
 * Electron Builder Configuration
 * Dynamically generates config based on target platform to avoid schema validation issues
 * when building for non-target platforms.
 */
const fs = require('fs');
const path = require('path');

const baseConfig = {
  appId: 'com.forsearch.manga-studio',
  productName: '漫剧工场',
  directories: {
    output: 'release',
  },
  files: [
    'dist/**',
    'electron/**',
  ],
  asarUnpack: [
    'dist/**',
  ],
  win: {
    target: ['nsis'],
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    target: ['AppImage'],
    category: 'AudioVideo',
  },
  // mac config will be added conditionally
  publish: {
    provider: 'github',
    owner: 'bo961386926',
    repo: 'manga-studio',
    releaseType: 'release',
    private: false,
  },
};

// Add mac config only when building for mac
if (process.platform === 'darwin' || process.argv.includes('--mac')) {
  baseConfig.mac = {
    target: ['dmg'],
    category: 'public.app-category.video',
    hardenedRuntime: true,
    gatekeeperAssess: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    dmg: {
      sign: true,
    },
  };
}

module.exports = baseConfig;