-- Seed driveway protection price + tax flag for useDrivewayProtectionPrice hook

INSERT INTO public.business_settings (setting_key, setting_value, updated_at)
VALUES (
  'driveway_protection_price',
  jsonb_build_object('price', 15, 'is_taxable', true),
  now()
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = COALESCE(
    public.business_settings.setting_value,
    '{}'::jsonb
  ) || jsonb_build_object(
    'price', COALESCE(
      (public.business_settings.setting_value->>'price')::numeric,
      15
    ),
    'is_taxable', COALESCE(
      (public.business_settings.setting_value->>'is_taxable')::boolean,
      true
    )
  ),
  updated_at = now();
