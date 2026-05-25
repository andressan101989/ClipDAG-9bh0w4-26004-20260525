import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DAG_REWARD_PER_LIKE = 0.01;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // User client (respects RLS)
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Admin client (bypasses RLS for reward updates)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get authenticated user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { video_id, creator_id } = await req.json();

    if (!video_id || !creator_id) {
      return new Response(
        JSON.stringify({ error: 'Missing video_id or creator_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prevent self-liking
    if (user.id === creator_id) {
      return new Response(
        JSON.stringify({ error: 'Cannot like your own video' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already liked (unique constraint prevents duplicates)
    const { data: existingLike } = await supabaseUser
      .from('likes')
      .select('id')
      .eq('user_id', user.id)
      .eq('video_id', video_id)
      .maybeSingle();

    if (existingLike) {
      // Unlike: remove like, do NOT deduct reward (just remove like count)
      const { error: deleteError } = await supabaseAdmin
        .from('likes')
        .delete()
        .eq('user_id', user.id)
        .eq('video_id', video_id);

      if (deleteError) throw deleteError;

      // Decrement likes_count on video
      const { data: video } = await supabaseAdmin
        .from('videos')
        .select('likes_count')
        .eq('id', video_id)
        .single();

      await supabaseAdmin
        .from('videos')
        .update({ likes_count: Math.max(0, (video?.likes_count || 1) - 1) })
        .eq('id', video_id);

      return new Response(
        JSON.stringify({ action: 'unliked', success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert like
    const { error: likeError } = await supabaseAdmin
      .from('likes')
      .insert({ user_id: user.id, video_id });

    if (likeError) throw likeError;

    // Increment video likes_count
    const { data: video } = await supabaseAdmin
      .from('videos')
      .select('likes_count')
      .eq('id', video_id)
      .single();

    await supabaseAdmin
      .from('videos')
      .update({ likes_count: (video?.likes_count || 0) + 1 })
      .eq('id', video_id);

    // Credit DAG reward to creator
    const { data: creatorProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('dag_balance')
      .eq('id', creator_id)
      .single();

    const currentBalance = Number(creatorProfile?.dag_balance || 0);
    const newBalance = Number((currentBalance + DAG_REWARD_PER_LIKE).toFixed(4));

    await supabaseAdmin
      .from('user_profiles')
      .update({ dag_balance: newBalance })
      .eq('id', creator_id);

    // Record transaction for creator
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: creator_id,
        amount: DAG_REWARD_PER_LIKE,
        type: 'reward',
        status: 'completed',
        description: `Like reward recibido`,
      });

    console.log(`DAG reward processed: ${DAG_REWARD_PER_LIKE} DAG to creator ${creator_id}`);

    return new Response(
      JSON.stringify({
        action: 'liked',
        success: true,
        reward: DAG_REWARD_PER_LIKE,
        creator_new_balance: newBalance,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('process_dag_reward error:', error);
    return new Response(
      JSON.stringify({ error: `Internal error: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
