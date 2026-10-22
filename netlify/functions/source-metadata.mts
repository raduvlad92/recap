import type { Config } from '@netlify/functions';
import { createSourceMetadataHandler } from './_shared/youtube-channel-metadata';

export default createSourceMetadataHandler();
export const config: Config = {
  path: '/api/source-metadata',
  rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 40 },
};
