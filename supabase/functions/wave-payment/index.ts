import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { amount, currency = 'XOF', description, subscription_id, plan_id, success_url, error_url } = await req.json();

    if (!amount || amount < 100) {
      return new Response(JSON.stringify({ error: 'Montant minimum: 100 FCFA' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const waveApiKey = Deno.env.get('WAVE_API_KEY');
    if (!waveApiKey) {
      return new Response(JSON.stringify({ error: 'Wave non configuré', preview_mode: true }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const transactionId = `MIP-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Create payment record
    const { data: payment, error: paymentError } = await supabaseClient
      .from('payments')
      .insert({
        user_id: user.id,
        amount,
        currency,
        payment_method: 'wave',
        payment_reference: transactionId,
        status: 'pending',
        metadata: { subscription_id, plan_id, description }
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment record error:', paymentError);
      return new Response(JSON.stringify({ error: 'Erreur création paiement' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create Wave checkout session
    const waveResponse = await fetch('https://api.wave.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waveApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(amount),
        currency,
        error_url: error_url || success_url || '',
        success_url: success_url || '',
        client_reference: transactionId,
      }),
    });

    const waveResult = await waveResponse.json();
    console.log('Wave response:', JSON.stringify(waveResult));

    if (!waveResponse.ok) {
      await supabaseClient.from('payments').update({ status: 'failed' }).eq('id', payment.id);
      return new Response(JSON.stringify({ error: waveResult.message || 'Erreur Wave' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update payment with Wave session ID
    await supabaseClient.from('payments').update({
      metadata: { ...payment.metadata, wave_session_id: waveResult.id }
    }).eq('id', payment.id);

    return new Response(JSON.stringify({
      success: true,
      wave_launch_url: waveResult.wave_launch_url,
      payment_id: payment.id,
      transaction_id: transactionId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Payment error:', error);
    return new Response(JSON.stringify({ error: 'Erreur interne' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
