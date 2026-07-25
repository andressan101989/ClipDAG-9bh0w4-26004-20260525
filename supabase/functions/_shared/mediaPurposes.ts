export type MediaPurpose =
  | 'avatar' | 'post_image' | 'carousel_image' | 'thumbnail'
  | 'product_image' | 'chat_image' | 'chat_audio' | 'voice_note'
  | 'music_audio' | 'document' | 'attachment' | 'live_cover';

type Rule = { kind: 'image' | 'audio' | 'document'; maxBytes: number; mimeTypes: readonly string[]; defaultVisibility: 'public' | 'private' };
const IMAGES = ['image/jpeg','image/png','image/webp'] as const;
const PUBLIC_IMAGES = [...IMAGES,'image/gif'] as const;
const AUDIO = ['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/x-m4a'] as const;
const DOCUMENTS = ['application/pdf','text/plain','application/rtf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;

export const MEDIA_PURPOSES: Record<MediaPurpose, Rule> = {
  avatar:{kind:'image',maxBytes:10_000_000,mimeTypes:IMAGES,defaultVisibility:'public'},
  post_image:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'public'},
  carousel_image:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'public'},
  thumbnail:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'public'},
  product_image:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'public'},
  live_cover:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'public'},
  chat_image:{kind:'image',maxBytes:25_000_000,mimeTypes:PUBLIC_IMAGES,defaultVisibility:'private'},
  chat_audio:{kind:'audio',maxBytes:100_000_000,mimeTypes:AUDIO,defaultVisibility:'private'},
  voice_note:{kind:'audio',maxBytes:100_000_000,mimeTypes:AUDIO,defaultVisibility:'private'},
  music_audio:{kind:'audio',maxBytes:250_000_000,mimeTypes:[...AUDIO,'audio/flac'],defaultVisibility:'private'},
  document:{kind:'document',maxBytes:50_000_000,mimeTypes:DOCUMENTS,defaultVisibility:'private'},
  attachment:{kind:'document',maxBytes:50_000_000,mimeTypes:DOCUMENTS,defaultVisibility:'private'},
};

export function validateMediaRequest(purpose: string,mimeType: string,sizeBytes: number,visibility: string) {
  const rule=MEDIA_PURPOSES[purpose as MediaPurpose];
  if(!rule) return {error:'invalid_purpose'} as const;
  if(!mimeType || !rule.mimeTypes.includes(mimeType as never)) return {error:'invalid_mime_type'} as const;
  if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>rule.maxBytes) return {error:'invalid_size'} as const;
  if(!['public','private'].includes(visibility)) return {error:'invalid_visibility'} as const;
  if(rule.defaultVisibility==='private'&&visibility!=='private') return {error:'visibility_not_allowed'} as const;
  return {rule} as const;
}

export function extensionForMime(mime:string):string {
  return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/wav':'wav','audio/x-m4a':'m4a','audio/flac':'flac','application/pdf':'pdf','text/plain':'txt','application/rtf':'rtf','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx'} as Record<string,string>)[mime] ?? 'bin';
}
