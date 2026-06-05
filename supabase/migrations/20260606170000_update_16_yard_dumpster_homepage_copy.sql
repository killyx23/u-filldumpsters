-- 16 Yard Dumpster homepage card copy (description + feature bullets; delivery fee from admin pricing).

UPDATE public.services SET
  homepage_description = 'Streamline your next cleanup or renovation project with our residential-friendly 16-yard roll-off dumpsters. Designed to fit easily in standard driveways, they offer the perfect balance of massive capacity and a compact footprint for hassle-free waste disposal.',
  features = '["Up to 2.5 tons capacity", "100% contactless delivery & pickup available", "Perfect for home renovations & cleanouts", "Low-profile sides for easy loading", "Optional driveway protective available", "Book today, delivery as early as tomorrow"]'::jsonb
WHERE id = 1;
