begin;

create or replace function public.create_carousel_post(
  p_video_url text,
  p_thumbnail_url text,
  p_caption text,
  p_music text,
  p_media_urls text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_url text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.user_profiles where id = v_user_id
  ) then
    raise exception using errcode = '23503', message = 'profile_not_found';
  end if;

  if coalesce(array_length(p_media_urls, 1), 0) not between 2 and 10 then
    raise exception using errcode = '22023', message = 'invalid_media_count';
  end if;

  foreach v_url in array p_media_urls loop
    if v_url is null or length(btrim(v_url)) = 0 or v_url !~* '^https://' then
      raise exception using errcode = '22023', message = 'invalid_media_url';
    end if;
  end loop;

  if p_video_url is distinct from p_media_urls[1]
     or p_thumbnail_url is distinct from p_media_urls[1] then
    raise exception using errcode = '22023', message = 'cover_must_match_first_media';
  end if;

  insert into public.videos (
    user_id,
    video_url,
    thumbnail_url,
    caption,
    music,
    media_urls
  ) values (
    v_user_id,
    p_video_url,
    p_thumbnail_url,
    coalesce(p_caption, ''),
    coalesce(nullif(btrim(p_music), ''), 'Sin musica'),
    p_media_urls
  )
  returning id into v_post_id;

  return v_post_id;
end;
$$;

comment on function public.create_carousel_post(text,text,text,text,text[])
  is 'Creates one authenticated carousel post with 2-10 persistent HTTPS media URLs.';

revoke execute on function public.create_carousel_post(text,text,text,text,text[]) from public;
revoke execute on function public.create_carousel_post(text,text,text,text,text[]) from anon;
grant execute on function public.create_carousel_post(text,text,text,text,text[]) to authenticated;
grant execute on function public.create_carousel_post(text,text,text,text,text[]) to service_role;

notify pgrst, 'reload schema';

commit;
