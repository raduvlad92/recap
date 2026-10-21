#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateInput } from '../actors/tech-collector/src/collector.mjs';

// Offline preparation only: no provider token, fetch, SDK import, database or Actor launch.
const args=process.argv.slice(2), option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
try {
  if(!option('--sources') || !option('--output'))throw new Error('Usage: node scripts/tech-backfill-input.mjs --sources public-inventory.json --output ignored-input.json [--date-to ISO-UTC] [--max-usd 45] [--execute --reservation opaque-budget-id]');
  const inventory=JSON.parse(await readFile(resolve(option('--sources')),'utf8'));
  const to=new Date(option('--date-to') || Date.now()), from=new Date(to.getTime()-30*86400000);
  const sources=(Array.isArray(inventory)?inventory:inventory.sources.filter(source=>source.scope==='included')).map(source=>({...source,...(source.youtubeChannelId?{channelId:source.youtubeChannelId}:{})}));
  const input=validateInput({sources,dateFrom:from.toISOString(),dateTo:to.toISOString(),executionEnabled:args.includes('--execute'),...(option('--reservation')?{budgetReservationId:option('--reservation')}:{}),maxTotalChargeUsd:Number(option('--max-usd') || 45),parentMaxChargeUsd:Number(option('--parent-max-usd') || 2),maxItemsPerSource:Number(option('--per-source') || 300),maxItemsTotal:Number(option('--total-items') || 4000)});
  // key is an internal normalization artifact, not a provider input requirement.
  const value={...input,sources:input.sources.map(({key,...source})=>source)};
  await writeFile(resolve(option('--output')),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  process.stdout.write(`Prepared ${value.sources.length} sources; execution ${value.executionEnabled?'explicitly enabled in input only':'disabled'}; no job started.\n`);
}catch(error){process.stderr.write((error?.code || error.message || 'input_preparation_failed')+'\n');process.exitCode=1;}
