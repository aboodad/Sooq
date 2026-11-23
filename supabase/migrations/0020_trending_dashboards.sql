-- =====================================================================
-- 0020 — واجهة الترندات + لوحات «نظرة عامة» المطوّرة للإدارة والتاجر
-- =====================================================================

create index if not exists activity_events_created_idx on public.activity_events(created_at desc);
create index if not exists search_queries_created_idx on public.search_queries(created_at desc);

-- ---------- الترندات (عامة، بيانات مجمّعة بلا أي معلومات شخصية ولا أسماء متاجر) ----------
-- النقاط: مشاهدة 1، مفضلة 3، سلة 4، شراء 8، مع تضاؤل زمني (الأحدث أعلى وزنًا)
create or replace function public.get_trending(p_days int default 7, p_category text default null, p_limit int default 24)
returns jsonb language sql stable security definer set search_path = '' as $$
  with params as (
    select least(greatest(coalesce(p_days, 7), 1), 30) as d, least(greatest(coalesce(p_limit, 24), 1), 48) as lim
  ), cat as (
    select c.id from public.categories c where c.slug = p_category
    union select c2.id from public.categories c2 join public.categories c on c2.parent_id = c.id where c.slug = p_category
  ), ev as (
    select e.product_id, e.event, e.created_at,
           case e.event when 'view' then 1 when 'wishlist' then 3 when 'cart' then 4 else 8 end as w
    from public.activity_events e, params
    where e.created_at >= now() - make_interval(days => params.d * 2)
  ), scored as (
    select ev.product_id,
      sum(ev.w * exp(-extract(epoch from now() - ev.created_at) / (3600.0 * 24 * (select d from params) / 2)))
        filter (where ev.created_at >= now() - make_interval(days => (select d from params))) as score,
      sum(ev.w) filter (where ev.created_at >= now() - make_interval(days => (select d from params))) as cur,
      sum(ev.w) filter (where ev.created_at < now() - make_interval(days => (select d from params))) as prev,
      count(*) filter (where ev.event = 'view' and ev.created_at >= now() - make_interval(days => (select d from params))) as views,
      count(*) filter (where ev.event = 'purchase' and ev.created_at >= now() - make_interval(days => (select d from params))) as sold
    from ev group by ev.product_id
  ), ranked as (
    select s.*, p.id, p.slug, p.name, p.rating_avg, p.rating_count, p.category_id
    from scored s join public.products p on p.id = s.product_id and p.status = 'active'
    where s.score > 0 and (p_category is null or p.category_id in (select id from cat))
    order by s.score desc limit (select lim from params)
  ), items as (
    select r.*, so.id as offer_id, so.price, so.compare_at_price, so.store_id,
           row_number() over (order by r.score desc) as rnk
    from ranked r
    join lateral (select so.* from public.seller_offers so join public.product_variants pv on pv.id = so.variant_id
                  join public.stores st on st.id = so.store_id and st.status = 'active'
                  left join public.inventory_levels il on il.offer_id = so.id
                  where pv.product_id = r.id and so.status = 'active' and coalesce(il.qty_available, 0) > 0
                  order by so.price limit 1) so on true
  )
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'slug', i.slug, 'name', i.name, 'rank', i.rnk, 'views', i.views, 'sold', i.sold,
        'growth', case when coalesce(i.prev, 0) = 0 then null else round((i.cur - i.prev) * 100.0 / i.prev) end,
        'is_new', coalesce(i.prev, 0) = 0,
        'image', (select url from public.product_images im where im.product_id = i.id order by sort limit 1),
        'price', i.price - private.offer_discount(i.offer_id, i.store_id, i.price),
        'original_price', case when greatest(i.price, coalesce(i.compare_at_price, 0)) > i.price - private.offer_discount(i.offer_id, i.store_id, i.price)
                               then greatest(i.price, coalesce(i.compare_at_price, 0)) end,
        'rating', i.rating_avg, 'rating_count', i.rating_count, 'offer_id', i.offer_id, 'in_stock', true) order by i.rnk) from items i), '[]'::jsonb),
    'searches', coalesce((select jsonb_agg(jsonb_build_object('q', q, 'n', n) order by n desc) from (
        select lower(trim(query)) q, count(*) n from public.search_queries, params
        where created_at >= now() - make_interval(days => params.d) and results_count > 0 and char_length(trim(query)) between 2 and 40
        group by 1 having count(*) >= 2 order by 2 desc limit 12) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('slug', c.slug, 'name', c.name_ar, 'icon', c.icon, 'score', round(t.sc)) order by t.sc desc) from (
        select coalesce(c.parent_id, c.id) cid, sum(s.score) sc from scored s join public.products p on p.id = s.product_id and p.status = 'active'
        join public.categories c on c.id = p.category_id where s.score > 0 group by 1 order by 2 desc limit 8) t
        join public.categories c on c.id = t.cid), '[]'::jsonb),
    'days', (select d from params));
