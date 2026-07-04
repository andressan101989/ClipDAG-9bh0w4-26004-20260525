/**
 * supabase/functions/ai-avatar/index.ts
 *
 * AI Avatar Generator Edge Function
 *
 * Actions:
 *   generate-image  → Google Gemini (gemini-2.0-flash-exp) image generation,
 *                     called directly — styled avatar from photo + prompt
 *   generate-video  → OnSpace AI video generation (Sora-2: talking avatar
 *                     animation) — kept on OnSpace; Gemini has no equivalent
 *                     video-generation endpoint
 *   check-video     → Poll video prediction status + download/store on completion
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

// Video generation (generate-video / check-video) still goes through OnSpace —
// Gemini's generateContent endpoint doesn't do video/Sora-2-style predictions.
const AI_BASE  = Deno.env.get('ONSPACE_AI_BASE_URL') ?? '';
const AI_KEY   = Deno.env.get('ONSPACE_AI_API_KEY')  ?? '';
const SB_URL   = Deno.env.get('SUPABASE_URL')         ?? '';
const SB_SVC   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabaseAdmin = createClient(SB_URL, SB_SVC);

// ── Supported avatar image styles ─────────────────────────────────────────────
const AVATAR_STYLES: Record<string, string> = {
  cartoon:   'cartoon avatar, bright colors, smooth cel-shading, big expressive eyes, TikTok creator style',
  anime:     'anime-style avatar, clean line art, vibrant colors, large eyes, soft shadows, manga aesthetic',
  realistic: '3D photorealistic avatar, subsurface scattering skin, cinematic lighting, DLSR quality',
  cinematic: 'cinematic portrait avatar, dramatic rembrandt lighting, film grain, anamorphic lens flare, ultra detailed',
  pixel:     'pixel art avatar, 64×64 resolution, retro 8-bit style, limited palette, sharp pixels',
  glass:     'glass morphism avatar portrait, frosted glass effect, neon glow, dark background, ultra-modern UI art',
  watercolor:'watercolor portrait avatar, soft brush strokes, pastel palette, artistic impressionist style',
  neon:      'neon cyberpunk avatar portrait, synthwave colors, dark background, glowing outlines, retrofuturistic',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? '';
    const token      = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body   = await req.json();
    const action = body.action as string;

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: generate-image
    // Generates a styled avatar image using Google Gemini image generation
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'generate-image') {
      const { photoUrl, style = 'cartoon', customPrompt } = body as {
        photoUrl:     string;
        style?:       string;
        customPrompt?: string;
      };

      const styleDesc = AVATAR_STYLES[style] ?? AVATAR_STYLES.cartoon;
      const prompt    = customPrompt
        ? `${customPrompt}. Style: ${styleDesc}. High quality, professional avatar, clean background.`
        : `Transform the person in this photo into a ${styleDesc}. Keep their facial features recognizable. Professional avatar for social media. Square format, clean background.`;

      // Gemini's generateContent takes inline image bytes, not a URL — fetch
      // the source photo and base64-encode it.
      const photoResp = await fetch(photoUrl);
      if (!photoResp.ok) throw new Error('Could not fetch source photo');
      const photoMime  = photoResp.headers.get('content-type') || 'image/jpeg';
      const photoBytes = new Uint8Array(await photoResp.arrayBuffer());
      let photoBinary = '';
      for (let i = 0; i < photoBytes.length; i++) photoBinary += String.fromCharCode(photoBytes[i]);
      const photoB64 = btoa(photoBinary);

      const aiResp = await fetch(GEMINI_URL, {
        method:  'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: photoMime, data: photoB64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();
        throw new Error(`Gemini image error: ${errText}`);
      }

      const aiData = await aiResp.json();
      const parts: any[] = aiData?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find((p) => p.inlineData || p.inline_data);
      const base64Data = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data;

      if (!base64Data) throw new Error('No image returned from AI model');

      // Decode base64 → binary
      const binaryStr  = atob(base64Data);
      const bytes      = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      // Upload to Supabase Storage
      const fileName = `${user.id}/avatar_${Date.now()}.png`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from('images').upload(fileName, bytes, { contentType: 'image/png', upsert: true });
      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabaseAdmin.storage.from('images').getPublicUrl(fileName);

      return new Response(JSON.stringify({ success: true, imageUrl: publicUrl, style }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: generate-video
    // Creates a Sora-2 talking avatar video from a reference avatar image + script
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'generate-video') {
      const { avatarUrl, script, duration = 4, aspectRatio = 'portrait' } = body as {
        avatarUrl:    string;
        script:       string;
        duration?:    number;
        aspectRatio?: string;
      };

      if (!avatarUrl || !script?.trim()) {
        throw new Error('avatarUrl y script son requeridos');
      }

      const videoPrompt = `A digital avatar talking directly to camera. The avatar says: "${script.slice(0, 200)}". The avatar should have natural facial expressions, blinking, and subtle head movement. Animate from the provided reference image. Cinematic portrait style, clean background, professional social media video.`;

      const predResp = await fetch(`${AI_BASE}/models/openai/sora-2/predictions`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${AI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            prompt:          videoPrompt,
            seconds:         Math.min(Math.max(duration, 3), 10),
            aspect_ratio:    aspectRatio,
            input_reference: avatarUrl,
          },
        }),
      });

      if (!predResp.ok) {
        const errText = await predResp.text();
        throw new Error(`OnSpace AI video error: ${errText}`);
      }

      const prediction = await predResp.json();
      const predId = prediction?.id;
      if (!predId) throw new Error('No prediction ID returned');

      console.log(`[ai-avatar] Video prediction created: ${predId}`);

      return new Response(JSON.stringify({ success: true, predictionId: predId, status: 'starting' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION: check-video
    // Polls prediction status; downloads and stores video when succeeded
    // ════════════════════════════════════════════════════════════════════════
    if (action === 'check-video') {
      const { predictionId } = body as { predictionId: string };
      if (!predictionId) throw new Error('predictionId requerido');

      const statusResp = await fetch(`${AI_BASE}/predictions/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${AI_KEY}` },
      });
      if (!statusResp.ok) {
        const errText = await statusResp.text();
        throw new Error(`Status check error: ${errText}`);
      }

      const status = await statusResp.json();

      if (status.status === 'failed' || status.status === 'canceled') {
        throw new Error(status.error || 'Video generation failed');
      }

      if (status.status === 'starting' || status.status === 'processing') {
        return new Response(JSON.stringify({
          success:  true,
          status:   status.status,
          progress: status.progress ?? 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (status.status === 'succeeded') {
        const videoUrl = status.output;
        if (!videoUrl) throw new Error('No output URL in succeeded prediction');

        // Download video
        const vidResp      = await fetch(videoUrl);
        const arrayBuffer  = await vidResp.arrayBuffer();
        const videoBlob    = new Blob([arrayBuffer], { type: 'video/mp4' });

        // Store in Supabase Storage
        const fileName = `${predictionId}.mp4`;
        const { error: uploadErr } = await supabaseAdmin.storage
          .from('videos').upload(fileName, videoBlob, { contentType: 'video/mp4', upsert: true });
        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabaseAdmin.storage.from('videos').getPublicUrl(fileName);

        console.log(`[ai-avatar] Video stored: ${publicUrl}`);

        return new Response(JSON.stringify({
          success: true, status: 'succeeded', videoUrl: publicUrl, storagePath: fileName,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ success: true, status: status.status, progress: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[ai-avatar]', err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
