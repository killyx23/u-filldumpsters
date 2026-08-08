-- Link Mini Telescoping Loader (8) to the same protection plans as Mini Excavator (5).

INSERT INTO public.protection_plan_services (protection_plan_id, service_id)
SELECT pps.protection_plan_id, 8
FROM public.protection_plan_services pps
WHERE pps.service_id = 5
ON CONFLICT (protection_plan_id, service_id) DO NOTHING;
