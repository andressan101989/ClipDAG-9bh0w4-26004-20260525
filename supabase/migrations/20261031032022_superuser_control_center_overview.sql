begin;

-- Bounded projection of facts absent from existing custom-date aggregate APIs.
-- Existing module authorities remain the detailed operational sources. No data writes.
create function public.get_admin_control_center_overview_v1(p_module text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
 v_from timestamptz; v_until timestamptz;
 v_metrics jsonb := '[]'::jsonb; v_series jsonb := '[]'::jsonb; v_recent jsonb := '[]'::jsonb;
begin
 perform public.admin_require_capability('admin.shell.access');
 if p_from is null or p_to is null or not pg_catalog.isfinite(p_from) or not pg_catalog.isfinite(p_to) or p_to < p_from or p_to - p_from > 89 then
 raise exception using errcode='22023',message='admin_overview_range_invalid';
 end if;
 v_from := p_from::timestamp at time zone 'UTC';
 v_until := (p_to + 1)::timestamp at time zone 'UTC';
 case p_module
when 'users' then
 perform public.admin_require_capability('users.accounts.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','users','label','Usuarios registrados en el periodo','value',(select count(*) from auth.users where created_at>=v_from and created_at<v_until and deleted_at is null),'unit','count','source','auth.users.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','active','label','Usuarios activos en el periodo','value',null,'unit','count','source','Sin autoridad canónica de actividad por intervalo','reason','last_sign_in_at solo conserva el último acceso; no acredita DAU/MAU ni historial de actividad.'),
 pg_catalog.jsonb_build_object('key','last_sign_in','label','Usuarios cuyo último inicio de sesión está en el periodo','value',(select count(*) from auth.users where last_sign_in_at>=v_from and last_sign_in_at<v_until and deleted_at is null),'unit','count','source','auth.users.last_sign_in_at','reason',null),
 pg_catalog.jsonb_build_object('key','creators','label','Creadores (directorio global)','value',null,'unit','count','source','Sin autoridad de directorio global','reason','Publicar contenido o vender Premium no acredita una cuenta de creador; consultar Creator Commerce para atribución comercial.')
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from auth.users where created_at>=v_from and created_at<v_until and deleted_at is null group by 1) bucket;
when 'content' then
 perform public.admin_require_capability('content.items.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','posts','label','Publicaciones (videos) creadas','value',(select count(*) from public.videos where created_at>=v_from and created_at<v_until),'unit','count','source','videos.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','safety','label','Alertas de seguridad abiertas del periodo','value',(select count(*) from private.content_safety_alerts where created_at>=v_from and created_at<v_until and status in ('open','in_review')),'unit','count','source','content_safety_alerts.status','reason',null),
 pg_catalog.jsonb_build_object('key','priority_safety','label','Alertas altas o críticas abiertas del periodo','value',(select count(*) from private.content_safety_alerts where created_at>=v_from and created_at<v_until and status in ('open','in_review') and severity in ('high','critical')),'unit','count','source','content_safety_alerts.status/severity','reason',null)
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from public.videos where created_at>=v_from and created_at<v_until group by 1) bucket;
when 'stories' then
 perform public.admin_require_capability('stories.items.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','stories','label','Stories creadas','value',(select count(*) from public.stories where created_at>=v_from and created_at<v_until),'unit','count','source','stories.created_at','reason',null)
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from public.stories where created_at>=v_from and created_at<v_until group by 1) bucket;
when 'live' then
 perform public.admin_require_capability('live.sessions.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','live','label','Sesiones LIVE iniciadas','value',(select count(*) from public.live_sessions where started_at>=v_from and started_at<v_until),'unit','count','source','live_sessions.started_at','reason',null)
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (started_at at time zone 'UTC')::date as day,count(*) value from public.live_sessions where started_at>=v_from and started_at<v_until group by 1) bucket;
when 'marketplace' then
 perform public.admin_require_capability('marketplace.overview.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','orders','label','Pedidos creados','value',(select count(*) from public.marketplace_orders where created_at>=v_from and created_at<v_until),'unit','count','source','marketplace_orders.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','sales','label','Ventas confirmadas (BDAG)','value',(select coalesce(sum(total),0) from public.marketplace_orders where confirmed_at>=v_from and confirmed_at<v_until and currency='BDAG'),'unit','BDAG','source','marketplace_orders.confirmed_at; bruto histórico, incluye posteriores reembolsos','reason',null),
 pg_catalog.jsonb_build_object('key','sellers','label','Solicitudes de vendedor creadas','value',(select count(*) from public.marketplace_sellers where created_at>=v_from and created_at<v_until),'unit','count','source','marketplace_sellers.created_at','reason',null)
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from public.marketplace_orders where created_at>=v_from and created_at<v_until group by 1) bucket;
when 'finance' then
 perform public.admin_require_capability('finance.ledger.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','transactions','label','Transacciones financieras creadas','value',(select count(*) from public.financial_transactions where created_at>=v_from and created_at<v_until),'unit','count','source','financial_transactions.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','income','label','Ingresos netos del periodo personalizado','value',null,'unit','BDAG','source','get_admin_platform_revenue','reason','La autoridad de ingresos admite hoy/mes/año/histórico; abrir Finanzas para ingresos reconocidos y reconciliación.'),
 pg_catalog.jsonb_build_object('key','gifts','label','Regalos LIVE enviados','value',(select count(*) from public.live_gift_transactions where created_at>=v_from and created_at<v_until),'unit','count','source','live_gift_transactions.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','gift_fees','label','Comisión bruta de regalos LIVE','value',(select coalesce(sum(platform_fee_coins),0) from public.live_gift_transactions where created_at>=v_from and created_at<v_until),'unit','BDAG','source','live_gift_transactions.platform_fee_coins; BDAG interno','reason',null)
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from public.financial_transactions where created_at>=v_from and created_at<v_until group by 1) bucket;
when 'premium' then
 perform public.admin_require_capability('finance.ledger.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','purchases','label','Recibos de compra Premium creados','value',(select count(*) from private.creator_premium_purchase_receipts where created_at>=v_from and created_at<v_until),'unit','count','source','creator_premium_purchase_receipts.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','periods','label','Periodos Premium del periodo','value',(select count(*) from private.creator_premium_subscription_periods where created_at>=v_from and created_at<v_until),'unit','count','source','creator_premium_subscription_periods.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','commission','label','Comisión Premium bruta verificada','value',(select case when bool_and(verified) or count(*)=0 then coalesce(sum(platform_fee_bdag),0) else null end from (select platform_fee_bdag,private.creator_premium_purchase_binding_is_valid_v1(id) verified from private.creator_premium_purchase_receipts where created_at>=v_from and created_at<v_until union all select platform_fee_bdag,private.creator_premium_subscription_period_fact_is_valid_f2_v1(id) verified from private.creator_premium_subscription_periods where created_at>=v_from and created_at<v_until) facts),'unit','BDAG','source','Snapshots Premium y verificadores canónicos; bruto, no neto de reembolsos','reason','Si es No disponible, existe una factura que no supera la verificación canónica.')
 ) into v_metrics;

