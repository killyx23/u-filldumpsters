/**
 * lookup-tax-rate Edge Function
 *
 * Returns the combined sales tax rate for a given ZIP code using TaxJar.
 * Results are cached in the tax_rate_cache table (TTL = 30 days).
 *
 * Required env vars:
 *   TAXJAR_API_KEY  – TaxJar API token (app.taxjar.com -> Account -> API Access)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY – auto-provided by Edge Runtime
 *
 * Request:  POST { zip_code: string, delivery_type?: string }
 * Response: { rate: number, source: "taxjar"|"cache"|"fallback", jurisdiction?: string }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCorsHeaders } from "./cors.ts";

const CACHE_TTL_DAYS = 30;
const FALLBACK_RATE  = 7.45; // Saratoga Springs, UT combined rate

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const zip_code = body.zip_code;

    if (!zip_code) {
      return jsonResponse({ rate: FALLBACK_RATE, source: 'fallback', error: 'zip_code required' }, 400);
    }

    const cleanZip = String(zip_code).trim().substring(0, 5);
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Check cache
    const { data: cached } = await supabase
      .from('tax_rate_cache')
      .select('rate, jurisdiction, fetched_at')
      .eq('zip_code', cleanZip)
      .maybeSingle();

    if (cached) {
      const ageMs   = Date.now() - new Date(cached.fetched_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < CACHE_TTL_DAYS) {
        return jsonResponse({ rate: Number(cached.rate), source: 'cache', jurisdiction: cached.jurisdiction });
      }
    }

    // 2. TaxJar API lookup
    const taxjarKey = Deno.env.get('TAXJAR_API_KEY');
    if (!taxjarKey) {
      console.warn('[lookup-tax-rate] TAXJAR_API_KEY not set; using fallback rate');
      return jsonResponse({ rate: FALLBACK_RATE, source: 'fallback' });
    }

    const taxjarRes = await fetch(
      `https://api.taxjar.com/v2/rates/${encodeURIComponent(cleanZip)}?country=US`,
      {
        headers: {
          Authorization: `Token token="${taxjarKey}"`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!taxjarRes.ok) {
      const errText = await taxjarRes.text();
      console.error(`[lookup-tax-rate] TaxJar error ${taxjarRes.status}:`, errText);
      return jsonResponse({ rate: FALLBACK_RATE, source: 'fallback' });
    }

    const taxjarData = await taxjarRes.json();
    const r = taxjarData.rate;

    // TaxJar returns rates as decimals (e.g. 0.0745); convert to percentage
    const combinedRate = Math.round(parseFloat(r.combined_rate) * 10000) / 100;
    const jurisdiction = `${r.city}, ${r.state} ${cleanZip}`;

    // 3. Upsert cache
    await supabase.from('tax_rate_cache').upsert({
      zip_code:     cleanZip,
      rate:         combinedRate,
      jurisdiction,
      state_rate:   r.state_rate  ? Math.round(parseFloat(r.state_rate)  * 10000) / 100 : null,
      county_rate:  r.county_rate ? Math.round(parseFloat(r.county_rate) * 10000) / 100 : null,
      city_rate:    r.city_rate   ? Math.round(parseFloat(r.city_rate)   * 10000) / 100 : null,
      fetched_at:   new Date().toISOString(),
    }, { onConflict: 'zip_code' });

    return jsonResponse({ rate: combinedRate, source: 'taxjar', jurisdiction });

  } catch (err) {
    console.error('[lookup-tax-rate] Unexpected error:', err);
    return jsonResponse({ rate: FALLBACK_RATE, source: 'fallback', error: err.message }, 500);
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
