import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './cors.ts';
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const { customer_id, content, attachment_url, attachment_name } = await req.json();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { data: note, error } = await supabaseAdmin.from('customer_notes').insert({
      customer_id,
      content,
      source: 'Admin Message',
      author_type: 'admin',
      author_id: user.id,
      is_read: true,
      attachment_url,
      attachment_name
    }).select().single();
    if (error) {
      throw error;
    }
    // Set has_unread_notes to true on the customer for the portal to pick up
    await supabaseAdmin.from('customers').update({
      has_unread_notes: true
    }).eq('id', customer_id);
    return new Response(JSON.stringify({
      note
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
