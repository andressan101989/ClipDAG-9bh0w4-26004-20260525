begin;

alter table private.advertising_ad_review_events
  drop constraint advertising_ad_review_events_actor_user_id_fkey;

alter table private.advertising_ad_review_events
  add constraint advertising_ad_review_events_actor_user_id_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete restrict;

commit;
