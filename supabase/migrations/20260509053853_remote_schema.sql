create extension if not exists "pg_cron" with schema "pg_catalog";

create sequence "public"."ai_knowledge_sections_id_seq";

drop policy "bookings_update_all" on "public"."bookings";

drop policy "Public read access to date_specific_availability" on "public"."date_specific_availability";

drop policy "Allow service role full access" on "public"."email_verifications";

drop policy "Customers can read their own access codes" on "public"."rental_access_codes";

drop policy "rental_access_codes_insert_for_booking_email" on "public"."rental_access_codes";

drop policy "rental_access_codes_service_role_update" on "public"."rental_access_codes";

drop policy "Public can read approved reviews" on "public"."reviews";

drop policy "Public read access to services" on "public"."services";

drop policy "service_role_full_access" on "public"."tax_rate_cache";

revoke delete on table "public"."tax_rate_cache" from "anon";

revoke insert on table "public"."tax_rate_cache" from "anon";

revoke references on table "public"."tax_rate_cache" from "anon";

revoke select on table "public"."tax_rate_cache" from "anon";

revoke trigger on table "public"."tax_rate_cache" from "anon";

revoke truncate on table "public"."tax_rate_cache" from "anon";

revoke update on table "public"."tax_rate_cache" from "anon";

revoke delete on table "public"."tax_rate_cache" from "authenticated";

revoke insert on table "public"."tax_rate_cache" from "authenticated";

revoke references on table "public"."tax_rate_cache" from "authenticated";

revoke select on table "public"."tax_rate_cache" from "authenticated";

revoke trigger on table "public"."tax_rate_cache" from "authenticated";

revoke truncate on table "public"."tax_rate_cache" from "authenticated";

revoke update on table "public"."tax_rate_cache" from "authenticated";

revoke delete on table "public"."tax_rate_cache" from "service_role";

revoke insert on table "public"."tax_rate_cache" from "service_role";

revoke references on table "public"."tax_rate_cache" from "service_role";

revoke select on table "public"."tax_rate_cache" from "service_role";

revoke trigger on table "public"."tax_rate_cache" from "service_role";

revoke truncate on table "public"."tax_rate_cache" from "service_role";

revoke update on table "public"."tax_rate_cache" from "service_role";

alter table "public"."bookings" drop constraint "bookings_delivery_type_check";

alter table "public"."tax_records" drop constraint "tax_records_delivery_type_check";

alter table "public"."tax_rate_cache" drop constraint "tax_rate_cache_pkey";

drop index if exists "public"."tax_rate_cache_pkey";

drop table "public"."tax_rate_cache";


  create table "public"."ai_assistant_messages" (
    "id" uuid not null default gen_random_uuid(),
    "customer_id" bigint not null,
    "name" text not null,
    "email" text not null,
    "order_number" text,
    "message" text not null,
    "created_at" timestamp with time zone not null default now(),
    "status" text not null default 'pending'::text,
    "admin_notes" text,
    "responded_at" timestamp with time zone
      );


