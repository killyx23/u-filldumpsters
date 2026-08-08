-- Add auto insurance document fields to driver verification records.

ALTER TABLE public.driver_verification_documents
  ADD COLUMN IF NOT EXISTS insurance_url text,
  ADD COLUMN IF NOT EXISTS insurance_storage_path text;

CREATE OR REPLACE FUNCTION public.log_verification_image_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Handle Front License Changes
    IF TG_OP = 'INSERT' AND NEW.license_front_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_front', NEW.license_front_storage_path, NEW.license_front_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.license_front_url IS DISTINCT FROM OLD.license_front_url AND NEW.license_front_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_front', NEW.license_front_storage_path, NEW.license_front_url, 'replaced', NEW.verified_by);
    END IF;

    -- Handle Back License Changes
    IF TG_OP = 'INSERT' AND NEW.license_back_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_back', NEW.license_back_storage_path, NEW.license_back_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.license_back_url IS DISTINCT FROM OLD.license_back_url AND NEW.license_back_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'license_back', NEW.license_back_storage_path, NEW.license_back_url, 'replaced', NEW.verified_by);
    END IF;

    -- Handle Insurance Document Changes
    IF TG_OP = 'INSERT' AND NEW.insurance_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'insurance_document', NEW.insurance_storage_path, NEW.insurance_url, 'uploaded', NEW.verified_by);
    ELSIF TG_OP = 'UPDATE' AND NEW.insurance_url IS DISTINCT FROM OLD.insurance_url AND NEW.insurance_url IS NOT NULL THEN
        INSERT INTO public.verification_image_history (customer_id, document_id, image_type, storage_path, url, action, uploaded_by)
        VALUES (NEW.customer_id, NEW.id, 'insurance_document', NEW.insurance_storage_path, NEW.insurance_url, 'replaced', NEW.verified_by);
    END IF;

    RETURN NEW;
END;
$$;
