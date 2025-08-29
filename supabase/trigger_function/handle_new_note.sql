
BEGIN
    UPDATE public.customers
    SET has_unread_notes = TRUE
    WHERE id = NEW.customer_id;
    RETURN NEW;
END;
