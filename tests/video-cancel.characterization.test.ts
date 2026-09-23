/**
 * Characterization tests: video job submission behavior. Today there is no
 * server-side job store; the caller owns retries. The gateway must never
 * auto-resubmit a submission whose outcome is unknown.
 */
import { describe, it, expect } from 'vitest';
import { reconcileSubmission } from '../services/modelService';

describe('video submission characterization', () => {
  it('does not silently resubmit an uncertain video job', async () => {
    await expect(
      reconcileSubmission({ status: 'submission_uncertain' }, {})
    ).resolves.toEqual({ action: 'query-or-manual' });
  });

  it('leaves deterministic states alone', async () => {
    for (const status of ['submitting', 'queued', 'polling', 'done', 'failed']) {
      await expect(
        reconcileSubmission({ status: status as any }, {})
      ).resolves.toEqual({ action: 'none' });
    }
  });
});
