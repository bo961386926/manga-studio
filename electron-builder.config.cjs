/**
 * Electron Builder Configuration
 * Minimal config - mac config moved to package.json to avoid schema validation issues
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
  publish: {
    provider: 'github',
    owner: 'bo961386926',
    repo: 'manga-studio',
    releaseType: 'release',
    private: false,
  },
};

module.exports = baseConfig;