$$;
grant execute on function public.get_trending(int, text, int) to anon, authenticated;

-- ---------- نظرة عامة للإدارة ----------
create or replace function public.admin_overview(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d int := least(greatest(coalesce(p_days, 30), 1), 365);
        v_from timestamptz := date_trunc('day', now() at time zone 'Asia/Aden') at time zone 'Asia/Aden' - make_interval(days => d - 1);
        v_prev timestamptz := v_from - make_interval(days => d);
        v_fin boolean := private.is_finance();
begin
  if not private.is_staff() then raise exception 'لا تملك صلاحية' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', d,
    'kpis', (select jsonb_build_object(
        'gmv', jsonb_build_array(sum(grand_total) filter (where created_at >= v_from), sum(grand_total) filter (where created_at < v_from)),
        'orders', jsonb_build_array(count(*) filter (where created_at >= v_from), count(*) filter (where created_at < v_from)),
        'aov', jsonb_build_array(round(avg(grand_total) filter (where created_at >= v_from)), round(avg(grand_total) filter (where created_at < v_from))),
        'customers', jsonb_build_array(count(distinct user_id) filter (where created_at >= v_from), count(distinct user_id) filter (where created_at < v_from)))
      from public.orders where created_at >= v_prev and status not in ('cancelled','expired','pending_payment')),
    'commission', case when v_fin then (select jsonb_build_array(
        coalesce(sum(commission_amount) filter (where created_at >= v_from), 0), coalesce(sum(commission_amount) filter (where created_at < v_from), 0))
      from public.sub_orders where created_at >= v_prev and status not in ('cancelled','awaiting_payment')) end,
    'new_users', (select jsonb_build_array(count(*) filter (where created_at >= v_from), count(*) filter (where created_at < v_from))
      from public.profiles where created_at >= v_prev),
    'cancel_rate', (select jsonb_build_array(
        round(100.0 * count(*) filter (where created_at >= v_from and status in ('cancelled','expired')) / nullif(count(*) filter (where created_at >= v_from), 0), 1),
        round(100.0 * count(*) filter (where created_at < v_from and status in ('cancelled','expired')) / nullif(count(*) filter (where created_at < v_from), 0), 1))
      from public.orders where created_at >= v_prev),
    'series', (select jsonb_agg(jsonb_build_object('day', g::date,
        'gmv', coalesce((select sum(grand_total) from public.orders o where o.created_at >= g and o.created_at < g + interval '1 day' and o.status not in ('cancelled','expired','pending_payment')), 0),
        'orders', (select count(*) from public.orders o where o.created_at >= g and o.created_at < g + interval '1 day' and o.status not in ('cancelled','expired','pending_payment')),
        'users', (select count(*) from public.profiles pr where pr.created_at >= g and pr.created_at < g + interval '1 day')) order by g)
      from generate_series(v_from, v_from + make_interval(days => d - 1), interval '1 day') g),
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.sub_orders where created_at >= v_from group by 1) t), '{}'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('k', payment_channel, 'n', n, 'total', t)) from (
        select payment_channel, count(*) n, sum(grand_total) t from public.orders where created_at >= v_from and status not in ('cancelled','expired') group by 1 order by 3 desc) x), '[]'::jsonb),
    'fulfillment', coalesce((select jsonb_object_agg(fulfillment, n) from (select fulfillment, count(*) n from public.orders where created_at >= v_from group by 1) t), '{}'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.name_ar, 'total', t.total) order by t.total desc) from (
        select coalesce(cc.parent_id, cc.id) cid, sum(i.line_total) total from public.order_items i
        join public.sub_orders so on so.id = i.sub_order_id and so.status not in ('cancelled','awaiting_payment') and so.created_at >= v_from
        join public.products p on p.id = i.product_id join public.categories cc on cc.id = p.category_id group by 1 order by 2 desc limit 8) t
        join public.categories c on c.id = t.cid), '[]'::jsonb),
    'governorates', coalesce((select jsonb_agg(jsonb_build_object('name', g.name_ar, 'total', t.total, 'n', t.n) order by t.total desc) from (
        select governorate_id, sum(grand_total) total, count(*) n from public.orders where created_at >= v_from and status not in ('cancelled','expired','pending_payment')
        group by 1 order by 2 desc limit 8) t join public.governorates g on g.id = t.governorate_id), '[]'::jsonb),
    'hours', (select jsonb_agg(coalesce(n, 0) order by h) from generate_series(0, 23) h left join (
        select extract(hour from created_at at time zone 'Asia/Aden')::int hr, count(*) n from public.orders where created_at >= v_from group by 1) t on t.hr = h),
    'funnel', (select jsonb_build_object('view', count(*) filter (where event = 'view'), 'cart', count(*) filter (where event = 'cart'),
        'purchase', count(*) filter (where event = 'purchase')) from public.activity_events where created_at >= v_from),
    'top_stores', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'slug', s.slug, 'total', t.total, 'n', t.n) order by t.total desc) from (
        select store_id, sum(subtotal) total, count(*) n from public.sub_orders where created_at >= v_from and status not in ('cancelled','awaiting_payment')
        group by 1 order by 2 desc limit 6) t join public.stores s on s.id = t.store_id), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'total', r) order by r desc) from (
        select i.product_name name, sum(i.qty) q, sum(i.line_total) r from public.order_items i
        join public.sub_orders so on so.id = i.sub_order_id and so.status not in ('cancelled','awaiting_payment') and so.created_at >= v_from
        group by 1 order by 3 desc limit 6) t), '[]'::jsonb),
    'actions', jsonb_build_object(
        'pending_payments', (select count(*) from public.orders where status = 'pending_payment' and payment_status = 'unpaid'),
        'stores_pending', (select count(*) from public.stores where status = 'pending'),
        'products_pending', (select count(*) from public.products where status = 'pending_review'),
        'late', (select count(*) from public.sub_orders where status = 'pending_merchant' and updated_at < now() - make_interval(hours => (private.setting('merchant_sla_hours', '4'::jsonb))::text::int)),
        'failed', (select count(*) from public.sub_orders where status = 'delivery_failed'),
        'returns', (select count(*) from public.returns where status = 'requested'),
        'refunds', (select count(*) from public.orders where payment_status = 'paid' and status in ('cancelled','expired')),
        'tickets', (select count(*) from public.support_tickets where status = 'open'),
        'ads', (select count(*) from public.ad_campaigns where status = 'requested'),
        'questions', (select count(*) from public.product_questions where answer is null and status <> 'hidden' and created_at < now() - interval '24 hours'),
        'outbox_failed', (select count(*) from public.message_outbox where status = 'failed' and created_at > now() - interval '3 days'),
        'batches', (select count(*) from public.merchant_batches where status in ('closed','picked_up'))));
