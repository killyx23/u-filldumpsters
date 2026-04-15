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
      upsert: true
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

export const saveVerificationDocumentToDb = async (customerId, frontUrl, frontPath, backUrl, backPath, status = 'pending') => {
  if (!customerId || customerId.toString().startsWith('unassigned')) {
    console.warn("Valid Customer ID is required to save verification documents. Falling back gracefully.");
    return null;
  }

  // Using upsert handles both INSERT (if no record exists) and UPDATE (if record exists)
  const { data, error } = await supabase
    .from('driver_verification_documents')
    .upsert({
      customer_id: customerId,
      license_front_url: frontUrl,
      license_front_storage_path: frontPath,
      license_back_url: backUrl,
      license_back_storage_path: backPath,
      uploaded_at: new Date().toISOString(),
      verification_status: status
    }, { onConflict: 'customer_id' })
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