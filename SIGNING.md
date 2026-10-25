# macOS Code Signing & Notarization Guide

## Overview

This document covers local and CI signing for the Electron app (漫剧工场) on macOS using Hardened Runtime, Gatekeeper assessment, and Apple Notarization.

---

## Required Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CSC_LINK` | Base64-encoded `.p12` certificate (Developer ID Application) | ✅ Local |
| `CSC_KEY_PASSWORD` | Password for the `.p12` certificate | ✅ Local |
| `APPLE_ID` | Apple Developer account email | ✅ Both |
| `APPLE_ID_PASSWORD` | App-specific password (not your Apple ID password) | ✅ Both |
| `APPLE_TEAM_ID` | 10-character Team ID from Apple Developer portal | ✅ Both |

---

## Local Signing Workflow

### 1. Export `.p12` from Keychain Access

1. Open **Keychain Access** → **My Certificates**
2. Find **"Developer ID Application: Your Name (TEAM_ID)"**
3. Right-click → **Export** → Save as `.p12`
4. Set a password (this becomes `CSC_KEY_PASSWORD`)

### 2. Convert to Base64

```bash
base64 -i Certificates.p12 -o cert.base64
# Or on macOS:
base64 Certificates.p12 > cert.base64
```

### 3. Create App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and Security** → **App-Specific Passwords**
2. Generate new password → Label: "electron-notarize"
3. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)
4. This is your `APPLE_ID_PASSWORD`

### 4. Run Build & Sign

```bash
export CSC_LINK=$(cat cert.base64)
export CSC_KEY_PASSWORD="your-p12-password"
export APPLE_ID="your@apple.com"
export APPLE_ID_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"

npm run electron:build:mac
```

The `afterSign` hook (`scripts/notarize.mjs`) will automatically notarize the signed app.

### 5. Dry Run (Sign Only)

```bash
# Skip notarization, only sign locally
node scripts/notarize.mjs --dry-run
```

---

## CI: GitHub Actions

```yaml
name: Build macOS
on:
  push:
    tags: ['v*']

jobs:
  build-mac:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: Import Certificate
        uses: apple-actions/import-codesign-certs@v4
        with:
          p12-file-base64: ${{ secrets.CSC_LINK }}
          p12-password: ${{ secrets.CSC_KEY_PASSWORD }}

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build & Sign
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run electron:build:mac

      - name: Upload Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: mac-release
          path: release/**/*
```

### Required GitHub Secrets

| Secret | Value |
|--------|-------|
| `CSC_LINK` | Base64 `.p12` (from `base64 -i cert.p12`) |
| `CSC_KEY_PASSWORD` | `.p12` password |
| `APPLE_ID` | Apple ID email |
| `APPLE_ID_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-char Team ID |

---

## Common Failures & Fixes

### `CSSMERR_TP_NOT_TRUSTED`

**Cause**: Certificate chain not trusted (expired, wrong cert type, or missing intermediate).

**Fix**:
- Verify cert is **"Developer ID Application"** (not "Mac App Store" or "Developer ID Installer")
- Check expiry: `openssl pkcs12 -in cert.p12 -nodes | openssl x509 -noout -dates`
- Re-download from Apple Developer portal if expired

### `binary is not signed` / `code object is not signed at all`

**Cause**: `electron-builder` didn't sign the binary (missing `CSC_LINK` or wrong config).

**Fix**:
- Ensure `CSC_LINK` and `CSC_KEY_PASSWORD` are set
- Verify `hardenedRuntime: true` in `package.json` build.mac
- Check `electron-builder` logs for signing step

### Hardened Runtime Violations

**Cause**: App uses forbidden APIs (e.g., `dlopen`, JIT without entitlement).

**Fix**:
- Check `build/entitlements.mac.plist` has required entitlements:
  - `com.apple.security.cs.allow-jit`
  - `com.apple.security.cs.allow-unsigned-executable-memory`
  - `com.apple.security.cs.debugger` (dev only)
- For native modules: ensure they're signed with same certificate
- Test with: `codesign --verify --deep --strict --verbose=2 "release/mac/漫剧工场.app"`

### Notarization Timeout (Exit Code 3)

**Cause**: Apple's notary service taking >20 min (rare, usually temporary).

**Fix**:
- Re-run build (often succeeds on retry)
- Check Apple System Status: <https://developer.apple.com/system-status/>

### `Invalid App-Specific Password`

**Cause**: Using Apple ID password instead of app-specific password.

**Fix**: Generate new app-specific password at appleid.apple.com

---

## Verification Commands

```bash
# Verify signature
codesign --verify --deep --strict --verbose=2 "release/mac/漫剧工场.app"

# Check entitlements
codesign -d --entitlements :- "release/mac/漫剧工场.app"

# Check notarization ticket
spctl --assess --type execute --verbose "release/mac/漫剧工场.app"
xcrun stapler validate "release/mac/漫剧工场.app"
```

---

## Exit Codes (scripts/notarize.mjs)

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Config error (missing env vars) |
| 2 | Notarization failed (Apple rejected) |
| 3 | Timeout (>20 min) |

---

## References

- [Electron Notarize](https://github.com/electron/notarize)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [Apple Notarization Docs](https://developer.apple.com/documentation/xcode/notarizing_macos_software_before_distribution)
- [Hardened Runtime Entitlements](https://developer.apple.com/documentation/bundleresources/entitlements)