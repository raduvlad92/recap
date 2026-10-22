import type { Config } from '@netlify/functions';
import { createCollectionActivityHandler } from './_shared/collection-activity';

export default createCollectionActivityHandler();
export const config: Config = {
  path: '/api/collection-activity',
  rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 60 },
};
