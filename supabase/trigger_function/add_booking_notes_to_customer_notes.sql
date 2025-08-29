
BEGIN
  -- We only want to add notes on creation or specific updates, not every change.
  IF TG_OP = 'INSERT' THEN
    IF NEW.notes IS NOT NULL AND NEW.notes <> '' THEN
      INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (NEW.customer_id, NEW.id, 'Booking Special Instructions', NEW.notes);
    END IF;

    IF NEW.verification_notes IS NOT NULL AND NEW.verification_notes <> '' THEN
       INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (NEW.customer_id, NEW.id, 'Verification Skip Reason', NEW.verification_notes);
    END IF;
  
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if the booking was just cancelled with a refund
    IF OLD.status <> 'Cancelled' AND NEW.status = 'Cancelled' AND NEW.refund_details IS NOT NULL THEN
      INSERT INTO public.customer_notes (customer_id, booking_id, source, content)
      VALUES (
        NEW.customer_id, 
        NEW.id, 
        'Booking Cancellation & Refund', 
        'Booking was cancelled. A refund of $' || (NEW.refund_details->>'amount')::numeric(10,2) || ' was processed. Reason: ' || (NEW.refund_details->>'reason')
      );
    END IF;
  END IF;

  RETURN NEW;
END;
