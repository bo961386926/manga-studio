/**
 * Prometheus metrics for server.
 * Exposes /metrics for scraping. Labels are deliberately low-cardinality:
 * never put user_id / project_id / free-form text in a label.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry, prefix: 'manga_studio_' });

// ===== HTTP =====

export const httpRequestsTotal = new Counter({
  name: 'manga_studio_http_requests_total',
  help: 'Total HTTP requests by method, path, status',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'manga_studio_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'path'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

// ===== Model gateway =====

export const modelInvocationsTotal = new Counter({
  name: 'manga_studio_model_invocations_total',
  help: 'Total model invocations by operation, status',
  labelNames: ['operation', 'status'],
  registers: [metricsRegistry],
});

export const modelInvocationDuration = new Histogram({
  name: 'manga_studio_model_invocation_duration_seconds',
  help: 'Model invocation latency in seconds',
  labelNames: ['operation'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [metricsRegistry],
});

export const modelJobsActive = new Gauge({
  name: 'manga_studio_model_jobs_active',
  help: 'Currently active async media jobs',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

export const tokensUsage = new Counter({
  name: 'manga_studio_tokens_usage_total',
  help: 'Total tokens used by model type',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

export const apiKeyErrors = new Counter({
  name: 'manga_studio_api_key_errors_total',
  help: 'API key related errors',
  labelNames: ['error_type'],
  registers: [metricsRegistry],
});

// ===== Credits / business =====

export const creditsDeductedTotal = new Counter({
  name: 'manga_studio_credits_deducted_total',
  help: 'Total credits deducted by operation',
  labelNames: ['operation'],
  registers: [metricsRegistry],
});

export const creditsRefundedTotal = new Counter({
  name: 'manga_studio_credits_refunded_total',
  help: 'Total credits refunded by operation',
  labelNames: ['operation'],
  registers: [metricsRegistry],
});

export const projectsTotal = new Gauge({
  name: 'manga_studio_projects_total',
  help: 'Total projects by stage',
  labelNames: ['stage'],
  registers: [metricsRegistry],
});

export const activeUsers = new Gauge({
  name: 'manga_studio_active_users',
  help: 'Currently authenticated users',
  registers: [metricsRegistry],
});

// ===== Storage / DB =====

export const dbQueryDuration = new Histogram({
  name: 'manga_studio_db_query_duration_seconds',
  help: 'Database query latency in seconds',
  labelNames: ['query_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [metricsRegistry],
});

export const dbPoolSize = new Gauge({
  name: 'manga_studio_db_pool_size',
  help: 'Database connection pool size',
  labelNames: ['state'],
  registers: [metricsRegistry],
});

export const uploadMediaTotal = new Counter({
  name: 'manga_studio_upload_media_total',
  help: 'Total media uploads',
  labelNames: ['content_type', 'status'],
  registers: [metricsRegistry],
});

export const migrationTotal = new Counter({
  name: 'manga_studio_migration_total',
  help: 'Total legacy config migrations',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

// ===== Helpers =====

/** Collapse Express route params so /api/projects/:id does not create unbounded labels. */
export function routeLabel(path) {
  return String(path || 'unknown')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:n');
}

export function recordHttpRequest(method, path, status, durationMs) {
  const route = routeLabel(path);
  httpRequestsTotal.inc({ method, path: route, status: String(status) });
  httpRequestDuration.observe({ method, path: route }, durationMs / 1000);
}

export function recordModelInvocation(operation, status, durationMs) {
  modelInvocationsTotal.inc({ operation, status });
  modelInvocationDuration.observe({ operation }, durationMs / 1000);
}

export function recordCreditsDeducted(operation, amount) {
  creditsDeductedTotal.inc({ operation }, amount);
}

export function recordCreditsRefunded(operation, amount) {
  creditsRefundedTotal.inc({ operation }, amount);
}

export function recordDbQuery(queryType, durationMs) {
  dbQueryDuration.observe({ query_type: queryType }, durationMs / 1000);
}

export function setDbPoolStats(total, idle, waiting) {
  dbPoolSize.set({ state: 'total' }, total);
  dbPoolSize.set({ state: 'idle' }, idle);
  dbPoolSize.set({ state: 'waiting' }, waiting);
}

export function setActiveUsers(count) {
  activeUsers.set(count);
}

export function setProjectsByStage(stage, count) {
  projectsTotal.set({ stage }, count);
}

export function recordTokensUsage(type, count) {
  tokensUsage.inc({ type }, count);
}

export function recordApiKeyError(errorType) {
  apiKeyErrors.inc({ error_type: errorType });
}

export function recordUploadMedia(contentType, status) {
  uploadMediaTotal.inc({ content_type: contentType, status });
}

export function recordMigration(status) {
  migrationTotal.inc({ status });
}

export function setModelJobsActive(status, count) {
  modelJobsActive.set({ status }, count);
}

// ===== Endpoint =====

export async function metricsHandler(req, res) {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch {
    res.status(500).send('metrics collection failed');
  }
}