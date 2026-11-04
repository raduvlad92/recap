import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

export const fileHash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function assetManifest(directory) {
  const files = [];
  const visit = path => {
    for (const item of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push([relative(directory, file).replaceAll('\\', '/'), fileHash(file)]);
      else throw new Error('Asset artifacts must contain regular files only');
    }
  };
  visit(directory);
  return Object.fromEntries(files.sort(([a], [b]) => a.localeCompare(b)));
}