alter table "public"."ai_assistant_messages" enable row level security;


  create table "public"."ai_knowledge_base" (
    "id" uuid not null default gen_random_uuid(),
    "section_id" bigint not null,
    "title" text not null,
    "content" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."ai_knowledge_base" enable row level security;


  create table "public"."ai_knowledge_sections" (
    "id" bigint not null default nextval('public.ai_knowledge_sections_id_seq'::regclass),
    "name" text not null,
    "description" text,
    "display_order" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."ai_knowledge_sections" enable row level security;

alter table "public"."bookings" drop column "access_pin";

alter table "public"."bookings" drop column "delivery_type";

alter table "public"."bookings" add column "pin_generated_at" timestamp with time zone;

alter table "public"."bookings" add column "pin_notification_sent_at" timestamp with time zone;

alter table "public"."bookings" alter column "tax_rate_used" set default 7.0;

alter table "public"."business_settings" drop column "tax_rate_delivery";

alter table "public"."business_settings" drop column "tax_rate_pickup";

alter table "public"."equipment_pricing" drop column "is_taxable";

alter table "public"."rental_access_codes" drop column "algo_pin_id";

alter table "public"."rental_access_codes" add column "lock_deleted_at" timestamp with time zone;

alter table "public"."rental_access_codes" add column "lock_id" text not null default ''::text;

alter table "public"."rental_access_codes" add column "notified_at" timestamp with time zone;

alter table "public"."rental_access_codes" add column "pin_id" text not null;

alter table "public"."rental_access_codes" add column "pin_type" text not null default 'bridge_proxied'::text;

alter table "public"."resource_access_logs" enable row level security;

alter table "public"."services" drop column "delivery_fee_is_taxable";

alter table "public"."services" drop column "is_taxable";

alter table "public"."services" drop column "mileage_is_taxable";

alter table "public"."tax_records" drop column "delivery_type";

alter table "public"."tax_records" drop column "line_items";

alter table "public"."tax_records" drop column "non_taxable_subtotal";

alter table "public"."tax_records" drop column "tax_api_used";

alter table "public"."tax_records" drop column "tax_jurisdiction";

alter table "public"."tax_records" drop column "taxable_subtotal";

alter sequence "public"."ai_knowledge_sections_id_seq" owned by "public"."ai_knowledge_sections"."id";

CREATE UNIQUE INDEX ai_assistant_messages_pkey ON public.ai_assistant_messages USING btree (id);

CREATE UNIQUE INDEX ai_knowledge_base_pkey ON public.ai_knowledge_base USING btree (id);

CREATE UNIQUE INDEX ai_knowledge_sections_pkey ON public.ai_knowledge_sections USING btree (id);

CREATE INDEX idx_ai_assistant_messages_created_at ON public.ai_assistant_messages USING btree (created_at DESC);

CREATE INDEX idx_ai_assistant_messages_customer_id ON public.ai_assistant_messages USING btree (customer_id);

CREATE INDEX idx_ai_assistant_messages_status ON public.ai_assistant_messages USING btree (status);

CREATE INDEX idx_ai_knowledge_base_content ON public.ai_knowledge_base USING gin (to_tsvector('english'::regconfig, content));

CREATE INDEX idx_ai_knowledge_base_section_id ON public.ai_knowledge_base USING btree (section_id);

CREATE INDEX idx_ai_knowledge_base_title ON public.ai_knowledge_base USING gin (to_tsvector('english'::regconfig, title));

CREATE INDEX idx_rental_access_codes_lock_deleted ON public.rental_access_codes USING btree (status, lock_deleted_at) WHERE (lock_deleted_at IS NULL);

alter table "public"."ai_assistant_messages" add constraint "ai_assistant_messages_pkey" PRIMARY KEY using index "ai_assistant_messages_pkey";

alter table "public"."ai_knowledge_base" add constraint "ai_knowledge_base_pkey" PRIMARY KEY using index "ai_knowledge_base_pkey";

alter table "public"."ai_knowledge_sections" add constraint "ai_knowledge_sections_pkey" PRIMARY KEY using index "ai_knowledge_sections_pkey";

alter table "public"."ai_assistant_messages" add constraint "ai_assistant_messages_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE not valid;

alter table "public"."ai_assistant_messages" validate constraint "ai_assistant_messages_customer_id_fkey";

alter table "public"."ai_knowledge_base" add constraint "ai_knowledge_base_section_id_fkey" FOREIGN KEY (section_id) REFERENCES public.ai_knowledge_sections(id) ON DELETE CASCADE not valid;

alter table "public"."ai_knowledge_base" validate constraint "ai_knowledge_base_section_id_fkey";

alter table "public"."rental_access_codes" add constraint "rental_access_codes_pin_type_check" CHECK ((pin_type = ANY (ARRAY['algopin'::text, 'bridge_proxied'::text]))) not valid;

alter table "public"."rental_access_codes" validate constraint "rental_access_codes_pin_type_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_pending_booking(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$DECLARE
  new_id bigint;
  new_customer_id bigint;
BEGIN
  INSERT INTO bookings (
    name,
    first_name,
    last_name,
    email,
    phone,
    street,
    city,
    state,
    zip,
    contact_address,
    delivery_address,
    drop_off_date,
    pickup_date,
    drop_off_time_slot,
    pickup_time_slot,
    plan,
    addons,
    total_price,
    status,
    notes,
    was_verification_skipped,
    verification_notes
  )
  VALUES (
    payload->>'name',
    payload->>'first_name',
    payload->>'last_name',
    payload->>'email',
    payload->>'phone',
    payload->>'street',
    payload->>'city',
    payload->>'state',
    payload->>'zip',
    payload->'contact_address',
    payload->'delivery_address',
    (payload->>'drop_off_date')::date,
    (payload->>'pickup_date')::date,
    payload->>'drop_off_time_slot',
    payload->>'pickup_time_slot',
    payload->'plan',
    payload->'addons',
    (payload->>'total_price')::real,
    'pending_payment',
    payload->>'notes',
    COALESCE((payload->>'was_verification_skipped')::boolean, false),
    payload->>'verification_notes'
  )
  RETURNING id, customer_id INTO new_id, new_customer_id;

  RETURN jsonb_build_object(
    'id', new_id,
    'customer_id', new_customer_id
  );
END;$function$
;

grant delete on table "public"."ai_assistant_messages" to "anon";

grant insert on table "public"."ai_assistant_messages" to "anon";

grant references on table "public"."ai_assistant_messages" to "anon";

grant select on table "public"."ai_assistant_messages" to "anon";

grant trigger on table "public"."ai_assistant_messages" to "anon";

grant truncate on table "public"."ai_assistant_messages" to "anon";

grant update on table "public"."ai_assistant_messages" to "anon";

grant delete on table "public"."ai_assistant_messages" to "authenticated";

grant insert on table "public"."ai_assistant_messages" to "authenticated";

grant references on table "public"."ai_assistant_messages" to "authenticated";

grant select on table "public"."ai_assistant_messages" to "authenticated";

grant trigger on table "public"."ai_assistant_messages" to "authenticated";

grant truncate on table "public"."ai_assistant_messages" to "authenticated";

grant update on table "public"."ai_assistant_messages" to "authenticated";

grant delete on table "public"."ai_assistant_messages" to "service_role";

grant insert on table "public"."ai_assistant_messages" to "service_role";

grant references on table "public"."ai_assistant_messages" to "service_role";

grant select on table "public"."ai_assistant_messages" to "service_role";

grant trigger on table "public"."ai_assistant_messages" to "service_role";

grant truncate on table "public"."ai_assistant_messages" to "service_role";

grant update on table "public"."ai_assistant_messages" to "service_role";

grant delete on table "public"."ai_knowledge_base" to "anon";

grant insert on table "public"."ai_knowledge_base" to "anon";

grant references on table "public"."ai_knowledge_base" to "anon";

grant select on table "public"."ai_knowledge_base" to "anon";

grant trigger on table "public"."ai_knowledge_base" to "anon";

grant truncate on table "public"."ai_knowledge_base" to "anon";

grant update on table "public"."ai_knowledge_base" to "anon";

grant delete on table "public"."ai_knowledge_base" to "authenticated";

grant insert on table "public"."ai_knowledge_base" to "authenticated";

grant references on table "public"."ai_knowledge_base" to "authenticated";

grant select on table "public"."ai_knowledge_base" to "authenticated";

grant trigger on table "public"."ai_knowledge_base" to "authenticated";

grant truncate on table "public"."ai_knowledge_base" to "authenticated";

grant update on table "public"."ai_knowledge_base" to "authenticated";

grant delete on table "public"."ai_knowledge_base" to "service_role";

grant insert on table "public"."ai_knowledge_base" to "service_role";

grant references on table "public"."ai_knowledge_base" to "service_role";

grant select on table "public"."ai_knowledge_base" to "service_role";

grant trigger on table "public"."ai_knowledge_base" to "service_role";

grant truncate on table "public"."ai_knowledge_base" to "service_role";

grant update on table "public"."ai_knowledge_base" to "service_role";

grant delete on table "public"."ai_knowledge_sections" to "anon";

grant insert on table "public"."ai_knowledge_sections" to "anon";

grant references on table "public"."ai_knowledge_sections" to "anon";

grant select on table "public"."ai_knowledge_sections" to "anon";

grant trigger on table "public"."ai_knowledge_sections" to "anon";

grant truncate on table "public"."ai_knowledge_sections" to "anon";

grant update on table "public"."ai_knowledge_sections" to "anon";

grant delete on table "public"."ai_knowledge_sections" to "authenticated";

grant insert on table "public"."ai_knowledge_sections" to "authenticated";

grant references on table "public"."ai_knowledge_sections" to "authenticated";

grant select on table "public"."ai_knowledge_sections" to "authenticated";

grant trigger on table "public"."ai_knowledge_sections" to "authenticated";

grant truncate on table "public"."ai_knowledge_sections" to "authenticated";

grant update on table "public"."ai_knowledge_sections" to "authenticated";

grant delete on table "public"."ai_knowledge_sections" to "service_role";

grant insert on table "public"."ai_knowledge_sections" to "service_role";

grant references on table "public"."ai_knowledge_sections" to "service_role";

grant select on table "public"."ai_knowledge_sections" to "service_role";

grant trigger on table "public"."ai_knowledge_sections" to "service_role";

grant truncate on table "public"."ai_knowledge_sections" to "service_role";

grant update on table "public"."ai_knowledge_sections" to "service_role";


  create policy "Admins can read all AI assistant messages"
  on "public"."ai_assistant_messages"
  as permissive
  for select
  to public
using (public.is_admin());



  create policy "Admins can update AI assistant messages"
  on "public"."ai_assistant_messages"
  as permissive
  for update
  to public
using (public.is_admin());



  create policy "Customers can insert their own AI assistant messages"
  on "public"."ai_assistant_messages"
  as permissive
  for insert
  to authenticated
with check ((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.user_id = auth.uid()))));



  create policy "Customers can read their own AI assistant messages"
  on "public"."ai_assistant_messages"
  as permissive
  for select
  to authenticated
