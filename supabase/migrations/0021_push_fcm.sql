-- =====================================================================
-- 0021 — إشعارات الجهاز عبر Firebase Cloud Messaging (FCM)
-- كل إشعار داخل المنصة يُرسل أيضًا كإشعار جهاز لمن فعّله، عند تفعيل القناة من لوحة الإدارة.
-- الإرسال: pg_net ← مسار /api/push/send في التطبيق (موثّق بسر مشترك) ← FCM HTTP v1.
-- مفتاح حساب الخدمة لا يدخل قاعدة البيانات إطلاقًا؛ يبقى متغير بيئة سري في Vercel.
-- =====================================================================

-- إعدادات Firebase العامة للمتصفح (ليست أسرارًا: تُضمَّن في أي تطبيق ويب يستخدم Firebase)
insert into public.app_settings (key, value) values
  ('public_firebase', '{"enabled":false,"apiKey":"","authDomain":"","projectId":"","messagingSenderId":"","appId":"","vapidKey":""}'::jsonb)
on conflict (key) do nothing;
update public.app_settings set value = value || '{"push":{"enabled":false,"relay_url":""}}'::jsonb
where key = 'notify' and not value ? 'push';

-- رموز أجهزة المستخدمين
create table public.push_tokens (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  token      text not null unique check (char_length(token) between 20 and 4096),
  platform   text not null default 'web' check (platform in ('web','android','ios')),
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens(user_id);
alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;
revoke all on public.push_tokens from anon, authenticated;
grant select on public.push_tokens to authenticated;
create policy own on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.register_push_token(p_token text, p_platform text default 'web', p_ua text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if coalesce(char_length(p_token), 0) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9_:\-\.]+$' then raise exception 'رمز غير صالح'; end if;
  if (select count(*) from public.push_tokens where user_id = v_uid) >= 10 then
    delete from public.push_tokens where id = (select id from public.push_tokens where user_id = v_uid order by last_seen limit 1);
  end if;
  -- الرمز ينتقل لصاحب الجلسة الحالية (جهاز مشترك سجّل فيه مستخدم آخر)
  insert into public.push_tokens (user_id, token, platform, user_agent) values (v_uid, p_token, coalesce(nullif(p_platform, ''), 'web'), left(p_ua, 300))
  on conflict (token) do update set user_id = excluded.user_id, last_seen = now(), user_agent = excluded.user_agent;
end $$;

create or replace function public.unregister_push_token(p_token text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

-- صندوق الرسائل: قناة push بلا رقم هاتف
alter table public.message_outbox drop constraint if exists message_outbox_channel_check;
alter table public.message_outbox add constraint message_outbox_channel_check check (channel in ('whatsapp','sms','push'));
alter table public.message_outbox alter column to_phone drop not null;
alter table public.message_outbox add constraint message_outbox_target_check check (channel = 'push' or to_phone is not null);
alter table public.message_outbox add column if not exists title text check (char_length(title) <= 120);
alter table public.message_outbox add column if not exists link text check (char_length(link) <= 300);

-- كل إشعار داخل المنصة ← إشعار جهاز (إن كانت القناة مفعّلة وللمستخدم أجهزة مسجّلة)
create or replace function private.push_on_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((private.setting('notify', '{}'::jsonb)->'push'->>'enabled')::boolean, false)
     and exists (select 1 from public.push_tokens where user_id = new.user_id) then
    insert into public.message_outbox (event, channel, user_id, title, text_body, link)
    values (coalesce(nullif(regexp_replace(new.kind, '[^a-z_]', '', 'g'), ''), 'info'), 'push', new.user_id,
            left(new.title, 120), left(coalesce(new.body, ''), 1000), case when new.link ~ '^/[^/]' then left(new.link, 300) end);
  end if;
  return null;
end $$;
create trigger trg_push_on_notification after insert on public.notifications
  for each row execute function private.push_on_notification();

-- الإرسال الفعلي: يضيف فرع push إلى الموزّع الحالي
create or replace function private.dispatch_outbox() returns int
language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := private.setting('notify', '{}'::jsonb); m public.message_outbox; v_req bigint; v_n int := 0;
        v_tok text; v_body jsonb; v_params jsonb; v_tpl text; v_url text; v_sms text; v_tokens jsonb;
begin
  for m in select * from public.message_outbox where status = 'queued' order by id limit 50 for update skip locked loop
    begin
      if m.channel = 'push' then
        v_tok := private.secret('push_relay_secret'); v_url := cfg->'push'->>'relay_url';
        if not coalesce((cfg->'push'->>'enabled')::boolean, false) or v_tok is null or coalesce(v_url, '') !~ '^https://[^/]+/api/push/send$' then
          update public.message_outbox set status = 'skipped', last_error = 'إشعارات الجهاز غير مُعدّة' where id = m.id; continue;
        end if;
        select jsonb_agg(token) into v_tokens from (select token from public.push_tokens where user_id = m.user_id order by last_seen desc limit 20) t;
        if v_tokens is null then
          update public.message_outbox set status = 'skipped', last_error = 'لا توجد أجهزة مسجّلة' where id = m.id; continue;
        end if;
        select net.http_post(url := v_url,
          body := jsonb_build_object('tokens', v_tokens, 'title', coalesce(m.title, 'سوقي'), 'body', m.text_body, 'link', coalesce(m.link, '/account/notifications')),
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-relay-secret', v_tok),
          timeout_milliseconds := 10000) into v_req;
      elsif m.channel = 'whatsapp' then
        v_tok := private.secret('whatsapp_token');
        if not coalesce((cfg->'whatsapp'->>'enabled')::boolean, false) or v_tok is null
           or coalesce(cfg->'whatsapp'->>'phone_number_id', '') !~ '^[0-9]{5,30}$' then
          update public.message_outbox set status = 'skipped', last_error = 'واتساب غير مُعدّ' where id = m.id; continue;
        end if;
        v_tpl := nullif(cfg->'whatsapp'->'templates'->>m.event, '');
        select coalesce(jsonb_agg(jsonb_build_object('type', 'text', 'text', coalesce(p #>> '{}', ''))), '[]'::jsonb)
          into v_params from jsonb_array_elements(m.params) p;
        v_body := case when v_tpl is not null then jsonb_build_object('messaging_product', 'whatsapp', 'to', m.to_phone, 'type', 'template',
                    'template', jsonb_build_object('name', v_tpl, 'language', jsonb_build_object('code', coalesce(cfg->'whatsapp'->>'lang', 'ar')),
                      'components', jsonb_build_array(jsonb_build_object('type', 'body', 'parameters', v_params))))
                  else jsonb_build_object('messaging_product', 'whatsapp', 'to', m.to_phone, 'type', 'text',
                    'text', jsonb_build_object('body', m.text_body, 'preview_url', false)) end;
        select net.http_post(
          url := 'https://graph.facebook.com/' || coalesce(nullif(cfg->'whatsapp'->>'api_version', ''), 'v21.0') || '/' || (cfg->'whatsapp'->>'phone_number_id') || '/messages',
          body := v_body,
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_tok),
          timeout_milliseconds := 8000) into v_req;
      else
        v_tok := private.secret('sms_token'); v_url := cfg->'sms'->>'url';
        if not coalesce((cfg->'sms'->>'enabled')::boolean, false) or coalesce(v_url, '') !~ '^https://' then
          update public.message_outbox set status = 'skipped', last_error = 'SMS غير مُعدّ' where id = m.id; continue;
        end if;
        v_sms := replace(replace(replace(coalesce(cfg->'sms'->>'body_template', '{"to":"{{to}}","text":"{{text}}"}'),
                   '"{{to}}"', to_jsonb(m.to_phone)::text), '"{{sender}}"', to_jsonb(coalesce(cfg->'sms'->>'sender', ''))::text),
                   '"{{text}}"', to_jsonb(m.text_body)::text);
        select net.http_post(url := v_url, body := v_sms::jsonb,
          headers := jsonb_build_object('Content-Type', 'application/json') ||
                     case when v_tok is not null then jsonb_build_object(coalesce(nullif(cfg->'sms'->>'auth_header', ''), 'Authorization'),
                                                                         coalesce(cfg->'sms'->>'auth_prefix', '') || v_tok) else '{}'::jsonb end,
          timeout_milliseconds := 8000) into v_req;
      end if;
      update public.message_outbox set status = 'sending', request_id = v_req, attempts = attempts + 1 where id = m.id;
      v_n := v_n + 1;
    exception when others then
      update public.message_outbox set status = 'failed', attempts = attempts + 1, last_error = left(sqlerrm, 300) where id = m.id;
    end;
  end loop;
  return v_n;
end $$;

-- المطابقة: حذف رموز الأجهزة التي أبلغ FCM أنها لم تعد صالحة
create or replace function private.reconcile_outbox() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0; v_json jsonb;
begin
  for r in select m.id, m.channel, m.attempts, h.status_code, h.content, h.error_msg, h.timed_out
           from public.message_outbox m join net._http_response h on h.id = m.request_id
           where m.status = 'sending' limit 200 loop
    if r.status_code between 200 and 299 then
      update public.message_outbox set status = 'sent', sent_at = now(), last_error = null where id = r.id;
      if r.channel = 'push' then
        begin
          v_json := r.content::jsonb;
          delete from public.push_tokens where token in (select jsonb_array_elements_text(coalesce(v_json->'invalid', '[]'::jsonb)));
          if coalesce((v_json->>'sent')::int, 1) = 0 then
            update public.message_outbox set status = 'failed', last_error = left(coalesce(v_json->>'error', 'لم يصل لأي جهاز'), 300) where id = r.id;
          end if;
        exception when others then null;
        end;
      end if;
    elsif r.attempts < 3 and (r.timed_out or r.status_code >= 500 or r.status_code is null) then
      update public.message_outbox set status = 'queued', last_error = left(coalesce(r.error_msg, r.content, 'timeout'), 300) where id = r.id;
    else
      update public.message_outbox set status = 'failed', last_error = left(coalesce(r.status_code::text || ': ', '') || coalesce(r.content, r.error_msg, ''), 300) where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  update public.message_outbox set status = 'failed', last_error = 'لا توجد استجابة'
  where status = 'sending' and created_at < now() - interval '30 minutes';
  return v_n;
end $$;

-- الأسرار: إضافة سر الربط مع مسار الإرسال
create or replace function public.admin_set_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_admin();
  if p_name not in ('whatsapp_token','sms_token','push_relay_secret') then raise exception 'اسم سر غير مسموح'; end if;
  if coalesce(trim(p_value), '') = '' or char_length(p_value) > 2000 then raise exception 'قيمة غير صالحة'; end if;
  if p_name = 'push_relay_secret' and char_length(trim(p_value)) < 32 then raise exception 'سر الربط يجب ألا يقل عن 32 حرفًا'; end if;
  select id into v_id from vault.secrets where name = 'sawqy_' || p_name;
  if v_id is null then perform vault.create_secret(trim(p_value), 'sawqy_' || p_name, 'Sawqy notifications');
  else perform vault.update_secret(v_id, trim(p_value)); end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id) values (auth.uid(), 'secret_set', 'vault', p_name);
end $$;

create or replace function public.admin_secret_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'whatsapp_token', exists (select 1 from vault.secrets where name = 'sawqy_whatsapp_token'),
    'sms_token', exists (select 1 from vault.secrets where name = 'sawqy_sms_token'),
    'push_relay_secret', exists (select 1 from vault.secrets where name = 'sawqy_push_relay_secret'),
    'push_devices', (select count(*) from public.push_tokens));
end $$;

create or replace function public.admin_test_notify(p_phone text, p_channel text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_phone text := private.phone_e164(p_phone);
begin
  perform private.require_admin();
  if p_channel = 'push' then
    if not exists (select 1 from public.push_tokens where user_id = auth.uid()) then
      raise exception 'فعّل إشعارات الجهاز من حسابك أولًا (صفحة الإشعارات) ثم جرّب';
    end if;
    insert into public.message_outbox (event, channel, user_id, title, text_body, link)
    values ('test', 'push', auth.uid(), 'سوقي', 'رسالة تجريبية — إشعارات الجهاز تعمل بنجاح ✅', '/account/notifications');
    return;
  end if;
  if v_phone is null then raise exception 'رقم غير صالح'; end if;
  if p_channel not in ('whatsapp','sms') then raise exception 'قناة غير صالحة'; end if;
  insert into public.message_outbox (event, channel, user_id, to_phone, text_body, params)
  values ('test', p_channel, auth.uid(), v_phone, 'سوقي: رسالة تجريبية — الإشعارات تعمل بنجاح.', '[]'::jsonb);
end $$;

-- لوحة الإشعارات: إخفاء الرقم وعرض القناة
create or replace function public.admin_notify_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'settings', private.setting('notify', '{}'::jsonb),
    'firebase', private.setting('public_firebase', '{}'::jsonb),
    'secrets', public.admin_secret_status(),
    'stats', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.message_outbox where created_at > now() - interval '7 days' group by status) t),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'event', event, 'channel', channel,
                 'to', case when channel = 'push' then 'جهاز' else '•••' || right(to_phone, 4) end, 'status', status, 'error', last_error, 'at', created_at) order by id desc)
               from (select * from public.message_outbox order by id desc limit 50) t), '[]'::jsonb));
end $$;

revoke execute on function private.push_on_notification() from public, anon, authenticated;
revoke execute on function public.register_push_token(text, text, text), public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text, text), public.unregister_push_token(text) to authenticated;
