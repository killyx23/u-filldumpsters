
  create table "public"."pending_customers" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "name" text,
    "phone" text,
    "street" text,
    "city" text,
    "state" text,
    "zip" text,
    "created_at" timestamp with time zone default now(),
    "is_verified" boolean default false,
    "booking_id" bigint,
    "service_id" integer,
    "plan_data" jsonb,
    "total_price" numeric(10,2),
    "base_price" numeric(10,2),
    "drop_off_date" date,
    "pickup_date" date,
    "drop_off_time_slot" text,
    "pickup_time_slot" text,
    "addons_data" jsonb,
    "booking_data" jsonb,
    "delivery_service" boolean default false,
    "verified_at" timestamp with time zone,
    "first_name" text,
    "last_name" text,
    "contact_address" jsonb,
    "delivery_address" jsonb,
    "notes" text
      );


alter table "public"."pending_customers" enable row level security;

CREATE INDEX idx_pending_customers_booking_id ON public.pending_customers USING btree (booking_id);

CREATE INDEX idx_pending_customers_email ON public.pending_customers USING btree (email);

CREATE INDEX idx_pending_customers_verified ON public.pending_customers USING btree (is_verified);

CREATE UNIQUE INDEX pending_customers_email_key ON public.pending_customers USING btree (email);

CREATE UNIQUE INDEX pending_customers_pkey ON public.pending_customers USING btree (id);

alter table "public"."pending_customers" add constraint "pending_customers_pkey" PRIMARY KEY using index "pending_customers_pkey";

alter table "public"."pending_customers" add constraint "pending_customers_email_key" UNIQUE using index "pending_customers_email_key";

grant delete on table "public"."pending_customers" to "anon";

grant insert on table "public"."pending_customers" to "anon";

grant references on table "public"."pending_customers" to "anon";

grant select on table "public"."pending_customers" to "anon";

grant trigger on table "public"."pending_customers" to "anon";

grant truncate on table "public"."pending_customers" to "anon";

grant update on table "public"."pending_customers" to "anon";

grant delete on table "public"."pending_customers" to "authenticated";

grant insert on table "public"."pending_customers" to "authenticated";

grant references on table "public"."pending_customers" to "authenticated";

grant select on table "public"."pending_customers" to "authenticated";

grant trigger on table "public"."pending_customers" to "authenticated";

grant truncate on table "public"."pending_customers" to "authenticated";

grant update on table "public"."pending_customers" to "authenticated";

grant delete on table "public"."pending_customers" to "service_role";

grant insert on table "public"."pending_customers" to "service_role";

grant references on table "public"."pending_customers" to "service_role";

grant select on table "public"."pending_customers" to "service_role";

grant trigger on table "public"."pending_customers" to "service_role";

grant truncate on table "public"."pending_customers" to "service_role";

grant update on table "public"."pending_customers" to "service_role";


  create policy "public_insert_pending_customers"
  on "public"."pending_customers"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "public_select_pending_customers"
  on "public"."pending_customers"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "public_update_pending_customers"
  on "public"."pending_customers"
  as permissive
  for update
  to anon, authenticated
using (true)
with check (true);



  create policy "service_role_full_access_pending_customers"
  on "public"."pending_customers"
  as permissive
  for all
  to service_role
using (true)
with check (true);




