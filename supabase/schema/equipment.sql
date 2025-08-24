create table public.equipment (
  id bigint generated always as identity not null,
  name text not null,
  total_quantity integer not null default 0,
  created_at timestamp with time zone not null default now(),
  blocks_all_services_when_rented boolean null default false,
  constraint equipment_pkey primary key (id),
  constraint equipment_name_key unique (name)
) TABLESPACE pg_default;