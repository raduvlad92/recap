import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { journaledMigration } from './cloudflare-release-migrations.mjs';

const [path, reviewedHash, ...extras] = process.argv.slice(2);
if (!path || !/^[a-f0-9]{64}$/.test(reviewedHash ?? '') || extras.length) {
  throw new Error('Usage: node scripts/prepare-reviewed-release-migration.mjs <migration.sql> <reviewed SHA-256>');
}
process.stdout.write(journaledMigration(basename(path), readFileSync(path, 'utf8'), reviewedHash));
