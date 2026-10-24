#!/usr/bin/env node
import { notarize } from '@electron/notarize';
import { resolve } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const appPath = resolve('release/mac/漫剧工场.app');
  const appleId = getEnv('APPLE_ID');
  const appleIdPassword = getEnv('APPLE_ID_PASSWORD');
  const teamId = getEnv('APPLE_TEAM_ID');

  console.log('📦 Notarization Configuration:');
  console.log(`   App Path: ${appPath}`);
  console.log(`   Apple ID: ${appleId}`);
  console.log(`   Team ID: ${teamId}`);
  console.log(`   Dry Run: ${DRY_RUN}`);

  if (DRY_RUN) {
    console.log('✅ Dry run complete — skipping notarization (sign only)');
    process.exit(0);
  }

  const startTime = Date.now();
  try {
    console.log('🚀 Submitting for notarization...');

    await notarize({
      appBundleId: 'com.forsearch.manga-studio',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
      tool: 'notarytool',
    });

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`✅ Notarization successful (${elapsed}s)`);
    process.exit(0);
  } catch (error) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.error(`❌ Notarization failed after ${elapsed}s`);

    if (error.logFileUrl) {
      console.error(`📋 Apple error log: ${error.logFileUrl}`);
    }
    console.error(error.message);

    if (error.message?.includes('timeout') || elapsed >= 20 * 60) {
      process.exit(3);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('💥 Fatal error:', err.message);
  process.exit(1);
});