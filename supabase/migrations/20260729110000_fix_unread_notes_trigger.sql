-- Only customer-authored unread notes should raise admin unread badges.
-- Recompute stuck has_unread_notes flags from actual unread customer notes.

CREATE OR REPLACE FUNCTION public.handle_new_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.author_type = 'customer' AND COALESCE(NEW.is_read, false) = false THEN
    UPDATE public.customers
       SET has_unread_notes = TRUE
     WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Backfill: align denormalized flag with unread customer notes only
UPDATE public.customers c
   SET has_unread_notes = EXISTS (
     SELECT 1
       FROM public.customer_notes cn
      WHERE cn.customer_id = c.id
        AND cn.is_read = FALSE
        AND cn.author_type = 'customer'
   );
