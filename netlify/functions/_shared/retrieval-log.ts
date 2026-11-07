import type { RetrievalAttempt } from '../../../src/lib/retrieval-types';
import { database } from './admin-data';
import { CollectionError, type Env } from './security';
export type AttemptParent = ({ checkId: string; jobId?: never } | { jobId: string; checkId?: never }) & { itemKey?: string };
export type AttemptOutcome = Partial<Pick<RetrievalAttempt, 'http_status' | 'error_code' | 'result_count' | 'provider_run_id' | 'diagnostics'>> & { status: Exclude<RetrievalAttempt['status'], 'running'> };
export interface RetrievalLog {
  start(parent: AttemptParent, method: string, provider: RetrievalAttempt['provider'], stage: RetrievalAttempt['stage']): Promise<string>;
  finish(id: string, result: AttemptOutcome): Promise<void>;
}
export function createRetrievalLog(env: Env): RetrievalLog {
  const db = database(env);
  const unavailable = () => new CollectionError(503, 'retrieval_log_unavailable', 'Retrieval could not be recorded safely.');
  return {
    async start(parent, method, provider, stage) {
      const { data, error } = await db.from('collection_retrieval_attempts').insert({ check_id: parent.checkId || null, job_id: parent.jobId || null, item_key: parent.itemKey || null, method, provider, stage }).select('id').single();
      if (error?.code === 'PT429') throw new CollectionError(409, 'original_already_attempted', 'This original already has a retained attempt.');
      if (error || !data) throw unavailable();
      return data.id;
    },
    async finish(id, result) {
      const { error, data } = await db.from('collection_retrieval_attempts').update({ ...result, finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'running').select('id').single();
      if (error || !data) throw unavailable();
    },
  };
}
export async function retrievalAttempt<T>(log: RetrievalLog, parent: AttemptParent, method: string, provider: RetrievalAttempt['provider'], stage: RetrievalAttempt['stage'], operation: () => Promise<T>, outcome: (result: T) => AttemptOutcome): Promise<T> {
  const id = await log.start(parent, method, provider, stage);
  let result: T;
  try { result = await operation(); }
  catch (error) {
    await log.finish(id, { status: 'failed', error_code: error instanceof CollectionError ? error.code : 'retrieval_failed', ...(error instanceof CollectionError && error.upstreamStatus ? { http_status: error.upstreamStatus } : {}) });
    throw error;
  }
  await log.finish(id, outcome(result));
  return result;
}

/** IDs must come from an already authorized parent query, never request input. */
export async function readRetrievalAttempts(db: ReturnType<typeof database>, column: 'check_id' | 'job_id', ids: string[]): Promise<RetrievalAttempt[]> {
  const records: RetrievalAttempt[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    for (let page = 0; page < 20; page++) {
      const { data, error } = await db.from('collection_retrieval_attempts').select('id,check_id,job_id,item_key,method,stage,provider,status,started_at,finished_at,http_status,error_code,result_count,provider_run_id,diagnostics').in(column, ids.slice(offset, offset + 100)).order('started_at').order('id').range(page * 1000, page * 1000 + 999);
      if (error || !data) throw new CollectionError(503, 'retrieval_log_unavailable', 'Retrieval history is unavailable.');
      records.push(...data);
      if (data.length < 1000) break;
      if (page === 19) throw new CollectionError(400, 'activity_range_too_large', 'Choose a smaller activity range.');
    }
  }
  return records;
}
