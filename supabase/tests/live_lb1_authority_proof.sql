begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-host@proof.local','proof',now(),now(),now()),
('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-viewer@proof.local','proof',now(),now(),now()),
('10000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-invited@proof.local','proof',now(),now(),now()),
('10000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-noinvite@proof.local','proof',now(),now(),now()),
('10000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-rejected@proof.local','proof',now(),now(),now()),
('10000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb1-otherhost@proof.local','proof',now(),now(),now());

insert into public.user_profiles(id,username,display_name,is_admin) values
('10000000-0000-4000-8000-000000000001','lb1_host','LB1 host',false),
('10000000-0000-4000-8000-000000000002','lb1_viewer','LB1 viewer',false),
('10000000-0000-4000-8000-000000000003','lb1_invited','LB1 invited',false),
('10000000-0000-4000-8000-000000000004','lb1_noinvite','LB1 no invite',false),
('10000000-0000-4000-8000-000000000005','lb1_rejected','LB1 rejected',false),
('10000000-0000-4000-8000-000000000006','lb1_otherhost','LB1 other host',false);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.start_live_session('10000000-0000-4000-8000-000000000101','LB1 proof');
select public.heartbeat_live_session('10000000-0000-4000-8000-000000000101');
select public.mark_live_session_disconnected('10000000-0000-4000-8000-000000000101');
select public.heartbeat_live_session('10000000-0000-4000-8000-000000000101');
select public.recover_host_live_sessions();
reset role;
do $$begin
 if not exists(select 1 from public.live_sessions where id='10000000-0000-4000-8000-000000000101' and status='live' and last_heartbeat_at is not null and host_disconnected_at is null) then raise exception 'liveness_lifecycle_failed'; end if;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
reset role;
do $$begin
 if (select viewer_count from public.live_sessions where id='10000000-0000-4000-8000-000000000101')<>1 then raise exception 'presence_enter_not_idempotent'; end if;
 if (select count(*) from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and event_type='presence_enter')<>1 then raise exception 'presence_event_not_idempotent'; end if;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$begin
 begin insert into public.live_participants(session_id,user_id,role,status,agora_uid,username) values('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','cohost','active',77,'forged');raise exception 'direct_participant_insert_allowed';exception when insufficient_privilege then null;end;
 begin update public.live_sessions set viewer_count=999 where id='10000000-0000-4000-8000-000000000101';raise exception 'direct_session_update_allowed';exception when insufficient_privilege then null;end;
 begin insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)values('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','reaction','{"gift_real":true,"transaction_id":"forged","amount_bdag":999}');raise exception 'direct_control_insert_allowed';exception when insufficient_privilege then null;end;
 begin insert into public.live_messages(session_id,user_id,username,message)values('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000001','forged','spoof');raise exception 'direct_message_insert_allowed';exception when insufficient_privilege then null;end;
 begin perform public.close_stale_live_sessions();raise exception 'maintenance_allowed';exception when insufficient_privilege then null;end;
 begin perform public.set_live_participants_updated_at();raise exception 'trigger_allowed';exception when insufficient_privilege then null;end;
 begin perform public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','mute',null);raise exception 'viewer_control_allowed';exception when sqlstate '42501' then null;end;
end$$;
reset role;

set local role anon;
select set_config('request.jwt.claim.role','anon',true),set_config('request.jwt.claim.sub','',true);
do $$begin begin perform public.live_emit_reaction('10000000-0000-4000-8000-000000000101',chr(10084)||chr(65039));raise exception 'anon_rpc_allowed';exception when insufficient_privilege then null;end;end$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.live_request_to_join('10000000-0000-4000-8000-000000000101');
select public.live_request_to_join('10000000-0000-4000-8000-000000000101');
reset role;
do $$begin if (select count(*) from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and event_type='request_join')<>1 then raise exception 'duplicate_request';end if;end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.live_host_decide_join_request('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002',true);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','mute',null);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','unmute',null);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','lock_mic',null);
do $$begin
 begin perform public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','unmute',null);raise exception 'locked_unmute_allowed';exception when sqlstate '55000' then null;end;
 begin perform public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','timer_start',61);raise exception 'invalid_timer_allowed';exception when sqlstate '22023' then null;end;
end$$;
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','unlock_mic',null);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','grant_floor',null);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','revoke_floor',null);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','timer_start',60);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','timer_start',120);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002','timer_stop',null);
reset role;

