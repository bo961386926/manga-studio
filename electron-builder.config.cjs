/**
 * Electron Builder Configuration
 * Minimal config to avoid schema validation issues
 */
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
    // Disable code signing for CI builds without certificates
    // forceCodeSigning: false prevents electron-builder from attempting to sign
    forceCodeSigning: false,
    dmg: {
      sign: false,
    },
  };
}

module.exports = baseConfig;