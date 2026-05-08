-- Migration E: Create tax_rate_cache table for the lookup-tax-rate edge function.
--
-- The lookup-tax-rate edge function (TaxJar integration) caches results here
-- keyed by ZIP code. The edge function refreshes entries older than 30 days.
--
-- Enable by:
--   1. Setting TAXJAR_API_KEY in Supabase project secrets (Settings > Edge Functions > Secrets).
--   2. Setting VITE_TAX_API_ENABLED=true in your .env.local or Vercel env vars.
--   3. Deploying supabase/functions/lookup-tax-rate to Supabase.

CREATE TABLE IF NOT EXISTS public.tax_rate_cache (
  zip_code     text         PRIMARY KEY,
  rate         numeric      NOT NULL,
  jurisdiction text,
  state_rate   numeric,
  county_rate  numeric,
  city_rate    numeric,
  fetched_at   timestamp with time zone NOT NULL DEFAULT now(),
  created_at   timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_rate_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.tax_rate_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.tax_rate_cache IS
  'Cache of ZIP-code sales tax rates from TaxJar. TTL enforced by lookup-tax-rate edge function (30 days).';
COMMENT ON COLUMN public.tax_rate_cache.rate IS
  'Combined state+county+city rate as a percentage (e.g. 7.45 for 7.45%)';

-- Seed Saratoga Springs, UT as baseline so the cache is never empty on first deploy.
INSERT INTO public.tax_rate_cache (zip_code, rate, jurisdiction, state_rate, county_rate, city_rate)
VALUES ('84045', 7.45, 'Saratoga Springs, UT 84045', 4.85, 2.0, 0.6)
ON CONFLICT (zip_code) DO NOTHING;
