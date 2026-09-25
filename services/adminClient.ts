// Admin panel client: thin wrappers over the existing admin API.
// Sensitive actions (VIP / disable / registration switch) additionally
// require recent reauthentication server-side (15-minute window).
import { apiFetch } from './storageService';

export interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  email_verified_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export const listAdminUsers = (q = ''): Promise<AdminUserRow[]> =>
  apiFetch(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r: any) => r.users);

export const getStatsOverview = (): Promise<Record<string, number>> =>
  apiFetch('/admin/stats/overview');

export const getRegistrationOpen = (): Promise<boolean> =>
  apiFetch('/admin/registration').then((r: any) => Boolean(r.open));

export const setRegistrationOpen = (open: boolean): Promise<void> =>
  apiFetch('/admin/registration', { method: 'PUT', body: JSON.stringify({ open }) }).then(() => undefined);

export const grantVip = (userId: string, expiresAt: string | null): Promise<void> =>
  apiFetch(`/admin/users/${userId}/vip`, { method: 'POST', body: JSON.stringify({ expiresAt }) }).then(() => undefined);

export const revokeVip = (userId: string): Promise<void> =>
  apiFetch(`/admin/users/${userId}/vip`, { method: 'DELETE' }).then(() => undefined);

export const disableUser = (userId: string): Promise<void> =>
  apiFetch(`/admin/users/${userId}/disable`, { method: 'POST' }).then(() => undefined);

export const reauthenticate = (password: string): Promise<void> =>
  apiFetch('/auth/reauthenticate', { method: 'POST', body: JSON.stringify({ password }) }).then(() => undefined);

// ---------- 公告 ----------
export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  starts_at: string;
  ends_at: string | null;
  created_at: string;
}

export const listAnnouncements = (): Promise<AnnouncementRow[]> =>
  apiFetch('/admin/announcements').then((r: any) => r.announcements);

export const createAnnouncement = (input: {
  title: string;
  body: string;
  level: 'info' | 'warning' | 'critical';
  endsAt?: string | null;
}): Promise<{ id: string }> =>
  apiFetch('/admin/announcements', {
    method: 'POST',
    body: JSON.stringify({ ...input, endsAt: input.endsAt || null }),
  });

export const deleteAnnouncement = (id: string): Promise<void> =>
  apiFetch(`/admin/announcements/${id}`, { method: 'DELETE' }).then(() => undefined);

// ---------- 兑换码批次 ----------
export interface RedeemBatchRow {
  id: string;
  name: string;
  credits: number;
  total_codes: number;
  max_redemptions_per_user: number;
  expires_at: string | null;
  created_at: string;
  redeemed: number;
}

export const listRedeemBatches = (): Promise<RedeemBatchRow[]> =>
  apiFetch('/admin/credits/redeem-batches').then((r: any) => r.batches);

export const createRedeemBatch = (input: {
  name: string;
  credits: number;
  count: number;
  maxPerUser?: number;
  expiresInDays?: number | null;
}): Promise<{ batchId: string; codes: string[] }> =>
  apiFetch('/admin/credits/redeem-batches', { method: 'POST', body: JSON.stringify(input) });
