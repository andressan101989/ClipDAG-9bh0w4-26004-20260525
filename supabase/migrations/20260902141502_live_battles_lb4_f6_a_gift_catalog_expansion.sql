begin;

-- LB4-F6-A expands only the canonical catalog. Existing gifts, including the
-- intentionally inactive sports_car row, are never updated by this migration.
insert into public.gift_catalog (
  id,
  emoji,
  icon,
  label,
  cost_coins,
  sort_order,
  display_order,
  category,
  animation_type,
  animation_asset,
  duration_ms,
  priority,
  active,
  enabled
) values
  -- Accessible: 1-20 coins (19 new gifts).
  ('brillo_suave', '✨', '✨', 'Brillo Suave', 2, 101, 101, 'basic', 'floating', null, 1200, 101, true, true),
  ('saludo_luz', '👋', '👋', 'Saludo de Luz', 3, 102, 102, 'basic', 'floating', null, 1300, 102, true, true),
  ('gota_alegre', '💧', '💧', 'Gota Alegre', 4, 103, 103, 'basic', 'floating', null, 1400, 103, true, true),
  ('petalo_sol', '🌼', '🌼', 'Pétalo de Sol', 6, 104, 104, 'basic', 'floating', null, 1500, 104, true, true),
  ('chispa_azul', '🔹', '🔹', 'Chispa Azul', 7, 105, 105, 'basic', 'floating', null, 1600, 105, true, true),
  ('abrazo_nube', '☁️', '☁️', 'Abrazo de Nube', 8, 106, 106, 'basic', 'floating', null, 1700, 106, true, true),
  ('nota_feliz', '🎵', '🎵', 'Nota Feliz', 9, 107, 107, 'basic', 'floating', null, 1800, 107, true, true),
  ('luna_mini', '🌙', '🌙', 'Luna Mini', 11, 108, 108, 'basic', 'floating', null, 1800, 108, true, true),
  ('estrella_tibia', '⭐', '⭐', 'Estrella Tibia', 12, 109, 109, 'basic', 'floating', null, 1800, 109, true, true),
  ('hoja_dorada', '🍂', '🍂', 'Hoja Dorada', 13, 110, 110, 'basic', 'floating', null, 1900, 110, true, true),
  ('burbuja_color', '🫧', '🫧', 'Burbuja de Color', 14, 111, 111, 'basic', 'floating', null, 1900, 111, true, true),
  ('cafe_amable', '☕', '☕', 'Café Amable', 15, 112, 112, 'basic', 'center', null, 1900, 112, true, true),
  ('sonrisa_pixel', '🙂', '🙂', 'Sonrisa Pixel', 16, 113, 113, 'basic', 'floating', null, 2000, 113, true, true),
  ('campana_clara', '🔔', '🔔', 'Campana Clara', 17, 114, 114, 'basic', 'center', null, 2000, 114, true, true),
  ('cometa_pequeno', '☄️', '☄️', 'Cometa Pequeño', 18, 115, 115, 'basic', 'floating', null, 2000, 115, true, true),
  ('ola_amiga', '🌊', '🌊', 'Ola Amiga', 19, 116, 116, 'basic', 'floating', null, 2100, 116, true, true),
  ('sol_de_bolsillo', '🌞', '🌞', 'Sol de Bolsillo', 20, 117, 117, 'basic', 'center', null, 2100, 117, true, true),
  ('panda_sueno', '🐼', '🐼', 'Panda Soñador', 20, 118, 118, 'basic', 'center', null, 2200, 118, true, true),
  ('nube_confeti', '🌤️', '🌤️', 'Nube Confeti', 20, 119, 119, 'basic', 'celebration', null, 2200, 119, true, true),

  -- Mid-range: 21-99 coins (21 new gifts).
  ('brujula_viajera', '🧭', '🧭', 'Brújula Viajera', 25, 120, 120, 'basic', 'center', null, 2000, 120, true, true),
  ('farol_cantor', '🏮', '🏮', 'Farol Cantor', 29, 121, 121, 'basic', 'center', null, 2100, 121, true, true),
  ('girasol_cantor', '🌻', '🌻', 'Girasol Cantor', 30, 122, 122, 'basic', 'floating', null, 2100, 122, true, true),
  ('mariposa_lila', '🦋', '🦋', 'Mariposa Lila', 35, 123, 123, 'basic', 'floating', null, 2200, 123, true, true),
  ('taza_estelar', '🍵', '🍵', 'Taza Estelar', 39, 124, 124, 'basic', 'center', null, 2200, 124, true, true),
  ('copo_coral', '❄️', '❄️', 'Copo Coral', 40, 125, 125, 'basic', 'floating', null, 2200, 125, true, true),
  ('arcoiris_breve', '🌈', '🌈', 'Arcoíris Breve', 45, 126, 126, 'basic', 'entrance', null, 2300, 126, true, true),
  ('libro_de_suenos', '📖', '📖', 'Libro de Sueños', 52, 127, 127, 'basic', 'center', null, 2300, 127, true, true),
  ('tambor_fiesta', '🥁', '🥁', 'Tambor de Fiesta', 55, 128, 128, 'basic', 'celebration', null, 2400, 128, true, true),
  ('paleta_frutal', '🍭', '🍭', 'Paleta Frutal', 59, 129, 129, 'basic', 'floating', null, 2300, 129, true, true),
  ('zorro_curioso', '🦊', '🦊', 'Zorro Curioso', 65, 130, 130, 'basic', 'center', null, 2400, 130, true, true),
  ('camara_de_estrellas', '📸', '📸', 'Cámara de Estrellas', 68, 131, 131, 'basic', 'center', null, 2400, 131, true, true),
  ('vela_magica', '🕯️', '🕯️', 'Vela Mágica', 69, 132, 132, 'basic', 'center', null, 2400, 132, true, true),
  ('flor_del_ritmo', '🌺', '🌺', 'Flor del Ritmo', 75, 133, 133, 'basic', 'celebration', null, 2500, 133, true, true),
  ('globo_aventura', '🎈', '🎈', 'Globo Aventura', 79, 134, 134, 'basic', 'entrance', null, 2500, 134, true, true),
  ('bicicleta_lunar', '🚲', '🚲', 'Bicicleta Lunar', 82, 135, 135, 'premium', 'entrance', null, 2500, 135, true, true),
  ('abeja_bailarina', '🐝', '🐝', 'Abeja Bailarina', 85, 136, 136, 'premium', 'floating', null, 2500, 136, true, true),
  ('isla_pequena', '🏝️', '🏝️', 'Isla Pequeña', 89, 137, 137, 'premium', 'center', null, 2600, 137, true, true),
  ('sombrero_feliz', '🎩', '🎩', 'Sombrero Feliz', 95, 138, 138, 'premium', 'center', null, 2600, 138, true, true),
  ('mapa_del_tesoro', '🗺️', '🗺️', 'Mapa del Tesoro', 98, 139, 139, 'premium', 'center', null, 2600, 139, true, true),
  ('vinilo_brillante', '💿', '💿', 'Vinilo Brillante', 99, 140, 140, 'premium', 'celebration', null, 2600, 140, true, true),

  -- Signature: 100-499 coins (18 new gifts).
  ('colibri_neon', '🐦', '🐦', 'Colibrí Neón', 110, 141, 141, 'premium', 'floating', null, 2700, 141, true, true),
  ('jardin_secreto', '🌷', '🌷', 'Jardín Secreto', 125, 142, 142, 'premium', 'center', null, 2800, 142, true, true),
  ('barco_de_papel', '⛵', '⛵', 'Barco de Papel', 140, 143, 143, 'premium', 'entrance', null, 2800, 143, true, true),
  ('teatro_de_luz', '🎭', '🎭', 'Teatro de Luz', 160, 144, 144, 'premium', 'center', null, 2900, 144, true, true),
  ('cascada_cristal', '💦', '💦', 'Cascada de Cristal', 180, 145, 145, 'premium', 'fullscreen', null, 3000, 145, true, true),
  ('buho_sabio', '🦉', '🦉', 'Búho Sabio', 200, 146, 146, 'premium', 'center', null, 3000, 146, true, true),
  ('corazon_cosmico', '💜', '💜', 'Corazón Cósmico', 220, 147, 147, 'premium', 'celebration', null, 3100, 147, true, true),
  ('tren_de_nubes', '🚂', '🚂', 'Tren de Nubes', 240, 148, 148, 'premium', 'entrance', null, 3200, 148, true, true),
  ('festival_del_sol', '🎪', '🎪', 'Festival del Sol', 275, 149, 149, 'premium', 'celebration', null, 3300, 149, true, true),
  ('caballo_estelar', '🐎', '🐎', 'Caballo Estelar', 320, 150, 150, 'premium', 'entrance', null, 3400, 150, true, true),
  ('submarino_coral', '🚤', '🚤', 'Submarino Coral', 350, 151, 151, 'premium', 'entrance', null, 3500, 151, true, true),
  ('faro_del_cielo', '🗼', '🗼', 'Faro del Cielo', 375, 152, 152, 'premium', 'center', null, 3500, 152, true, true),
  ('orquesta_lunar', '🎻', '🎻', 'Orquesta Lunar', 400, 153, 153, 'premium', 'celebration', null, 3600, 153, true, true),
  ('portal_esmeralda', '🟢', '🟢', 'Portal Esmeralda', 425, 154, 154, 'premium', 'fullscreen', null, 3700, 154, true, true),
  ('globo_aerostatico', '🎈', '🎈', 'Globo Aerostático', 440, 155, 155, 'premium', 'entrance', null, 3700, 155, true, true),
  ('casa_del_arbol', '🌳', '🌳', 'Casa del Árbol', 460, 156, 156, 'premium', 'center', null, 3800, 156, true, true),
  ('danza_del_cometa', '☄️', '☄️', 'Danza del Cometa', 480, 157, 157, 'premium', 'fullscreen', null, 3900, 157, true, true),
  ('reloj_de_aurora', '⏳', '⏳', 'Reloj de Aurora', 499, 158, 158, 'premium', 'center', null, 4000, 158, true, true),

  -- Premium: 500-1,999 coins (13 new gifts).
  ('ballena_celeste', '🐋', '🐋', 'Ballena Celeste', 500, 159, 159, 'premium', 'fullscreen', null, 4000, 159, true, true),
  ('volcan_de_confeti', '🌋', '🌋', 'Volcán de Confeti', 550, 160, 160, 'premium', 'celebration', null, 4200, 160, true, true),
  ('bosque_encantado', '🌲', '🌲', 'Bosque Encantado', 650, 161, 161, 'premium', 'fullscreen', null, 4300, 161, true, true),
  ('palacio_de_hielo', '🧊', '🧊', 'Palacio de Hielo', 800, 162, 162, 'premium', 'center', null, 4400, 162, true, true),
  ('caravana_estelar', '🚐', '🚐', 'Caravana Estelar', 950, 163, 163, 'premium', 'entrance', null, 4500, 163, true, true),
  ('templo_del_viento', '⛩️', '⛩️', 'Templo del Viento', 1050, 164, 164, 'legendary', 'center', null, 4600, 164, true, true),
  ('oceano_bioluminiscente', '🌊', '🌊', 'Océano Bioluminiscente', 1150, 165, 165, 'legendary', 'fullscreen', null, 4700, 165, true, true),
  ('ciudad_de_cristal', '🏙️', '🏙️', 'Ciudad de Cristal', 1300, 166, 166, 'legendary', 'fullscreen', null, 4800, 166, true, true),
  ('aurora_infinita', '🌌', '🌌', 'Aurora Infinita', 1450, 167, 167, 'legendary', 'fullscreen', null, 5000, 167, true, true),
  ('tren_galactico', '🚄', '🚄', 'Tren Galáctico', 1600, 168, 168, 'legendary', 'entrance', null, 5200, 168, true, true),
  ('jardin_de_meteoros', '🌠', '🌠', 'Jardín de Meteoros', 1750, 169, 169, 'legendary', 'celebration', null, 5400, 169, true, true),
  ('isla_flotante', '🏞️', '🏞️', 'Isla Flotante', 1900, 170, 170, 'legendary', 'fullscreen', null, 5600, 170, true, true),
  ('sinfonia_del_cielo', '🎼', '🎼', 'Sinfonía del Cielo', 1999, 171, 171, 'legendary', 'celebration', null, 5800, 171, true, true),

  -- Elite: 2,000-9,999 coins (11 new gifts).
  ('navio_de_aurora', '🛳️', '🛳️', 'Navío de Aurora', 2000, 172, 172, 'legendary', 'entrance', null, 6000, 172, true, true),
  ('reino_de_nubes', '🏯', '🏯', 'Reino de Nubes', 2500, 173, 173, 'legendary', 'fullscreen', null, 6200, 173, true, true),
  ('catedral_estelar', '🌟', '🌟', 'Catedral Estelar', 3000, 174, 174, 'legendary', 'fullscreen', null, 6400, 174, true, true),
  ('faro_interplanetario', '🛰️', '🛰️', 'Faro Interplanetario', 3500, 175, 175, 'legendary', 'entrance', null, 6600, 175, true, true),
  ('desfile_de_planetas', '🪐', '🪐', 'Desfile de Planetas', 4200, 176, 176, 'legendary', 'celebration', null, 6800, 176, true, true),
  ('biblioteca_cosmica', '📚', '📚', 'Biblioteca Cósmica', 5000, 177, 177, 'legendary', 'center', null, 7000, 177, true, true),
  ('cascada_de_estrellas', '🌠', '🌠', 'Cascada de Estrellas', 6000, 178, 178, 'legendary', 'fullscreen', null, 7200, 178, true, true),
  ('ciudad_del_amanecer', '🌅', '🌅', 'Ciudad del Amanecer', 7000, 179, 179, 'legendary', 'fullscreen', null, 7400, 179, true, true),
  ('santuario_celeste', '🛕', '🛕', 'Santuario Celeste', 8000, 180, 180, 'legendary', 'center', null, 7600, 180, true, true),
  ('horizonte_de_cristal', '🔭', '🔭', 'Horizonte de Cristal', 9000, 181, 181, 'legendary', 'fullscreen', null, 7800, 181, true, true),
  ('universo_de_bolsillo', '🌐', '🌐', 'Universo de Bolsillo', 9999, 182, 182, 'legendary', 'fullscreen', null, 8000, 182, true, true),

  -- Legendary: 10,000-34,999 coins (6 new gifts).
  ('corona_de_auroras', '👸', '👸', 'Corona de Auroras', 10000, 183, 183, 'legendary', 'celebration', null, 8200, 183, true, true),
  ('arca_de_constelaciones', '🛶', '🛶', 'Arca de Constelaciones', 15000, 184, 184, 'legendary', 'fullscreen', null, 8500, 184, true, true),
  ('opera_del_cosmos', '🎶', '🎶', 'Ópera del Cosmos', 20000, 185, 185, 'legendary', 'celebration', null, 8800, 185, true, true),
  ('continente_celeste', '🗺️', '🗺️', 'Continente Celeste', 25000, 186, 186, 'legendary', 'fullscreen', null, 9200, 186, true, true),
  ('eclipse_de_cristal', '🌘', '🌘', 'Eclipse de Cristal', 30000, 187, 187, 'legendary', 'fullscreen', null, 9600, 187, true, true),
  ('legado_de_las_estrellas', '🌟', '🌟', 'Legado de las Estrellas', 34999, 188, 188, 'legendary', 'fullscreen', null, 10000, 188, true, true)
