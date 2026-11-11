// SQL text only. Nothing in this module connects, reads credentials, or executes SQL.
// Logical definitions exclude planner/vacuum statistics. Runtime identities are
// checked separately so even a same-definition drop/recreate is refused.
export const catalogueSql = String.raw`
create function pg_temp.reader_role(p_role oid) returns text language sql stable as $$
 select case when p_role=0 then 'PUBLIC' when p_role=current_user::regrole then '@owner' else p_role::regrole::text end
$$;
create function pg_temp.reader_acl(p_acl aclitem[],p_owner oid,p_kind "char") returns jsonb language sql stable as $$
 select coalesce(jsonb_agg(jsonb_build_array(pg_temp.reader_role(grantor),pg_temp.reader_role(grantee),privilege_type,is_grantable)
 order by pg_temp.reader_role(grantor)collate "C",pg_temp.reader_role(grantee)collate "C",privilege_type collate "C",is_grantable),'[]')
 from aclexplode(coalesce(p_acl,acldefault(p_kind,p_owner)))
$$;
create function pg_temp.reader_catalogue() returns table(key text,doc jsonb,identity text) language sql stable as $$
 with ns as(select * from pg_namespace where nspname in('public','recap_internal','supabase_migrations')),
 rel as(select c.*,n.nspname from pg_class c join ns n on n.oid=c.relnamespace),
 fn as(select p.*,n.nspname from pg_proc p join ns n on n.oid=p.pronamespace)
 select 'schema:'||nspname,jsonb_build_object('owner',pg_temp.reader_role(nspowner),'acl',pg_temp.reader_acl(nspacl,nspowner,'n'),'comment',obj_description(oid,'pg_namespace')),oid::text from ns
 union all select 'relation:'||nspname||'.'||relname,jsonb_build_object(
 'kind',relkind,'owner',pg_temp.reader_role(relowner),'acl',pg_temp.reader_acl(relacl,relowner,case when relkind='S' then 's'::"char" else 'r'::"char" end),
 'rls',relrowsecurity,'forceRls',relforcerowsecurity,'persistence',relpersistence,'replicaIdentity',relreplident,
 'options',reloptions,'tablespace',(select spcname from pg_tablespace where oid=reltablespace),
 'accessMethod',(select amname from pg_am where oid=relam),'comment',obj_description(oid,'pg_class'),
 'view',case when relkind in('v','m')then pg_get_viewdef(oid,true)end),oid::text from rel
 union all select 'column:'||r.nspname||'.'||r.relname||'.'||a.attname,jsonb_build_object(
 'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'dropped',a.attisdropped,
 'identity',a.attidentity,'generated',a.attgenerated,'storage',a.attstorage,'compression',a.attcompression,
 'collation',case when a.attcollation<>0 then a.attcollation::regcollation::text end,
 'options',a.attoptions,'fdwOptions',a.attfdwoptions,'acl',case when a.attacl is not null then pg_temp.reader_acl(a.attacl,r.relowner,'c')end,
 'default',pg_get_expr(d.adbin,d.adrelid),'comment',col_description(a.attrelid,a.attnum)),r.oid::text||':'||a.attnum
 from rel r join pg_attribute a on a.attrelid=r.oid and a.attnum>0 left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 union all select 'constraint:'||n.nspname||'.'||coalesce(r.relname,t.typname)||'.'||c.conname,jsonb_build_object(
 'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated,'deferrable',c.condeferrable,'deferred',c.condeferred,
 'local',c.conislocal,'inherited',c.coninhcount,'noInherit',c.connoinherit,'comment',obj_description(c.oid,'pg_constraint')),c.oid::text
 from pg_constraint c join ns n on n.oid=c.connamespace left join pg_class r on r.oid=c.conrelid left join pg_type t on t.oid=c.contypid
 union all select 'index:'||r.nspname||'.'||r.relname,jsonb_build_object(
 'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'clustered',i.indisclustered,'replicaIdentity',i.indisreplident),i.indexrelid::text
 from pg_index i join rel r on r.oid=i.indexrelid
 union all select 'trigger:'||r.nspname||'.'||r.relname||'.'||case when t.tgisinternal then
  'internal:'||coalesce(c.conname::text,'')||':'||t.tgfoid::regprocedure::text||':'||t.tgtype else t.tgname::text end,jsonb_build_object(
 'definition',case when t.tgisinternal then replace(pg_get_triggerdef(t.oid),quote_ident(t.tgname),'__internal_constraint_trigger__')else pg_get_triggerdef(t.oid)end,
 'enabled',t.tgenabled,'internal',t.tgisinternal,'parent',t.tgparentid<>0,'comment',obj_description(t.oid,'pg_trigger')),t.oid::text
 from pg_trigger t join rel r on r.oid=t.tgrelid left join pg_constraint c on c.oid=t.tgconstraint
 union all select 'policy:'||r.nspname||'.'||r.relname||'.'||p.polname,jsonb_build_object(
 'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(pg_temp.reader_role(role)order by pg_temp.reader_role(role)collate "C")from unnest(p.polroles)role),
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid),'comment',obj_description(p.oid,'pg_policy')),p.oid::text
 from pg_policy p join rel r on r.oid=p.polrelid
 union all select 'definition:'||oid::regprocedure::text,case when prokind='a' then (select to_jsonb(a)from pg_aggregate a where a.aggfnoid=fn.oid)else to_jsonb(pg_get_functiondef(oid))end,oid::text from fn
 union all select 'function:'||oid::regprocedure::text,jsonb_build_object(
 'owner',pg_temp.reader_role(proowner),'acl',pg_temp.reader_acl(proacl,proowner,'f'),'language',(select lanname from pg_language where oid=prolang),
 'kind',prokind,'definer',prosecdef,'strict',proisstrict,'leakproof',proleakproof,'volatility',provolatile,'parallel',proparallel,
 'cost',procost,'rows',prorows,'support',prosupport::regproc::text,'config',proconfig,'argumentNames',proargnames,'argumentModes',proargmodes,
 'defaults',pg_get_expr(proargdefaults,0),'comment',obj_description(oid,'pg_proc')),oid::text from fn
 union all select 'defaultAcl:'||pg_temp.reader_role(d.defaclrole)||':'||coalesce(n.nspname,'*')||':'||d.defaclobjtype::text,
 pg_temp.reader_acl(d.defaclacl,d.defaclrole,d.defaclobjtype),d.oid::text from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
 union all select 'type:'||n.nspname||'.'||t.typname,jsonb_build_object('kind',t.typtype,'owner',pg_temp.reader_role(t.typowner),
 'acl',pg_temp.reader_acl(t.typacl,t.typowner,'T'),'notNull',t.typnotnull,'baseType',format_type(t.typbasetype,t.typtypmod),
 'default',t.typdefault,'relation',case when t.typrelid<>0 then t.typrelid::regclass::text end,
 'element',case when t.typelem<>0 then format_type(t.typelem,null)end,
 'enum',(select jsonb_agg(enumlabel order by enumsortorder)from pg_enum where enumtypid=t.oid),
 'comment',obj_description(t.oid,'pg_type')),t.oid::text from pg_type t join ns n on n.oid=t.typnamespace
 union all select 'rule:'||r.nspname||'.'||r.relname||'.'||w.rulename,jsonb_build_object(
 'definition',pg_get_ruledef(w.oid),'enabled',w.ev_enabled,'comment',obj_description(w.oid,'pg_rewrite')),w.oid::text
 from pg_rewrite w join rel r on r.oid=w.ev_class
 union all select 'sequence:'||s.schemaname||'.'||s.sequencename,to_jsonb(s)-array['schemaname','sequencename','sequenceowner'],('"'||s.schemaname||'"."'||s.sequencename||'"')::regclass::oid::text
 from pg_sequences s where s.schemaname in('public','recap_internal','supabase_migrations')
$$;
create function pg_temp.reader_rows(p_strip_added_column boolean default false)
 returns table(key text,row_count bigint,row_sha256 text)language plpgsql as $$
declare r record;projection text;total_rows bigint:=0;begin
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','recap_internal')and c.relkind in('r','p','m')order by n.nspname,c.relname loop
  key:=r.nspname||'.'||r.relname;
  projection:=case when p_strip_added_column and key='public.reader_content_analysis_calls' then 'to_jsonb(r)-''erased_job_id'''else 'to_jsonb(r)'end;
  execute format('select count(*)from %I.%I',r.nspname,r.relname)into row_count;
  total_rows:=total_rows+row_count;
  if total_rows>1000000 then raise exception 'Reader plan row bound exceeded';end if;
  execute format('select encode(sha256(convert_to(coalesce(string_agg(h,'''' order by h),''''),''UTF8'')),''hex'')from(select encode(sha256(convert_to((%s)::text,''UTF8'')),''hex'')h from %I.%I r)s',projection,r.nspname,r.relname)into row_sha256;
  return next;
 end loop;
end;$$;
create function pg_temp.reader_capture()returns jsonb language sql volatile as $$
 select jsonb_build_object(
 'objectsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_array(key,doc,identity)order by key collate "C"),'[]')::text,'UTF8')),'hex')from pg_temp.reader_catalogue()),
 'rowsSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r)order by key collate "C"),'[]')::text,'UTF8')),'hex')from pg_temp.reader_rows()r),
 'historySha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(h)order by version),'[]')::text,'UTF8')),'hex')from supabase_migrations.schema_migrations h))
$$;
`;

export const cleanupSql = String.raw`
drop function pg_temp.reader_capture();
drop function pg_temp.reader_rows(boolean);
drop function pg_temp.reader_catalogue();
drop function pg_temp.reader_acl(aclitem[],oid,"char");
drop function pg_temp.reader_role(oid);
`;
