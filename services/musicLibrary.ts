/**
 * ClipDAG Music Library
 * Curated free-to-use audio tracks for reels and stories.
 * Uses free Creative Commons / royalty-free audio from public sources.
 */

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  genre: Genre;
  duration: number; // seconds
  bpm?: number;
  mood: Mood;
  /** Public streaming URL */
  previewUrl: string;
  coverUrl: string;
  trending?: boolean;
  usageCount?: number;
  isOriginalSound?: boolean;
}

export type Genre =
  | 'hip-hop'
  | 'electronic'
  | 'pop'
  | 'lo-fi'
  | 'latin'
  | 'rnb'
  | 'cinematic'
  | 'trap'
  | 'ambient'
  | 'original';

export type Mood =
  | 'energetic'
  | 'chill'
  | 'romantic'
  | 'dark'
  | 'happy'
  | 'emotional'
  | 'hype'
  | 'peaceful';

export interface MusicCategory {
  id: string;
  label: string;
  emoji: string;
  genre?: Genre;
  mood?: Mood;
}

// ── Categories ────────────────────────────────────────────────────────────────
export const MUSIC_CATEGORIES: MusicCategory[] = [
  { id: 'trending', label: 'Tendencias', emoji: '🔥' },
  { id: 'hiphop', label: 'Hip-Hop', emoji: '🎤', genre: 'hip-hop' },
  { id: 'electronic', label: 'Electrónica', emoji: '⚡', genre: 'electronic' },
  { id: 'lofi', label: 'Lo-Fi', emoji: '☕', genre: 'lo-fi' },
  { id: 'latin', label: 'Latino', emoji: '🌶️', genre: 'latin' },
  { id: 'cinematic', label: 'Épica', emoji: '🎬', genre: 'cinematic' },
  { id: 'ambient', label: 'Ambiente', emoji: '🌊', genre: 'ambient' },
  { id: 'original', label: 'Sonidos', emoji: '🎙️', genre: 'original' },
];

// ── Music Library ─────────────────────────────────────────────────────────────
// Using royalty-free preview audio from free CDN sources
export const MUSIC_LIBRARY: MusicTrack[] = [
  {
    id: 'ml_001',
    title: 'Cyberpunk Dreams',
    artist: 'DJ_3000',
    genre: 'electronic',
    duration: 30,
    bpm: 128,
    mood: 'energetic',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=200&h=200&fit=crop',
    trending: true,
    usageCount: 48200,
  },
  {
    id: 'ml_002',
    title: 'Neon Waves',
    artist: 'Future Bass',
    genre: 'electronic',
    duration: 30,
    bpm: 140,
    mood: 'hype',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1571974599782-87624638275e?w=200&h=200&fit=crop',
    trending: true,
    usageCount: 32100,
  },
  {
    id: 'ml_003',
    title: 'Crypto Lo-Fi',
    artist: 'ChillBlocks',
    genre: 'lo-fi',
    duration: 30,
    bpm: 80,
    mood: 'chill',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1614149162883-504ce4d13909?w=200&h=200&fit=crop',
    trending: true,
    usageCount: 27500,
  },
  {
    id: 'ml_004',
    title: 'Digital Hustle',
    artist: 'BlockBeats',
    genre: 'hip-hop',
    duration: 30,
    bpm: 95,
    mood: 'energetic',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1619983081563-430f63602796?w=200&h=200&fit=crop',
    trending: true,
    usageCount: 21800,
  },
  {
    id: 'ml_005',
    title: 'Moonlight DAG',
    artist: 'NightSynth',
    genre: 'ambient',
    duration: 30,
    bpm: 60,
    mood: 'peaceful',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=200&h=200&fit=crop',
    usageCount: 18400,
  },
  {
    id: 'ml_006',
    title: 'Blockchain Pop',
    artist: 'CryptoVibes',
    genre: 'pop',
    duration: 30,
    bpm: 110,
    mood: 'happy',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&h=200&fit=crop',
    trending: true,
    usageCount: 15300,
  },
  {
    id: 'ml_007',
    title: 'Reggaeton Token',
    artist: 'DAG Latino',
    genre: 'latin',
    duration: 30,
    bpm: 100,
    mood: 'energetic',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1504898770365-14faca6a7320?w=200&h=200&fit=crop',
    usageCount: 13700,
  },
  {
    id: 'ml_008',
    title: 'Epic Crypto Anthem',
    artist: 'CinematicDAO',
    genre: 'cinematic',
    duration: 30,
    bpm: 85,
    mood: 'emotional',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=200&h=200&fit=crop',
    usageCount: 11200,
  },
  {
    id: 'ml_009',
    title: 'Dark Metaverse',
    artist: 'NeonDark',
    genre: 'trap',
    duration: 30,
    bpm: 140,
    mood: 'dark',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=200&h=200&fit=crop',
    usageCount: 9800,
  },
  {
    id: 'ml_010',
    title: 'Sunset RnB',
    artist: 'SoulChain',
    genre: 'rnb',
    duration: 30,
    bpm: 90,
    mood: 'romantic',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=200&h=200&fit=crop',
    usageCount: 8600,
  },
  {
    id: 'ml_011',
    title: 'Morning Coffee Chain',
    artist: 'LoFi Crypto',
    genre: 'lo-fi',
    duration: 30,
    bpm: 75,
    mood: 'chill',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=200&h=200&fit=crop',
    usageCount: 7400,
  },
  {
    id: 'ml_012',
    title: 'Hype Train DAG',
    artist: 'TrapNode',
    genre: 'trap',
    duration: 30,
    bpm: 150,
    mood: 'hype',
    previewUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=200&h=200&fit=crop',
    usageCount: 6900,
  },
  {
    id: 'ml_original',
    title: 'Sin musica',
    artist: 'Original Sound',
    genre: 'original',
    duration: 0,
    mood: 'peaceful',
    previewUrl: '',
    coverUrl: '',
    isOriginalSound: true,
    usageCount: 0,
  },
];

// ── Helper functions ──────────────────────────────────────────────────────────

export function getTrendingTracks(limit = 6): MusicTrack[] {
  return MUSIC_LIBRARY.filter(t => t.trending && !t.isOriginalSound).slice(0, limit);
}

export function getTracksByCategory(categoryId: string): MusicTrack[] {
  if (categoryId === 'trending') return MUSIC_LIBRARY.filter(t => t.trending && !t.isOriginalSound);
  if (categoryId === 'original') return MUSIC_LIBRARY.filter(t => t.isOriginalSound);
  const cat = MUSIC_CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return MUSIC_LIBRARY;
  if (cat.genre) return MUSIC_LIBRARY.filter(t => t.genre === cat.genre);
  if (cat.mood) return MUSIC_LIBRARY.filter(t => t.mood === cat.mood);
  return MUSIC_LIBRARY;
}

export function searchTracks(query: string): MusicTrack[] {
  const q = query.toLowerCase().trim();
  if (!q) return MUSIC_LIBRARY;
  return MUSIC_LIBRARY.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.genre.toLowerCase().includes(q)
  );
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatUsageCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function getTrackById(id: string): MusicTrack | undefined {
  return MUSIC_LIBRARY.find(t => t.id === id);
}
