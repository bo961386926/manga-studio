// User-scoped project data access. Every function requires userId first;
// never accept an optional owner. See user-identity-access-design.md §9.1.
import { pool } from '../db.js';

// Extract a cover image for a project card: character reference image first
// (per product intent), then character variation, then scene, then keyframe.
export const extractCover = (data) => {
  const scriptData = data?.scriptData;
  if (Array.isArray(scriptData?.characters)) {
    for (const c of scriptData.characters) {
      if (c.referenceImage) return c.referenceImage;
      const variation = c.variations?.find((v) => v.referenceImage);
      if (variation?.referenceImage) return variation.referenceImage;
    }
  }
  const scene = Array.isArray(scriptData?.scenes)
    ? scriptData.scenes.find((s) => s.referenceImage)
    : null;
  if (scene?.referenceImage) return scene.referenceImage;
  const keyframe = Array.isArray(data?.shots)
    ? data.shots.flatMap((s) => s.keyframes || []).find((k) => k.imageUrl)
    : null;
  if (keyframe?.imageUrl) return keyframe.imageUrl;
  return null;
};

// Lightweight list metadata (with cover) so the lobby does not download full
// projects (which embed large video base64 payloads).
export const getProjectMetaList = async (userId) => {
  const result = await pool.query(
    'SELECT data, last_modified FROM projects WHERE user_id = $1 ORDER BY last_modified DESC',
    [userId]
  );
  return result.rows.map((row) => {
    const data = row.data || {};
    return {
      id: data.id,
      title: data.title || '(untitled)',
      stage: data.stage,
      lastModified: parseInt(row.last_modified) || data.lastModified,
      logline: data.scriptData?.logline,
      cover: extractCover(data),
    };
  });
};

export const getAllProjects = async (userId) => {
  const result = await pool.query(
    'SELECT data, last_modified FROM projects WHERE user_id = $1 ORDER BY last_modified DESC',
    [userId]
  );
  return result.rows.map((row) => ({
    ...row.data,
    lastModified: parseInt(row.last_modified) || row.data.lastModified,
  }));
};

export const getProject = async (userId, id) => {
  const { rows } = await pool.query(
    'SELECT data FROM projects WHERE user_id = $1 AND id = $2',
    [userId, id]
  );
  return rows[0]?.data ?? null;
};

export const saveProject = async (userId, id, data) => {
  const lastModified = data.lastModified || Date.now();
  await pool.query(
    `INSERT INTO projects (user_id, id, data, last_modified)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, id) DO UPDATE SET data = $3, last_modified = $4`,
    [userId, id, JSON.stringify(data), lastModified]
  );
};

export const deleteProject = async (userId, id) => {
  await pool.query('DELETE FROM projects WHERE user_id = $1 AND id = $2', [userId, id]);
};
