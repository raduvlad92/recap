import type { Config } from '@netlify/functions';
import { createKeywordLearningHandler } from './_shared/keyword-learning';

/** Netlify acknowledges dispatch with 202; only the private durable receipt
 * establishes completion. A platform retry reuses the same reservation key,
 * so an existing settled or unresolved request never calls the model again. */
export const config: Config = { background: true };
export default createKeywordLearningHandler({}, { generateOnly: true });