end $$;

-- ---------- نظرة عامة للتاجر ----------
create or replace function public.merchant_overview(p_store uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d int := least(greatest(coalesce(p_days, 30), 1), 365);
        v_from timestamptz := date_trunc('day', now() at time zone 'Asia/Aden') at time zone 'Asia/Aden' - make_interval(days => d - 1);
        v_prev timestamptz := v_from - make_interval(days => d);
        v_fin boolean := private.store_perm(p_store, 'finance') or private.is_staff();
begin
  if not (private.store_perm(p_store, 'orders') or private.store_perm(p_store, 'products') or private.is_staff()) then
    raise exception 'لا تملك صلاحية' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', d, 'finance', v_fin,
    'store', (select jsonb_build_object('name', name, 'slug', slug, 'status', status, 'rating', rating_avg, 'rating_count', rating_count,
               'commission_rate', commission_rate, 'rejection_reason', rejection_reason) from public.stores where id = p_store),
    'kpis', (select jsonb_build_object(
        'revenue', case when v_fin then jsonb_build_array(coalesce(sum(subtotal - store_coupon_discount) filter (where created_at >= v_from), 0), coalesce(sum(subtotal - store_coupon_discount) filter (where created_at < v_from), 0)) end,
        'net', case when v_fin then jsonb_build_array(coalesce(sum(merchant_net) filter (where created_at >= v_from), 0), coalesce(sum(merchant_net) filter (where created_at < v_from), 0)) end,
        'orders', jsonb_build_array(count(*) filter (where created_at >= v_from), count(*) filter (where created_at < v_from)),
        'aov', case when v_fin then jsonb_build_array(round(avg(subtotal) filter (where created_at >= v_from)), round(avg(subtotal) filter (where created_at < v_from))) end)
      from public.sub_orders where store_id = p_store and created_at >= v_prev and status not in ('cancelled','awaiting_payment')),
    'cancel_rate', (select jsonb_build_array(
        round(100.0 * count(*) filter (where created_at >= v_from and status = 'cancelled') / nullif(count(*) filter (where created_at >= v_from), 0), 1),
        round(100.0 * count(*) filter (where created_at < v_from and status = 'cancelled') / nullif(count(*) filter (where created_at < v_from), 0), 1))
      from public.sub_orders where store_id = p_store and created_at >= v_prev and status <> 'awaiting_payment'),
    'views', (select jsonb_build_array(count(*) filter (where e.created_at >= v_from), count(*) filter (where e.created_at < v_from))
      from public.activity_events e where e.event = 'view' and e.created_at >= v_prev
        and e.product_id in (select pv.product_id from public.seller_offers so join public.product_variants pv on pv.id = so.variant_id where so.store_id = p_store)),
    'accept_minutes', (select round(avg(extract(epoch from h.created_at - so.created_at) / 60)) from public.order_status_history h
        join public.sub_orders so on so.id = h.sub_order_id where so.store_id = p_store and h.to_status = 'accepted' and so.created_at >= v_from),
    'series', (select jsonb_agg(jsonb_build_object('day', g::date,
        'revenue', case when v_fin then coalesce((select sum(subtotal - store_coupon_discount) from public.sub_orders s where s.store_id = p_store and s.created_at >= g and s.created_at < g + interval '1 day' and s.status not in ('cancelled','awaiting_payment')), 0) else 0 end,
        'orders', (select count(*) from public.sub_orders s where s.store_id = p_store and s.created_at >= g and s.created_at < g + interval '1 day' and s.status not in ('cancelled','awaiting_payment'))) order by g)
      from generate_series(v_from, v_from + make_interval(days => d - 1), interval '1 day') g),
    'status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.sub_orders where store_id = p_store and created_at >= v_from group by 1) t), '{}'::jsonb),
    'hours', (select jsonb_agg(coalesce(n, 0) order by h) from generate_series(0, 23) h left join (
        select extract(hour from created_at at time zone 'Asia/Aden')::int hr, count(*) n from public.sub_orders where store_id = p_store and created_at >= v_from group by 1) t on t.hr = h),
    'funnel', (select jsonb_build_object('view', count(*) filter (where event = 'view'), 'cart', count(*) filter (where event = 'cart'), 'purchase', count(*) filter (where event = 'purchase'))
      from public.activity_events where created_at >= v_from
        and product_id in (select pv.product_id from public.seller_offers so join public.product_variants pv on pv.id = so.variant_id where so.store_id = p_store)),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'qty', q, 'total', case when v_fin then r end) order by q desc) from (
        select i.product_name name, sum(i.qty) q, sum(i.line_total) r from public.order_items i
        join public.sub_orders so on so.id = i.sub_order_id and so.store_id = p_store and so.status not in ('cancelled','awaiting_payment') and so.created_at >= v_from
        group by 1 order by 2 desc limit 6) t), '[]'::jsonb),
    'ratings', (select jsonb_agg(coalesce(n, 0) order by r) from generate_series(1, 5) r left join (
        select rating, count(*) n from public.reviews where store_id = p_store and status = 'published' group by 1) t on t.rating = r),
    'low_stock', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('offer_id', so.id, 'name', p.name, 'variant', pv.name, 'available', il.qty_available) as x
        from public.seller_offers so join public.inventory_levels il on il.offer_id = so.id
        join public.product_variants pv on pv.id = so.variant_id join public.products p on p.id = pv.product_id
        where so.store_id = p_store and so.status in ('active','out_of_stock') and il.qty_available <= il.low_stock_threshold
        order by il.qty_available limit 6) t), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', id, 'sub_no', sub_no, 'status', status, 'subtotal', subtotal, 'created_at', created_at) as x
        from public.sub_orders where store_id = p_store and status <> 'awaiting_payment' order by created_at desc limit 6) t), '[]'::jsonb),
    'actions', jsonb_build_object(
        'new', (select count(*) from public.sub_orders where store_id = p_store and status = 'pending_merchant'),
        'preparing', (select count(*) from public.sub_orders where store_id = p_store and status in ('accepted','preparing')),
        'ready', (select count(*) from public.sub_orders where store_id = p_store and status = 'ready'),
        'open_batches', (select count(*) from public.merchant_batches where store_id = p_store and status = 'open'),
        'questions', (select count(*) from public.product_questions q where q.answer is null and q.status <> 'hidden'
                       and exists (select 1 from public.seller_offers so join public.product_variants pv on pv.id = so.variant_id where pv.product_id = q.product_id and so.store_id = p_store)),
        'returns', (select count(*) from public.returns r join public.sub_orders so on so.id = r.sub_order_id where so.store_id = p_store and r.status = 'requested'),
        'low_stock', (select count(*) from public.seller_offers so join public.inventory_levels il on il.offer_id = so.id
                       where so.store_id = p_store and so.status in ('active','out_of_stock') and il.qty_available <= il.low_stock_threshold),
        'pending_review', (select count(*) from public.products where proposed_by_store_id = p_store and status = 'pending_review'),
        'unsettled', case when v_fin then (select coalesce(sum(merchant_net), 0) from public.sub_orders where store_id = p_store and status = 'delivered' and settlement_id is null) end));
end $$;

revoke execute on function public.admin_overview(int), public.merchant_overview(uuid, int) from public, anon;
grant execute on function public.admin_overview(int), public.merchant_overview(uuid, int) to authenticated;
