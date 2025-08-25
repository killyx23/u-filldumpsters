
BEGIN
    -- This function handles both new rentals (INSERT) and returns (UPDATE)

    IF (TG_OP = 'INSERT') THEN
        -- On a new booking_equipment record, DECREMENT the total quantity
        UPDATE equipment e
        SET total_quantity = e.total_quantity - NEW.quantity
        WHERE e.id = NEW.equipment_id;
        RETURN NEW;
    END IF;

    IF (TG_OP = 'UPDATE') THEN
        -- On an update, if returned_at is newly set, INCREMENT the quantity
        -- This ensures we only add back to inventory once.
        IF OLD.returned_at IS NULL AND NEW.returned_at IS NOT NULL THEN
            UPDATE equipment e
            SET total_quantity = e.total_quantity + OLD.quantity -- Use OLD quantity to prevent exploits
            WHERE e.id = OLD.equipment_id;
        -- Optional: handle case where a return is undone
        ELSIF OLD.returned_at IS NOT NULL AND NEW.returned_at IS NULL THEN
             UPDATE equipment e
            SET total_quantity = e.total_quantity - OLD.quantity
            WHERE e.id = OLD.equipment_id;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NULL;
END;