on conflict (id) do nothing;

do $$
declare
  v_total bigint;
  v_active bigint;
  v_inactive bigint;
  v_new bigint;
begin
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (where active and enabled),
    pg_catalog.count(*) filter (where not active or not enabled)
  into v_total, v_active, v_inactive
  from public.gift_catalog;

  select pg_catalog.count(*)
  into v_new
  from public.gift_catalog
  where display_order between 101 and 188
    and sort_order = display_order
    and priority = display_order
    and active
    and enabled;

  if v_total <> 101 or v_active <> 100 or v_inactive <> 1 or v_new <> 88 then
    raise exception using
      errcode = '23514',
      message = 'live_gift_catalog_f6_a_cardinality_invalid';
  end if;

  if not exists (
    select 1
    from public.gift_catalog
    where id = 'sports_car'
      and active = false
      and enabled = false
  ) or exists (
    select 1
    from public.gift_catalog
    where (not active or not enabled)
      and id <> 'sports_car'
  ) then
    raise exception using
      errcode = '23514',
      message = 'live_gift_catalog_f6_a_historical_state_invalid';
  end if;

  if not exists (
    select 1
    from public.gift_catalog
    where id = 'rose'
      and cost_coins = 5
      and active
      and enabled
  ) or not exists (
    select 1
    from public.gift_catalog
    where id = 'private_jet'
      and active
      and enabled
  ) then
    raise exception using
      errcode = '23514',
      message = 'live_gift_catalog_f6_a_historical_contract_invalid';
  end if;
end;
$$;

commit;
