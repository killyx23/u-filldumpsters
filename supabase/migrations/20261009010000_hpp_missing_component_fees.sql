-- Missing-component replacement fees quoted in the Hardware Protection Plan terms.
INSERT INTO public.charges_and_fees (fee_key, fee_name, fee_description, fee_value, is_percentage)
VALUES
(
  'hpp_missing_remote_fee',
  'HPP Missing Wireless Remote Fee',
  'Flat replacement fee when a wireless remote transmitter is lost, stolen, or not returned for inspection.',
  350.00,
  false
),
(
  'hpp_missing_winch_controller_fee',
  'HPP Missing Winch Controller Fee',
  'Flat replacement fee for a missing winch controller or handheld pendant.',
  150.00,
  false
),
(
  'hpp_missing_lighting_fixture_fee',
  'HPP Missing Safety Lighting Fixture Fee',
  'Flat replacement fee per missing safety lighting fixture assembly.',
  75.00,
  false
),
(
  'hpp_missing_hydraulic_hose_fee',
  'HPP Missing Hydraulic Hose Fee',
  'Flat replacement fee per missing detachable hydraulic hose or coupler.',
  100.00,
  false
),
(
  'hpp_missing_tarp_assembly_fee',
  'HPP Missing Tarp Assembly Fee',
  'Flat replacement fee per missing tarp tension spring or articulation arm side assembly.',
  250.00,
  false
)
ON CONFLICT (fee_key) DO NOTHING;
