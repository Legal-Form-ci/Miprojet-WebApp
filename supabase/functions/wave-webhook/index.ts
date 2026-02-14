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
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const body = await req.json();
    console.log('Wave webhook received:', JSON.stringify(body));

    const { type, data } = body;

    // Handle different event types
    if (type === 'checkout.session.completed') {
      await handleSuccessfulPayment(supabaseAdmin, data);
    } else if (type === 'checkout.session.failed' || type === 'checkout.session.expired') {
      await handleFailedPayment(supabaseAdmin, data);
    } else {
      console.log('Unhandled event type:', type);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function handleSuccessfulPayment(supabaseAdmin: any, data: any) {
  const clientReference = data?.client_reference;
  if (!clientReference) {
    console.error('No client_reference in webhook');
    return;
  }

  // Find payment
  const { data: payment, error: findError } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('payment_reference', clientReference)
    .single();

  if (findError || !payment) {
    console.error('Payment not found:', clientReference);
    return;
  }

  // Update payment to completed
  await supabaseAdmin.from('payments').update({
    status: 'completed',
    payment_method: 'wave',
    metadata: {
      ...(payment.metadata as Record<string, unknown> || {}),
      wave_payment_status: data.payment_status || 'succeeded',
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
      title: 'Abonnement activé ✅',
      message: 'Votre abonnement MIPROJET a été activé avec succès. Vous avez maintenant accès aux opportunités exclusives.',
      type: 'success',
      link: '/opportunities',
    });

    console.log('Subscription activated for user:', payment.user_id);
  }
}

async function handleFailedPayment(supabaseAdmin: any, data: any) {
  const clientReference = data?.client_reference;
  if (!clientReference) return;

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('payment_reference', clientReference)
    .single();

  if (!payment) return;

  await supabaseAdmin.from('payments').update({
    status: 'failed',
    metadata: {
      ...(payment.metadata as Record<string, unknown> || {}),
      wave_payment_status: 'failed',
      wave_session_id: data.id,
    }
  }).eq('id', payment.id);

  // Cancel pending subscription
  const metadata = payment.metadata as Record<string, unknown> | null;
  if (metadata?.subscription_id) {
    await supabaseAdmin.from('user_subscriptions').update({
      status: 'cancelled',
    }).eq('id', metadata.subscription_id as string);
  }

  // Notify user
  await supabaseAdmin.from('notifications').insert({
    user_id: payment.user_id,
    title: 'Paiement échoué',
    message: 'Votre paiement n\'a pas abouti. Veuillez réessayer.',
    type: 'error',
    link: '/subscription',
  });

  console.log('Payment failed for user:', payment.user_id);
}
