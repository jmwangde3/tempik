import type { D1Database } from '@cloudflare/workers-types';
import { purgeOldData } from './db/queries';
import type { PurgeResult } from './db/queries';

export interface MaintenanceEnv {
  DB: D1Database;
  RETENTION_DAYS?: string;
}

const DEFAULT_RETENTION_DAYS = 7;

export function retentionDays(env: MaintenanceEnv): number {
  const parsed = Number.parseInt(env.RETENTION_DAYS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * Cron entry point. Disposable inboxes are throwaway by definition, but nothing
 * ever removed them: every inbox, message and session ever created stayed in D1
 * for good, because `DELETE /api/inboxes/:address` only drops the session link.
 */
export async function runMaintenance(env: MaintenanceEnv): Promise<PurgeResult> {
  const days = retentionDays(env);
  const result = await purgeOldData(env.DB, days);
  console.log(
    `[maintenance] retention=${days}d purged messages=${result.messages} ` +
      `inboxes=${result.inboxes} sessions=${result.sessions}`
  );
  return result;
}
