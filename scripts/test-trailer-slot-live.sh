#!/usr/bin/env bash
# Live local test: service 1 with bin+trailer reservations vs trailer reuse mid-week.
set -euo pipefail
cd "$(dirname "$0")/.."

eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|SECRET_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
API_URL="${API_URL:-${SUPABASE_URL:-}}"
KEY="${SECRET_KEY:-${SERVICE_ROLE_KEY:-}}"
if [[ -z "$API_URL" || -z "$KEY" ]]; then
  echo "Start local Supabase first: npx supabase start" >&2
  exit 1
fi

AUTH=( -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" )
REST="$API_URL/rest/v1"
FN="$API_URL/functions/v1/get-availability"

D_DROP="2027-09-08"   # Mon
D_MID="2027-09-10"    # Wed
D_PICK="2027-09-12"   # Fri
EMAIL="trailer-slot-test@example.invalid"

echo "=== 1) Clean prior fixtures ==="
curl -s "${AUTH[@]}" -X DELETE "$REST/bookings?email=eq.$EMAIL" >/dev/null
curl -s "${AUTH[@]}" -X DELETE "$REST/date_specific_availability?date=gte.$D_DROP&date=lte.$D_PICK&service_id=in.(1,2,3)" >/dev/null || true

echo "=== 2) Open calendar for services 1,2,3 on test week ==="
curl -s "${AUTH[@]}" -X POST "$REST/date_specific_availability" -d "$(jq -nc --arg d1 "$D_DROP" --arg d2 "$D_MID" --arg d3 "$D_PICK" '
  [1,2,3] as $svcs |
  [$d1,$d2,$d3] as $dates |
  [$svcs[], $dates[]] | combinations | . as [$s,$d] |
  {service_id:$s, date:$d, is_available:true,
   delivery_start_time:"06:00:00", delivery_end_time:"18:00:00",
   pickup_start_time:"06:00:00", return_by_time:"18:00:00",
   delivery_pickup_start_time:"14:00:00", delivery_pickup_end_time:"16:00:00"}')"
 >/dev/null

echo ""
echo "=== 3) curl get-availability BEFORE booking (service 1, Wed $D_MID) ==="
echo "curl -X POST $FN -d '{\"serviceId\":1,\"startDate\":\"$D_MID\",\"endDate\":\"$D_MID\"}'"
BEFORE=$(curl -s "${AUTH[@]}" -X POST "$FN" -d "{\"serviceId\":1,\"startDate\":\"$D_MID\",\"endDate\":\"$D_MID\"}")
echo "$BEFORE" | jq '{date: .availability["'"$D_MID"'"].available, deliverySlots: .availability["'"$D_MID"'"].deliverySlots}'

echo ""
echo "=== 4) curl POST booking — service 1, Mon drop / Fri pickup ==="
BOOKING_BODY=$(jq -nc \
  --arg email "$EMAIL" \
  --arg drop "$D_DROP" \
  --arg pick "$D_PICK" \
  '{
    name:"TRAILER SLOT TEST",
    email:$email,
    phone:"5555550200",
    street:"1 Test St", city:"Rapid City", state:"SD", zip:"57701",
    drop_off_date:$drop, pickup_date:$pick,
    drop_off_time_slot:"08:00:00|10:00:00",
    pickup_time_slot:"14:00:00|16:00:00",
    drop_off_window_start:"08:00:00", drop_off_window_end:"10:00:00",
    pickup_window_start:"14:00:00", pickup_window_end:"16:00:00",
    plan:{id:1,name:"16 Yard Dumpster Rental"},
    addons:{isDelivery:false},
    total_price:1,
    status:"Confirmed"
  }')
echo "curl -X POST $REST/bookings -d '<booking json>'"
BOOKING_RESP=$(curl -s "${AUTH[@]}" -X POST "$REST/bookings" \
  -H "Prefer: return=representation" \
  -d "$BOOKING_BODY")
BOOKING_ID=$(echo "$BOOKING_RESP" | jq -r '.[0].id // empty')
if [[ -z "$BOOKING_ID" ]]; then
  echo "Booking insert failed:" >&2
  echo "$BOOKING_RESP" | jq . >&2
  exit 1
fi
echo "BOOKING_ID=$BOOKING_ID"

echo ""
echo "=== 5) curl GET booking_resource_reservations for booking $BOOKING_ID ==="
echo "curl $REST/booking_resource_reservations?booking_id=eq.$BOOKING_ID&select=id,resource_id,reserved_date,slot_start,slot_end,granularity,quantity&order=reserved_date,resource_id"
RESV=$(curl -s "${AUTH[@]}" \
  "$REST/booking_resource_reservations?booking_id=eq.$BOOKING_ID&select=id,resource_id,inventory_items(name),reserved_date,slot_start,slot_end,granularity,quantity&order=reserved_date,resource_id")
echo "$RESV" | jq .
RESV_IDS=$(echo "$RESV" | jq -r '[.[].id] | join(", ")')
echo "RESERVATION_IDS=$RESV_IDS"

echo ""
echo "=== 6) resource_quantity_used checks (via SQL) ==="
psql "postgresql://postgres:postgres@127.0.0.1:55422/postgres" -c "
select 'bin Wed whole day' as check,
       public.resource_quantity_used(1, '$D_MID'::date) as used, 2 as stock;
select 'trailer Wed 09-11 slot' as check,
       public.resource_quantity_used(2, '$D_MID'::date, '09:00:00'::time, '11:00:00'::time) as used, 1 as stock;
select 'trailer Mon 08-10 slot' as check,
       public.resource_quantity_used(2, '$D_DROP'::date, '08:00:00'::time, '10:00:00'::time) as used, 1 as stock;
"

echo ""
echo "=== 7) curl get-availability AFTER — service 1 on Wed (bin should block date) ==="
AFTER_S1=$(curl -s "${AUTH[@]}" -X POST "$FN" -d "{\"serviceId\":1,\"startDate\":\"$D_MID\",\"endDate\":\"$D_MID\"}")
echo "$AFTER_S1" | jq '{date: .availability["'"$D_MID"'"].available, deliverySlots: .availability["'"$D_MID"'"].deliverySlots}'

echo ""
echo "=== 8) curl get-availability AFTER — service 2 self-pickup on Wed (trailer day-free mid-week) ==="
AFTER_S2=$(curl -s "${AUTH[@]}" -X POST "$FN" -d "{\"serviceId\":2,\"startDate\":\"$D_MID\",\"endDate\":\"$D_MID\",\"isDelivery\":false}")
echo "$AFTER_S2" | jq '{date: .availability["'"$D_MID"'"].available}'

echo ""
echo "=== 9) curl get-availability AFTER — service 3 material on Wed (trailer slots may still show) ==="
AFTER_S3=$(curl -s "${AUTH[@]}" -X POST "$FN" -d "{\"serviceId\":3,\"startDate\":\"$D_MID\",\"endDate\":\"$D_MID\"}")
echo "$AFTER_S3" | jq '{date: .availability["'"$D_MID"'"].available, deliverySlots: (.availability["'"$D_MID"'"].deliverySlots // [] | map({label, available, remaining}))}'

echo ""
echo "=== Summary ==="
echo "booking_id=$BOOKING_ID"
echo "booking_resource_reservations ids: $RESV_IDS"
echo "Bin rows: $(echo "$RESV" | jq '[.[] | select(.inventory_items.name | test("Dumpster"))] | length')"
echo "Trailer rows: $(echo "$RESV" | jq '[.[] | select(.inventory_items.name | test("Trailer"))] | length')"
