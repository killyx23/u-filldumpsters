create table public.customers (
  id bigserial not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  name text not null,
  email text not null,
  phone text null,
  street text null,
  city text null,
  state text null,
  zip text null,
  stripe_customer_id text null,
  notes text null,
  unverified_address boolean null default false,
  license_plate text null,
  has_unread_notes boolean not null default false,
  license_image_urls jsonb null,
  has_incomplete_verification boolean null default false,
  admin_notes text null,
  constraint customers_pkey primary key (id),
  constraint customers_email_key unique (email),
  constraint customers_stripe_customer_id_key unique (stripe_customer_id)
) TABLESPACE pg_default;

create index IF not exists idx_customers_user_id on public.customers using btree (id) TABLESPACE pg_default;