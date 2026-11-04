import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/** Compile the existing validator into a private local cache. No credential or
 * ciphertext is embedded, no external state is changed, and sending is absent. */
export async function reminderValidator(root) {
  const directory = join(root,'.local/cloudflare-preflight'); mkdirSync(directory,{recursive:true,mode:0o700});
  const file = join(directory,'actual-reminder-validator.mjs');
  const result = await build({stdin:{contents:"export { decryptReminderRuntime } from './netlify/functions/_shared/recap-reminders';",resolveDir:root,loader:'ts'},bundle:true,packages:'external',platform:'node',format:'esm',target:'node22',write:false});
  writeFileSync(file,result.outputFiles[0].contents,{mode:0o600});
  return (await import(pathToFileURL(file))).decryptReminderRuntime;
}