when 'ads' then
 perform public.admin_require_capability('advertising.ads.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','campaigns','label','Campañas creadas','value',(select count(*) from private.advertising_campaigns where created_at>=v_from and created_at<v_until),'unit','count','source','advertising_campaigns.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','active_campaigns','label','Campañas del periodo actualmente activas','value',(select count(*) from private.advertising_campaigns where created_at>=v_from and created_at<v_until and status='active'),'unit','count','source','advertising_campaigns.status','reason',null),
 pg_catalog.jsonb_build_object('key','businesses','label','Business Accounts creadas','value',(select count(*) from private.business_accounts where created_at>=v_from and created_at<v_until),'unit','count','source','business_accounts.created_at','reason',null),
 pg_catalog.jsonb_build_object('key','spend','label','Ads gasto reconocido','value',case when public.admin_actor_has_capability('advertising.billing.read') then (select coalesce(sum(amount_bdag),0) from private.advertising_financial_events where created_at>=v_from and created_at<v_until and event_type='spend') else null end,'unit','BDAG','source','advertising_financial_events.spend; solo con advertising.billing.read','reason','Sin advertising.billing.read el gasto no está disponible')
 ) into v_metrics;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('day',bucket.day,'value',bucket.value) order by bucket.day),'[]'::jsonb) into v_series from (select (created_at at time zone 'UTC')::date as day,count(*) value from private.advertising_campaigns where created_at>=v_from and created_at<v_until group by 1) bucket;
when 'reports' then
 perform public.admin_require_capability('reports.cases.read');

 select pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('key','reports','label','Reportes pendientes creados en el periodo','value',(select count(*) from public.reports where created_at>=v_from and created_at<v_until and status='pending'),'unit','count','source','reports.status','reason',null)
 ) into v_metrics;

when 'activity' then
 perform public.admin_require_capability('admin.audit.read');
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at',a.created_at,'action',a.action,'domain',a.domain) order by a.created_at desc,a.id desc),'[]'::jsonb) into v_recent from (select created_at,id,action,domain from private.admin_action_audit where created_at>=v_from and created_at<v_until and private.admin_audit_row_visible(domain,financial_effect) order by created_at desc,id desc limit 8) a;
 select pg_catalog.jsonb_build_array(

 ) into v_metrics;

 else raise exception using errcode='22023',message='admin_overview_module_invalid';
 end case;
 return pg_catalog.jsonb_build_object('authority','admin_control_center_v1','module',p_module,'from',p_from,'to',p_to,'timezone','UTC','metrics',v_metrics,'series',v_series,'recent',v_recent);
