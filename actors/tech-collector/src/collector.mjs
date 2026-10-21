import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Retain the original review unchanged: historical provider runs need their actual pins.
const ORIGINAL_REVIEWED = JSON.parse(readFileSync(new URL('../providers/reviewed-metadata.json', import.meta.url), 'utf8'));
const XQUIK_REVIEWED = JSON.parse(readFileSync(new URL('../providers/xquik-reviewed-metadata.json', import.meta.url), 'utf8'));
export const REVIEWED = {...ORIGINAL_REVIEWED,X:XQUIK_REVIEWED};
export function reviewedProviderForRun(platform,actorId,buildId) {
  const candidates=[REVIEWED[platform],ORIGINAL_REVIEWED[platform]].filter(Boolean);
  const provider=candidates.find(review=>review.actorId===actorId && review.buildId===buildId);
  if(!provider)throw fault('unreviewed_provider_run');
  return provider;
}
export const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const MONEY = 1_000_000;
const TEXT_LIMIT = 200_000;
const EMPTY_FORMAT_DIAGNOSTICS={CHANNEL_HAS_NO_SHORTS:'shorts',CHANNEL_HAS_NO_LIVE_VIDEOS:'stream',CHANNEL_HAS_NO_VIDEOS:'video'};
const cents = value => Math.ceil(value * MONEY) / MONEY;
const sumCapsUsd = values => values.reduce((total,value)=>total+Math.ceil(value*MONEY),0)/MONEY;
const text = (value, max = TEXT_LIMIT) => typeof value === 'string' ? value.slice(0, max).trim() : '';
const list = value => Array.isArray(value) ? value : [];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const fault = code => Object.assign(new Error(code), { code });
const number = (value, min, max, name) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw fault('invalid_' + name); return value; };
const integer = (value, min, max, name) => { number(value, min, max, name); if (!Number.isInteger(value)) throw fault('invalid_' + name); return value; };
export function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].some(k => /token|secret|signature|password|auth|api.?key/i.test(k))) return '';
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|invalid|test)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return '';
    return url.href;
  } catch { return ''; }
}
export function sourceKey(url, platform) {
  const safe = publicUrl(url); if (!safe) throw fault('invalid_source_url');
  const parsed = new URL(safe), host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parsed.search) throw fault('invalid_source_url');
  if (platform === 'YouTube') {
    if (host !== 'youtube.com') throw fault('invalid_source_platform');
    if (['videos', 'shorts', 'streams', 'featured', 'about'].includes(parts.at(-1)) && parts.length > 1) parts.pop();
    if (!(parts.length === 1 && /^[@A-Za-z0-9_.-]+$/.test(parts[0]) && !['watch','feed','playlist','results','live','shorts'].includes(parts[0].toLowerCase())) && !(parts.length === 2 && ['channel','user','c'].includes(parts[0]) && /^[A-Za-z0-9_-]+$/.test(parts[1]))) throw fault('invalid_source_channel');
    return 'youtube.com/' + (parts[0]==='channel' ? parts.join('/') : parts.join('/').toLowerCase());
  }
  if (!['X', 'Instagram'].includes(platform) || !((platform === 'X' && ['x.com','twitter.com'].includes(host)) || (platform === 'Instagram' && host === 'instagram.com')) || parts.length !== 1 || !/^[A-Za-z0-9_.]+$/.test(parts[0]) || ['home','search','explore','accounts','p','reel','reels','i'].includes(parts[0].toLowerCase())) throw fault('invalid_source_profile');
  return (platform === 'X' ? 'x.com/' : 'instagram.com/') + parts[0].toLowerCase();
}
export function pricingFingerprint(pricing) {
  return digest({ model: pricing?.pricingModel, startedAt: pricing?.startedAt, minimum: pricing?.minimalMaxTotalChargeUsd ?? null, events: pricing?.pricingPerEvent?.actorChargeEvents });
}
export function validateInput(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fault('invalid_input');
  const from = Date.parse(raw.dateFrom), to = Date.parse(raw.dateTo);
  if (![raw.dateFrom,raw.dateTo].every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 31 * 86400000 || to > now + 300000) throw fault('invalid_date_range');
  const sources = list(raw.sources).map(source => {
    if (!source || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(source.id || '')) throw fault('invalid_source_id');
    const key = sourceKey(source.url, source.platform);
    const aliases = list(source.aliases).map(url => { sourceKey(url,source.platform); return url; });
    if (aliases.length > 5 || (source.channelId && !/^UC[A-Za-z0-9_-]{22}$/.test(source.channelId))) throw fault('invalid_source_identity');
    return { id:source.id, url:publicUrl(source.url), platform:source.platform, name:text(source.name,200) || source.id, ...(source.channelId ? {channelId:source.channelId} : {}), aliases, key };
  });
  if (!sources.length || sources.length > 80 || new Set(sources.map(s=>s.id)).size !== sources.length || new Set(sources.map(s=>s.key)).size !== sources.length) throw fault('invalid_or_duplicate_sources');
  const identityOwners=new Map();
  for(const source of sources) {
    const anchors=new Set([source.key,...source.aliases.map(url=>sourceKey(url,source.platform)),...(source.channelId?['youtube.com/channel/'+source.channelId]:[])]);
    for(const anchor of anchors) {if(identityOwners.has(anchor))throw fault('invalid_or_duplicate_sources');identityOwners.set(anchor,source.id);}
  }
  const maxTotalChargeUsd = number(raw.maxTotalChargeUsd, 0.05, 45, 'total_budget');
  const parentMaxChargeUsd = number(raw.parentMaxChargeUsd ?? 2, 0.02, 2, 'parent_budget');
  if (parentMaxChargeUsd >= maxTotalChargeUsd) throw fault('invalid_parent_budget');
  if (raw.executionEnabled !== undefined && typeof raw.executionEnabled !== 'boolean') throw fault('invalid_execution_flag');
  if ((raw.executionEnabled === true || raw.budgetReservationId !== undefined) && !/^[A-Za-z0-9_-]{8,160}$/.test(raw.budgetReservationId || '')) throw fault('budget_reservation_required');
  return { sources, dateFrom:new Date(from).toISOString(), dateTo:new Date(to).toISOString(), maxTotalChargeUsd, parentMaxChargeUsd, maxItemsPerSource:integer(raw.maxItemsPerSource ?? 300,3,1000,'source_limit'), maxItemsTotal:integer(raw.maxItemsTotal ?? 4000,1,5000,'total_limit'), executionEnabled:raw.executionEnabled === true, budgetReservationId:raw.budgetReservationId || null };
}
export function childRequest(source, input, remaining) {
  const count = Math.min(input.maxItemsPerSource, remaining);
  if (count < 1) return null;
  const provider = REVIEWED[source.platform];
  let body, counts;
  if (source.platform === 'YouTube') {
    // A shared channel run has independent caps per format. Sum, never multiply, the source allowance.
    counts = {video:Math.ceil(count/3), shorts:Math.floor((count+1)/3), stream:Math.floor(count/3)};
    const baseUrl = source.url.replace(/\/(videos|shorts|streams|featured|about)\/?$/,'').replace(/\/$/,'');
    body = { startUrls:[{url:baseUrl}], maxResults:counts.video, maxResultsShorts:counts.shorts, maxResultStreams:counts.stream, oldestPostDate:input.dateFrom, sortVideosBy:'NEWEST', transcriptionAndSubtitle:'ALWAYS_SUBTITLES', subtitlesLanguage:'en', subtitlesFormat:'plaintext', saveSubsToKVS:false, preferAutoGeneratedSubtitles:false, aiVideoDescription:false, aiVideoSummary:false };
  } else if (source.platform === 'X') {
    const handle = source.key.split('/')[1];
    // Date-only API filters overfetch the boundary days; exact UTC filtering is also applied locally.
    const start=input.dateFrom.slice(0,10),end=new Date(Date.parse(input.dateTo)+86400000).toISOString().slice(0,10);
    body = {mode:'search',searchTerms:[`from:${handle} since:${start} until:${end}`],queryType:'Latest',maxItems:count,outputVariant:'rich',fieldStyle:'camelCase',includeSearchTerms:true};
  } else {
    body = { directUrls:[source.url], resultsType:'posts', resultsLimit:count, onlyPostsNewerThan:input.dateFrom, addParentData:true };
  }
  // Xquik charges platform usage separately; its bounded allowance is not a quoted supplier fee.
  const estimateMicroUsd = source.platform === 'YouTube' ? count * 5300 : source.platform === 'X' ? provider.reservation.platformAllowanceMicroUsd+count*provider.reservation.perItemMicroUsd : count * 2700;
  const maxChargeUsd = Math.max(Math.ceil((provider.pricing.minimalMaxTotalChargeUsd || 0)*MONEY),estimateMicroUsd)/MONEY;
  return { actor:provider.actor, actorId:provider.actorId, buildId:provider.buildId, buildNumber:provider.buildNumber, pricingUrl:provider.pricingUrl, pricingFingerprint:pricingFingerprint(provider.pricing), maxChargeUsd, maxItems:count, formatLimits:counts || null, body, options:{build:provider.buildNumber, memory:provider.runOptions?.memory ?? 1024, timeout:provider.runOptions?.timeout ?? 600, maxTotalChargeUsd:maxChargeUsd,restartOnError:false} };
}
export function observedCharge(run) {
  return TERMINAL.has(run?.status) && typeof run?.usageTotalUsd === 'number' && Number.isFinite(run.usageTotalUsd) && run.usageTotalUsd >= 0 ? run.usageTotalUsd : null;
}
export function plannedBudget(input) {
  // All source allowances are priced independently; the global item cap can stop earlier.
  const sourceCaps=input.sources.map(source=>({sourceId:source.id,platform:source.platform,maxChargeUsd:childRequest(source,input,input.maxItemsPerSource).maxChargeUsd}));
  const plannedFullCapUsd=sumCapsUsd([input.parentMaxChargeUsd,...sourceCaps.map(source=>source.maxChargeUsd)]);
  return {plannedFullCapUsd,plannedSourceCaps:sourceCaps,allSourceCapsFitBudget:plannedFullCapUsd<=input.maxTotalChargeUsd+0.0000001};
}
export function committedUsd(state) {
  // PPE usage can rise after SUCCEEDED. Observed charges never release launch capacity.
  return sumCapsUsd([state.parentMaxChargeUsd,...Object.values(state.entries).map(entry=>entry.reservedUsd)]);
}
export function reserve(state, source, request) {
  if (state.entries[source.id]) throw fault('duplicate_reservation');
  if (sumCapsUsd([committedUsd(state),request.maxChargeUsd]) > state.maxTotalChargeUsd + 0.0000001) return false;
  state.entries[source.id] = {sourceId:source.id, actorId:request.actorId, actor:request.actor, buildId:request.buildId, buildNumber:request.buildNumber, pricingUrl:request.pricingUrl, pricingFingerprint:request.pricingFingerprint, reservedUsd:request.maxChargeUsd, observedCostUsd:null, costObservedAt:null, costStatus:'unreported', status:'submitting', providerRunId:null, datasetId:null, maxItems:request.maxItems, formatLimits:request.formatLimits, updates:[], coverage:null};
  return true;
}
/** Read only actual caption cues; plain text and durations never manufacture timing. */
export function timedSubtitleSegments(value) {
  if(typeof value!=='string')return [];
  const seconds=value=>{
    const match=/^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[.,](\d{1,3})$/.exec(value);
    return match?Number(match[1] || 0)*3600+Number(match[2])*60+Number(match[3])+Number(match[4].padEnd(3,'0'))/1000:null;
  };
  const segments=[];
  for(const block of value.slice(0,TEXT_LIMIT).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n[\t ]*\n/)) {
    const lines=block.trim().split('\n');
    if(/^(?:NOTE(?:\s|$)|STYLE$|REGION$)/.test(lines[0]))continue;
    const cueIndex=lines.findIndex(line=>/-->/.test(line));
    if(cueIndex<0)continue;
    const cue=/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[cueIndex].trim());
    if(!cue)continue;
    const startSeconds=seconds(cue[1]),endSeconds=seconds(cue[2]);
    const caption=lines.slice(cueIndex+1).join('\n').replace(/<[^>]*>/g,'').trim();
    if(startSeconds===null || endSeconds===null || endSeconds<startSeconds || !caption || caption.length>10000)continue;
    segments.push({startSeconds,durationSeconds:endSeconds-startSeconds,text:caption});
  }
  return segments;
}
function inlineSubtitles(raw) {
  const tracks = list(raw.subtitles);
  const selected = tracks.find(t=>t?.language==='en' && (t.plaintext || t.srt || t.vtt || t.text)) || tracks.find(t=>t && (t.plaintext || t.srt || t.vtt || t.text));
  const original=selected ? selected.plaintext || selected.srt || selected.vtt || selected.text : '';
  const transcriptSegments=timedSubtitleSegments(selected?.srt || selected?.vtt || selected?.text || '');
  return {content:text(original).split('\n').filter(line=>!/^\s*\d+\s*$/.test(line) && !/-->/.test(line) && !/^WEBVTT/.test(line)).join('\n').replace(/<[^>]*>/g,'').trim(),clipped:typeof original==='string' && original.length>TEXT_LIMIT,...(transcriptSegments.length?{transcriptSegments}:{})};
}
function sameSource(source, raw) {
  if (source.platform === 'X') return text(raw.author?.userName || raw.author?.username || raw.author?.screen_name).toLowerCase() === source.key.split('/')[1];
  if (source.platform === 'Instagram') return text(raw.ownerUsername).toLowerCase() === source.key.split('/')[1];
  const expectedId=source.channelId || [source.url,...source.aliases].map(url=>new URL(url).pathname).find(path=>/^\/channel\/UC[A-Za-z0-9_-]{22}\/?$/.test(path))?.split('/')[2];
  if (expectedId && raw.channelId && expectedId !== raw.channelId) return false;
  if (expectedId && raw.channelId === expectedId) return true;
  const anchors = new Set([source.url,...source.aliases].map(url=>sourceKey(url,'YouTube')));
  if (raw.channelUrl) {try {return anchors.has(sourceKey(raw.channelUrl,'YouTube'));} catch {return false;}}
  for (const url of [raw.channelUrl,raw.inputChannelUrl,raw.fromYTUrl,raw.input]) {
    try { if (anchors.has(sourceKey(url,'YouTube'))) return true; } catch { /* A video URL is not a channel anchor. */ }
  }
  return false;
}
export function normalizeItem(source, raw, input) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {reason:'provider_error'};
  if (raw.demo===true) return {reason:'provider_demo_data'};
  if (raw.error) {
    if(source.platform==='YouTube' && Object.hasOwn(EMPTY_FORMAT_DIAGNOSTICS,raw.error))return {reason:'empty_format',diagnosticCode:raw.error,emptyFormat:EMPTY_FORMAT_DIAGNOSTICS[raw.error]};
    if(source.platform==='YouTube' && raw.error==='DATE_FILTER_TOO_STRICT')return {reason:'no_items_reported',diagnosticCode:raw.error};
    if(source.platform==='Instagram' && raw.error==='no_items') {
      const targets=[raw.inputUrl,raw.url].filter(value=>value!==undefined);
      try {
        const anchors=new Set([source.url,...source.aliases].map(url=>sourceKey(url,'Instagram')));
        if(!targets.length || !targets.every(url=>anchors.has(sourceKey(url,'Instagram'))))return {reason:'provider_error'};
      } catch {return {reason:'provider_error'};}
      if(raw.requestErrorMessages!==undefined && (!Array.isArray(raw.requestErrorMessages) || raw.requestErrorMessages.length>10000 || raw.requestErrorMessages.some(message=>typeof message!=='string')))return {reason:'provider_error'};
      return {reason:'no_items_reported',requestErrorCount:list(raw.requestErrorMessages).filter(message=>message.trim()).length};
    }
    return {reason:'provider_error'};
  }
  if (!sameSource(source,raw)) return {reason:'unattributed'};
  const parsedDate = Date.parse(raw.date || raw.timestamp || raw.createdAt || '');
  if (!Number.isFinite(parsedDate)) return {reason:'missing_date'};
  const publishedAt = new Date(parsedDate).toISOString();
  if (parsedDate < Date.parse(input.dateFrom) || parsedDate > Date.parse(input.dateTo)) return {reason:'outside_window',publishedAt};
  const originalUrl = publicUrl(raw.url || raw.twitterUrl);
  if (!originalUrl) return {reason:'invalid_original_url'};
  const u = new URL(originalUrl), host = u.hostname.replace(/^www\./,'');
  let url;
  if (source.platform === 'YouTube') {
    const videoId = host==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v') || (/^\/(shorts|live)\//.test(u.pathname)?u.pathname.split('/')[2]:null);
    if (!['youtube.com','youtu.be'].includes(host) || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId || '')) return {reason:'invalid_original_url'};
    url = 'https://www.youtube.com/watch?v='+videoId;
  } else if (source.platform === 'X') {
    if (!['x.com','twitter.com'].includes(host) || !/^\/[A-Za-z0-9_]+\/status\/\d+$/.test(u.pathname)) return {reason:'invalid_original_url'};
    if (u.pathname.split('/')[1].toLowerCase() !== source.key.split('/')[1]) return {reason:'unattributed'};
    url = 'https://x.com'+u.pathname;
  } else {
    if (host !== 'instagram.com' || !/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return {reason:'invalid_original_url'};
    url = 'https://www.instagram.com'+u.pathname.replace(/\/$/,'')+'/';
  }
  const subtitleData = source.platform==='YouTube' ? inlineSubtitles(raw) : {content:'',clipped:false};
  const subtitles=subtitleData.content;
  const originalPostText=source.platform==='X'?raw.text:source.platform==='Instagram'?raw.caption:'';
  const postText = text(originalPostText);
  const description = source.platform==='YouTube' ? text(raw.text) : '';
  const content = subtitles || postText || description;
  const contentClipped=subtitles?subtitleData.clipped:postText?typeof originalPostText==='string' && originalPostText.length>TEXT_LIMIT:typeof raw.text==='string' && raw.text.length>TEXT_LIMIT;
  const contentKind = subtitles ? 'transcript' : postText ? 'feed_text' : 'metadata_only';
  const coverage = (subtitles ? 'Existing YouTube subtitles; no generated transcription or AI analysis.' : source.platform==='YouTube' ? 'Video metadata and description only; spoken content not collected.' : postText ? 'Public post/caption text; linked articles, image text and media audio not collected.' : 'Post metadata only; no usable post text returned.')+(contentClipped?' Source text was clipped at 200,000 characters; the remaining text is not included.':'');
  const references = [{title:'Original update',url}];
  for (const link of list(raw.descriptionLinks)) { const safe=publicUrl(link?.url); if(safe && references.length<21 && !references.some(r=>r.url===safe)) references.push({title:text(link.text,160)||'Creator-linked reference',url:safe}); }
  const title = text(raw.title,500) || (postText ? postText.slice(0,120) : 'Update from '+source.name);
  const image = publicUrl(raw.thumbnailUrl || raw.displayUrl || raw.extendedEntities?.media?.[0]?.media_url_https);
  const sourceAvatarUrl=source.platform==='YouTube' && typeof raw.channelAvatarUrl==='string' && raw.channelAvatarUrl.length<=2000?publicUrl(raw.channelAvatarUrl):'';
  const isShort=source.platform==='YouTube'?(raw.type==='shorts' || /^\/shorts\//.test(u.pathname)?true:['video','stream'].includes(raw.type)?false:undefined):undefined;
  return {update:{id:'tech-'+digest(url).slice(0,24),sourceId:source.id,contributorIds:[],title,summary:content.slice(0,700) || 'No usable content text returned; open the original update.',url,publishedAt,format:source.platform==='YouTube'?'video':'post',topics:[],brands:[],sponsors:[],references,insights:[],...(image?{image}:{}),...(typeof raw.duration==='string'?{duration:text(raw.duration,30)}:{}),...(typeof isShort==='boolean'?{isShort}:{}),...(subtitleData.transcriptSegments?{transcriptSegments:subtitleData.transcriptSegments}:{}),isSample:false,coverage,...(content?{content}:{}),contentKind},format:source.platform==='YouTube'?(raw.type || 'unknown'):'post',contentClipped,...(sourceAvatarUrl?{sourceAvatarUrl}:{})};
}
export function sourceCoverage(source, entry, rawItems, input, datasetTruncated = false) {
  const rejected = {}, updates = [], seen = new Set(), dates = [], formats = {}, diagnosticCodes={}, emptyFormats=new Set();let clippedItems=0,resultRows=0,sourceAvatarUrl='';
  for (const raw of rawItems) {
    const result = normalizeItem(source,raw,input);
    if(result.diagnosticCode)diagnosticCodes[result.diagnosticCode]=(diagnosticCodes[result.diagnosticCode] || 0)+1;
    if(result.emptyFormat)emptyFormats.add(result.emptyFormat);
    if(result.requestErrorCount)rejected.provider_request_error=(rejected.provider_request_error || 0)+1;
    if(!['empty_format','no_items_reported','provider_demo_data','provider_error'].includes(result.reason))resultRows++;
    if (result.publishedAt) dates.push(result.publishedAt);
    if (!result.update) { rejected[result.reason]=(rejected[result.reason] || 0)+1; continue; }
    dates.push(result.update.publishedAt); formats[result.format]=(formats[result.format] || 0)+1;
    if (seen.has(result.update.id)) {rejected.duplicate=(rejected.duplicate || 0)+1;continue;}
    if (updates.length >= entry.maxItems) {rejected.source_cap=(rejected.source_cap || 0)+1;continue;}
    seen.add(result.update.id); updates.push(result.update);if(result.contentClipped)clippedItems++;if(!sourceAvatarUrl && result.sourceAvatarUrl)sourceAvatarUrl=result.sourceAvatarUrl;
  }
  const capped = datasetTruncated || resultRows>=entry.maxItems || Object.entries(entry.formatLimits || {}).some(([format,limit])=>limit>0 && (formats[format] || 0)>=limit);
  const demoOnly=rawItems.length>0 && rejected.provider_demo_data===rawItems.length;
  const failed = entry.status !== 'SUCCEEDED' || !!rejected.provider_error || !!rejected.provider_request_error || !!rejected.provider_demo_data;
  const reportedEmpty=!!rejected.empty_format || !!rejected.no_items_reported;
  const earliestReached = dates.length ? dates.sort()[0] : null;
  const status=demoOnly?'provider_demo_only':failed?'failed_or_partial':capped?'capped':updates.length?'collected_unverified_completeness':reportedEmpty?'no_items_reported':'no_results_unverified';
  return {updates,coverage:{sourceId:source.id,sourceUrl:source.url,platform:source.platform,...(sourceAvatarUrl?{sourceAvatarUrl}:{}),status,providerStatus:entry.status,returnedItems:rawItems.length,acceptedItems:updates.length,earliestReached,dateFrom:input.dateFrom,dateTo:input.dateTo,dateCutoffReached:earliestReached ? earliestReached<=input.dateFrom : null,complete:false,capped,datasetTruncated,formatLimits:entry.formatLimits,formatsSeen:formats,rejected,diagnosticCodes,emptyFormats:[...emptyFormats],transcriptItems:updates.filter(u=>u.contentKind==='transcript').length,postTextItems:updates.filter(u=>u.contentKind==='feed_text').length,metadataOnlyItems:updates.filter(u=>u.contentKind==='metadata_only').length,clippedItems,providerRunId:entry.providerRunId,actor:entry.actor,buildId:entry.buildId,observedCostUsd:entry.observedCostUsd,costObservedAt:entry.costObservedAt ?? null,costStatus:entry.costStatus,notes:['Provider success alone does not prove complete 30-day history.','No AI analysis, generated transcription, comments or audience analysis.',...(rejected.provider_demo_data?[`${rejected.provider_demo_data} supplier demo rows were excluded; they are not real source content.`]:[]),...(reportedEmpty?['The supplier reported empty formats or no items; this is not proof of exhaustive history.']:[]),...(source.platform==='Instagram' && rejected.no_items_reported?['The Instagram supplier reported empty or private data; quiet and inaccessible accounts cannot be distinguished from this response.']:[]),...(rejected.provider_request_error?[`${rejected.provider_request_error} no-item records also contained request errors; failure evidence is retained.`]:[]),...(clippedItems?[`${clippedItems} items contain source text clipped at 200,000 characters; entire transcripts or post bodies are not established.`]:[])]}};
}
export async function runCollector(raw, deps) {
  const input=validateInput(raw,deps.now?.() ?? Date.now());
  const fingerprint=digest(input), plan=plannedBudget(input), parent=await deps.parentRun();
  if (!parent?.id || !Number.isInteger(parent.options?.memoryMbytes) || parent.options.memoryMbytes<128 || parent.options.memoryMbytes>256 || !Number.isFinite(parent.options?.timeoutSecs) || parent.options.timeoutSecs<=0 || parent.options.timeoutSecs>3600 || typeof parent.options.maxTotalChargeUsd!=='number' || !Number.isFinite(parent.options.maxTotalChargeUsd) || parent.options.maxTotalChargeUsd<=0 || parent.options.maxTotalChargeUsd>input.parentMaxChargeUsd) throw fault('parent_resource_cap_required');
  let state=await deps.load();
  if (state && (state.inputFingerprint!==fingerprint || state.parentRunId!==parent.id)) throw fault('checkpoint_identity_mismatch');
  state ||= {version:1,parentRunId:parent.id,inputFingerprint:fingerprint,budgetReservationId:input.budgetReservationId,maxTotalChargeUsd:input.maxTotalChargeUsd,parentMaxChargeUsd:input.parentMaxChargeUsd,entries:{},skipped:{},publication:'pending',startedAt:new Date(deps.now?.() ?? Date.now()).toISOString()};
  if(committedUsd(state)>input.maxTotalChargeUsd+0.0000001)throw fault('checkpoint_full_caps_exceed_budget');
  state.budgetPolicy='hold_submitted_full_caps';state.plannedFullCapUsd=plan.plannedFullCapUsd;
  await deps.save(state);
  if (input.executionEnabled) {
    for (const source of input.sources) {
      let entry=state.entries[source.id];
      if (entry?.coverage) continue;
      if (entry?.rejectedBuild) {state.skipped[source.id]='provider_build_mismatch';continue;}
      if (entry?.status==='submitting' && !entry.providerRunId) { state.skipped[source.id]='ambiguous_start_requires_operator_reconciliation';continue; }
      if (!entry) {
        const total=Object.values(state.entries).reduce((n,e)=>n+e.updates.length,0);
        const request=childRequest(source,input,input.maxItemsTotal-total);
        if (!request) {state.skipped[source.id]='total_item_cap';continue;}
        try {await deps.preflight(source.platform,request);} catch {state.skipped[source.id]='provider_review_changed';await deps.save(state);continue;}
        if (!reserve(state,source,request)) {state.skipped[source.id]='aggregate_budget_cap';continue;}
        await deps.save(state); // Durable reservation precedes the non-idempotent external POST.
        entry=state.entries[source.id];
        let started;
        try { started=await deps.start(request); } catch {state.skipped[source.id]='ambiguous_start_requires_operator_reconciliation';await deps.save(state);continue;}
        if (!started?.id) {state.skipped[source.id]='ambiguous_start_requires_operator_reconciliation';await deps.save(state);continue;}
        entry.providerRunId=started.id;entry.status=started.status;entry.datasetId=started.defaultDatasetId || null;
        await deps.save(state);
        if (started.buildId!==request.buildId) {entry.rejectedBuild=true;entry.actualBuildId=started.buildId || null;await deps.save(state);await deps.abort(started.id);state.skipped[source.id]='provider_build_mismatch';entry.status='ABORTED';await deps.save(state);continue;}
      }
      let run;
      try { run=await deps.wait(entry.providerRunId); } catch {state.skipped[source.id]='provider_status_unavailable';await deps.save(state);continue;}
      entry.status=run.status;entry.datasetId=run.defaultDatasetId || entry.datasetId;entry.observedCostUsd=observedCharge(run);entry.costStatus=entry.observedCostUsd===null?'unreported':'provider_reported';
      entry.costObservedAt=entry.observedCostUsd===null?null:new Date(deps.now?.() ?? Date.now()).toISOString();
      if (entry.observedCostUsd!==null && entry.observedCostUsd>entry.reservedUsd+0.000001) {await deps.save(state);throw fault('provider_budget_exceeded');}
      if (!TERMINAL.has(run.status)) {state.skipped[source.id]='provider_still_running';await deps.save(state);continue;}
      let dataset;
      try {dataset=entry.datasetId ? await deps.items(entry.datasetId,entry.maxItems+1) : {items:[],total:0};} catch {state.skipped[source.id]='provider_dataset_unavailable';await deps.save(state);continue;}
      const normalized=sourceCoverage(source,entry,dataset.items,input,dataset.total>dataset.items.length);
      entry.updates=normalized.updates;entry.coverage=normalized.coverage;delete state.skipped[source.id];await deps.save(state);
    }
  }
  const coverage=input.sources.map(source=>state.entries[source.id]?.coverage || {sourceId:source.id,sourceUrl:source.url,platform:source.platform,status:input.executionEnabled?(state.skipped[source.id] || 'not_attempted'):'execution_disabled',complete:false,earliestReached:null,dateCutoffReached:null,providerRunId:state.entries[source.id]?.providerRunId || null,observedCostUsd:state.entries[source.id]?.observedCostUsd ?? null,costObservedAt:state.entries[source.id]?.costObservedAt ?? null});
  const updates=Object.values(state.entries).flatMap(entry=>entry.updates).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
  const parentObservedCostUsd=observedCharge(await deps.parentRun());
  const budgetSkippedSourceIds=input.sources.filter(source=>state.skipped[source.id]==='aggregate_budget_cap').map(source=>source.id);
  const manifest={
    version:1,parentRunId:parent.id,budgetReservationId:input.budgetReservationId,executionEnabled:input.executionEnabled,dateFrom:input.dateFrom,dateTo:input.dateTo,sourceCount:input.sources.length,updateCount:updates.length,
    maxTotalChargeUsd:input.maxTotalChargeUsd,parentReservedUsd:input.parentMaxChargeUsd,budgetPolicy:state.budgetPolicy,...plan,
    partialBudgetRun:!plan.allSourceCapsFitBudget || budgetSkippedSourceIds.length>0,budgetSkippedSourceIds,
    parentObservedCostUsd,parentCostObservedAt:parentObservedCostUsd===null?null:new Date(deps.now?.() ?? Date.now()).toISOString(),
    committedUsd:committedUsd(state),observedChildCostUsd:cents(Object.values(state.entries).reduce((n,e)=>n+(e.observedCostUsd ?? 0),0)),unknownCostRuns:Object.values(state.entries).filter(e=>e.observedCostUsd===null).length,
    observedCostsAreFinal:false,costObservationNotice:'Reported fees are point-in-time observations and may rise after terminal status; full child caps remain reserved.',
    complete:false,pricingCheckedAt:Object.fromEntries(Object.entries(REVIEWED).map(([p,v])=>[p,v.checkedAt])),providerRuns:Object.values(state.entries).map(({updates,coverage,...entry})=>entry),datasetPublication:state.publication
  };
  const output={manifest,coverage,updates};
  const resultFingerprint=digest({updates,coverage});
  if (state.publication==='published' && state.resultFingerprint!==resultFingerprint) output.manifest.datasetPublication='stale_use_output';
  await deps.output(output); // Canonical KVS OUTPUT is authoritative even if dataset publication is interrupted.
  if (state.publication==='pending') {
    state.publication='publishing';state.resultFingerprint=resultFingerprint;await deps.save(state);
    await deps.publish([...updates.map(update=>({recordType:'source-update',...update})),...coverage.map(c=>({recordType:'coverage',...c})),{recordType:'manifest',...manifest}]);
    state.publication='published';await deps.save(state);output.manifest.datasetPublication='published';await deps.output(output);
  } else if (state.publication==='publishing') { output.manifest.datasetPublication='uncertain_use_output';await deps.output(output); }
  return output;
}
