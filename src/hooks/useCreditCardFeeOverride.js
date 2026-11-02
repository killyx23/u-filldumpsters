import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

let snapshot = { override: null, loading: true, saving: false, error: null };
const listeners = new Set();
let loadPromise = null;

function emit(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener(snapshot));
}

function readOverride(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

async function loadOverride() {
  if (loadPromise) return loadPromise;
  loadPromise = supabase
    .from('financial_book_settings')
    .select('credit_card_fee_override')
    .eq('id', 1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        emit({ loading: false, error });
        return;
      }
      emit({
        loading: false,
        error: null,
        override: readOverride(data?.credit_card_fee_override),
      });
    })
    .finally(() => {
      loadPromise = null;
    });
  return loadPromise;
}

export function useCreditCardFeeOverride() {
  const [state, setState] = useState(snapshot);

  useEffect(() => {
    listeners.add(setState);
    setState(snapshot);
    if (snapshot.loading) loadOverride();
    return () => listeners.delete(setState);
  }, []);

  const save = useCallback(async (override) => {
    emit({ saving: true, error: null });
    const { error } = await supabase.from('financial_book_settings').upsert({
      id: 1,
      credit_card_fee_override: override,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      emit({ saving: false, error });
      throw error;
    }
    emit({ saving: false, error: null, override: readOverride(override) });
  }, []);

  return { ...state, save };
}
