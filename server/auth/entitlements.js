// VIP entitlements and capability evaluation. Access is evaluated server-side
// as: verified user + active entitlement + required model access level.
import { pool, withTransaction } from '../db.js';
import { getConfig, setConfig, removeConfig } from '../db.js';

// Free capabilities are available to any verified (active) user; VIP
// capabilities additionally require a non-expired, enabled vip entitlement.
export const canUseCapability = async ({ userId, accessLevel }) => {
  if (accessLevel === 'free') return true;
  if (accessLevel === 'vip') {
    const { rows } = await pool.query(
      `SELECT expires_at FROM user_entitlements
       WHERE user_id = $1 AND entitlement_key = 'vip' AND enabled = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId]
    );
    return rows.length > 0;
  }
  return false;
};

export const grantVip = async ({ userId, expiresAt = null, grantedBy = null, reason = null }) => {
  await pool.query(
    `INSERT INTO user_entitlements (id, user_id, entitlement_key, enabled, expires_at, granted_by, reason)
     VALUES (gen_random_uuid(), $1, 'vip', TRUE, $2, $3, $4)
     ON CONFLICT (user_id, entitlement_key)
     DO UPDATE SET enabled = TRUE, expires_at = EXCLUDED.expires_at,
                   granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason,
                   updated_at = NOW()`,
    [userId, expiresAt, grantedBy, reason]
  );
};

export const revokeVip = async ({ userId }) => {
  await pool.query(
    `UPDATE user_entitlements SET enabled = FALSE, updated_at = NOW()
     WHERE user_id = $1 AND entitlement_key = 'vip'`,
    [userId]
  );
};

export const countActiveAdmins = async () => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND status = 'active'`
  );
  return rows[0].c;
};

// Registration switch. Defaults to open when unset.
export const isRegistrationOpen = async () => {
  const value = await getConfig('registration_open');
  return value !== false;
};

export const setRegistrationOpen = async (open) => {
  if (open) await removeConfig('registration_open');
  else await setConfig('registration_open', false);
};
