import type { Config } from '@netlify/functions';
import { createCollectHandler } from './_shared/collect-handler';

export default createCollectHandler();
export const config: Config = {
  path: '/api/collect',
  rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 40 },
};
