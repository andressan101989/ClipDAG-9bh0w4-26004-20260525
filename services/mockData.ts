// Mock data service for ClipDAG

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
  dagBalance: number;
  walletAddress: string | null;
  email: string;
  isLive?: boolean;
  totalLikes?: number;
}

export interface Video {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  videoUrl: string;
  thumbnailUrl: string;
  /** Carousel: multiple media URLs (images or videos) */
  mediaUrls?: string[];
  caption: string;
  likes: number;
  comments: number;
  shares: number;
  music: string;
  isLiked: boolean;
  createdAt: string;
}

export interface Comment {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  text: string;
  likes: number;
  createdAt: string;
}

export interface Transaction {
  id: string;
  userId: string;
  amount: number;
  type: 'reward' | 'withdraw' | 'tip';
  status: 'pending' | 'completed';
  description: string;
  createdAt: string;
}

export interface LiveStream {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  title: string;
  thumbnailUrl: string;
  viewers: number;
  dagEarned: number;
  isLive: boolean;
  startedAt: string;
}

export interface Creator {
  id: string;
  username: string;
  avatar: string;
  followers: number;
  dagEarned: number;
}

export const SAMPLE_VIDEOS: Video[] = [
  {
    id: 'v1',
    userId: 'u2',
    username: 'crypto_luna',
    userAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=700&fit=crop',
    caption: 'BlockDAG is changing everything! Early adopters win big! #BlockDAG #Web3 #Crypto',
    likes: 24700,
    comments: 892,
    shares: 1340,
    music: 'Cyberpunk Beat - DJ_3000',
    isLiked: false,
    createdAt: '2026-05-09T12:00:00Z',
  },
  {
    id: 'v2',
    userId: 'u3',
    username: 'web3_creator',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1620321023374-d1a68fbc720d?w=400&h=700&fit=crop',
    caption: 'Como gane 500 DAG en una semana creando contenido! #ClipDAG #EarnCrypto',
    likes: 38200,
    comments: 1240,
    shares: 2100,
    music: 'Future Bass - Neon Waves',
    isLiked: true,
    createdAt: '2026-05-08T15:30:00Z',
  },
  {
    id: 'v3',
    userId: 'u4',
    username: 'dagmaster99',
    userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&h=700&fit=crop',
    caption: 'Tutorial: Conecta tu wallet MetaMask a ClipDAG en 30 segundos! #Tutorial #BlockDAG',
    likes: 15900,
    comments: 567,
    shares: 890,
    music: 'Lo-Fi Crypto Vibes',
    isLiked: false,
    createdAt: '2026-05-07T09:00:00Z',
  },
  {
    id: 'v4',
    userId: 'u5',
    username: 'nft_artgirl',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=700&fit=crop',
    caption: 'Mi arte generativo mezclado con BlockDAG! Cada like = 0.01 DAG para mi creador',
    likes: 52400,
    comments: 2340,
    shares: 3800,
    music: 'Digital Dreams - Synthwave Mix',
    isLiked: false,
    createdAt: '2026-05-06T20:00:00Z',
  },
  {
    id: 'v5',
    userId: 'u6',
    username: 'blockboy_mx',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1639762681057-408e52192e55?w=400&h=700&fit=crop',
    caption: 'Reaccion a la nueva actualizacion de BlockDAG! #BlockDAG #CryptoNews',
    likes: 91200,
    comments: 4100,
    shares: 7600,
    music: 'Epic Crypto Anthem',
    isLiked: false,
    createdAt: '2026-05-05T17:00:00Z',
  },
  {
    id: 'v6',
    userId: 'u7',
    username: 'satoshi_fan',
    userAvatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&h=200&fit=crop',
    videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=400&h=700&fit=crop',
    caption: 'El futuro de las finanzas descentralizadas ya esta aqui! #DeFi #Web3',
    likes: 33100,
    comments: 1890,
    shares: 2200,
    music: 'Future Bass - Neon Waves',
    isLiked: false,
    createdAt: '2026-05-04T11:00:00Z',
  },
  // ── Carousel post example ───────────────────────────────────────────────────
  {
    id: 'v7',
    userId: 'u5',
    username: 'nft_artgirl',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
    videoUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=800&fit=crop',
    thumbnailUrl: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=800&fit=crop',
    mediaUrls: [
      'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&h=800&fit=crop',
      'https://images.unsplash.com/photo-1620321023374-d1a68fbc720d?w=800&h=800&fit=crop',
      'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800&h=800&fit=crop',
      'https://images.unsplash.com/photo-1639762681057-408e52192e55?w=800&h=800&fit=crop',
    ],
    caption: 'Mi viaje al Web3 en 4 fotos! Desliza para ver la historia completa #BlockDAG #NFT #Web3Creator',
    likes: 71400,
    comments: 3200,
    shares: 5800,
    music: 'Digital Dreams - Synthwave',
    isLiked: false,
    createdAt: '2026-05-03T14:00:00Z',
  },
];

