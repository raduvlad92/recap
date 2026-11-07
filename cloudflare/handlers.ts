import admin from '../netlify/functions/admin.mts';
import catalogue from '../netlify/functions/catalogue.mts';
import collect from '../netlify/functions/collect.mts';
import activity from '../netlify/functions/collection-activity.mts';
import reconciliation from '../netlify/functions/content-analysis-reconciliation.mts';
import status from '../netlify/functions/content-analysis-status.mts';
import briefings from '../netlify/functions/daily-briefings.mts';
import health from '../netlify/functions/health.mts';
import learning from '../netlify/functions/keyword-learning.mts';
import production from '../netlify/functions/keyword-production.mts';
import recovery from '../netlify/functions/keyword-recovery.mts';
import events from '../netlify/functions/reminder-events.mts';
import unsubscribe from '../netlify/functions/reminder-unsubscribe.mts';
import metadata from '../netlify/functions/source-metadata.mts';
import accountDeletion from '../netlify/functions/account-deletion.mts';

export type Handler = (request: Request) => Promise<Response>;
export const handlers: Record<string, Handler> = {
  admin, catalogue, collect, 'collection-activity': activity, 'account-deletion': accountDeletion,
  'content-analysis-reconciliation': reconciliation, 'content-analysis-status': status,
  'daily-briefings': briefings, health, 'keyword-learning': learning,
  'keyword-production': production, 'keyword-recovery': recovery,
  'reminder-events': events, 'reminder-unsubscribe': unsubscribe, 'source-metadata': metadata,
};
export const limits: Record<string, number> = { admin: 90, catalogue: 120, collect: 40, 'collection-activity': 60, 'source-metadata': 40 };
export function routeName(path: string): string | undefined {
  if (path === '/creators' || path.startsWith('/creators/') || path === '/sitemap.xml') return 'catalogue';
  const match = /^\/(?:api|\.netlify\/functions)\/([a-z-]+)\/?$/.exec(path);
  return match?.[1];
}
