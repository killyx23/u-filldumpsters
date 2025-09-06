
DECLARE
    customer_id_var bigint;
BEGIN
    -- Check if a customer with the given email already exists
    SELECT id INTO customer_id_var FROM public.customers WHERE email = contact_email;

    -- If customer doesn't exist, create a new one
    IF customer_id_var IS NULL THEN
        INSERT INTO public.customers (name, email)
        VALUES (contact_name, contact_email)
        RETURNING id INTO customer_id_var;
    END IF;

    -- Insert the message as a note linked to the customer
    INSERT INTO public.customer_notes (customer_id, source, content)
    VALUES (customer_id_var, 'Contact Form Inquiry', contact_message);
END;