end;
$$;
alter function public.get_admin_control_center_overview_v1(text,date,date) owner to postgres;
revoke all on function public.get_admin_control_center_overview_v1(text,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_control_center_overview_v1(text,date,date) to authenticated;
comment on function public.get_admin_control_center_overview_v1(text,date,date) is 'Read-only capability-gated aggregate cohorts; inclusive UTC dates, maximum 90 days, no identities or full datasets. Snapshot metrics explicitly label their semantics.';

-- Extend the existing review authority. The old signature is replaced, keeping
-- named/default two-argument callers compatible and removing RPC overload ambiguity.
drop function public.search_admin_advertising_ads(text,integer);
create or replace function public.search_admin_advertising_ads(
  p_review_status text default null,
  p_limit integer default 50,
  p_cursor_submitted_at timestamptz default null,
  p_cursor_id uuid default null,
  p_ad_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  if p_review_status is not null
    and p_review_status not in ('not_submitted', 'pending', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'advertising_ad_review_status_invalid';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_cursor_submitted_at is not null and p_cursor_id is null) or (p_ad_id is not null and p_cursor_id is not null) then
    raise exception using errcode='22023',message='advertising_ad_review_cursor_invalid';
  end if;
  select coalesce((
    select pg_catalog.jsonb_agg(item.payload order by item.submitted_at asc nulls last, item.id)
    from (
      select ad.id, ad.submitted_at, pg_catalog.jsonb_build_object(
        'id', ad.id,
        'name', ad.name,
        'status', ad.status,
        'review_status', ad.review_status,
        'submission_fingerprint', ad.submission_fingerprint,
        'submitted_at', ad.submitted_at,
        'reviewed_at', ad.reviewed_at,
        'campaign', pg_catalog.jsonb_build_object(
          'id', campaign.id, 'name', campaign.name, 'objective', campaign.objective
        ),
        'ad_set', pg_catalog.jsonb_build_object('id', ad_set.id, 'name', ad_set.name),
        'business_account_id', business.id,
        'ad_account_id', account.id,
        'creative', pg_catalog.jsonb_build_object(
          'creative_id', creative.id,
          'creative_version_id', version.id,
          'version_number', version.version_number,
          'format', version.format,
          'media_asset_id', version.media_asset_id,
          'video_asset_id', version.video_asset_id,
          'primary_text', version.primary_text,
          'headline', version.headline,
          'description', version.description,
          'call_to_action', version.call_to_action,
          'media_status', coalesce(media.status, video.status),
          'media_mime_type', coalesce(media.mime_type, video.mime_type),
          'preview_url', case
            when version.format='image' and media.status='ready' and media.deleted_at is null
              and media.visibility='public'
              and media.public_url ~* '^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
              then media.public_url
            when version.format='video' and video.status='ready' and video.deleted_at is null
              and video.thumbnail_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
              then video.thumbnail_url
            else null
          end,
          'playback_url', case
            when version.format='video' and video.status='ready' and video.deleted_at is null
              and video.hls_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
              then video.hls_url
            else null
          end
        ),
        'destination', pg_catalog.jsonb_build_object(
          'id', destination.id,
          'destination_type', destination.destination_type,
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id
        ),
        'latest_decision', case when latest.event_type in ('approved', 'rejected') then
          pg_catalog.jsonb_build_object(
            'event_type', latest.event_type,
            'reason_code', latest.reason_code,
            'note', latest.note,
            'actor_user_id', latest.actor_user_id,
            'created_at', latest.created_at
          ) else null end
      ) payload
      from private.advertising_ads as ad
      join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
      join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
      join private.ad_accounts as account on account.id = campaign.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      join private.advertising_creative_versions as version on version.id = ad.creative_version_id
      join private.advertising_creatives as creative on creative.id = version.creative_id
      join private.advertising_destinations as destination on destination.id = ad.destination_id
      left join public.media_assets as media on media.id = version.media_asset_id
      left join public.video_assets as video on video.id = version.video_asset_id
      left join lateral (
        select event.* from private.advertising_ad_review_events as event
        where event.ad_id = ad.id
        order by event.created_at desc, event.id desc limit 1
      ) as latest on true
      where (p_review_status is null or ad.review_status = p_review_status)
        and (p_ad_id is null or ad.id = p_ad_id)
        and (p_cursor_id is null
          or (p_cursor_submitted_at is null and ad.submitted_at is null and ad.id > p_cursor_id)
          or (p_cursor_submitted_at is not null and (ad.submitted_at is null
            or (ad.submitted_at,ad.id) > (p_cursor_submitted_at,p_cursor_id))))
      order by ad.submitted_at asc nulls last, ad.id
      limit v_limit + 1
    ) as item
  ), '[]'::jsonb) into v_rows;
  v_count := pg_catalog.jsonb_array_length(v_rows);
  if v_count > v_limit then v_rows := v_rows - v_limit; end if;
  v_last := v_rows -> (pg_catalog.jsonb_array_length(v_rows)-1);
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_count > v_limit then pg_catalog.jsonb_build_object('submitted_at',v_last->'submitted_at','id',v_last->'id') else null end);
end;
$$;


alter function public.search_admin_advertising_ads(text,integer,timestamptz,uuid,uuid) owner to postgres;
revoke all on function public.search_admin_advertising_ads(text,integer,timestamptz,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_advertising_ads(text,integer,timestamptz,uuid,uuid) to authenticated;
comment on function public.search_admin_advertising_ads(text,integer,timestamptz,uuid,uuid) is 'Canonical review payload with bounded ascending submission/id keysets, NULLS LAST, lookahead and exact ad lookup for submission-fingerprint reconciliation.';
commit;
