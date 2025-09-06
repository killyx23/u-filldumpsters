create table public.services (
  id integer not null,
  name text not null,
  description text null,
  service_type text not null,
  constraint services_pkey primary key (id)
) TABLESPACE pg_default;