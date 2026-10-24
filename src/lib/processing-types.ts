/** Public processing state. Private model evidence and cost records never belong here. */
export interface ContentProcessing {
 ruleVersion: 'content-v1';
 contentHash?: string;
 content: 'pending' | 'ready' | 'partial' | 'unavailable' | 'failed' | 'blocked';
 recap: 'pending' | 'running' | 'ready' | 'unavailable' | 'failed' | 'blocked' | 'empty';
 keywords: 'pending' | 'running' | 'ready' | 'review' | 'failed' | 'blocked' | 'empty';
 reason?: string;
 updatedAt?: string;
}
