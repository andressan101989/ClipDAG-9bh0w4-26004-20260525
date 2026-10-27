-- Synthetic evidence is injected ONLY by the disposable superuser fixture.
-- This is not a normative policy, scanner verdict, or production activation.
insert into auth.users(id,is_anonymous) values
 ('11111111-1111-4111-8111-111111111111',false),
 ('22222222-2222-4222-8222-222222222222',false),
 ('33333333-3333-4333-8333-333333333333',false);
insert into public.user_profiles(id,username) values
 ('11111111-1111-4111-8111-111111111111','stories_b1_owner'),
 ('22222222-2222-4222-8222-222222222222','stories_b1_viewer'),
 ('33333333-3333-4333-8333-333333333333','stories_b1_other') on conflict(id) do nothing;
insert into public.follows(follower_id,following_id) values
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111'),
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
insert into public.stories(id,user_id,media_type,media_url) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','photo','https://fixture.invalid/photo.jpg');
insert into private.story_interactive_elements(story_id,element_id,kind,public_config,private_answer) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000001','poll','{"version":1,"element_id":"00000000-0000-4000-8000-000000000001","type":"poll","prompt":"A or B?","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}',null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000002','poll','{"version":1,"element_id":"00000000-0000-4000-8000-000000000002","type":"poll","prompt":"Choose","options":[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"}]}',null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000003','slider','{"version":1,"element_id":"00000000-0000-4000-8000-000000000003","type":"slider","prompt":"How much?","emoji":"🔥"}',null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000004','quiz','{"version":1,"element_id":"00000000-0000-4000-8000-000000000004","type":"quiz","prompt":"Quiz","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}','b'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000005','question','{"version":1,"element_id":"00000000-0000-4000-8000-000000000005","type":"question","prompt":"Ask"}',null),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-4000-8000-000000000006','reaction','{"version":1,"element_id":"00000000-0000-4000-8000-000000000006","type":"reaction","prompt":"React","emoji":"❤️"}',null);
update public.stories set story_composition=jsonb_build_object('version',2,'elements',(
 select jsonb_agg(jsonb_build_object('id',element_id,'type','interactive','element_id',element_id,'x',0.5,'y',0.5,'scale',1,'rotation',0))
 from private.story_interactive_elements where story_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update private.story_safety_state set state='passed',policy_digest=repeat('a',64),
 evidence_fingerprint=private.story_current_fingerprint(story_id),evidence_generation=generation,
 visual_complete=true,audio_complete=true,text_complete=true,decided_at=clock_timestamp()
where story_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
