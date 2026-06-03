import { supabase } from '@/lib/customSupabaseClient';

export const uploadVerificationImage = async (customerId, imageFile, imageType) => {
  if (!imageFile) throw new Error("No image file provided");
  
  const fileExt = imageFile.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `customers/${customerId}/verification/${imageType}_${fileName}`;

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

  const { data: publicUrlData } = supabase.storage
    .from('verification-documents')
    .getPublicUrl(filePath);

  return {
    url: publicUrlData.publicUrl,
    path: filePath
  };
};

export const saveVerificationDocumentToDb = async (
  customerId,
  frontUrl,
  frontPath,
  backUrl,
  backPath,
  status = 'pending',
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

  if (insuranceUrl) {
    payload.insurance_url = insuranceUrl;
    payload.insurance_storage_path = insurancePath;
  } else {
    const existing = await getVerificationDocumentsByCustomerId(customerId);
    if (existing?.insurance_url) {
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
    license_front_storage_path: doc?.license_front_storage_path || legacyFront?.path || null,
    license_back_url: doc?.license_back_url || legacyBack?.url || null,
    license_back_storage_path: doc?.license_back_storage_path || legacyBack?.path || null,
    insurance_url: doc?.insurance_url || null,
    insurance_storage_path: doc?.insurance_storage_path || null,
    verification_status: doc?.verification_status || (legacyFront?.url ? 'legacy' : doc?.verification_status || null),
  };

  const hasAnyDocument =
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