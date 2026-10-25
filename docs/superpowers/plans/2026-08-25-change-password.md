# Authenticated Password Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated user change their password without email while keeping the current browser signed in and revoking every other session.

**Architecture:** Add one CSRF-protected auth route that verifies the current password, updates the Argon2id hash and session version transactionally, revokes old sessions, and creates a replacement session. Add a small client method and a focused dashboard modal using existing alert and styling patterns.

**Tech Stack:** Express, PostgreSQL, Argon2id, React 19, TypeScript, Node test runner, Vitest.

---

### Task 1: Backend password-change contract

**Files:**
- Modify: `server/test/routes.test.js`
- Modify: `server/auth/routes.js`

- [ ] **Step 1: Write failing route tests**

Add tests that log in twice, submit `currentPassword` and `newPassword` with the first cookie/CSRF pair, and assert: HTTP 200 returns a replacement cookie and CSRF token; the old password fails; the new password succeeds; the second session is invalid; wrong current password and a password shorter than 10 bytes do not mutate the hash.

- [ ] **Step 2: Verify RED**

Run `cd server && npm test -- --test-name-pattern="change password"`. Expected: 404 because `/api/auth/change-password` does not exist.

- [ ] **Step 3: Implement the minimal route**

Add `POST /change-password` behind `requireUser` and `csrfProtection`. Validate both fields, verify the stored hash, then transactionally update `password_hash`, increment `session_version`, revoke all sessions, and call `createSession`. Set the replacement cookie, return `{ success: true, csrfToken }`, and write a password-free `auth.change_password` audit event.

- [ ] **Step 4: Verify GREEN**

Run the focused server test and expect all matching tests to pass.

### Task 2: Browser client contract

**Files:**
- Create: `tests/auth-client.change-password.test.ts`
- Modify: `services/authClient.ts`

- [ ] **Step 1: Write a failing Vitest test**

Stub same-origin `fetch`, call the desired `changePassword(currentPassword, newPassword)` API, and assert it posts the exact JSON body through the authenticated API path and stores the returned CSRF token.

- [ ] **Step 2: Verify RED**

Run `pnpm test -- tests/auth-client.change-password.test.ts`. Expected: import failure because `changePassword` is not exported.

- [ ] **Step 3: Implement the minimal client method**

Export `changePassword`, call `apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify(...) })`, store `csrfToken`, and surface the server error message.

- [ ] **Step 4: Verify GREEN**

Run the focused Vitest test and expect it to pass.

### Task 3: Dashboard password dialog

**Files:**
- Modify: `components/Dashboard.tsx`

- [ ] **Step 1: Add the smallest account UI**

Add a “修改密码” button beside the signed-in account, and a modal with current password, new password, and confirmation fields. Disable submission when fields are empty, reject mismatched confirmation locally, call `changePassword`, clear fields on success, and use the existing alert surface for success/failure.

- [ ] **Step 2: Run type/build verification**

Run `pnpm build`. Expected: Vite production build exits 0 with no TypeScript or bundling errors.

### Task 4: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run all server tests**

Run `cd server && npm test`. Expected: zero failures.

- [ ] **Step 2: Run all frontend tests**

Run `pnpm test`. Expected: zero failures.

- [ ] **Step 3: Run production build**

Run `pnpm build`. Expected: exit 0.

- [ ] **Step 4: Review scoped diff**

Run `git diff --check` and inspect only the files listed above, preserving unrelated user changes.
