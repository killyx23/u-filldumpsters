import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://REDACTED_PROJECT_REF.supabase.co';
const supabaseAnonKey = 'REDACTED_SUPABASE_ANON_JWT';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);