export interface RetrievalAttempt {
  id: string;
  check_id: string | null;
  job_id: string | null;
  item_key?: string | null;
  method: string;
  stage: 'discovery' | 'content';
  provider: 'native' | 'apify';
  status: 'running' | 'succeeded' | 'partial' | 'empty' | 'failed' | 'blocked';
  started_at: string;
  finished_at: string | null;
  http_status: number | null;
  error_code: string | null;
  result_count: number | null;
  provider_run_id: string | null;
  diagnostics: Record<string, number | boolean | string>;
}
