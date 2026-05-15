import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://essesdjgtmralbkglpzw.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzc2VzZGpndG1yYWxia2dscHp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5NDk5MDQsImV4cCI6MjA2OTUyNTkwNH0.ZwuJcWRKqiAaL9USYHJNWOz9vcFVZBRJ0PLn1EdiIy4';

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);

export default customSupabaseClient;

export { 
    customSupabaseClient,
    customSupabaseClient as supabase,
};
