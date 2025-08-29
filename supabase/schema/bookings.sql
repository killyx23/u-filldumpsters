create table public.bookings (
  id bigint generated always as identity not null,
  created_at timestamp with time zone not null default timezone ('utc'::text, now()),
  name text not null,
  email text not null,
  phone text not null,
  street text not null,
  city text not null,
  state text not null,
  zip text not null,
  drop_off_date date not null,
  pickup_date date not null,
  plan jsonb not null,
  addons jsonb not null,
  total_price real not null,
  status text null default 'pending_payment'::text,
  delivered_at timestamp with time zone null,
  picked_up_at timestamp with time zone null,
  drop_off_time_slot text null,
  pickup_time_slot text null,
  notes text null,
  customer_id bigint null,
  rented_out_at timestamp with time zone null,
  returned_at timestamp with time zone null,
  equipment_status text null default 'Pending'::text,
  return_issues jsonb null,
  damage_photos jsonb null,
  fees jsonb null,
  verification_notes text null,
  refund_details jsonb null,
  is_manually_verified boolean not null default false,
  was_verification_skipped boolean null default false,
  constraint bookings_pkey primary key (id),
  constraint bookings_customer_id_fkey foreign KEY (customer_id) references customers (id)
) TABLESPACE pg_default;

create index IF not exists idx_bookings_customer_id on public.bookings using btree (customer_id) TABLESPACE pg_default;

create trigger on_booking_insert BEFORE INSERT on bookings for EACH row
execute FUNCTION handle_new_booking ();

create trigger on_booking_insert_or_update_create_note
after INSERT
or
update on bookings for EACH row
execute FUNCTION add_booking_notes_to_customer_notes ();