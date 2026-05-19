-- Sync legacy equipment ID 7 (Premium Insurance) with canonical services.id = 7 price ($25)
UPDATE public.services
SET base_price = 25.00
WHERE id = 7 AND (base_price IS NULL OR base_price <> 25.00);

UPDATE public.equipment
SET price = 25.00
WHERE id = 7 AND (price IS NULL OR price <> 25.00);

UPDATE public.equipment_pricing
SET base_price = 25.00,
    last_updated = NOW()
WHERE equipment_id = 7 AND (base_price IS NULL OR base_price <> 25.00);
