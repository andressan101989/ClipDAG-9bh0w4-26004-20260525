/**
 * Edge Function: bdag-economy
 *
 * Unified handler for all internal BDAG economy operations:
 *   - content_purchase  : unlock exclusive content (atomic, fee split)
 *   - boost_purchase    : boost post/profile/product with BDAG
 *   - subscribe         : subscribe to creator plan (monthly BDAG)
 *   - ad_create         : create ad campaign with BDAG budget
 *   - premium_dm_config : configure pay-per-message
 *
 * All operations are purely internal (DB only, no blockchain).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUBSCRIPTION_FEE_PCT = 10; // 10% platform fee on subscriptions

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const ok   = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const fail = (msg: string)  => ok({ success: false, error: msg });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // ── Auth ───────────────────────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return fail('No autorizado');

  let userId: string;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) throw new Error('auth');
    userId = user.id;
  } catch { return fail('No autorizado'); }

  let body: any;
  try { body = await req.json(); } catch { return fail('Body inválido'); }

  const { action } = body;
  console.log(`[bdag-economy] action=${action} user=${userId}`);

  // ════════════════════════════════════════════════════════════════════════════
  // CONTENT PURCHASE
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'content_purchase') {
    const { content_id } = body;
    if (!content_id) return fail('content_id requerido');

    const { data, error } = await supabase.rpc('purchase_exclusive_content', {
      p_buyer_id:   userId,
      p_content_id: content_id,
    });
    if (error) {
      console.error('[economy] content_purchase RPC error:', error.message);
      return fail('Error procesando compra. Intenta de nuevo.');
    }
    if (!data?.success) return ok({ success: false, error: data?.error, already_owned: data?.already_owned ?? false });

    // Notify creator
    try {
      const { data: buyer } = await supabase
        .from('user_profiles').select('username').eq('id', userId).single();
      const { data: content } = await supabase
        .from('exclusive_content').select('creator_id, title').eq('id', content_id).single();

      if (content) {
        await supabase.from('notifications').insert({
          user_id:       content.creator_id,
          from_user_id:  userId,
          from_username: buyer?.username ?? 'Alguien',
          type:          'content_sale',
          message:       `${buyer?.username ?? 'Alguien'} compró "${content.title}" — +${data.creator_earnings?.toFixed(2)} BDAG`,
          reference_id:  content_id,
          reference_type: 'exclusive_content',
        });
      }
    } catch (e: any) { console.warn('[economy] notify error:', e?.message); }

    return ok({ success: true, ...data });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BOOST PURCHASE
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'boost_purchase') {
    const { reference_id, reference_type = 'video', boost_type = 'post', amount_bdag, duration_hrs = 24 } = body;
    if (!reference_id)           return fail('reference_id requerido');
    if (!amount_bdag || amount_bdag < 100) return fail('Mínimo 100 BDAG para boost');

    const { data, error } = await supabase.rpc('purchase_boost', {
      p_user_id:       userId,
      p_reference_id:  reference_id,
      p_reference_type: reference_type,
      p_boost_type:    boost_type,
      p_amount_bdag:   amount_bdag,
      p_duration_hrs:  duration_hrs,
    });
    if (error) { console.error('[economy] boost RPC error:', error.message); return fail('Error al activar boost.'); }
    if (!data?.success) return ok({ success: false, error: data?.error });

    return ok({ success: true, new_balance: data.new_balance });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUBSCRIBE TO CREATOR PLAN
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'subscribe') {
    const { plan_id } = body;
    if (!plan_id) return fail('plan_id requerido');

    // Load plan
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', plan_id)
      .eq('status', 'active')
      .single();

    if (!plan) return fail('Plan no encontrado o inactivo');
    if (plan.creator_id === userId) return fail('No puedes suscribirte a tu propio plan');

    // Check existing subscription
    const { data: existing } = await supabase
      .from('creator_subscriptions')
      .select('id, status, expires_at')
      .eq('plan_id', plan_id)
      .eq('subscriber_id', userId)
      .single();

    if (existing?.status === 'active' && new Date(existing.expires_at) > new Date()) {
      return fail('Ya tienes una suscripción activa a este plan');
    }

    // Read balance from authoritative ledger_accounts
    const { data: buyerLedger } = await supabase
      .from('ledger_accounts')
      .select('balance')
      .eq('owner_id', userId)
      .eq('account_type', 'user')
      .maybeSingle();

    const balance = Number(buyerLedger?.balance ?? 0);
    if (balance < plan.price_bdag) {
      return fail(`Saldo insuficiente. Necesitas ${plan.price_bdag} BDAG, tienes ${balance.toFixed(2)} BDAG`);
    }

    const platformFee   = Number((plan.price_bdag * SUBSCRIPTION_FEE_PCT / 100).toFixed(8));
    const creatorEarned = Number((plan.price_bdag - platformFee).toFixed(8));

    const { data: creatorProf } = await supabase
      .from('user_profiles').select('username').eq('id', plan.creator_id).single();

    // Determine expiry (30 days for monthly)
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    await Promise.all([
      // Atomic ledger debit for buyer
      supabase.rpc('ledger_debit', {
        p_user_id:        userId,
        p_amount:         plan.price_bdag,
        p_operation_type: 'subscription',
        p_reference_type: 'subscription_plan',
        p_reference_id:   plan_id,
      }),
      // Atomic ledger credit for creator
      supabase.rpc('ledger_credit', {
        p_user_id:        plan.creator_id,
        p_amount:         creatorEarned,
        p_operation_type: 'subscription',
        p_reference_type: 'subscription_plan',
        p_reference_id:   plan_id,
      }),
      existing
        ? supabase.from('creator_subscriptions').update({
            status: 'active', amount_bdag: plan.price_bdag,
            last_renewed_at: new Date().toISOString(), expires_at: expiresAt,
          }).eq('id', existing.id)
        : supabase.from('creator_subscriptions').insert({
            plan_id, subscriber_id: userId, creator_id: plan.creator_id,
            amount_bdag: plan.price_bdag, status: 'active', expires_at: expiresAt,
          }),
      supabase.from('subscription_plans')
        .update({ subscribers_count: plan.subscribers_count + 1 })
        .eq('id', plan_id),
      // Legacy transactions table kept for wallet history fallback
      supabase.from('transactions').insert([
        { user_id: userId, amount: plan.price_bdag, type: 'tip', status: 'completed',
          description: `Suscripción: ${plan.name}` },
        { user_id: plan.creator_id, amount: creatorEarned, type: 'reward', status: 'completed',
          description: `Suscriptor nuevo — ${plan.name}` },
      ]),
    ]);

    // Notify creator
    try {
      const { data: subscriber } = await supabase
        .from('user_profiles').select('username').eq('id', userId).single();
      await supabase.from('notifications').insert({
        user_id: plan.creator_id, from_user_id: userId,
        from_username: subscriber?.username ?? 'Alguien',
        type: 'new_subscriber',
        message: `${subscriber?.username ?? 'Alguien'} se suscribió a "${plan.name}" — +${creatorEarned.toFixed(2)} BDAG`,
        reference_id: plan_id, reference_type: 'subscription_plan',
      });
    } catch { /* non-fatal */ }

    const newBuyerBal = Number((balance - plan.price_bdag).toFixed(8));
    return ok({ success: true, expires_at: expiresAt, new_balance: newBuyerBal, creator_earned: creatorEarned });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE AD CAMPAIGN
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'ad_create') {
    const { title, description, media_url, ad_type = 'feed', budget_bdag, cpm_bdag = 10, duration_days = 7, reference_id, reference_type } = body;

    if (!title)                        return fail('Título requerido');
    if (!budget_bdag || budget_bdag < 500) return fail('Presupuesto mínimo: 500 BDAG');

    // Read from authoritative ledger_accounts (not user_profiles.dag_balance)
    const { data: adLedger } = await supabase
      .from('ledger_accounts')
      .select('balance')
      .eq('owner_id', userId)
      .eq('account_type', 'user')
      .maybeSingle();
    const adBalance = Number(adLedger?.balance ?? 0);
    if (adBalance < budget_bdag) return fail(`Saldo insuficiente. Tienes ${adBalance.toFixed(2)} BDAG`);

    await Promise.all([
      // Atomic ledger debit — no read-then-write on user_profiles
      supabase.rpc('ledger_debit', {
        p_user_id:        userId,
        p_amount:         budget_bdag,
        p_operation_type: 'boost',
        p_reference_type: 'ad_campaign',
        p_reference_id:   null,
      }),
      supabase.from('ad_campaigns').insert({
        advertiser_id: userId, title, description: description ?? '', media_url: media_url ?? '',
        target_url: '', ad_type, budget_bdag, cpm_bdag,
        reference_id: reference_id ?? null,
        reference_type: reference_type ?? '',
        ends_at: new Date(Date.now() + duration_days * 24 * 3600 * 1000).toISOString(),
        status: 'active',
      }),
      supabase.from('transactions').insert({
        user_id: userId, amount: budget_bdag, type: 'tip', status: 'completed',
        description: `Campaña publicitaria: "${title}"`,
      }),
    ]);

    const newAdBalance = Number((adBalance - budget_bdag).toFixed(8));
    return ok({ success: true, new_balance: newAdBalance });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONFIGURE PREMIUM DM
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'premium_dm_config') {
    const { enabled, price_bdag, welcome_message } = body;
    if (price_bdag !== undefined && price_bdag < 1) return fail('Precio mínimo: 1 BDAG');

    await supabase.from('premium_dm_config').upsert({
      user_id:         userId,
      enabled:         enabled ?? false,
      price_bdag:      price_bdag ?? 50,
      welcome_message: welcome_message ?? '',
      updated_at:      new Date().toISOString(),
    });

    return ok({ success: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE EXCLUSIVE CONTENT
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'create_content') {
    const { title, description, content_type = 'post', preview_text, preview_url, content_url, price_bdag, tags } = body;
    if (!title)              return fail('Título requerido');
    if (!price_bdag || price_bdag < 10) return fail('Precio mínimo: 10 BDAG');

    const { data: newContent, error: insertErr } = await supabase
      .from('exclusive_content')
      .insert({
        creator_id: userId, title, description: description ?? '',
        content_type, preview_text: preview_text ?? '',
        preview_url: preview_url ?? '', content_url: content_url ?? '',
        price_bdag, tags: tags ?? [],
      })
      .select('id')
      .single();

    if (insertErr) { console.error('[economy] create_content insert error:', insertErr.message); return fail('Error al crear contenido. Intenta de nuevo.'); }
    return ok({ success: true, content_id: newContent?.id });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PREMIUM DM SEND (escrow)
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'premium_dm_send') {
    const { recipient_id, amount_bdag, message_text } = body;
    if (!recipient_id) return fail('recipient_id requerido');
    if (!message_text?.trim()) return fail('Mensaje requerido');

    const { data, error } = await supabase.rpc('send_premium_dm', {
      p_sender_id:    userId,
      p_recipient_id: recipient_id,
      p_amount_bdag:  amount_bdag ?? 0,
      p_message_text: message_text.trim(),
    });
    if (error) { console.error('[economy] premium_dm_send error:', error.message); return fail('Error al enviar DM premium'); }
    if (!data?.success) return ok({ success: false, error: data?.error });

    // Notify creator
    try {
      const { data: sender } = await supabase.from('user_profiles').select('username').eq('id', userId).single();
      await supabase.from('notifications').insert({
        user_id: recipient_id, from_user_id: userId,
        from_username: sender?.username ?? 'Alguien',
        type: 'premium_dm',
        message: `${sender?.username ?? 'Alguien'} te envió un DM Premium${data.is_free_dm ? ' (gratis con suscripción)' : ` · ${amount_bdag} BDAG retenidos`}`,
        reference_id: data.message_id, reference_type: 'message',
      });
    } catch { /* non-fatal */ }

    return ok({ success: true, ...data });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PREMIUM DM RELEASE (creator responded)
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'premium_dm_release') {
    const { message_id } = body;
    if (!message_id) return fail('message_id requerido');

    const { data, error } = await supabase.rpc('release_premium_dm', {
      p_creator_id: userId,
      p_message_id: message_id,
    });
    if (error) { console.error('[economy] premium_dm_release error:', error.message); return fail('Error al liberar pago'); }
    if (!data?.success) return ok({ success: false, error: data?.error });

    return ok({ success: true, ...data });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // GET PREMIUM DM CONFIG
  // ════════════════════════════════════════════════════════════════════════════
  if (action === 'get_premium_dm_config') {
    const { target_user_id } = body;
    const uid = target_user_id ?? userId;
    const { data } = await supabase.from('premium_dm_config').select('*').eq('user_id', uid).single();
    return ok({ success: true, config: data });
  }

  return fail(`Acción desconocida: ${action}`);
});