update public.live_participants set floor_started_at=clock_timestamp()-interval '121 seconds',floor_duration_seconds=120,floor_granted=true,mic_muted=false where session_id='10000000-0000-4000-8000-000000000101' and user_id='10000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.live_enforce_participant_timer('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000002');
reset role;
do $$begin if not(select mic_muted and not floor_granted from public.live_participants where session_id='10000000-0000-4000-8000-000000000101' and user_id='10000000-0000-4000-8000-000000000002')then raise exception 'timer_auto_mute_failed';end if;end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.live_host_invite_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000003');
select public.live_host_invite_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000003');
reset role;
select set_config('lb1.invite',(select id::text from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and target_user_id='10000000-0000-4000-8000-000000000003' and event_type='host_invite' order by created_at desc,id desc limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101',current_setting('lb1.invite')::uuid,true);
select public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101',current_setting('lb1.invite')::uuid,true);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
do $$begin begin perform public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000999',true);raise exception 'accept_without_invite_allowed';exception when sqlstate '55000' then null;end;end$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.live_host_invite_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000005');
reset role;
select set_config('lb1.rejected_invite',(select id::text from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and target_user_id='10000000-0000-4000-8000-000000000005' and event_type='host_invite' order by created_at desc,id desc limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101',current_setting('lb1.rejected_invite')::uuid,false);
select public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101',current_setting('lb1.rejected_invite')::uuid,false);
do $$begin begin perform public.live_respond_to_host_invite('10000000-0000-4000-8000-000000000101',current_setting('lb1.rejected_invite')::uuid,true);raise exception 'rejected_invite_reused';exception when sqlstate '55000' then null;end;end$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.live_emit_reaction('10000000-0000-4000-8000-000000000101',chr(10084)||chr(65039)) from generate_series(1,8);
do $$begin
 begin perform public.live_emit_reaction('10000000-0000-4000-8000-000000000101',chr(10084)||chr(65039));raise exception 'reaction_rate_bypassed';exception when sqlstate '55000' then null;end;
 begin perform public.live_emit_reaction('10000000-0000-4000-8000-000000000101','x');raise exception 'reaction_allowlist_bypassed';exception when sqlstate '22023' then null;end;
end$$;
select public.live_send_message('10000000-0000-4000-8000-000000000101','  hello LB1  ');
do $$begin begin perform public.live_send_message('10000000-0000-4000-8000-000000000101','second');raise exception 'message_rate_bypassed';exception when sqlstate '55000' then null;end;end$$;
reset role;
do $$begin
 if not exists(select 1 from public.live_messages where session_id='10000000-0000-4000-8000-000000000101' and user_id='10000000-0000-4000-8000-000000000002' and username='lb1_viewer' and message='hello LB1')then raise exception 'message_identity_failed';end if;
 if exists(select 1 from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and actor_user_id='10000000-0000-4000-8000-000000000002' and coalesce(payload->>'gift_real','false')='true')then raise exception 'reaction_forged_gift';end if;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.live_host_control_participant('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000003','remove_cohost',null);
reset role;
do $$begin if exists(select 1 from public.live_participants where session_id='10000000-0000-4000-8000-000000000101' and user_id='10000000-0000-4000-8000-000000000003' and role='cohost' and status='active')then raise exception 'removed_publisher_eligible';end if;end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
do $$begin
 if exists(select 1 from public.live_control_events where session_id='10000000-0000-4000-8000-000000000101' and target_user_id='10000000-0000-4000-8000-000000000003' and event_type='remove_cohost') then raise exception 'private_control_visible'; end if;
end$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',false);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',false);
select public.live_set_participant_presence('10000000-0000-4000-8000-000000000101',true);
reset role;
do $$begin
 if (select viewer_count from public.live_sessions where id='10000000-0000-4000-8000-000000000101')<>4 then raise exception 'presence_reentry_count_failed';end if;
 if (select private.live_agora_uid('10000000-0000-4000-8000-000000000002'))<>1758552870 then raise exception 'agora_uid_mismatch';end if;
 if to_regprocedure('public.increment_live_viewer_count(uuid,integer)')is not null then raise exception 'unsafe_delta_function_remains';end if;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.end_live_session('10000000-0000-4000-8000-000000000101','host_ended');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
do $$begin begin perform public.live_request_to_join('10000000-0000-4000-8000-000000000101');raise exception 'ended_transition_allowed';exception when sqlstate '55000' then null;end;end$$;
reset role;

rollback;
