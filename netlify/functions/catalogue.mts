import type {Config} from '@netlify/functions';
import type {CatalogueCreator} from '../../src/lib/admin-types';
import {database} from './_shared/admin-data';
import {canonicalOrigin,escapeHtml,renderCreator,renderDirectory,renderMissing} from './_shared/catalogue-pages';
import {runtimeEnv} from './_shared/security';
export default async(request:Request):Promise<Response>=>{
 const url=new URL(request.url),origin=canonicalOrigin(runtimeEnv('APP_URL'));
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD','x-robots-tag':'noindex'}});
 const bodyResponse=(body:string,status=200,type='text/html; charset=utf-8',index=true)=>new Response(request.method==='HEAD'?null:body,{status,headers:{'content-type':type,'cache-control':status===200?'public, max-age=0, s-maxage=300':'no-store','x-content-type-options':'nosniff','x-robots-tag':index?'index, follow':'noindex, follow','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY'}});
 if(url.pathname==='/robots.txt')return bodyResponse(`User-agent: *\nDisallow: /\nAllow: /creators\nAllow: /catalogue.css\nAllow: /fonts/\nAllow: /favicon.svg\nSitemap: ${origin}/sitemap.xml\n`,200,'text/plain; charset=utf-8');
 if(url.pathname==='/creators')return Response.redirect(origin+'/creators/'+url.search,301);
 try{
  const db=database(runtimeEnv,false);
  const {data,error}=await db.from('catalogue_creators').select('*,catalogue_channels!catalogue_channels_creator_id_fkey(*)').eq('is_listed',true).order('name').limit(1000);
  if(error||!data)throw new Error('Unavailable');
  const creators=data as CatalogueCreator[];
  if(url.pathname==='/sitemap.xml')return bodyResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(origin)}/creators/</loc></url>${creators.map(c=>`<url><loc>${escapeHtml(origin)}/creators/${escapeHtml(c.slug)}/</loc><lastmod>${escapeHtml(c.updated_at.slice(0,10))}</lastmod></url>`).join('')}</urlset>`,200,'application/xml; charset=utf-8');
  if(url.pathname==='/creators/')return bodyResponse(renderDirectory(creators,origin,url.searchParams),200,undefined,!url.searchParams.has('q')&&!url.searchParams.has('platform')&&!url.searchParams.has('topic'));
  if(!/^\/creators\/[a-z0-9][a-z0-9-]{0,119}\/?$/.test(url.pathname))return bodyResponse(renderMissing(origin),404,undefined,false);
  const slug=decodeURIComponent(url.pathname.split('/')[2]||'');
  const creator=creators.find(c=>c.slug===slug);
  if(!creator)return bodyResponse(renderMissing(origin),404,undefined,false);
  if(!url.pathname.endsWith('/'))return Response.redirect(origin+'/creators/'+creator.slug+'/',301);
  const related=creators.filter(c=>c.id!==creator.id&&c.topics.some(t=>creator.topics.includes(t))).slice(0,4);
  return bodyResponse(renderCreator(creator,related,origin,creators.filter(c=>c.id!==creator.id&&c.name.toLowerCase()===creator.name.toLowerCase())));
 }catch{return bodyResponse('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Catalogue temporarily unavailable | recap</title><main><h1>The creator directory is temporarily unavailable.</h1><p>Please try again shortly. Your saved workspace is separate.</p><a href="/">Open your workspace</a></main></html>',503,undefined,false);}
};
export const config:Config={path:['/creators','/creators/*','/robots.txt','/sitemap.xml'],rateLimit:{action:'rate_limit',aggregateBy:['domain','ip'],windowSize:60,windowLimit:120}};
