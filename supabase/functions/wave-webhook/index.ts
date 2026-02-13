import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify webhook secret
    const webhookSecret = Deno.env.get('WAVE_WEBHOOK_SECRET');
    const signature = req.headers.get('wave-signature') || req.headers.get('x-wave-signature');
    
    // Wave sends webhook secret in headers for verification
    if (webhookSecret && signature && signature !== webhookSecret) {
      console.error('Invalid webhook signature');
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json();
    console.log('Wave webhook received:', JSON.stringify(body));

    const { type, data } = body;

    if (type !== 'checkout.session.completed') {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const clientReference = data?.client_reference;
    if (!clientReference) {
      console.error('No client_reference in webhook');
      return new Response(JSON.stringify({ error: 'Missing reference' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Find payment
    const { data: payment, error: findError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('payment_reference', clientReference)
      .single();

    if (findError || !payment) {
      console.error('Payment not found:', clientReference);
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update payment to completed
    await supabaseAdmin.from('payments').update({
      status: 'completed',
      metadata: {
        ...(payment.metadata as Record<string, unknown> || {}),
        wave_payment_status: data.payment_status,
        wave_session_id: data.id,
      }
    }).eq('id', payment.id);

    // If subscription payment, activate subscription
    const metadata = payment.metadata as Record<string, unknown> | null;
    if (metadata?.subscription_id) {
      const planId = metadata.plan_id as string;
      let durationDays = 30;

      if (planId) {
        const { data: plan } = await supabaseAdmin
          .from('subscription_plans')
          .select('duration_days')
          .eq('id', planId)
          .single();
        if (plan) durationDays = plan.duration_days!;
      }

      const startDate = new Date();
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + durationDays);

      await supabaseAdmin.from('user_subscriptions').update({
        status: 'active',
        started_at: startDate.toISOString(),
        expires_at: expiryDate.toISOString(),
        payment_id: payment.id,
        payment_method: 'wave',
        payment_reference: clientReference,
      }).eq('id', metadata.subscription_id as string);

      // Notify user
      await supabaseAdmin.from('notifications').insert({
        user_id: payment.user_id,
        title: 'Abonnement activé',
        message: 'Votre abonnement MIPROJET a été activé avec succès.',
        type: 'success',
        link: '/opportunities',
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
