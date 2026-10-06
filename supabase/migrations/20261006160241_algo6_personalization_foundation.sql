begin;

-- ALGO-6 FINAL MACRO: one private, explicit personalization authority.
create table private.personalization_interest_taxonomy (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  parent_id uuid null references private.personalization_interest_taxonomy(id)
    on update restrict on delete restrict,
  level smallint not null,
  labels jsonb not null,
  semantic_text text not null,
  active boolean not null default true,
  minor_safe boolean not null default true,
  ads_eligible boolean not null default true,
  embedding_provider text not null default 'cloudflare_workers_ai',
  embedding_model text not null default '@cf/baai/bge-m3',
  embedding_dimensions integer not null default 1024,
  embedding extensions.vector(1024) null,
  embedding_status text not null default 'pending',
  embedding_fingerprint text not null,
  embedding_attempt_count integer not null default 0,
  embedding_available_at timestamptz not null default clock_timestamp(),
  embedding_started_at timestamptz null,
  embedding_completed_at timestamptz null,
  embedding_last_error_code text null,
  embedding_provider_call_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint personalization_interest_taxonomy_slug_check
    check (slug ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint personalization_interest_taxonomy_level_check
    check ((level = 1 and parent_id is null) or (level = 2 and parent_id is not null)),
  constraint personalization_interest_taxonomy_labels_check
    check (
      jsonb_typeof(labels) = 'object'
      and labels ?& array['es','en','pt','fr']
      and jsonb_typeof(labels -> 'es') = 'string'
      and jsonb_typeof(labels -> 'en') = 'string'
      and jsonb_typeof(labels -> 'pt') = 'string'
      and jsonb_typeof(labels -> 'fr') = 'string'
    ),
  constraint personalization_interest_taxonomy_semantic_text_check
    check (semantic_text = btrim(semantic_text) and char_length(semantic_text) between 3 and 500),
  constraint personalization_interest_taxonomy_provider_check
    check (embedding_provider = 'cloudflare_workers_ai'),
  constraint personalization_interest_taxonomy_model_check
    check (embedding_model = '@cf/baai/bge-m3'),
  constraint personalization_interest_taxonomy_dimensions_check
    check (embedding_dimensions = 1024 and (embedding is null or extensions.vector_dims(embedding) = 1024)),
  constraint personalization_interest_taxonomy_status_check
    check (embedding_status in ('pending','processing','ready','failed')),
  constraint personalization_interest_taxonomy_fingerprint_check
    check (embedding_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint personalization_interest_taxonomy_attempt_check
    check (embedding_attempt_count between 0 and 5),
  constraint personalization_interest_taxonomy_provider_calls_check
    check (embedding_provider_call_count >= 0),
  constraint personalization_interest_taxonomy_state_check check (
    (embedding_status = 'pending' and embedding is null and embedding_started_at is null and embedding_completed_at is null)
    or (embedding_status = 'processing' and embedding is null and embedding_started_at is not null and embedding_completed_at is null)
    or (embedding_status = 'ready' and embedding is not null and embedding_started_at is null and embedding_completed_at is not null)
    or (embedding_status = 'failed' and embedding is null and embedding_started_at is null and embedding_completed_at is not null)
  )
);

create table private.user_personalization_profiles (
  user_id uuid primary key references auth.users(id) on update restrict on delete cascade,
  onboarding_version text not null default 'personalization-onboarding-v1',
  onboarding_completed_at timestamptz null,
  primary_language_tag text null,
  additional_language_tags text[] not null default '{}'::text[],
  content_region_code text null,
  personalization_enabled boolean not null default true,
  ads_personalization_consent boolean not null default false,
  preferences_updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint user_personalization_profiles_onboarding_version_check
    check (onboarding_version = 'personalization-onboarding-v1'),
  constraint user_personalization_profiles_primary_language_check
    check (primary_language_tag is null or primary_language_tag in ('es','en','pt','fr')),
  constraint user_personalization_profiles_additional_languages_check
    check (
      cardinality(additional_language_tags) <= 3
      and additional_language_tags <@ array['es','en','pt','fr']::text[]
      and (primary_language_tag is null or not (primary_language_tag = any(additional_language_tags)))
    ),
  constraint user_personalization_profiles_region_check
    check (content_region_code is null or content_region_code = 'GLOBAL' or content_region_code ~ '^[A-Z]{2}$'),
  constraint user_personalization_profiles_completion_check
    check (
      onboarding_completed_at is null
      or (primary_language_tag is not null and content_region_code is not null)
    )
);

create table private.user_personalization_interests (
  user_id uuid not null references auth.users(id) on update restrict on delete cascade,
  interest_id uuid not null references private.personalization_interest_taxonomy(id)
    on update restrict on delete restrict,
  source text not null default 'explicit',
  selected_at timestamptz not null default clock_timestamp(),
  primary key (user_id, interest_id),
  constraint user_personalization_interests_source_check check (source = 'explicit')
);

create index personalization_interest_taxonomy_parent_idx
  on private.personalization_interest_taxonomy(parent_id, sort_order, slug)
  where active;
create index personalization_interest_taxonomy_embedding_queue_idx
  on private.personalization_interest_taxonomy(embedding_available_at, id)
  where active and embedding_status = 'pending' and embedding_attempt_count < 5;
create index user_personalization_interests_interest_idx
  on private.user_personalization_interests(interest_id, user_id);

alter table private.personalization_interest_taxonomy enable row level security;
alter table private.personalization_interest_taxonomy force row level security;
alter table private.user_personalization_profiles enable row level security;
alter table private.user_personalization_profiles force row level security;
alter table private.user_personalization_interests enable row level security;
alter table private.user_personalization_interests force row level security;

revoke all on table private.personalization_interest_taxonomy from public, anon, authenticated, service_role;
revoke all on table private.user_personalization_profiles from public, anon, authenticated, service_role;
revoke all on table private.user_personalization_interests from public, anon, authenticated, service_role;

create function private.personalization_taxonomy_fingerprint_v1(
  p_slug text,
  p_semantic_text text
) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('personalization-taxonomy-v1|' || p_slug || '|' || p_semantic_text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.personalization_taxonomy_fingerprint_v1(text,text)
  from public, anon, authenticated, service_role;

-- Parent topics. Display labels are presentation only; slugs are stable IDs.
with parents(slug, es, en, pt, fr, semantic_text, sort_order) as (values
  ('sports','Deportes','Sports','Esportes','Sports','sports, athletic competition and teams',10),
  ('music','Música','Music','Música','Musique','music, artists, songs and live performance',20),
  ('movies_tv','Cine y TV','Movies & TV','Filmes e TV','Cinéma et TV','movies, television and screen entertainment',30),
  ('comedy','Comedia','Comedy','Comédia','Comédie','comedy, humor and funny entertainment',40),
  ('technology','Tecnología','Technology','Tecnologia','Technologie','technology, computing and digital innovation',50),
  ('gaming','Videojuegos','Gaming','Jogos','Jeux vidéo','video games, gaming culture and esports',60),
  ('cars_motorsport','Autos y motor','Cars & motorsport','Carros e automobilismo','Auto et sport automobile','cars, motorcycles and motorsport',70),
  ('food','Comida','Food','Comida','Cuisine','food, cooking, recipes and restaurants',80),
  ('travel','Viajes','Travel','Viagens','Voyage','travel, destinations and cultures',90),
  ('fashion_style','Moda y estilo','Fashion & style','Moda e estilo','Mode et style','fashion, clothing and personal style',100),
  ('fitness_wellness','Fitness y bienestar','Fitness & wellness','Fitness e bem-estar','Fitness et bien-être','fitness, exercise and general wellness',110),
  ('beauty','Belleza','Beauty','Beleza','Beauté','beauty, makeup, hair and skin care',120),
  ('art_design','Arte y diseño','Art & design','Arte e design','Art et design','art, illustration, architecture and design',130),
  ('science_education','Ciencia y educación','Science & education','Ciência e educação','Science et éducation','science, learning and educational explanation',140),
  ('pets_nature','Mascotas y naturaleza','Pets & nature','Pets e natureza','Animaux et nature','pets, wildlife and nature',150),
  ('business_entrepreneurship','Negocios y emprendimiento','Business & entrepreneurship','Negócios e empreendedorismo','Affaires et entrepreneuriat','business, careers and entrepreneurship',160)
)
insert into private.personalization_interest_taxonomy(
  slug, parent_id, level, labels, semantic_text, embedding_fingerprint, sort_order
)
select
  p.slug,
  null,
  1,
  jsonb_build_object('es',p.es,'en',p.en,'pt',p.pt,'fr',p.fr),
  p.semantic_text,
  private.personalization_taxonomy_fingerprint_v1(p.slug,p.semantic_text),
  p.sort_order
from parents p;

with children(parent_slug, slug, es, en, pt, fr, semantic_text, sort_order) as (values
  ('sports','sports_general','Deportes en general','Sports in general','Esportes em geral','Sports en général','general sports and athletic competition',1),
  ('sports','football_soccer','Fútbol','Football / soccer','Futebol','Football','association football soccer',2),
  ('sports','baseball','Béisbol','Baseball','Beisebol','Baseball','baseball',3),
  ('sports','basketball','Baloncesto','Basketball','Basquete','Basket-ball','basketball',4),
  ('sports','motorsport','Automovilismo','Motorsport','Automobilismo','Sport automobile','motorsport racing',5),
  ('sports','mma_boxing','MMA y boxeo','MMA & boxing','MMA e boxe','MMA et boxe','mixed martial arts and boxing',6),
  ('sports','tennis','Tenis','Tennis','Tênis','Tennis','tennis',7),
  ('sports','cricket','Críquet','Cricket','Críquete','Cricket','cricket sport',8),
  ('music','music_general','Música en general','Music in general','Música em geral','Musique en général','general music and artists',1),
  ('music','reggaeton','Reguetón','Reggaeton','Reggaeton','Reggaeton','reggaeton music',2),
  ('music','latin_music','Música latina','Latin music','Música latina','Musique latine','Latin music',3),
  ('music','hip_hop','Hip hop','Hip hop','Hip hop','Hip-hop','hip hop and rap music',4),
  ('music','pop','Pop','Pop','Pop','Pop','pop music',5),
  ('music','rock','Rock','Rock','Rock','Rock','rock music',6),
  ('music','electronic','Electrónica','Electronic','Eletrônica','Électronique','electronic dance music',7),
  ('music','salsa','Salsa','Salsa','Salsa','Salsa','salsa music and dance',8),
  ('music','bachata','Bachata','Bachata','Bachata','Bachata','bachata music and dance',9),
  ('music','regional_mexican','Regional mexicano','Regional Mexican','Regional mexicano','Musique régionale mexicaine','regional Mexican music',10),
  ('music','classical','Clásica','Classical','Clássica','Classique','classical music',11),
  ('movies_tv','movies_tv_general','Cine y TV en general','Movies and TV in general','Filmes e TV em geral','Cinéma et TV en général','general movies and television',1),
  ('movies_tv','action','Acción','Action','Ação','Action','action movies and television',2),
  ('movies_tv','comedy_film','Comedia cinematográfica','Comedy film','Filme de comédia','Film comique','comedy movies and television',3),
  ('movies_tv','drama','Drama','Drama','Drama','Drame','drama movies and television',4),
  ('movies_tv','science_fiction','Ciencia ficción','Science fiction','Ficção científica','Science-fiction','science fiction movies and television',5),
  ('movies_tv','horror','Terror','Horror','Terror','Horreur','horror movies and television',6),
  ('movies_tv','anime','Anime','Anime','Anime','Anime','anime series and movies',7),
  ('movies_tv','documentaries','Documentales','Documentaries','Documentários','Documentaires','documentary films and series',8),
  ('comedy','comedy_general','Comedia en general','Comedy in general','Comédia em geral','Comédie en général','general comedy and humor',1),
  ('comedy','sketch_comedy','Sketches','Sketch comedy','Comédia de esquetes','Sketchs comiques','sketch comedy',2),
  ('comedy','stand_up','Stand-up','Stand-up','Stand-up','Stand-up','stand up comedy',3),
  ('comedy','memes','Memes','Memes','Memes','Mèmes','internet memes and humor',4),
  ('technology','technology_general','Tecnología en general','Technology in general','Tecnologia em geral','Technologie en général','general technology',1),
  ('technology','artificial_intelligence','Inteligencia artificial','Artificial intelligence','Inteligência artificial','Intelligence artificielle','artificial intelligence and machine learning',2),
  ('technology','smartphones','Teléfonos inteligentes','Smartphones','Smartphones','Smartphones','smartphones and mobile technology',3),
  ('technology','gadgets','Gadgets','Gadgets','Gadgets','Gadgets','consumer gadgets',4),
  ('technology','programming','Programación','Programming','Programação','Programmation','software development and programming',5),
  ('technology','cybersecurity','Ciberseguridad','Cybersecurity','Cibersegurança','Cybersécurité','cybersecurity and digital safety',6),
  ('gaming','gaming_general','Videojuegos en general','Gaming in general','Jogos em geral','Jeux vidéo en général','general video games',1),
  ('gaming','console','Consola','Console','Console','Console','console video games',2),
  ('gaming','pc','PC','PC','PC','PC','PC video games',3),
  ('gaming','mobile_gaming','Juegos móviles','Mobile gaming','Jogos mobile','Jeux mobiles','mobile video games',4),
  ('gaming','esports','Esports','Esports','Esports','Esport','competitive esports',5),
  ('cars_motorsport','cars_motorsport_general','Motor en general','Cars and motorsport in general','Carros e automobilismo em geral','Auto et sport automobile en général','general cars and motorsport',1),
  ('cars_motorsport','supercars','Superautos','Supercars','Supercarros','Supercars','supercars and performance cars',2),
  ('cars_motorsport','electric_vehicles','Vehículos eléctricos','Electric vehicles','Veículos elétricos','Véhicules électriques','electric vehicles',3),
  ('cars_motorsport','tuning','Modificación','Tuning','Tuning','Tuning','car tuning and customization',4),
  ('cars_motorsport','motorcycles','Motocicletas','Motorcycles','Motocicletas','Motos','motorcycles',5),
  ('cars_motorsport','formula_one','Fórmula 1','Formula One','Fórmula 1','Formule 1','Formula One racing',6),
  ('food','food_general','Comida en general','Food in general','Comida em geral','Cuisine en général','general food and cooking',1),
  ('food','recipes','Recetas','Recipes','Receitas','Recettes','cooking recipes',2),
  ('food','restaurants','Restaurantes','Restaurants','Restaurantes','Restaurants','restaurants and dining',3),
  ('food','desserts','Postres','Desserts','Sobremesas','Desserts','desserts and baking',4),
  ('food','street_food','Comida callejera','Street food','Comida de rua','Cuisine de rue','street food',5),
  ('food','healthy_food','Comida saludable','Healthy food','Comida saudável','Cuisine saine','healthy everyday food',6),
  ('travel','travel_general','Viajes en general','Travel in general','Viagens em geral','Voyage en général','general travel',1),
  ('travel','destinations','Destinos','Destinations','Destinos','Destinations','travel destinations',2),
  ('travel','budget_travel','Viajes económicos','Budget travel','Viagens econômicas','Voyage économique','budget travel',3),
  ('travel','luxury_travel','Viajes de lujo','Luxury travel','Viagens de luxo','Voyage de luxe','luxury travel',4),
  ('travel','adventure_travel','Aventura','Adventure travel','Viagens de aventura','Voyage aventure','adventure travel',5),
  ('fashion_style','fashion_style_general','Moda en general','Fashion in general','Moda em geral','Mode en général','general fashion and style',1),
  ('fashion_style','streetwear','Moda urbana','Streetwear','Streetwear','Streetwear','streetwear fashion',2),
  ('fashion_style','luxury_fashion','Moda de lujo','Luxury fashion','Moda de luxo','Mode de luxe','luxury fashion',3),
  ('fashion_style','sustainable_fashion','Moda sostenible','Sustainable fashion','Moda sustentável','Mode durable','sustainable fashion',4),
  ('fitness_wellness','fitness_wellness_general','Bienestar general','Fitness and wellness in general','Fitness e bem-estar em geral','Fitness et bien-être en général','general fitness and non-medical wellness',1),
  ('fitness_wellness','strength_training','Fuerza','Strength training','Treino de força','Musculation','strength training',2),
  ('fitness_wellness','running','Correr','Running','Corrida','Course','running and jogging',3),
  ('fitness_wellness','yoga','Yoga','Yoga','Yoga','Yoga','yoga practice',4),
  ('beauty','beauty_general','Belleza en general','Beauty in general','Beleza em geral','Beauté en général','general beauty',1),
  ('beauty','makeup','Maquillaje','Makeup','Maquiagem','Maquillage','makeup artistry',2),
  ('beauty','hair','Cabello','Hair','Cabelo','Cheveux','hair styling and care',3),
  ('beauty','skincare','Cuidado de la piel','Skin care','Cuidados com a pele','Soin de la peau','general cosmetic skin care',4),
  ('art_design','art_design_general','Arte y diseño en general','Art and design in general','Arte e design em geral','Art et design en général','general art and design',1),
  ('art_design','illustration','Ilustración','Illustration','Ilustração','Illustration','illustration and drawing',2),
  ('art_design','photography','Fotografía','Photography','Fotografia','Photographie','creative photography',3),
  ('art_design','architecture','Arquitectura','Architecture','Arquitetura','Architecture','architecture and spaces',4),
  ('art_design','graphic_design','Diseño gráfico','Graphic design','Design gráfico','Design graphique','graphic design',5),
  ('science_education','science_education_general','Ciencia y educación en general','Science and education in general','Ciência e educação em geral','Science et éducation en général','general science and education',1),
  ('science_education','space_astronomy','Espacio y astronomía','Space and astronomy','Espaço e astronomia','Espace et astronomie','space and astronomy',2),
  ('science_education','history_learning','Historia','History','História','Histoire','history education',3),
  ('science_education','math_learning','Matemáticas','Mathematics','Matemática','Mathématiques','mathematics education',4),
  ('science_education','language_learning','Idiomas','Language learning','Aprendizado de idiomas','Apprentissage des langues','language learning',5),
  ('pets_nature','pets_nature_general','Mascotas y naturaleza en general','Pets and nature in general','Pets e natureza em geral','Animaux et nature en général','general pets and nature',1),
  ('pets_nature','dogs','Perros','Dogs','Cães','Chiens','dogs and dog care',2),
  ('pets_nature','cats','Gatos','Cats','Gatos','Chats','cats and cat care',3),
  ('pets_nature','wildlife','Vida silvestre','Wildlife','Vida selvagem','Faune sauvage','wildlife and habitats',4),
  ('pets_nature','outdoors','Naturaleza','Outdoors','Natureza','Plein air','outdoors and nature',5),
  ('business_entrepreneurship','business_entrepreneurship_general','Negocios en general','Business in general','Negócios em geral','Affaires en général','general business and entrepreneurship',1),
  ('business_entrepreneurship','startups','Startups','Startups','Startups','Startups','startups and entrepreneurship',2),
  ('business_entrepreneurship','marketing','Marketing','Marketing','Marketing','Marketing','marketing and brand strategy',3),
  ('business_entrepreneurship','leadership','Liderazgo','Leadership','Liderança','Leadership','business leadership',4),
  ('business_entrepreneurship','personal_finance_education','Educación financiera','Financial education','Educação financeira','Éducation financière','general financial literacy education without personal financial targeting',5)
)
insert into private.personalization_interest_taxonomy(
  slug, parent_id, level, labels, semantic_text, embedding_fingerprint, sort_order
)
select
  c.slug,
  p.id,
  2,
  jsonb_build_object('es',c.es,'en',c.en,'pt',c.pt,'fr',c.fr),
  c.semantic_text,
  private.personalization_taxonomy_fingerprint_v1(c.slug,c.semantic_text),
  c.sort_order
from children c
join private.personalization_interest_taxonomy p
  on p.slug = c.parent_slug and p.level = 1;

create function private.personalization_validate_selection_v1(
  p_primary_language_tag text,
  p_additional_language_tags text[],
  p_content_region_code text,
  p_interest_slugs text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_languages text[] := coalesce(p_additional_language_tags, '{}'::text[]);
  v_slugs text[] := coalesce(p_interest_slugs, '{}'::text[]);
  v_distinct_slugs integer;
  v_parent_count integer;
  v_missing_children integer;
begin
  if p_primary_language_tag is null or p_primary_language_tag not in ('es','en','pt','fr') then
    raise exception using errcode = '22023', message = 'personalization_primary_language_invalid';
  end if;
  if cardinality(v_languages) > 3
     or exists (select 1 from unnest(v_languages) x where x not in ('es','en','pt','fr'))
     or p_primary_language_tag = any(v_languages)
     or cardinality(v_languages) <> (select count(distinct x) from unnest(v_languages) x) then
    raise exception using errcode = '22023', message = 'personalization_additional_languages_invalid';
  end if;
  if p_content_region_code is null
     or not (p_content_region_code = 'GLOBAL' or p_content_region_code ~ '^[A-Z]{2}$') then
    raise exception using errcode = '22023', message = 'personalization_content_region_invalid';
  end if;

  select count(distinct x) into v_distinct_slugs from unnest(v_slugs) x;
  if cardinality(v_slugs) <> v_distinct_slugs then
    raise exception using errcode = '22023', message = 'personalization_duplicate_interest';
  end if;
  if exists (
    select 1 from unnest(v_slugs) x
    left join private.personalization_interest_taxonomy t on t.slug = x and t.active
    where t.id is null
  ) then
    raise exception using errcode = '22023', message = 'personalization_interest_invalid';
  end if;
  select count(*) into v_parent_count
  from private.personalization_interest_taxonomy t
  where t.active and t.level = 1 and t.slug = any(v_slugs);
  if v_parent_count < 3 or v_parent_count > 8 then
    raise exception using errcode = '22023', message = 'personalization_parent_interest_count_invalid';
  end if;
  select count(*) into v_missing_children
  from private.personalization_interest_taxonomy p
  where p.active and p.level = 1 and p.slug = any(v_slugs)
    and not exists (
      select 1 from private.personalization_interest_taxonomy c
      where c.parent_id = p.id and c.active and c.slug = any(v_slugs)
    );
  if v_missing_children > 0 then
    raise exception using errcode = '22023', message = 'personalization_subinterest_required';
  end if;
  if v_distinct_slugs > 48 then
    raise exception using errcode = '22023', message = 'personalization_interest_selection_too_large';
  end if;
  return jsonb_build_object('valid',true,'parent_count',v_parent_count,'interest_count',v_distinct_slugs);
end;
$$;

revoke all on function private.personalization_validate_selection_v1(text,text[],text,text[])
  from public, anon, authenticated, service_role;

create function public.get_personalization_onboarding_catalog_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version','personalization-onboarding-v1',
    'languages',jsonb_build_array('es','en','pt','fr'),
    'region_contract','GLOBAL_OR_ISO_3166_1_ALPHA_2',
    'minimum_parent_interests',3,
    'maximum_parent_interests',8,
    'maximum_creator_follows',5,
    'topics',coalesce(jsonb_agg(jsonb_build_object(
      'slug',t.slug,
      'parent_slug',p.slug,
      'level',t.level,
      'labels',t.labels,
      'minor_safe',t.minor_safe
    ) order by coalesce(p.sort_order,t.sort_order),t.level,t.sort_order,t.slug),'[]'::jsonb)
  )
  from private.personalization_interest_taxonomy t
  left join private.personalization_interest_taxonomy p on p.id = t.parent_id
  where t.active and t.minor_safe;
$$;

revoke all on function public.get_personalization_onboarding_catalog_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_personalization_onboarding_catalog_v1() to authenticated;

create function public.get_my_personalization_onboarding_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile private.user_personalization_profiles;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  select * into v_profile from private.user_personalization_profiles where user_id = v_actor;
  return jsonb_build_object(
    'contract_version','personalization-onboarding-v1',
    'completed',coalesce(v_profile.onboarding_completed_at is not null,false),
    'onboarding_completed_at',v_profile.onboarding_completed_at,
    'primary_language_tag',v_profile.primary_language_tag,
    'additional_language_tags',coalesce(to_jsonb(v_profile.additional_language_tags),'[]'::jsonb),
    'content_region_code',v_profile.content_region_code,
    'personalization_enabled',coalesce(v_profile.personalization_enabled,true),
    'ads_personalization_consent',coalesce(v_profile.ads_personalization_consent,false),
    'preferences_updated_at',v_profile.preferences_updated_at,
    'interest_slugs',coalesce((
      select jsonb_agg(t.slug order by t.level,t.sort_order,t.slug)
      from private.user_personalization_interests ui
      join private.personalization_interest_taxonomy t on t.id = ui.interest_id
      where ui.user_id = v_actor
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_personalization_onboarding_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_personalization_onboarding_v1() to authenticated;

create function public.save_my_personalization_preferences_v1(
  p_primary_language_tag text,
  p_additional_language_tags text[],
  p_content_region_code text,
  p_interest_slugs text[],
  p_personalization_enabled boolean default true,
  p_ads_personalization_consent boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_validation jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  if not exists (
    select 1 from private.user_age_eligibility a
    where a.user_id = v_actor and a.status = 'eligible' and a.evaluated_at is not null
  ) then
    raise exception using errcode = '42501', message = 'personalization_age_eligibility_required';
  end if;
  v_validation := private.personalization_validate_selection_v1(
    p_primary_language_tag,
    p_additional_language_tags,
    upper(p_content_region_code),
    p_interest_slugs
  );
  insert into private.user_personalization_profiles(
    user_id,primary_language_tag,additional_language_tags,content_region_code,
    personalization_enabled,ads_personalization_consent,preferences_updated_at,updated_at
  ) values (
    v_actor,p_primary_language_tag,coalesce(p_additional_language_tags,'{}'::text[]),upper(p_content_region_code),
    coalesce(p_personalization_enabled,true),coalesce(p_ads_personalization_consent,false),v_now,v_now
  ) on conflict (user_id) do update set
    primary_language_tag = excluded.primary_language_tag,
    additional_language_tags = excluded.additional_language_tags,
    content_region_code = excluded.content_region_code,
    personalization_enabled = excluded.personalization_enabled,
    ads_personalization_consent = excluded.ads_personalization_consent,
    preferences_updated_at = excluded.preferences_updated_at,
    updated_at = excluded.updated_at;

  delete from private.user_personalization_interests where user_id = v_actor;
  insert into private.user_personalization_interests(user_id,interest_id,source,selected_at)
  select v_actor,t.id,'explicit',v_now
  from private.personalization_interest_taxonomy t
  where t.active and t.slug = any(p_interest_slugs);

  return jsonb_build_object(
    'saved',true,
    'preferences_updated_at',v_now,
    'validation',v_validation
  );
end;
$$;

revoke all on function public.save_my_personalization_preferences_v1(text,text[],text,text[],boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_personalization_preferences_v1(text,text[],text,text[],boolean,boolean) to authenticated;

create function public.get_my_onboarding_creator_recommendations_v1(
  p_limit integer default 12
) returns table(
  creator_id uuid,
  username text,
  display_name text,
  avatar_url text,
  follower_count integer,
  semantic_relevance numeric,
  language_match numeric,
  region_match numeric,
  quality_score numeric,
  recommendation_score numeric,
  already_following boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception using errcode = '22023', message = 'personalization_creator_limit_invalid';
  end if;
  v_limit := p_limit;
  return query
  with viewer_profile as materialized (
    select p.* from private.user_personalization_profiles p where p.user_id = v_actor
  ),
  selected_centroid as materialized (
    select extensions.avg(t.embedding) as embedding
    from private.user_personalization_interests ui
    join private.personalization_interest_taxonomy t on t.id = ui.interest_id
    where ui.user_id = v_actor and t.active and t.embedding_status = 'ready' and t.embedding is not null
  ),
  eligible_videos as materialized (
    select v.id,v.user_id,vsp.embedding,vsp.detected_language
    from public.videos v
    left join private.video_semantic_profiles vsp
      on vsp.video_id = v.id and vsp.status = 'ready' and vsp.embedding is not null
    where v.user_id <> v_actor
      and private.admin_content_is_visible('video',v.id)
      and private.video_can_view_owner(v.user_id)
      and not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = v_actor and b.blocked_id = v.user_id)
           or (b.blocker_id = v.user_id and b.blocked_id = v_actor)
      )
  ),
  creator_semantics as materialized (
    select ev.user_id,
        max(case when sc.embedding is not null and ev.embedding is not null
          then greatest(0::numeric,least(1::numeric,
          (1 - (ev.embedding operator(extensions.<=>) sc.embedding))::numeric)) else 0 end)::numeric as semantic_relevance,
      max(case when ev.detected_language = vp.primary_language_tag then 1::numeric
        when ev.detected_language = any(vp.additional_language_tags) then 0.6::numeric else 0 end) as language_match
    from eligible_videos ev
    cross join viewer_profile vp
    cross join selected_centroid sc
    group by ev.user_id
  ),
  quality as materialized (
    select v.user_id,
      least(1::numeric,coalesce(avg(case when vv.media_duration_ms > 0 and vv.completion_ratio is not null
        then least(1::numeric,greatest(0::numeric,vv.completion_ratio)) end),0)) as quality_score
    from eligible_videos ev
    join public.videos v on v.id = ev.id
    left join public.video_views vv on vv.video_id = v.id
    group by v.user_id
  ),
  scored as (
    select up.id,up.username,up.display_name,up.avatar_url,up.followers_count,
      cs.semantic_relevance,
      cs.language_match,
      case when vp.content_region_code <> 'GLOBAL'
        and cp.content_region_code = vp.content_region_code then 1::numeric else 0 end as region_match,
      q.quality_score,
      exists(select 1 from public.follows f where f.follower_id = v_actor and f.following_id = up.id) as already_following
    from creator_semantics cs
    join public.user_profiles up on up.id = cs.user_id and not up.is_private
    cross join viewer_profile vp
    left join private.user_personalization_profiles cp on cp.user_id = up.id
    left join quality q on q.user_id = up.id
  )
  select s.id,s.username,coalesce(s.display_name,s.username),coalesce(s.avatar_url,''),s.followers_count,
    s.semantic_relevance,s.language_match,s.region_match,coalesce(s.quality_score,0),
    round((
      6*s.semantic_relevance + 1.5*s.language_match + 1*s.region_match
      + 2*coalesce(s.quality_score,0) + least(2::numeric,ln(1+greatest(0,s.followers_count))/5)
    )::numeric,6),s.already_following
  from scored s
  order by recommendation_score desc, md5(s.id::text || v_actor::text), s.id
  limit v_limit;
end;
$$;

revoke all on function public.get_my_onboarding_creator_recommendations_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_onboarding_creator_recommendations_v1(integer) to authenticated;

create function public.complete_my_personalization_onboarding_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile private.user_personalization_profiles;
  v_interest_slugs text[];
  v_eligible_count integer;
  v_required_follows integer;
  v_followed_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  select * into v_profile from private.user_personalization_profiles where user_id = v_actor for update;
  if not found then
    raise exception using errcode = '22023', message = 'personalization_preferences_required';
  end if;
  select array_agg(t.slug order by t.slug) into v_interest_slugs
  from private.user_personalization_interests ui
  join private.personalization_interest_taxonomy t on t.id = ui.interest_id
  where ui.user_id = v_actor;
  perform private.personalization_validate_selection_v1(
    v_profile.primary_language_tag,v_profile.additional_language_tags,
    v_profile.content_region_code,v_interest_slugs
  );

  with recommendations as materialized (
    select * from public.get_my_onboarding_creator_recommendations_v1(30)
  )
  select count(*),count(*) filter (where already_following)
    into v_eligible_count,v_followed_count
  from recommendations;
  v_required_follows := least(2,v_eligible_count);
  if v_followed_count < v_required_follows then
    raise exception using errcode = '22023', message = 'personalization_creator_follows_required';
  end if;
  update private.user_personalization_profiles
  set onboarding_completed_at = coalesce(onboarding_completed_at,v_now), updated_at = v_now
  where user_id = v_actor;
  return jsonb_build_object(
    'completed',true,
    'onboarding_completed_at',coalesce(v_profile.onboarding_completed_at,v_now),
    'required_creator_follows',v_required_follows,
    'eligible_creator_recommendations',v_eligible_count,
    'followed_recommendations',v_followed_count
  );
end;
$$;

revoke all on function public.complete_my_personalization_onboarding_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.complete_my_personalization_onboarding_v1() to authenticated;

create function public.claim_personalization_taxonomy_embedding_jobs_v1(
  p_limit integer default 8
) returns table(
  interest_id uuid,
  embedding_fingerprint text,
  input_text text,
  provider text,
  model text,
  embedding_dimensions integer,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic private.personalization_interest_taxonomy;
begin
  if p_limit is null or not (p_limit between 1 and 25) then
    raise exception using errcode = '22023', message = 'invalid_personalization_taxonomy_claim_limit';
  end if;
  for v_topic in
    select t.* from private.personalization_interest_taxonomy t
    where t.active and t.embedding_status = 'pending'
      and t.embedding_attempt_count < 5 and t.embedding_available_at <= clock_timestamp()
    order by t.embedding_available_at,t.sort_order,t.id
    for update skip locked limit p_limit
  loop
    update private.personalization_interest_taxonomy t set
      embedding_status = 'processing',
      embedding_attempt_count = t.embedding_attempt_count + 1,
      embedding_started_at = clock_timestamp(),
      embedding_completed_at = null,
      embedding_last_error_code = null,
      updated_at = clock_timestamp()
    where t.id = v_topic.id;
    interest_id := v_topic.id;
    embedding_fingerprint := v_topic.embedding_fingerprint;
    input_text := v_topic.semantic_text;
    provider := 'cloudflare_workers_ai';
    model := '@cf/baai/bge-m3';
    embedding_dimensions := 1024;
    attempt_count := v_topic.embedding_attempt_count + 1;
    return next;
  end loop;
end;
$$;

revoke all on function public.claim_personalization_taxonomy_embedding_jobs_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_personalization_taxonomy_embedding_jobs_v1(integer) to service_role;

create function public.complete_personalization_taxonomy_embedding_job_v1(
  p_interest_id uuid,
  p_embedding_fingerprint text,
  p_embedding extensions.vector(1024)
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic private.personalization_interest_taxonomy;
begin
  select * into v_topic from private.personalization_interest_taxonomy where id = p_interest_id for update;
  if not found then raise exception using errcode='P0002',message='personalization_taxonomy_topic_not_found'; end if;
  if v_topic.embedding_fingerprint is distinct from p_embedding_fingerprint then
    return jsonb_build_object('interest_id',p_interest_id,'status','stale','stored',false);
  end if;
  if v_topic.embedding_status = 'ready' then
    if v_topic.embedding::text = p_embedding::text then
      return jsonb_build_object(
        'interest_id',p_interest_id,'status','ready','stored',false,
        'idempotent',true,'embedding_dimensions',1024
      );
    end if;
    raise exception using errcode='23505',message='personalization_taxonomy_embedding_event_conflict';
  end if;
  if v_topic.embedding_status <> 'processing' then
    raise exception using errcode='55000',message='personalization_taxonomy_topic_not_processing';
  end if;
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1024 then
    raise exception using errcode='22023',message='invalid_personalization_taxonomy_embedding_dimensions';
  end if;
  update private.personalization_interest_taxonomy set
    embedding = p_embedding,embedding_status='ready',embedding_started_at=null,
    embedding_completed_at=clock_timestamp(),embedding_last_error_code=null,
    embedding_provider_call_count=embedding_provider_call_count+1,updated_at=clock_timestamp()
  where id = p_interest_id;
  return jsonb_build_object('interest_id',p_interest_id,'status','ready','stored',true,'embedding_dimensions',1024);
end;
$$;

revoke all on function public.complete_personalization_taxonomy_embedding_job_v1(uuid,text,extensions.vector)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_personalization_taxonomy_embedding_job_v1(uuid,text,extensions.vector) to service_role;

create function public.fail_personalization_taxonomy_embedding_job_v1(
  p_interest_id uuid,
  p_embedding_fingerprint text,
  p_error_code text,
  p_retryable boolean default true,
  p_provider_called boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic private.personalization_interest_taxonomy;
  v_retry boolean;
  v_error text;
  v_available timestamptz;
begin
  select * into v_topic from private.personalization_interest_taxonomy where id=p_interest_id for update;
  if not found then raise exception using errcode='P0002',message='personalization_taxonomy_topic_not_found'; end if;
  if v_topic.embedding_fingerprint is distinct from p_embedding_fingerprint then
    return jsonb_build_object('interest_id',p_interest_id,'status','stale','stored',false);
  end if;
  v_error := left(lower(regexp_replace(btrim(coalesce(p_error_code,'')),'[^a-z0-9_:-]+','_','g')),100);
  if char_length(v_error)<2 then v_error:='taxonomy_embedding_worker_error'; end if;
  if v_topic.embedding_status in ('pending','failed') then
    if v_topic.embedding_last_error_code is not distinct from v_error then
      return jsonb_build_object(
        'interest_id',p_interest_id,'status',v_topic.embedding_status,
        'retryable',v_topic.embedding_status='pending','available_at',v_topic.embedding_available_at,
        'idempotent',true
      );
    end if;
    raise exception using errcode='23505',message='personalization_taxonomy_embedding_event_conflict';
  end if;
  if v_topic.embedding_status <> 'processing' then
    raise exception using errcode='55000',message='personalization_taxonomy_topic_not_processing';
  end if;
  v_retry := coalesce(p_retryable,false) and v_topic.embedding_attempt_count<5;
  v_available := case when v_retry then clock_timestamp()+make_interval(secs=>least(1800,30*power(2,greatest(v_topic.embedding_attempt_count-1,0))::integer)) else clock_timestamp() end;
  update private.personalization_interest_taxonomy set
    embedding_status=case when v_retry then 'pending' else 'failed' end,
    embedding_available_at=v_available,embedding_started_at=null,
    embedding_completed_at=case when v_retry then null else clock_timestamp() end,
    embedding_last_error_code=v_error,
    embedding_provider_call_count=embedding_provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end,
    updated_at=clock_timestamp()
  where id=p_interest_id;
  return jsonb_build_object('interest_id',p_interest_id,'status',case when v_retry then 'pending' else 'failed' end,'retryable',v_retry,'available_at',v_available);
end;
$$;

revoke all on function public.fail_personalization_taxonomy_embedding_job_v1(uuid,text,text,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_personalization_taxonomy_embedding_job_v1(uuid,text,text,boolean,boolean) to service_role;

comment on table private.personalization_interest_taxonomy is
  'Canonical safe explicit-interest taxonomy and BGE-M3 job state. No inferred sensitive traits.';
comment on table private.user_personalization_profiles is
  'Canonical private explicit personalization profile; behavior remains in existing event authorities.';
comment on table private.user_personalization_interests is
  'Only explicit selections. Never stores duplicated behavioral evidence.';

commit;
