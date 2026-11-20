/**
 * Attach one live GPS tracker or padlock to one trailer.
 * Several devices may share a trailer. One device id cannot.
 */

export async function linkDeviceToUnit(supabase, {
  kind,
  deviceId,
  deviceName,
  unitId,
  table,
  idColumn,
}) {
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await supabase
    .from('unit_accessories')
    .select('id, inventory_unit_id')
    .eq('kind', kind)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (readError) return { error: readError };

  let accessoryId = existing?.id ?? null;
  if (!accessoryId) {
    const { data, error } = await supabase.from('unit_accessories').insert({
      inventory_unit_id: unitId,
      kind,
      name: deviceName,
      quantity: 1,
      device_id: deviceId,
    }).select('id').single();
    if (error) return { error };
    accessoryId = data.id;
  } else if (Number(existing.inventory_unit_id) !== Number(unitId)) {
    const { error } = await supabase.from('unit_accessories').update({
      inventory_unit_id: unitId,
      updated_at: now,
    }).eq('id', accessoryId);
    if (error) return { error };
  }

  const { error } = await supabase.from(table).update({
    inventory_unit_id: unitId,
    accessory_id: accessoryId,
    updated_at: now,
  }).eq(idColumn, deviceId);
  if (error) return { error };
  return { accessoryId };
}

export async function unlinkDeviceFromUnit(supabase, {
  kind,
  deviceId,
  accessoryId,
  table,
  idColumn,
}) {
  const now = new Date().toISOString();
  const { error } = await supabase.from(table).update({
    inventory_unit_id: null,
    accessory_id: null,
    updated_at: now,
  }).eq(idColumn, deviceId);
  if (error) return { error };
  if (accessoryId) {
    await supabase
      .from('unit_accessories')
      .delete()
      .eq('id', accessoryId)
      .eq('kind', kind)
      .eq('device_id', deviceId);
  }
  return {};
}
