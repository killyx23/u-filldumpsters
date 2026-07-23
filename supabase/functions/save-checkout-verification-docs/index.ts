import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCorsHeaders } from './cors.ts';

type DocFields = {
  license_front_url: string | null;
  license_front_storage_path: string | null;
  license_back_url: string | null;
  license_back_storage_path: string | null;
  insurance_url: string | null;
  insurance_storage_path: string | null;
};

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase();
}

async function customerMatchesEmail(
  supabase: ReturnType<typeof createClient>,
  customerId: number,
  email: string,
) {
  const { data, error } = await supabase
    .from('customers')
    .select('id, email')
    .eq('id', customerId)
    .maybeSingle();

  if (error || !data) return false;
  return normalizeEmail(data.email) === normalizeEmail(email);
}

async function isCheckoutAuthorized(
  supabase: ReturnType<typeof createClient>,
  customerId: number,
  email: string,
  pendingToken: string | null,
) {
  if (!(await customerMatchesEmail(supabase, customerId, email))) {
    return { ok: false, error: 'Customer email does not match' };
  }

  const normalizedEmail = normalizeEmail(email);

  const { data: verification } = await supabase
    .from('email_verifications')
    .select('is_verified')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (verification?.is_verified) {
    return { ok: true };
  }

  if (pendingToken) {
    const { data: pending } = await supabase
      .from('pending_customers')
      .select('email, is_verified')
      .eq('id', pendingToken)
      .maybeSingle();

    if (pending && normalizeEmail(pending.email) === normalizedEmail && pending.is_verified) {
      return { ok: true };
    }
  }

  return { ok: false, error: 'Email must be verified before saving documents' };
}

const SIGNED_URL_TTL_SECONDS = 3600;
const LOCAL_HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
const DOCKER_INTERNAL_HOST_PATTERN = /^(kong|storage|rest|meta|auth)$/i;

function isLocalOrDockerHost(hostname: string) {
  return (
    LOCAL_HOST_PATTERN.test(hostname) ||
    DOCKER_INTERNAL_HOST_PATTERN.test(hostname) ||
    hostname.startsWith('supabase_') ||
    hostname.includes('_network')
  );
}

function rewriteSignedUrlForSite(url: string, siteUrl: string | null) {
  if (!url || !siteUrl) return url;
  try {
    const signed = new URL(url);
    const site = new URL(siteUrl);
    if (
      isLocalOrDockerHost(signed.hostname) &&
      LOCAL_HOST_PATTERN.test(site.hostname) &&
      signed.origin !== site.origin
    ) {
      return `${site.origin}${signed.pathname}${signed.search}`;
    }
  } catch {
    // ignore
  }
  return url;
}

