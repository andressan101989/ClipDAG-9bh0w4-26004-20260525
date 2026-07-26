import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { getSupabaseClient } from '@/template';

export type MediaPurpose='avatar'|'post_image'|'carousel_image'|'thumbnail'|'product_image'|'chat_image'|'chat_audio'|'voice_note'|'music_audio'|'document'|'attachment'|'live_cover';
export type MediaVisibility='public'|'private';
export interface UploadMediaInput { uri:string; purpose:MediaPurpose; mimeType:string; fileName?:string; sizeBytes?:number; visibility:MediaVisibility; signal?:AbortSignal; timeoutMs?:number; }
export interface MediaAssetDescriptor { assetId:string; provider:'r2'; mediaKind:'image'|'audio'|'document'; purpose:MediaPurpose; visibility:MediaVisibility; status:'ready'; url?:string; }
type CreateResponse={success:boolean;data?:{assetId:string;uploadUrl:string;method:'PUT';headers:{'Content-Type':string};expiresAt:string};error?:string};

const supabase=getSupabaseClient();
const rejectLocalUrl=(value:string)=>/^(file|ph|content):\/\//i.test(value);

export async function createMediaUpload(input:UploadMediaInput) {
  const file=new File(input.uri);
  const size=input.sizeBytes ?? file.size;
  const {data,error}=await supabase.functions.invoke<CreateResponse>('create-media-upload',{body:{purpose:input.purpose,mime_type:input.mimeType,size_bytes:size,file_name:input.fileName??file.name,visibility:input.visibility}});
  if(error||!data?.success||!data.data) throw new Error(data?.error??error?.message??'media_create_failed');
  return {file,contract:data.data};
}
export async function finalizeMediaUpload(assetId:string):Promise<MediaAssetDescriptor> {
  const {data,error}=await supabase.functions.invoke('finalize-media-upload',{body:{asset_id:assetId}});
  if(error||!data?.success||!data.data) throw new Error(data?.error??error?.message??'media_finalize_failed');
  if(data.data.url&&rejectLocalUrl(data.data.url)) throw new Error('invalid_persisted_media_url');
  return data.data as MediaAssetDescriptor;
}
export async function uploadMediaFromUri(input:UploadMediaInput):Promise<MediaAssetDescriptor> {
  if(!input.uri||!input.mimeType) throw new Error('invalid_media_input');
  const controller=new AbortController();
  const forwardAbort=()=>controller.abort();
  input.signal?.addEventListener('abort',forwardAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(),input.timeoutMs??120_000);
  try {
    const {file,contract}=await createMediaUpload(input);
    const response=await expoFetch(contract.uploadUrl,{method:'PUT',headers:contract.headers,body:file,signal:controller.signal});
    if(!response.ok) throw new Error(`media_upload_http_${response.status}`);
    return await finalizeMediaUpload(contract.assetId);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort',forwardAbort);
  }
}
export async function getMediaUrl(assetId:string):Promise<string> {
  const {data,error}=await supabase.functions.invoke('get-media-url',{body:{asset_id:assetId}});
  if(error||!data?.success||!data.data?.url) throw new Error(data?.error??error?.message??'media_url_failed');
  return data.data.url;
}
export async function deleteMediaAsset(assetId:string):Promise<void> {
  const {data,error}=await supabase.functions.invoke('delete-media-asset',{body:{asset_id:assetId}});
  if(error||!data?.success) throw new Error(data?.error??error?.message??'media_delete_failed');
}
export async function setProfileAvatarWithMedia(assetId:string):Promise<string> {
  const {data,error}=await supabase.rpc('set_profile_avatar_with_media',{p_asset_id:assetId});
  if(error||typeof data!=='string'||!data.startsWith('https://')) {
    throw new Error(error?.message??'avatar_update_failed');
  }
  return data;
}
export type LinkableMediaEntity = 'user_profile' | 'video_post' | 'story' | 'shop_product';

export async function linkMediaAsset(assetId:string,entityType:LinkableMediaEntity,entityId:string,slot:string,position=0):Promise<void> {
  const {error}=await supabase.rpc('link_media_asset',{p_asset_id:assetId,p_entity_type:entityType,p_entity_id:entityId,p_slot:slot,p_position:position});
  if(error) throw new Error(error.message);
}
export async function getLinkedMediaAssetIds(entityType:LinkableMediaEntity,entityId:string,slot?:string):Promise<string[]> {
  let query=supabase.from('media_asset_links').select('asset_id').eq('entity_type',entityType).eq('entity_id',entityId);
  if(slot) query=query.eq('slot',slot);
  const {data,error}=await query;
  if(error) throw new Error(error.message);
  return (data??[]).map(row=>row.asset_id as string);
}