using (((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.user_id = auth.uid()))) OR public.is_admin()));



  create policy "Admin write access to ai_knowledge_base"
  on "public"."ai_knowledge_base"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin()));



  create policy "Public read access to ai_knowledge_base"
  on "public"."ai_knowledge_base"
  as permissive
  for select
  to public
using (true);



  create policy "Admin write access to ai_knowledge_sections"
  on "public"."ai_knowledge_sections"
  as permissive
  for all
  to public
using (((auth.role() = 'service_role'::text) OR public.is_admin()));



  create policy "Public read access to ai_knowledge_sections"
  on "public"."ai_knowledge_sections"
  as permissive
  for select
  to public
using (true);



  create policy "public_insert_bookings"
  on "public"."bookings"
  as permissive
  for insert
  to public
with check (true);



  create policy "public_read_bookings"
  on "public"."bookings"
  as permissive
  for select
  to public
using (true);



  create policy "service_role_full_access_bookings"
  on "public"."bookings"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));



  create policy "users_update_own_bookings"
  on "public"."bookings"
  as permissive
  for update
  to public
using ((auth.uid() IN ( SELECT customers.user_id
   FROM public.customers
  WHERE (customers.id = bookings.customer_id))));



  create policy "Allow anonymous read access to date_specific_availability"
  on "public"."date_specific_availability"
  as permissive
  for select
  to public