async function uploadFile(
  supabase: ReturnType<typeof createClient>,
  customerId: number,
  imageType: string,
  file: File,
) {
  const fileExt = file.name.split('.').pop() || 'bin';
  const filePath = `customers/${customerId}/verification/${imageType}_${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('verification-documents')
    .upload(filePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data: publicUrlData } = supabase.storage.from('verification-documents').getPublicUrl(filePath);

  return {
    url: publicUrlData.publicUrl,
    path: filePath,
  };
}

async function signDocumentPaths(
  supabase: ReturnType<typeof createClient>,
  fields: DocFields,
  siteUrl: string | null = null,
) {
  const paths = [
    fields.license_front_storage_path,
    fields.license_back_storage_path,
    fields.insurance_storage_path,
  ].filter(Boolean) as string[];

  const signedByPath: Record<string, string> = {};
  for (const path of paths) {
    const { data, error } = await supabase.storage
      .from('verification-documents')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (!error && data?.signedUrl) {
      signedByPath[path] = rewriteSignedUrlForSite(data.signedUrl, siteUrl);
    }
  }

  return {
    license_front_url: fields.license_front_storage_path
      ? signedByPath[fields.license_front_storage_path] || fields.license_front_url
      : fields.license_front_url,
    license_front_storage_path: fields.license_front_storage_path,
    license_back_url: fields.license_back_storage_path
      ? signedByPath[fields.license_back_storage_path] || fields.license_back_url
      : fields.license_back_url,
    license_back_storage_path: fields.license_back_storage_path,
    insurance_url: fields.insurance_storage_path
      ? signedByPath[fields.insurance_storage_path] || fields.insurance_url
      : fields.insurance_url,
    insurance_storage_path: fields.insurance_storage_path,
  };
}

async function upsertVerificationDocuments(
  supabase: ReturnType<typeof createClient>,
  customerId: number,
  fields: DocFields,
  licensePlate: string | null,
) {
  const { data: existing } = await supabase
    .from('driver_verification_documents')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();

  const payload = {
    customer_id: customerId,
    license_front_url: fields.license_front_url ?? existing?.license_front_url ?? null,
    license_front_storage_path: fields.license_front_storage_path ?? existing?.license_front_storage_path ?? null,
    license_back_url: fields.license_back_url ?? existing?.license_back_url ?? null,
    license_back_storage_path: fields.license_back_storage_path ?? existing?.license_back_storage_path ?? null,
    insurance_url: fields.insurance_url ?? existing?.insurance_url ?? null,
    insurance_storage_path: fields.insurance_storage_path ?? existing?.insurance_storage_path ?? null,
    uploaded_at: new Date().toISOString(),
    verification_status: 'pending',
  };

  const { data, error } = await supabase
    .from('driver_verification_documents')
    .upsert(payload, { onConflict: 'customer_id' })
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (licensePlate) {
    const { error: customerError } = await supabase
      .from('customers')
      .update({
        license_plate: licensePlate,
        has_incomplete_verification: false,
      })
      .eq('id', customerId);

    if (customerError) {
      throw customerError;
    }
  }

  return data;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ success: false, error: 'Server configuration error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await req.json();
      const action = String(body.action || 'attach');
      const email = normalizeEmail(body.email);
      const pendingToken = body.pending_token ? String(body.pending_token) : null;
      const licensePlate = body.license_plate ? String(body.license_plate).toUpperCase() : null;

      if (!email.includes('@')) {
        return new Response(JSON.stringify({ success: false, error: 'email is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let customerId = Number(body.customer_id);
      if (!customerId) {
        const { data: customerRow } = await supabase
          .from('customers')
          .select('id')
          .ilike('email', email)
          .maybeSingle();
        customerId = customerRow?.id ? Number(customerRow.id) : 0;
      }

      if (!customerId) {
        return new Response(JSON.stringify({ success: true, skipped: true, reason: 'no_customer' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const auth = await isCheckoutAuthorized(supabase, customerId, email, pendingToken);
      if (!auth.ok) {
        return new Response(JSON.stringify({ success: false, error: auth.error }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const fields: DocFields = {
        license_front_url: body.license_front_url ?? null,
        license_front_storage_path: body.license_front_storage_path ?? null,
        license_back_url: body.license_back_url ?? null,
        license_back_storage_path: body.license_back_storage_path ?? null,
        insurance_url: body.insurance_url ?? null,
        insurance_storage_path: body.insurance_storage_path ?? null,
      };

      const data = await upsertVerificationDocuments(supabase, customerId, fields, licensePlate);

      return new Response(JSON.stringify({ success: true, data, action }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const form = await req.formData();
    const customerId = Number(form.get('customer_id'));
    const email = normalizeEmail(String(form.get('email') || ''));
    const pendingToken = form.get('pending_token') ? String(form.get('pending_token')) : null;
    const licensePlate = form.get('license_plate') ? String(form.get('license_plate')).toUpperCase() : null;
    const siteUrl = form.get('site_url') ? String(form.get('site_url')).trim() : null;

    if (!customerId || !email.includes('@')) {
      return new Response(JSON.stringify({ success: false, error: 'customer_id and email are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const auth = await isCheckoutAuthorized(supabase, customerId, email, pendingToken);
    if (!auth.ok) {
      return new Response(JSON.stringify({ success: false, error: auth.error }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const frontFile = form.get('license_front');
    const backFile = form.get('license_back');
    const insuranceFile = form.get('insurance_document');

    const fields: DocFields = {
      license_front_url: form.get('license_front_url') ? String(form.get('license_front_url')) : null,
      license_front_storage_path: form.get('license_front_storage_path')
        ? String(form.get('license_front_storage_path'))
        : null,
      license_back_url: form.get('license_back_url') ? String(form.get('license_back_url')) : null,
      license_back_storage_path: form.get('license_back_storage_path')
        ? String(form.get('license_back_storage_path'))
        : null,
      insurance_url: form.get('insurance_url') ? String(form.get('insurance_url')) : null,
      insurance_storage_path: form.get('insurance_storage_path')
        ? String(form.get('insurance_storage_path'))
        : null,
    };

    if (frontFile instanceof File && frontFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'license_front', frontFile);
      fields.license_front_url = uploaded.url;
      fields.license_front_storage_path = uploaded.path;
    }

    if (backFile instanceof File && backFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'license_back', backFile);
      fields.license_back_url = uploaded.url;
      fields.license_back_storage_path = uploaded.path;
    }

    if (insuranceFile instanceof File && insuranceFile.size > 0) {
      const uploaded = await uploadFile(supabase, customerId, 'insurance_document', insuranceFile);
      fields.insurance_url = uploaded.url;
      fields.insurance_storage_path = uploaded.path;
    }

    const data = await upsertVerificationDocuments(supabase, customerId, fields, licensePlate);
    const documents = await signDocumentPaths(supabase, fields, siteUrl);

    return new Response(
      JSON.stringify({
        success: true,
        data,
        documents,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[save-checkout-verification-docs] error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
