import { supabase } from '@/lib/customSupabaseClient';
import { parseEdgeFunctionError } from '@/utils/parseEdgeFunctionError';

const BUCKET = 'verification-documents';
const SIGNED_URL_TTL_SECONDS = 3600;
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** Hostnames that appear in local Supabase signed URLs but are not reachable from the browser. */
const DOCKER_INTERNAL_HOSTNAMES = new Set(['kong', 'storage', 'rest', 'meta', 'auth']);

const isAbsoluteUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

function getBrowserSupabaseOrigin() {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }

  const raw = import.meta.env.VITE_SUPABASE_URL || '';
  return raw.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/i, '');
}

function isBrowserUnreachableStorageHost(hostname) {
  if (!hostname) return false;
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  if (DOCKER_INTERNAL_HOSTNAMES.has(hostname)) return true;
  // e.g. supabase_kong_u-filldumpsters, *.supabase_network.*
  if (hostname.startsWith('supabase_') || hostname.includes('_network')) return true;
  return false;
}

/**
 * In local dev, edge/storage may return signed URLs for 127.0.0.1:55421 or Docker-only
 * hosts like kong:8000. Rewrite onto the Vite origin so /storage/v1 is proxied and <img> loads.
 */
export function rewriteStorageUrlForCurrentOrigin(url) {
  if (!url || typeof url !== 'string') return url;

  try {
    const parsed = new URL(url);
    if (!parsed.pathname.includes('/storage/v1/')) {
      return url;
    }

    const targetOrigin = getBrowserSupabaseOrigin();
    if (!targetOrigin) return url;

    const targetHost = new URL(targetOrigin).hostname;

    if (import.meta.env.DEV && isBrowserUnreachableStorageHost(parsed.hostname)) {
      if (parsed.origin !== targetOrigin) {
        return `${targetOrigin}${parsed.pathname}${parsed.search}`;
      }
    }

    if (
      LOCAL_HOSTNAMES.has(parsed.hostname) &&
      LOCAL_HOSTNAMES.has(targetHost) &&
      parsed.origin !== targetOrigin
    ) {
      return `${targetOrigin}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // ignore invalid URLs
  }

  return url;
}

function getPathAndUrl(pathValue, urlValue) {
  const path = pathValue || extractStoragePath(urlValue);
  return { path, url: urlValue || null };
}

/**
 * Normalize a storage path from a raw path or legacy absolute public URL.
 */
export function extractStoragePath(pathOrUrl) {
  if (!pathOrUrl || typeof pathOrUrl !== 'string') return null;

  const trimmed = pathOrUrl.trim();
  if (!isAbsoluteUrl(trimmed)) {
    return trimmed.replace(/^\/+/, '');
  }

  const markers = [
    `/object/public/${BUCKET}/`,
    `/object/sign/${BUCKET}/`,
    `/object/authenticated/${BUCKET}/`,
  ];

  for (const marker of markers) {
    const idx = trimmed.indexOf(marker);
    if (idx >= 0) {
      return trimmed.slice(idx + marker.length).split('?')[0];
    }
  }

  const bucketIdx = trimmed.indexOf(`${BUCKET}/`);
  if (bucketIdx >= 0) {
    return trimmed.slice(bucketIdx + BUCKET.length + 1).split('?')[0];
  }

  return null;
}

export function isVerificationPdf(pathOrUrl) {
  if (!pathOrUrl) return false;
  return String(pathOrUrl).toLowerCase().includes('.pdf');
}

/** True when front, back, and insurance document slots are all present (URLs or storage paths). */
export function areVerificationDocumentsComplete(doc) {
  if (!doc) return false;
  const hasFront = Boolean(doc.license_front_url || doc.license_front_storage_path);
  const hasBack = Boolean(doc.license_back_url || doc.license_back_storage_path);
  const hasInsurance = Boolean(doc.insurance_url || doc.insurance_storage_path);
  return hasFront && hasBack && hasInsurance;
}

/**
 * Resolve a verification document to a browser-loadable URL using the current Supabase client.
 */
export async function resolveVerificationMediaUrl(pathOrUrl, options = {}) {
  const { preferSigned = true } = options;
  if (!pathOrUrl) return null;

  const path = extractStoragePath(pathOrUrl);
  if (!path) {
    return isAbsoluteUrl(pathOrUrl) ? pathOrUrl : null;
  }

  if (preferSigned) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

    if (!error && data?.signedUrl) {
      return rewriteStorageUrlForCurrentOrigin(data.signedUrl);
    }

    if (error) {
      console.warn('[resolveVerificationMediaUrl] signed URL failed:', path, error);
    }

    return null;
  }

  const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return rewriteStorageUrlForCurrentOrigin(publicData?.publicUrl || null);
}

async function signCheckoutVerificationPaths(customerId, email, paths, pendingToken = null) {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (uniquePaths.length === 0) {
    return {};
  }

  const { data, error } = await supabase.functions.invoke('sign-checkout-verification-urls', {
    body: {
      customer_id: customerId,
      email: email.trim().toLowerCase(),
      paths: uniquePaths,
      pending_token: pendingToken,
      site_url: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });

  if (error) {
    throw new Error(await parseEdgeFunctionError(error, data));
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to sign verification document URLs');
  }

  return data.signed_urls || {};
}

function mapCheckoutRpcRow(data) {
  const front = getPathAndUrl(data.license_front_storage_path, data.license_front_url);
  const back = getPathAndUrl(data.license_back_storage_path, data.license_back_url);
  const insurance = getPathAndUrl(data.insurance_storage_path, data.insurance_url);

  return {
    customer_id: data.customer_id,
    license_plate: data.license_plate || null,
    license_front_url: front.url,
    license_front_storage_path: front.path,
    license_back_url: back.url,
    license_back_storage_path: back.path,
    insurance_url: insurance.url,
    insurance_storage_path: insurance.path,
    verification_status: data.verification_status || null,
  };
}

export async function resolveVerificationDocumentSet(doc, options = {}) {
  if (!doc) return null;

  const { preferSigned = true } = options;
  const frontPath = doc.license_front_storage_path || extractStoragePath(doc.license_front_url);
  const backPath = doc.license_back_storage_path || extractStoragePath(doc.license_back_url);
  const insurancePath = doc.insurance_storage_path || extractStoragePath(doc.insurance_url);

  const [frontUrl, backUrl, insuranceUrl] = await Promise.all([
    resolveVerificationMediaUrl(doc.license_front_storage_path || doc.license_front_url, { preferSigned }),
    resolveVerificationMediaUrl(doc.license_back_storage_path || doc.license_back_url, { preferSigned }),
    resolveVerificationMediaUrl(doc.insurance_storage_path || doc.insurance_url, { preferSigned }),
  ]);

  const slotUrl = (resolvedUrl, storagePath, legacyUrl) => {
    if (resolvedUrl) return resolvedUrl;
    if (storagePath || extractStoragePath(legacyUrl)) return null;
    return legacyUrl || null;
  };

  return {
    ...doc,
    license_front_url: slotUrl(frontUrl, frontPath, doc.license_front_url),
    license_back_url: slotUrl(backUrl, backPath, doc.license_back_url),
    insurance_url: slotUrl(insuranceUrl, insurancePath, doc.insurance_url),
  };
}

export async function resolveCheckoutVerificationDocumentSet(doc, { customerId, email, pendingToken = null } = {}) {
  if (!doc) return null;

  const frontPath = doc.license_front_storage_path || extractStoragePath(doc.license_front_url);
  const backPath = doc.license_back_storage_path || extractStoragePath(doc.license_back_url);
  const insurancePath = doc.insurance_storage_path || extractStoragePath(doc.insurance_url);
  const paths = [frontPath, backPath, insurancePath].filter(Boolean);

  const normalizedDoc = {
    ...doc,
    license_front_storage_path: frontPath,
    license_back_storage_path: backPath,
    insurance_storage_path: insurancePath,
  };

  if (paths.length === 0) {
    return normalizedDoc;
  }

  try {
    const signedUrls = await signCheckoutVerificationPaths(customerId, email, paths, pendingToken);

    const resolveSlot = (path) => {
      if (path && signedUrls[path]) {
        return rewriteStorageUrlForCurrentOrigin(signedUrls[path]);
      }
      return null;
    };

    return {
      ...normalizedDoc,
      license_front_url: resolveSlot(frontPath),
      license_back_url: resolveSlot(backPath),
      insurance_url: resolveSlot(insurancePath),
    };
  } catch (error) {
    console.error('[resolveCheckoutVerificationDocumentSet] signing failed:', error);

    return {
      ...normalizedDoc,
      license_front_url: null,
      license_back_url: null,
      insurance_url: null,
    };
  }
}

async function invokeCheckoutVerificationFunction(formData) {
  const { data, error } = await supabase.functions.invoke('save-checkout-verification-docs', {
    body: formData,
  });

  if (error) {
    throw new Error(await parseEdgeFunctionError(error, data));
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to save verification documents');
  }

  return data;
}

/**
 * Checkout-safe load via SECURITY DEFINER RPC (anon booking flow).
 */
export async function getCheckoutVerificationDocuments(customerId, email, options = {}) {
  if (!customerId || !email?.includes('@')) return null;

  const { pendingToken = null } = options;

  const { data, error } = await supabase.rpc('get_checkout_verification_documents', {
    p_customer_id: Number(customerId),
    p_email: email.trim().toLowerCase(),
  });

  if (error) {
    console.error('[getCheckoutVerificationDocuments] RPC error:', error);
    throw error;
  }

  if (!data) return null;

  const mapped = mapCheckoutRpcRow(data);
  return resolveCheckoutVerificationDocumentSet(mapped, {
    customerId,
    email,
    pendingToken,
  });
}

/**
 * Checkout-safe save: uploads + DB upsert via edge function (service role).
 */
export async function saveCheckoutVerificationDocuments({
  customerId,
  email,
  pendingToken = null,
  licensePlate = null,
  licenseFrontFile = null,
  licenseBackFile = null,
  insuranceFile = null,
  existingFrontUrl = null,
  existingFrontPath = null,
  existingBackUrl = null,
  existingBackPath = null,
  existingInsuranceUrl = null,
  existingInsurancePath = null,
}) {
  const formData = new FormData();
  formData.append('customer_id', String(customerId));
  formData.append('email', email.trim().toLowerCase());
  if (pendingToken) formData.append('pending_token', pendingToken);
  if (licensePlate) formData.append('license_plate', licensePlate);
  if (typeof window !== 'undefined' && window.location?.origin) {
    formData.append('site_url', window.location.origin);
  }
  if (existingFrontUrl) formData.append('license_front_url', existingFrontUrl);
  if (existingFrontPath) formData.append('license_front_storage_path', existingFrontPath);
  if (existingBackUrl) formData.append('license_back_url', existingBackUrl);
  if (existingBackPath) formData.append('license_back_storage_path', existingBackPath);
  if (existingInsuranceUrl) formData.append('insurance_url', existingInsuranceUrl);
  if (existingInsurancePath) formData.append('insurance_storage_path', existingInsurancePath);
  if (licenseFrontFile) formData.append('license_front', licenseFrontFile);
  if (licenseBackFile) formData.append('license_back', licenseBackFile);
  if (insuranceFile) formData.append('insurance_document', insuranceFile);

  const result = await invokeCheckoutVerificationFunction(formData);
  const docs = result?.documents;
  if (!docs) return result;

  // Prefer edge-returned signed URLs; if any slot still looks like a public URL, re-sign.
  const resolved = await resolveCheckoutVerificationDocumentSet(
    {
      license_front_url: docs.license_front_url,
      license_front_storage_path: docs.license_front_storage_path,
      license_back_url: docs.license_back_url,
      license_back_storage_path: docs.license_back_storage_path,
      insurance_url: docs.insurance_url,
      insurance_storage_path: docs.insurance_storage_path,
    },
    { customerId, email, pendingToken },
  );

  return {
    ...result,
    documents: {
      license_front_url: resolved?.license_front_url || docs.license_front_url,
      license_front_storage_path: resolved?.license_front_storage_path || docs.license_front_storage_path,
      license_back_url: resolved?.license_back_url || docs.license_back_url,
      license_back_storage_path: resolved?.license_back_storage_path || docs.license_back_storage_path,
      insurance_url: resolved?.insurance_url || docs.insurance_url,
      insurance_storage_path: resolved?.insurance_storage_path || docs.insurance_storage_path,
    },
  };
}

/**
 * Attach pending checkout document URLs after email verification (no file re-upload).
 */
export async function attachCheckoutVerificationDocuments({
  customerId = null,
  email,
  pendingToken = null,
  licensePlate = null,
  licenseFrontUrl = null,
  licenseFrontPath = null,
  licenseBackUrl = null,
  licenseBackPath = null,
  insuranceUrl = null,
  insurancePath = null,
}) {
  const body = {
    action: 'attach',
    email: email.trim().toLowerCase(),
    pending_token: pendingToken,
    license_plate: licensePlate,
    license_front_url: licenseFrontUrl,
    license_front_storage_path: licenseFrontPath,
    license_back_url: licenseBackUrl,
    license_back_storage_path: licenseBackPath,
    insurance_url: insuranceUrl,
    insurance_storage_path: insurancePath,
  };

  if (customerId) {
    body.customer_id = customerId;
  }

  const { data, error } = await supabase.functions.invoke('save-checkout-verification-docs', {
    body,
  });

  if (error) {
    throw new Error(await parseEdgeFunctionError(error, data));
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to attach verification documents');
  }

  return data;
}

export const uploadVerificationImage = async (customerId, imageFile, imageType) => {
  if (!imageFile) throw new Error("No image file provided");

  // Anon checkout can only INSERT under unassigned-* (storage RLS). Authenticated
  // portal users may upload to their own customers/{id}/ folder. Never upload to
  // another customer's numeric folder from the browser — use save-checkout-verification-docs.
  const customerIdStr = String(customerId || '');
  const folderId = customerIdStr.startsWith('unassigned-')
    ? customerIdStr
    : /^\d+$/.test(customerIdStr)
      ? customerIdStr
      : `unassigned-${Date.now()}`;

  const fileExt = imageFile.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `customers/${folderId}/verification/${imageType}_${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('verification-documents')
    .upload(filePath, imageFile, {
      contentType: imageFile.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("Upload Error:", uploadError);
    throw uploadError;
  }

  // Prefer a signed URL when RLS allows (unassigned SELECT); else store path + public URL string.
  let url = null;
  const { data: signedData, error: signedError } = await supabase.storage
    .from('verification-documents')
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (!signedError && signedData?.signedUrl) {
    url = rewriteStorageUrlForCurrentOrigin(signedData.signedUrl);
  } else {
    const { data: publicUrlData } = supabase.storage
      .from('verification-documents')
      .getPublicUrl(filePath);
    url = rewriteStorageUrlForCurrentOrigin(publicUrlData.publicUrl);
  }

  return {
    url,
    path: filePath
  };
};

export const saveVerificationDocumentToDb = async (
  customerId,
  frontUrl,
  frontPath,
  backUrl,
  backPath,
  status = 'pending', // Pass 'approved' when front+back+insurance are all present
  insuranceUrl = null,
  insurancePath = null,
) => {
  if (!customerId || customerId.toString().startsWith('unassigned')) {
    console.warn("Valid Customer ID is required to save verification documents. Falling back gracefully.");
    return null;
  }

  const payload = {
    customer_id: customerId,
    license_front_url: frontUrl,
    license_front_storage_path: frontPath,
    license_back_url: backUrl,
    license_back_storage_path: backPath,
    uploaded_at: new Date().toISOString(),
    verification_status: status,
  };

  if (insuranceUrl || insurancePath) {
    payload.insurance_url = insuranceUrl;
    payload.insurance_storage_path = insurancePath;
  } else {
    const existing = await getVerificationDocumentsByCustomerId(customerId);
    if (existing?.insurance_url || existing?.insurance_storage_path) {
      payload.insurance_url = existing.insurance_url;
      payload.insurance_storage_path = existing.insurance_storage_path;
    }
  }

  // Using upsert handles both INSERT (if no record exists) and UPDATE (if record exists)
  const { data, error } = await supabase
    .from('driver_verification_documents')
    .upsert(payload, { onConflict: 'customer_id' })
    .select()
    .maybeSingle();

  if (error) {
    console.error("DB Save Error:", error);
    throw error;
  }
  return data;
};

export const getVerificationDocumentsByCustomerId = async (customerId) => {
  if (!customerId) return null;
  
  // Use maybeSingle to gracefully handle cases where no record exists (returns null instead of throwing an error)
  const { data, error } = await supabase
    .from('driver_verification_documents')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) {
    console.error("Fetch Error:", error);
    throw error;
  }
  
  return data;
};

/**
 * Merges driver_verification_documents with legacy customers.license_image_urls so
 * license, insurance, and audit history stay visible for older records.
 */
export const getMergedVerificationDocumentsByCustomerId = async (customerId) => {
  if (!customerId) return null;

  const [doc, customerResult] = await Promise.all([
    getVerificationDocumentsByCustomerId(customerId),
    supabase.from('customers').select('license_image_urls').eq('id', customerId).maybeSingle(),
  ]);

  if (customerResult.error) {
    console.error('Customer license fetch error:', customerResult.error);
    throw customerResult.error;
  }

  const legacyUrls = customerResult.data?.license_image_urls;
  const legacyFront = Array.isArray(legacyUrls) ? legacyUrls[0] : null;
  const legacyBack = Array.isArray(legacyUrls) && legacyUrls.length > 1 ? legacyUrls[1] : null;

  const merged = {
    ...(doc || {}),
    customer_id: customerId,
    license_front_url: doc?.license_front_url || legacyFront?.url || null,
    license_front_storage_path:
      doc?.license_front_storage_path ||
      legacyFront?.path ||
      extractStoragePath(doc?.license_front_url || legacyFront?.url),
    license_back_url: doc?.license_back_url || legacyBack?.url || null,
    license_back_storage_path:
      doc?.license_back_storage_path ||
      legacyBack?.path ||
      extractStoragePath(doc?.license_back_url || legacyBack?.url),
    insurance_url: doc?.insurance_url || null,
    insurance_storage_path:
      doc?.insurance_storage_path || extractStoragePath(doc?.insurance_url),
    verification_status: doc?.verification_status || (legacyFront?.url ? 'legacy' : doc?.verification_status || null),
  };

  const hasAnyDocument =
    merged.license_front_storage_path ||
    merged.license_back_storage_path ||
    merged.insurance_storage_path ||
    merged.license_front_url ||
    merged.license_back_url ||
    merged.insurance_url;

  return hasAnyDocument ? merged : null;
};

export const downloadVerificationImage = async (storagePath, filename = 'verification-doc') => {
  if (!storagePath) throw new Error("No storage path provided");
  
  try {
    const { data, error } = await supabase.storage
      .from('verification-documents')
      .download(storagePath);
      
    if (error) throw error;

    const blob = data;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error("Download Error:", error);
    throw error;
  }
};

export const updateVerificationStatus = async (customerId, status, verifiedBy) => {
  if (!customerId) return null;

  const { data, error } = await supabase
    .from('driver_verification_documents')
    .update({
      verification_status: status,
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy
    })
    .eq('customer_id', customerId)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Status Update Error:", error);
    throw error;
  }
  return data;
};