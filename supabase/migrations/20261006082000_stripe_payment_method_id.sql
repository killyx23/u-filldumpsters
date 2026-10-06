alter table public.stripe_payment_info
  add column if not exists stripe_payment_method_id text;
