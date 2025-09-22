
BEGIN
    -- Generates a random 6-digit number and prepends 'CID-'
    NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    -- Check for uniqueness and regenerate if it exists (highly unlikely but good practice)
    WHILE EXISTS(SELECT 1 FROM public.customers WHERE customer_id_text = NEW.customer_id_text) LOOP
        NEW.customer_id_text := 'CID-' || LPAD(FLOOR(random() * 1000000)::text, 6, '0');
    END LOOP;
    RETURN NEW;
END;
