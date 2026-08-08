-- Create charges and fees configuration table
CREATE TABLE IF NOT EXISTS public.charges_and_fees (
    id BIGSERIAL PRIMARY KEY,
    fee_key VARCHAR(100) UNIQUE NOT NULL,
    fee_name VARCHAR(255) NOT NULL,
    fee_description TEXT,
    fee_value NUMERIC(10, 2) NOT NULL,
    is_percentage BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert baseline values for dynamic website fields
INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES
('extension_fee', 'Extension Fee', 'Fee charged for rental period extensions requested 24 hours in advance.', 75.00, false),
('dry_run_percentage', 'Dry Run Percentage Rate', 'The baseline penalty percentage multiplier applied to the base rate when an operation is blocked.', 50.00, true),
('dumpster_allowed_tons', 'Dumpster Allowed Base Tonnage', 'The standard maximum weight limit threshold built into basic rental costs.', 2.50, false),
('dumpster_overweight_rate', 'Dumpster Overweight Fee (Per Ton)', 'Penalty rate applied to each additional ton over the baseline weight allowance.', 100.00, false),
('dump_loader_max_tons', 'Dump Loader Maximum Tonnage Limit', 'The total safe transport threshold cap for the dump loader trailer systems.', 5.00, false),
('base_dump_fee', 'Municipal Dump Access Base Fee', 'The standard flat operational administrative fee charged for municipal landfill entry routing.', 150.00, false),
('dump_tonnage_rate', 'Municipal Landfill Scale Rate (Per Ton)', 'Standard scale dump charge calculated by post-disposal weight evaluations.', 45.00, false),
('special_item_fee_min', 'Special Item Disposal Minimum Charge', 'The low-end boundary threshold charge for targeted special item components (mattresses, TVs).', 20.00, false),
('special_item_fee_max', 'Special Item Disposal Maximum Charge', 'The high-end boundary threshold charge for targeted special item components (refrigerants, items with Freon).', 50.00, false),
('cleaning_fee', 'Equipment Cleaning Fee', 'Standard baseline clean-up assessment applied to return assets needing excessive decontamination.', 20.00, false),
('advance_cancel_percentage', 'Advance Cancellation Retainment Rate', 'Percentage fee retained for cancellations occurring more than 24 hours prior to service scheduling.', 10.00, true),
('late_cancel_percentage', 'Late Cancellation Maximum Charge Rate', 'Maximum dynamic percentage fee applied for cancellations within 24 hours of scheduled execution.', 50.00, true),
('small_equipment_admin_rate', 'Small Equipment Administrative Multiplier', 'The markup rate threshold added to replacement expenses for missing ancillary accessories.', 15.00, true),
('driveway_protection_plan_cost', 'Driveway Protection Plan Flat Fee', 'Optional insurance upgrade to cover baseline landscaping buffer allocations.', 15.00, false),
('hardware_protection_plan_cost', 'Hardware Protection Plan Flat Fee', 'Optional package providing peace-of-mind parameters across heavy trailers and operational assets.', 15.00, false),
('hardware_protection_plan_cap', 'Hardware Protection Plan Maximum Credit Cap', 'The high-water protection mark threshold limit providing relief parameters for broken elements.', 500.00, false)
ON CONFLICT (fee_key) DO NOTHING;

ALTER TABLE public.charges_and_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access charges_and_fees" ON public.charges_and_fees;
CREATE POLICY "Admin full access charges_and_fees"
  ON public.charges_and_fees FOR ALL
  USING (public.is_admin() OR auth.role() = 'service_role')
  WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anyone can read charges_and_fees" ON public.charges_and_fees;
CREATE POLICY "Anyone can read charges_and_fees"
  ON public.charges_and_fees FOR SELECT
  USING (true);

GRANT SELECT ON public.charges_and_fees TO anon, authenticated;
GRANT ALL ON public.charges_and_fees TO service_role;
