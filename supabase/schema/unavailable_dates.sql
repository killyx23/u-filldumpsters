create table public.unavailable_dates (
  id bigint generated always as identity not null,
  date date not null,
  reason text null,
  created_at timestamp with time zone not null default now(),
  service_id integer null,
  constraint unavailable_dates_pkey primary key (id),
  constraint unavailable_dates_date_key unique (date),
  constraint fk_service foreign KEY (service_id) references services (id) on delete set null
) TABLESPACE pg_default;