using (true);



  create policy "Allow anonymous read access to dump_fees"
  on "public"."dump_fees"
  as permissive
  for select
  to public
using (true);



  create policy "public_insert_email_verifications"
  on "public"."email_verifications"
  as permissive
  for insert
  to public
with check (true);



  create policy "public_read_email_verifications"
  on "public"."email_verifications"
  as permissive
  for select
  to public
using (true);



  create policy "public_update_email_verifications"
  on "public"."email_verifications"
  as permissive
  for update
  to public
using (true);



  create policy "service_role_full_access_email_verifications"
  on "public"."email_verifications"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));



  create policy "Customers can read their own access codes (by booking ownership"
  on "public"."rental_access_codes"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.bookings b
     JOIN public.customers c ON ((c.id = b.customer_id)))
  WHERE ((b.id = rental_access_codes.order_id) AND (c.user_id = auth.uid())))));



  create policy "customers_read_own_access_codes"
  on "public"."rental_access_codes"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM (public.bookings b
     JOIN public.customers c ON ((c.id = b.customer_id)))
  WHERE ((b.id = rental_access_codes.order_id) AND (c.user_id = auth.uid())))));



  create policy "public_insert_access_codes"
  on "public"."rental_access_codes"
  as permissive
  for insert
  to public
with check (true);



  create policy "service_role_full_access_rental_codes"
  on "public"."rental_access_codes"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));



  create policy "Allow anonymous read access to public reviews"
  on "public"."reviews"
  as permissive
  for select
  to public
using ((is_public = true));



  create policy "Allow anonymous read access to services"
  on "public"."services"
  as permissive
  for select
  to public
using (true);


CREATE TRIGGER ai_knowledge_base_updated_at BEFORE UPDATE ON public.ai_knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_updated_at();

CREATE TRIGGER ai_knowledge_sections_updated_at BEFORE UPDATE ON public.ai_knowledge_sections FOR EACH ROW EXECUTE FUNCTION public.update_ai_knowledge_updated_at();

CREATE TRIGGER on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleted_users();


  create policy "Admin write resource-covers"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-covers'::text));



  create policy "Admin write resource-files"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-files'::text));



  create policy "Admin write resource-pdfs"
  on "storage"."objects"
  as permissive
  for all
  to public
using ((bucket_id = 'resource-pdfs'::text));



  create policy "Allow authenticated deletes to verification-documents"
  on "storage"."objects"
  as permissive
  for delete
  to public
using (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow authenticated updates to verification-documents"
  on "storage"."objects"
  as permissive
  for update
  to public
using (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow authenticated uploads to verification-documents"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check (((bucket_id = 'verification-documents'::text) AND (auth.role() = 'authenticated'::text)));



  create policy "Allow public read for verification-documents"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'verification-documents'::text));



  create policy "Public read resource-covers"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-covers'::text));



  create policy "Public read resource-files"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-files'::text));



  create policy "Public read resource-pdfs"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'resource-pdfs'::text));



  create policy "TEMP_DEBUG_ALLOW_ALL_STORAGE"
  on "storage"."objects"
  as permissive
  for all
  to public
using (true)
with check (true);