export const MOCK_COMMENTS: Record<string, Comment[]> = {
  v1: [
    { id: 'c1', userId: 'u7', username: 'hodl_king', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop', text: 'BlockDAG to the moon! Llevamos mucho tiempo esperando esto', likes: 234, createdAt: '2026-05-09T13:00:00Z' },
    { id: 'c2', userId: 'u8', username: 'defi_girl', avatar: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=100&h=100&fit=crop', text: 'Increible app! Ya gane mis primeros DAG', likes: 167, createdAt: '2026-05-09T14:00:00Z' },
    { id: 'c3', userId: 'u9', username: 'satoshi_fan', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop', text: 'Esto es el futuro de las redes sociales sin duda', likes: 89, createdAt: '2026-05-09T15:00:00Z' },
  ],
  v2: [
    { id: 'c4', userId: 'u10', username: 'techie_rosa', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop', text: '500 DAG?! Yo tambien quiero aprender esto', likes: 445, createdAt: '2026-05-08T16:00:00Z' },
    { id: 'c5', userId: 'u11', username: 'web3native', avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop', text: 'Tutorial completo por favor!', likes: 312, createdAt: '2026-05-08T17:00:00Z' },
  ],
  v3: [
    { id: 'c6', userId: 'u2', username: 'crypto_luna', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop', text: 'Super util! Lo hice en menos de 20 segundos', likes: 201, createdAt: '2026-05-07T10:00:00Z' },
  ],
  v4: [
    { id: 'c7', userId: 'u6', username: 'blockboy_mx', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop', text: 'Arte increible! Cuanto has ganado hasta ahora?', likes: 567, createdAt: '2026-05-06T21:00:00Z' },
    { id: 'c8', userId: 'u3', username: 'web3_creator', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop', text: 'Colaboramos? Tengo ideas geniales', likes: 389, createdAt: '2026-05-06T22:00:00Z' },
  ],
  v5: [
    { id: 'c9', userId: 'u4', username: 'dagmaster99', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop', text: 'Este video ya tiene 91K likes! Un monstruo', likes: 892, createdAt: '2026-05-05T18:00:00Z' },
  ],
  v6: [
    { id: 'c10', userId: 'u5', username: 'nft_artgirl', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop', text: 'El futuro es descentralizado!', likes: 445, createdAt: '2026-05-04T12:00:00Z' },
  ],
};

export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 't1', userId: 'u1', amount: 0.01, type: 'reward', status: 'completed', description: 'Like reward - @crypto_luna', createdAt: '2026-05-10T10:00:00Z' },
  { id: 't2', userId: 'u1', amount: 0.01, type: 'reward', status: 'completed', description: 'Like reward - @nft_artgirl', createdAt: '2026-05-10T09:30:00Z' },
  { id: 't3', userId: 'u1', amount: 0.01, type: 'reward', status: 'completed', description: 'Like reward - @web3_creator', createdAt: '2026-05-09T20:00:00Z' },
  { id: 't4', userId: 'u1', amount: 5.00, type: 'withdraw', status: 'completed', description: 'Retiro a MetaMask ***8f3a', createdAt: '2026-05-08T15:00:00Z' },
  { id: 't5', userId: 'u1', amount: 0.50, type: 'tip', status: 'completed', description: 'Tip de @blockboy_mx en Live', createdAt: '2026-05-07T11:00:00Z' },
  { id: 't6', userId: 'u1', amount: 2.50, type: 'withdraw', status: 'pending', description: 'Retiro a MetaMask ***8f3a', createdAt: '2026-05-10T08:00:00Z' },
];

export const MOCK_LIVE_STREAMS: LiveStream[] = [
  {
    id: 'l1',
    userId: 'u5',
    username: 'nft_artgirl',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
    title: 'Creando NFTs en vivo + Sorteo 500 DAG',
    thumbnailUrl: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=500&h=300&fit=crop',
    viewers: 12840,
    dagEarned: 234.5,
    isLive: true,
    startedAt: '2026-05-10T09:00:00Z',
  },
  {
    id: 'l2',
    userId: 'u6',
    username: 'blockboy_mx',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    title: 'Analisis BlockDAG en tiempo real',
    thumbnailUrl: 'https://images.unsplash.com/photo-1640160186315-838b53fcabc6?w=500&h=300&fit=crop',
    viewers: 8920,
    dagEarned: 189.0,
    isLive: true,
    startedAt: '2026-05-10T08:30:00Z',
  },
  {
    id: 'l3',
    userId: 'u3',
    username: 'web3_creator',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    title: 'Workshop: Gana tu primer DAG hoy',
    thumbnailUrl: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=500&h=300&fit=crop',
    viewers: 5300,
    dagEarned: 97.3,
    isLive: true,
    startedAt: '2026-05-10T10:00:00Z',
  },
];

export const MOCK_CREATORS: Creator[] = [
  { id: 'u5', username: 'nft_artgirl', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop', followers: 128400, dagEarned: 2340 },
  { id: 'u6', username: 'blockboy_mx', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop', followers: 95200, dagEarned: 1890 },
  { id: 'u3', username: 'web3_creator', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', followers: 67800, dagEarned: 1240 },
  { id: 'u2', username: 'crypto_luna', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop', followers: 54100, dagEarned: 920 },
  { id: 'u4', username: 'dagmaster99', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop', followers: 41200, dagEarned: 780 },
  { id: 'u7', username: 'satoshi_fan', avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&h=200&fit=crop', followers: 28900, dagEarned: 560 },
];

export const SEARCH_TAGS = [
  '#BlockDAG', '#Web3', '#Crypto', '#NFT', '#DeFi', '#ClipDAG',
  '#EarnCrypto', '#BlockchainLife', '#CryptoCreator', '#DAG',
];

export const TIP_AMOUNTS = [0.1, 0.5, 1, 5, 10];

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function formatDAG(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toFixed(2);
}
