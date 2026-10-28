import { createKeywordProductionHandler } from './_shared/keyword-production-handler';

/** Authenticated finite rollout: server-authored plans and source-bound
 * publication. Generation uses the existing durable background call worker. */
export default createKeywordProductionHandler();
