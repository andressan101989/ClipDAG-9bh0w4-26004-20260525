CREATE OR REPLACE FUNCTION public.follow_user(p_follower_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_inserted boolean;
begin
  if p_follower_id = p_target_id then raise exception 'self_follow_not_allowed'; end if;
  insert into public.follows (follower_id, following_id)
  values (p_follower_id, p_target_id)
  on conflict (follower_id, following_id) do nothing;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  if v_inserted then
    update public.user_profiles set following_count = following_count + 1 where id = p_follower_id;
    update public.user_profiles set followers_count = followers_count + 1 where id = p_target_id;
  end if;
end; $$;

CREATE OR REPLACE FUNCTION public.unfollow_user(p_follower_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_deleted boolean;
begin
  delete from public.follows where follower_id = p_follower_id and following_id = p_target_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  if v_deleted then
    update public.user_profiles set following_count = greatest(0, following_count - 1) where id = p_follower_id;
    update public.user_profiles set followers_count = greatest(0, followers_count - 1) where id = p_target_id;
  end if;
end; $$;;
