import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList,
  Dimensions, ActivityIndicator, ScrollView, TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { formatNumber } from '@/services/mockData';
import type { VideoWithMeta } from '@/contexts/FeedContext';
import { fetchCreatorVideoFeed, fetchSavedVideoFeed } from '@/services/creatorService';
import { randomUUID } from 'expo-crypto';
import { DraftManager } from '@/modules/creator/drafts/DraftManager';
import type { PublicationDraft, PublicationDraftPage } from '@/services/publicationDraftService';
import { getMediaUrl } from '@/services/mediaService';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_GAP = 2;
const THUMB_SIZE = (SCREEN_W - GRID_GAP * 2) / 3;

type ContentTab = 'posts' | 'reels' | 'saved' | 'stories' | 'drafts';

const TAB_CONFIG: { key: ContentTab; icon: string; label: string }[] = [
  { key: 'posts', icon: 'grid', label: 'Publicaciones' },
  { key: 'reels', icon: 'play-box-multiple-outline', label: 'Reels' },
  { key: 'saved', icon: 'bookmark-outline', label: 'Guardados' },
  { key: 'stories', icon: 'circle-outline', label: 'Historias' },
  { key: 'drafts', icon: 'file-outline', label: 'Borradores' },
];

function normalizeContentTab(value: string | string[] | undefined): ContentTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return TAB_CONFIG.some(tab => tab.key === candidate) ? candidate as ContentTab : 'posts';
}

// ── Sort options ───────────────────────────────────────────────────────────────
type SortBy = 'newest' | 'oldest' | 'most_liked' | 'most_viewed';

type DraftUpdateMutation={
  id:string;expectedRevision:number;clientMutationId:string;
  kind:PublicationDraft['kind'];caption:string;music:string;
  composition:PublicationDraft['composition'];assetIds:string[];
};
type DraftDeleteMutation={id:string;expectedRevision:number;clientMutationId:string};
type DraftPublishAttempt={clientCommandId:string;revision:number;draft:PublicationDraft};

function mergeDraftPages(current:PublicationDraft[],incoming:PublicationDraft[]):PublicationDraft[] {
  const merged=new Map(current.map(item=>[item.id,item]));
  for(const item of incoming) merged.set(item.id,item);
  return [...merged.values()];
}

function draftCursorKey(cursor:NonNullable<PublicationDraftPage['nextCursor']>):string {
  return `${cursor.updatedAt}:${cursor.id}`;
}

function isAmbiguousDraftMutationError(error:unknown):boolean {
  if(!error||typeof error!=='object') return true;
  const candidate=error as {code?:unknown;status?:unknown;message?:unknown};
  const code=typeof candidate.code==='string'?candidate.code:'';
  const status=typeof candidate.status==='number'?candidate.status:0;
  const message=typeof candidate.message==='string'?candidate.message.toLowerCase():'';
  if(code==='draft_publish_command_conflict'||message==='draft_publish_command_conflict') return false;
  if(status>=500||/network|fetch|timeout|connection|aborted/.test(message)) return true;
  // A PostgreSQL/PostgREST domain code is an authoritative rejection, not a
  // lost response. Unknown transport failures stay fail-safe and replayable.
  return !code;
}

interface ContentItemProps {
  video: VideoWithMeta;
  onPress: (video: VideoWithMeta) => void;
  onLongPress: (video: VideoWithMeta) => void;
}

const ContentItem = React.memo(function ContentItem({ video, onPress, onLongPress }: ContentItemProps) {
  const isVideo = !!(video.videoUrl?.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
    video.videoUrl?.includes('gtv-videos-bucket') ||
    video.videoUrl?.includes('/videos/'));
  const isCarousel = Array.isArray((video as any).mediaUrls) && (video as any).mediaUrls.length > 1;

  const imgSrc = video.thumbnailUrl?.startsWith('http')
    ? { uri: video.thumbnailUrl }
    : video.videoUrl?.startsWith('http')
      ? { uri: video.videoUrl }
      : { uri: `https://api.dicebear.com/7.x/shapes/svg?seed=${video.id}` };

  return (
    <Pressable
      style={styles.gridItem}
      onPress={() => onPress(video)}
      onLongPress={() => onLongPress(video)}
    >
      <Image source={imgSrc} style={styles.gridThumb} contentFit="cover" transition={150} />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.78)']}
        style={styles.gridOverlay}
      >
        <View style={styles.gridStats}>
          <MaterialIcons name="favorite" size={10} color={Colors.secondary} />
          <Text style={styles.gridStatText}>{formatNumber(video.likes || 0)}</Text>
        </View>
      </LinearGradient>
      {/* Type badge */}
      <View style={styles.typeBadge}>
        {isCarousel ? (
          <MaterialCommunityIcons name="image-multiple-outline" size={10} color="#fff" />
        ) : isVideo ? (
          <MaterialCommunityIcons name="play" size={10} color="#fff" />
        ) : (
          <MaterialIcons name="photo" size={10} color="#fff" />
        )}
      </View>
    </Pressable>
  );
});

export default function MyContentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const { user } = useAuth();
  const { deleteVideo } = useFeed();
  const { showAlert } = useAlert();

  const requestedTab = normalizeContentTab(tab);
  const [activeTab, setActiveTab] = useState<ContentTab>(requestedTab);
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [ownVideos, setOwnVideos] = useState<VideoWithMeta[]>([]);
  const [savedVideos, setSavedVideos] = useState<VideoWithMeta[]>([]);
  const [cloudDrafts,setCloudDrafts]=useState<PublicationDraft[]>([]);
  const [isLoadingDrafts,setIsLoadingDrafts]=useState(false);
  const [draftLoadError,setDraftLoadError]=useState<string|null>(null);
  const [draftNextCursor,setDraftNextCursor]=useState<PublicationDraftPage['nextCursor']>(null);
  const [isLoadingMoreDrafts,setIsLoadingMoreDrafts]=useState(false);
  const [draftContinuationError,setDraftContinuationError]=useState<string|null>(null);
  const [editingDraft,setEditingDraft]=useState<PublicationDraft|null>(null);
  const [editingDraftCaption,setEditingDraftCaption]=useState('');
  const [draftPreviewUrls,setDraftPreviewUrls]=useState<string[]>([]);
  const [isLoadingDraftPreview,setIsLoadingDraftPreview]=useState(false);
  const [draftPreviewError,setDraftPreviewError]=useState<string|null>(null);
  const tabsScrollRef=useRef<ScrollView>(null);
  const draftPublishCommandsRef=useRef(new Map<string,DraftPublishAttempt>());
  const draftUpdateMutationsRef=useRef(new Map<string,DraftUpdateMutation>());
  const draftDeleteMutationsRef=useRef(new Map<string,DraftDeleteMutation>());
  const draftMutationInFlightRef=useRef(new Set<string>());
  const draftMutationOwnerRef=useRef(user?.id);
  const draftMutationGenerationRef=useRef(0);
  const draftLoadRef=useRef(0);
  const draftInitialLoadGenerationRef=useRef<number|null>(null);
  const draftNextCursorRef=useRef<PublicationDraftPage['nextCursor']>(null);
  const draftContinuationInFlightRef=useRef(new Set<string>());
  const draftConsumedCursorKeysRef=useRef(new Set<string>());
  const draftRestoreRef=useRef(0);
  const draftRestoreDraftIdRef=useRef<string|null>(null);
  const draftPreviewRef=useRef(0);
  const draftEditorGenerationRef=useRef(0);
  const draftEditorTargetIdRef=useRef<string|null>(null);
  const draftResolvedEditorIdRef=useRef<string|null>(null);
  const activeUserIdRef=useRef(user?.id);
  const contentLoadRef = useRef(0);
  if(draftMutationOwnerRef.current!==user?.id) {
    draftMutationOwnerRef.current=user?.id;
    draftMutationGenerationRef.current+=1;
    draftPublishCommandsRef.current.clear();
    draftUpdateMutationsRef.current.clear();
    draftDeleteMutationsRef.current.clear();
    draftMutationInFlightRef.current.clear();
  }
  activeUserIdRef.current=user?.id;

  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if(activeTab==='drafts') tabsScrollRef.current?.scrollToEnd?.({animated:false});
  },[activeTab]);

  useEffect(() => {
    draftLoadRef.current += 1;
    draftInitialLoadGenerationRef.current=null;
    draftRestoreRef.current += 1;
    draftRestoreDraftIdRef.current=null;
    draftPreviewRef.current += 1;
    draftEditorGenerationRef.current += 1;
    draftEditorTargetIdRef.current=null;
    draftResolvedEditorIdRef.current=null;
    draftNextCursorRef.current=null;
    draftContinuationInFlightRef.current.clear();
    draftConsumedCursorKeysRef.current.clear();
    setCloudDrafts([]);
    setDraftLoadError(null);
    setIsLoadingDrafts(false);
    setDraftNextCursor(null);
    setIsLoadingMoreDrafts(false);
    setDraftContinuationError(null);
    setEditingDraft(null);
    setEditingDraftCaption('');
    setDraftPreviewUrls([]);
    setDraftPreviewError(null);
    setIsLoadingDraftPreview(false);
  },[user?.id]);

  const loadContent = useCallback(async () => {
    const generation = contentLoadRef.current + 1;
    contentLoadRef.current = generation;
    if (!user?.id) {
      setOwnVideos([]);
      setSavedVideos([]);
      setIsLoadingContent(false);
      return;
    }
    setIsLoadingContent(true);
    try {
      const [creatorVideos, saved] = await Promise.all([
        fetchCreatorVideoFeed(user.id, 200),
        fetchSavedVideoFeed(user.id, 200),
      ]);
      if (contentLoadRef.current === generation) {
        setOwnVideos(creatorVideos);
        setSavedVideos(saved);
      }
    } catch (error) {
      console.warn('[MyContent] server content load failed:', error);
      if (contentLoadRef.current === generation) {
        setOwnVideos([]);
        setSavedVideos([]);
      }
    } finally {
      if (contentLoadRef.current === generation) setIsLoadingContent(false);
    }
  }, [user?.id]);

  const loadDrafts=useCallback(async()=>{
    const generation=draftLoadRef.current+1;
    const ownerId=user?.id;
    draftLoadRef.current=generation;
    draftInitialLoadGenerationRef.current=generation;
    draftContinuationInFlightRef.current.clear();
    draftConsumedCursorKeysRef.current.clear();
    setIsLoadingMoreDrafts(false);
    setDraftContinuationError(null);
    if(!ownerId) {
      draftInitialLoadGenerationRef.current=null;
      draftNextCursorRef.current=null;
      setCloudDrafts([]);
      setDraftLoadError(null);
      setIsLoadingDrafts(false);
      setDraftNextCursor(null);
      return;
    }
    setIsLoadingDrafts(true);
    setDraftLoadError(null);
    try {
      const page=await DraftManager.listPublicationDrafts({limit:50,cursor:null});
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        setCloudDrafts(mergeDraftPages([],page.items));
        draftNextCursorRef.current=page.nextCursor;
        setDraftNextCursor(page.nextCursor);
      }
    } catch(error) {
      console.warn('[MyContent] cloud draft load failed',error);
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        setDraftLoadError('No se pudieron cargar tus borradores');
      }
    } finally {
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        setIsLoadingDrafts(false);
      }
      if(draftInitialLoadGenerationRef.current===generation) {
        draftInitialLoadGenerationRef.current=null;
      }
    }
  },[user?.id]);

  const loadMoreDrafts=useCallback(async()=>{
    const cursor=draftNextCursorRef.current;
    const ownerId=user?.id;
    const generation=draftLoadRef.current;
    if(!ownerId||!cursor||draftInitialLoadGenerationRef.current!==null) return;
    const cursorKey=draftCursorKey(cursor);
    const requestKey=`${generation}:${cursorKey}`;
    if(draftContinuationInFlightRef.current.has(requestKey)
      ||draftConsumedCursorKeysRef.current.has(cursorKey)) return;
    draftContinuationInFlightRef.current.add(requestKey);
    setIsLoadingMoreDrafts(true);
    setDraftContinuationError(null);
    try {
      const page=await DraftManager.listPublicationDrafts({limit:50,cursor});
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        draftConsumedCursorKeysRef.current.add(cursorKey);
        setCloudDrafts(current=>mergeDraftPages(current,page.items));
        draftNextCursorRef.current=page.nextCursor;
        setDraftNextCursor(page.nextCursor);
      }
    } catch {
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        setDraftContinuationError('No se pudieron cargar más borradores');
      }
    } finally {
      draftContinuationInFlightRef.current.delete(requestKey);
      if(draftLoadRef.current===generation&&activeUserIdRef.current===ownerId) {
        setIsLoadingMoreDrafts(false);
      }
    }
  },[user?.id]);

  const loadDraftPreview=useCallback(async(draft:PublicationDraft)=>{
    const generation=draftPreviewRef.current+1;
    const ownerId=user?.id;
    draftPreviewRef.current=generation;
    setDraftPreviewUrls([]);
    setDraftPreviewError(null);
    if(!ownerId||draft.assetIds.length===0) {
      setIsLoadingDraftPreview(false);
      return;
    }
    setIsLoadingDraftPreview(true);
    try {
      const urls=await Promise.all(draft.assetIds.map(assetId=>getMediaUrl(assetId)));
      if(draftPreviewRef.current===generation&&activeUserIdRef.current===ownerId) {
        setDraftPreviewUrls(urls);
      }
    } catch(error) {
      console.warn('[MyContent] private draft preview failed',error);
      if(draftPreviewRef.current===generation&&activeUserIdRef.current===ownerId) {
        setDraftPreviewError('No se pudo cargar la vista previa privada');
      }
    } finally {
      if(draftPreviewRef.current===generation&&activeUserIdRef.current===ownerId) {
        setIsLoadingDraftPreview(false);
      }
    }
  },[user?.id]);

  useEffect(()=>{
    if(!editingDraft) {
      draftPreviewRef.current+=1;
      setDraftPreviewUrls([]);
      setDraftPreviewError(null);
      setIsLoadingDraftPreview(false);
      return;
    }
    void loadDraftPreview(editingDraft);
    return ()=>{draftPreviewRef.current+=1;};
  },[editingDraft,loadDraftPreview]);

  useEffect(()=>{
    if(!editingDraft&&editingDraftCaption) setEditingDraftCaption('');
  },[editingDraft,editingDraftCaption]);

  useFocusEffect(useCallback(() => {
    void loadContent();
    void loadDrafts();
    return () => {
      contentLoadRef.current += 1;
      draftLoadRef.current += 1;
      draftInitialLoadGenerationRef.current=null;
      draftRestoreRef.current += 1;
      draftRestoreDraftIdRef.current=null;
    };
  }, [loadContent,loadDrafts]));

  const myVideos = ownVideos;

  const myReels = useMemo(() => myVideos.filter(v => {
    const url = v.videoUrl || '';
    return url.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
      url.includes('gtv-videos-bucket') ||
      url.includes('/videos/');
  }), [myVideos]);

  const myPosts = useMemo(() => myVideos.filter(v => {
    const url = v.videoUrl || '';
    const isCarousel = Array.isArray((v as any).mediaUrls) && (v as any).mediaUrls.length > 1;
    const isVid = url.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
      url.includes('gtv-videos-bucket') || url.includes('/videos/');
    return !isVid || isCarousel;
  }), [myVideos]);

  const sortedItems = useCallback((items: VideoWithMeta[]) => {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case 'oldest': return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        case 'most_liked': return (b.likes || 0) - (a.likes || 0);
        case 'most_viewed': return (b.viewsCount || 0) - (a.viewsCount || 0);
        default: return 0;
      }
    });
  }, [sortBy]);

  const currentItems: VideoWithMeta[] = useMemo(() => {
    switch (activeTab) {
      case 'posts': return sortedItems(myPosts);
      case 'reels': return sortedItems(myReels);
      case 'saved': return sortedItems(savedVideos);
      case 'stories': return [];
      case 'drafts': return [];
      default: return [];
    }
  }, [activeTab, myPosts, myReels, savedVideos, sortedItems]);

  const totalLikes = useMemo(() => myVideos.reduce((s, v) => s + (v.likes || 0), 0), [myVideos]);
  const totalViews = useMemo(() => myVideos.reduce((s, v) => s + (v.viewsCount || 0), 0), [myVideos]);

  const handleDelete = useCallback(async (video: VideoWithMeta) => {
    showAlert('Eliminar publicacion', 'Esta accion es permanente.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          const result = await deleteVideo(video.id, video.videoUrl, video.thumbnailUrl);
          setIsDeleting(false);
          if (result.success) {
            setOwnVideos(current => current.filter(item => item.id !== video.id));
            setSavedVideos(current => current.filter(item => item.id !== video.id));
            showAlert('Eliminado', 'Tu publicacion fue eliminada');
          }
          else showAlert('Error', result.error || 'No se pudo eliminar');
        },
      },
    ]);
  }, [deleteVideo, showAlert]);

  const handleItemPress = useCallback((video: VideoWithMeta) => {
    showAlert(
      `@${video.username}`,
      video.caption || 'Sin descripcion',
      [
        {
          text: 'Ver Analytics',
          onPress: () => showAlert('Analytics', `Likes: ${formatNumber(video.likes || 0)}\nVistas: ${formatNumber(video.viewsCount || 0)}\nComentarios: ${formatNumber(video.comments || 0)}`),
        },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => handleDelete(video),
        },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  }, [handleDelete, showAlert]);

  const handleItemLongPress = useCallback((video: VideoWithMeta) => {
    handleItemPress(video);
  }, [handleItemPress]);

  const handleSort = useCallback(() => {
    const options: { text: string; key: SortBy }[] = [
      { text: 'Mas reciente', key: 'newest' },
      { text: 'Mas antiguo', key: 'oldest' },
      { text: 'Mas likes', key: 'most_liked' },
      { text: 'Mas vistas', key: 'most_viewed' },
    ];
    showAlert('Ordenar por', '', [
      ...options.map(o => ({ text: o.text, onPress: () => setSortBy(o.key) })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  }, [showAlert]);

  const invalidateDraftReadsAfterMutation=useCallback((draftId:string)=>{
    draftLoadRef.current+=1;
    draftInitialLoadGenerationRef.current=null;
    if(draftRestoreDraftIdRef.current===draftId) {
      draftRestoreRef.current+=1;
      draftRestoreDraftIdRef.current=null;
    }
    draftContinuationInFlightRef.current.clear();
    draftConsumedCursorKeysRef.current.clear();
    setIsLoadingDrafts(false);
    setIsLoadingMoreDrafts(false);
    setDraftContinuationError(null);
  },[]);

  const restoreCloudDraft=useCallback(async(id:string)=>{
    const ownerId=user?.id;
    if(!ownerId) return;
    const generation=draftRestoreRef.current+1;
    const editorGeneration=draftEditorGenerationRef.current+1;
    const previousResolvedEditorId=draftResolvedEditorIdRef.current;
    draftRestoreRef.current=generation;
    draftRestoreDraftIdRef.current=id;
    draftEditorGenerationRef.current=editorGeneration;
    draftEditorTargetIdRef.current=id;
    try {
      const restored=await DraftManager.restorePublicationDraft(id);
      if(draftRestoreRef.current!==generation
        ||draftRestoreDraftIdRef.current!==id
        ||draftEditorGenerationRef.current!==editorGeneration
        ||draftEditorTargetIdRef.current!==id
        ||activeUserIdRef.current!==ownerId) return;
      setCloudDrafts(current=>current.map(item=>item.id===restored.id?restored:item));
      draftResolvedEditorIdRef.current=restored.id;
      setEditingDraft(restored);
      setEditingDraftCaption(restored.caption);
    } catch(error) {
      if(draftRestoreRef.current===generation&&activeUserIdRef.current===ownerId) {
        if(draftEditorTargetIdRef.current===id) {
          draftEditorTargetIdRef.current=previousResolvedEditorId;
        }
        showAlert('Error',error instanceof Error?error.message:'draft_restore_failed');
      }
    } finally {
      if(draftRestoreRef.current===generation&&draftRestoreDraftIdRef.current===id) {
        draftRestoreDraftIdRef.current=null;
      }
    }
  },[showAlert,user?.id]);

  const updateCloudDraftRevision=useCallback(async(
    draft:PublicationDraft,
    nextCaption:string,
    ownerId:string,
    generation:number,
  ):Promise<PublicationDraft>=>{
    const pendingMutation=draftUpdateMutationsRef.current.get(draft.id);
    const createMutation=(base:PublicationDraft):DraftUpdateMutation=>({
      id:base.id,expectedRevision:base.revision,clientMutationId:randomUUID(),
      kind:base.kind,caption:nextCaption,music:base.music,
      composition:base.composition,assetIds:[...base.assetIds],
    });
    const runMutation=async(mutation:DraftUpdateMutation):Promise<PublicationDraft>=>{
      try {
        const updated=await DraftManager.updatePublicationDraft(mutation);
        if(draftUpdateMutationsRef.current.get(draft.id)===mutation) {
          draftUpdateMutationsRef.current.delete(draft.id);
        }
        return updated;
      } catch(error) {
        if(!isAmbiguousDraftMutationError(error)
          &&draftUpdateMutationsRef.current.get(draft.id)===mutation) {
          draftUpdateMutationsRef.current.delete(draft.id);
        }
        throw error;
      }
    };

    if(pendingMutation) {
      const confirmed=await runMutation(pendingMutation);
      if(confirmed.caption===nextCaption
        ||draftMutationGenerationRef.current!==generation
        ||activeUserIdRef.current!==ownerId) return confirmed;
      const nextMutation=createMutation(confirmed);
      draftUpdateMutationsRef.current.set(draft.id,nextMutation);
      return runMutation(nextMutation);
    }

    const mutation=createMutation(draft);
    draftUpdateMutationsRef.current.set(draft.id,mutation);
    return runMutation(mutation);
  },[]);

  const saveCloudDraftRevision=useCallback(async()=>{
    const draft=editingDraft;
    const ownerId=user?.id;
    const generation=draftMutationGenerationRef.current;
    const editorGeneration=draftEditorGenerationRef.current;
    if(!draft||!ownerId) return;
    if(draftPublishCommandsRef.current.has(draft.id)) {
      if(draftEditorTargetIdRef.current===draft.id&&activeUserIdRef.current===ownerId) {
        showAlert(
          'Publicación pendiente',
          'Reintenta Publicar para confirmar el intento anterior antes de guardar otros cambios.',
        );
      }
      return;
    }
    const operationKey=draft.id;
    if(draftMutationInFlightRef.current.has(operationKey)) return;
    const nextCaption=editingDraftCaption.trim();
    const hasPendingUpdate=draftUpdateMutationsRef.current.has(draft.id);
    if(nextCaption===draft.caption&&!hasPendingUpdate) {
      if(draftEditorTargetIdRef.current===draft.id&&activeUserIdRef.current===ownerId) {
        showAlert('Sin cambios','Edita la descripción antes de guardar una nueva revisión.');
      }
      return;
    }
    draftMutationInFlightRef.current.add(operationKey);
    try {
      const updated=await updateCloudDraftRevision(draft,nextCaption,ownerId,generation);
      if(draftMutationGenerationRef.current!==generation||activeUserIdRef.current!==ownerId) return;
      invalidateDraftReadsAfterMutation(draft.id);
      setCloudDrafts(current=>current.map(item=>item.id===updated.id&&item.revision<=updated.revision?updated:item));
      setEditingDraft(current=>current?.id===updated.id&&current.revision<=updated.revision?updated:current);
      const isCurrentEditor=draftEditorTargetIdRef.current===draft.id;
      if(isCurrentEditor&&draftEditorGenerationRef.current===editorGeneration) {
        setEditingDraftCaption(updated.caption);
      }
      if(isCurrentEditor) showAlert('Borrador sincronizado',`Revisión ${updated.revision}`);
    } catch(error) {
      if(draftMutationGenerationRef.current===generation
        &&activeUserIdRef.current===ownerId
        &&draftEditorTargetIdRef.current===draft.id) {
        showAlert('Conflicto de borrador',error instanceof Error?error.message:'draft_update_failed');
      }
    } finally {
      if(draftMutationGenerationRef.current===generation&&activeUserIdRef.current===ownerId) {
        draftMutationInFlightRef.current.delete(operationKey);
      }
    }
  },[editingDraft,editingDraftCaption,invalidateDraftReadsAfterMutation,showAlert,updateCloudDraftRevision,user?.id]);

  const publishCloudDraft=useCallback(async()=>{
    const draft=editingDraft;
    const ownerId=user?.id;
    const generation=draftMutationGenerationRef.current;
    const editorGeneration=draftEditorGenerationRef.current;
    if(!draft||!ownerId) return;
    const operationKey=draft.id;
    const existingAttempt=draftPublishCommandsRef.current.get(draft.id);
    if(draftMutationInFlightRef.current.has(operationKey)) return;
    draftMutationInFlightRef.current.add(operationKey);
    try {
      let attempt=existingAttempt;
      let draftToPublish:PublicationDraft;
      if(attempt) {
        draftToPublish=attempt.draft;
      } else {
        const nextCaption=editingDraftCaption.trim();
        const hasPendingUpdate=draftUpdateMutationsRef.current.has(draft.id);
        draftToPublish=nextCaption===draft.caption&&!hasPendingUpdate
          ? draft
          : await updateCloudDraftRevision(draft,nextCaption,ownerId,generation);
        if(draftMutationGenerationRef.current!==generation||activeUserIdRef.current!==ownerId) return;
        if(draftToPublish!==draft) {
          invalidateDraftReadsAfterMutation(draft.id);
          setCloudDrafts(current=>current.map(item=>item.id===draftToPublish.id&&item.revision<=draftToPublish.revision?draftToPublish:item));
          setEditingDraft(current=>current?.id===draftToPublish.id&&current.revision<=draftToPublish.revision?draftToPublish:current);
          if(draftEditorTargetIdRef.current===draft.id
            &&draftEditorGenerationRef.current===editorGeneration) {
            setEditingDraftCaption(draftToPublish.caption);
          }
        }
        attempt={clientCommandId:randomUUID(),revision:draftToPublish.revision,draft:draftToPublish};
        draftPublishCommandsRef.current.set(draft.id,attempt);
      }
      const postId=await DraftManager.publishPublicationDraft({
        draft:attempt.draft,clientCommandId:attempt.clientCommandId,
      });
      if(draftMutationGenerationRef.current!==generation||activeUserIdRef.current!==ownerId) return;
      draftPublishCommandsRef.current.delete(draft.id);
      invalidateDraftReadsAfterMutation(draft.id);
      setCloudDrafts(current=>current.filter(item=>item.id!==draft.id));
      const isCurrentEditor=draftEditorTargetIdRef.current===draft.id;
      setEditingDraft(current=>{
        if(current?.id!==draft.id) return current;
        if(draftEditorTargetIdRef.current===draft.id) draftEditorTargetIdRef.current=null;
        if(draftResolvedEditorIdRef.current===draft.id) draftResolvedEditorIdRef.current=null;
        return null;
      });
      if(isCurrentEditor) {
        showAlert('Publicado','El borrador se publicó mediante la autoridad canónica.',[
          {text:'Ver feed',onPress:()=>router.push('/(tabs)')},{text:'Cerrar'},
        ]);
      }
      void postId;
    } catch(error) {
      if(draftMutationGenerationRef.current===generation&&activeUserIdRef.current===ownerId) {
        if(!isAmbiguousDraftMutationError(error)) draftPublishCommandsRef.current.delete(draft.id);
        if(draftEditorTargetIdRef.current===draft.id) {
          showAlert('Publicación pendiente',error instanceof Error?error.message:'draft_publish_failed');
        }
      }
    } finally {
      if(draftMutationGenerationRef.current===generation&&activeUserIdRef.current===ownerId) {
        draftMutationInFlightRef.current.delete(operationKey);
      }
    }
  },[editingDraft,editingDraftCaption,invalidateDraftReadsAfterMutation,router,showAlert,updateCloudDraftRevision,user?.id]);

  const deleteCloudDraft=useCallback((draft:PublicationDraft)=>{
    const ownerId=user?.id;
    const generation=draftMutationGenerationRef.current;
    if(!ownerId) return;
    showAlert('Eliminar borrador','Esta acción libera su reserva privada de media.',[
      {text:'Cancelar',style:'cancel'},
      {text:'Eliminar',style:'destructive',onPress:async()=>{
        if(draftMutationGenerationRef.current!==generation||activeUserIdRef.current!==ownerId) return;
        const operationKey=draft.id;
        if(draftMutationInFlightRef.current.has(operationKey)) return;
        let mutation=draftDeleteMutationsRef.current.get(draft.id);
        if(!mutation) {
          mutation={id:draft.id,expectedRevision:draft.revision,clientMutationId:randomUUID()};
          draftDeleteMutationsRef.current.set(draft.id,mutation);
        }
        draftMutationInFlightRef.current.add(operationKey);
        try {
          await DraftManager.deletePublicationDraft(mutation);
          if(draftMutationGenerationRef.current!==generation||activeUserIdRef.current!==ownerId) return;
          draftDeleteMutationsRef.current.delete(draft.id);
          invalidateDraftReadsAfterMutation(draft.id);
          setCloudDrafts(current=>current.filter(item=>item.id!==draft.id));
          setEditingDraft(current=>{
            if(current?.id!==draft.id) return current;
            if(draftEditorTargetIdRef.current===draft.id) draftEditorTargetIdRef.current=null;
            if(draftResolvedEditorIdRef.current===draft.id) draftResolvedEditorIdRef.current=null;
            return null;
          });
        } catch(error) {
          if(draftMutationGenerationRef.current===generation&&activeUserIdRef.current===ownerId) {
            if(!isAmbiguousDraftMutationError(error)) draftDeleteMutationsRef.current.delete(draft.id);
            showAlert('Error',error instanceof Error?error.message:'draft_delete_failed');
          }
        } finally {
          if(draftMutationGenerationRef.current===generation&&activeUserIdRef.current===ownerId) {
            draftMutationInFlightRef.current.delete(operationKey);
          }
        }
      }},
    ]);
  },[invalidateDraftReadsAfterMutation,showAlert,user?.id]);

  const renderDraft=useCallback(({item}:{item:PublicationDraft})=>(
    <View style={styles.draftCard}>
      <View style={{flex:1,gap:4}}>
        <Text style={styles.draftTitle} numberOfLines={2}>{item.caption||'Sin descripción'}</Text>
        <Text style={styles.draftMeta}>{item.kind==='carousel'?'Carrusel':'Foto'} · revisión {item.revision}</Text>
      </View>
      <Pressable onPress={()=>void restoreCloudDraft(item.id)} style={styles.draftAction}><Text style={styles.draftActionText}>Restaurar</Text></Pressable>
      <Pressable onPress={()=>deleteCloudDraft(item)} style={styles.draftDelete}><MaterialIcons name="delete-outline" size={20} color={Colors.error}/></Pressable>
    </View>
  ),[deleteCloudDraft,restoreCloudDraft]);

  const renderItem = useCallback(({ item }: { item: VideoWithMeta }) => (
    <ContentItem video={item} onPress={handleItemPress} onLongPress={handleItemLongPress} />
  ), [handleItemPress, handleItemLongPress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Mis Contenidos</Text>
        <Pressable onPress={handleSort} style={styles.sortBtn} hitSlop={8}>
          <MaterialCommunityIcons name="sort-variant" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(myVideos.length)}</Text>
          <Text style={styles.statLbl}>Publicaciones</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(totalLikes)}</Text>
          <Text style={styles.statLbl}>Total Likes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(totalViews)}</Text>
          <Text style={styles.statLbl}>Total Vistas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: Colors.primary }]}>
            {(totalLikes * 0.01).toFixed(2)}
          </Text>
          <Text style={styles.statLbl}>$DAG Ganados</Text>
        </View>
      </View>

      {/* Content tabs */}
      <ScrollView
        ref={tabsScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsContent}
        onContentSizeChange={()=>{
          if(activeTab==='drafts') tabsScrollRef.current?.scrollToEnd?.({animated:false});
        }}
      >
        {TAB_CONFIG.map(t => {
          const count = t.key === 'posts' ? myPosts.length
            : t.key === 'reels' ? myReels.length
            : t.key === 'saved' ? savedVideos.length
            : t.key === 'drafts' ? cloudDrafts.length
            : 0;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{selected:activeTab===t.key}}
              accessibilityLabel={t.label}
            >
              <MaterialCommunityIcons
                name={t.icon as any}
                size={16}
                color={activeTab === t.key ? '#fff' : Colors.textSubtle}
              />
              <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
                {t.label}
              </Text>
              {count > 0 ? (
                <View style={[styles.tabBadge, activeTab === t.key && styles.tabBadgeActive]}>
                  <Text style={styles.tabBadgeText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {activeTab==='drafts' ? (
        <View style={styles.draftSectionHeader}>
          <Text style={styles.draftSectionTitle}>Borradores privados</Text>
          <Text style={styles.draftSectionSub}>Guardados en tu cuenta y visibles solo para ti.</Text>
        </View>
      ) : null}

      {activeTab==='drafts'&&draftLoadError ? (
        <View style={styles.draftError} accessibilityRole="alert">
          <MaterialCommunityIcons name="cloud-alert-outline" size={22} color={Colors.error}/>
          <View style={styles.draftErrorCopy}>
            <Text style={styles.draftErrorTitle}>{draftLoadError}</Text>
            <Text style={styles.draftErrorSub}>Comprueba tu conexión e inténtalo de nuevo.</Text>
          </View>
          <Pressable
            onPress={()=>void loadDrafts()}
            style={styles.draftRetry}
            accessibilityRole="button"
            accessibilityLabel="Reintentar cargar borradores"
          >
            <Text style={styles.draftRetryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Content grid */}
      {isDeleting || (activeTab==='drafts'
        ? isLoadingDrafts&&cloudDrafts.length===0
        : isLoadingContent) ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>{isDeleting
            ? 'Eliminando...'
            : activeTab==='drafts' ? 'Cargando borradores...' : 'Cargando contenido...'}</Text>
        </View>
      ) : activeTab==='drafts'&&(cloudDrafts.length>0||editingDraft) ? (
        <FlatList
          data={cloudDrafts}
          keyExtractor={item=>item.id}
          renderItem={renderDraft}
          onEndReached={()=>{if(draftNextCursor&&!draftContinuationError) void loadMoreDrafts();}}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{padding:Spacing.md,gap:Spacing.sm,paddingBottom:80+insets.bottom}}
          ListHeaderComponent={editingDraft ? (
            <View style={styles.draftEditor}>
              <Text style={styles.draftEditorTitle}>Reanudar borrador privado</Text>
              {isLoadingDraftPreview ? (
                <View style={styles.draftPreviewStatus}>
                  <ActivityIndicator color={Colors.primary}/>
                  <Text style={styles.draftPreviewStatusText}>Cargando fotografía privada...</Text>
                </View>
              ) : null}
              {draftPreviewUrls.length>0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.draftPreviews}>
                  {draftPreviewUrls.map((url,index)=>(
                    <Image
                      key={`${editingDraft.assetIds[index]??index}`}
                      source={{uri:url}}
                      style={styles.draftPreviewImage}
                      contentFit="cover"
                      accessibilityLabel={`Vista previa privada ${index+1}`}
                    />
                  ))}
                </ScrollView>
              ) : null}
              {draftPreviewError ? (
                <View style={styles.draftPreviewFailure} accessibilityRole="alert">
                  <Text style={styles.draftPreviewFailureText}>{draftPreviewError}</Text>
                  <Pressable
                    onPress={()=>void loadDraftPreview(editingDraft)}
                    style={styles.draftAction}
                    accessibilityRole="button"
                    accessibilityLabel="Reintentar vista previa privada"
                  >
                    <Text style={styles.draftActionText}>Reintentar vista previa</Text>
                  </Pressable>
                </View>
              ) : null}
              <TextInput
                value={editingDraftCaption}
                onChangeText={value=>{
                  draftEditorGenerationRef.current+=1;
                  setEditingDraftCaption(value);
                }}
                placeholder="Descripción"
                placeholderTextColor={Colors.textSubtle}
                multiline
                maxLength={2200}
                style={styles.draftInput}
              />
              <View style={styles.draftEditorActions}>
                <Pressable onPress={()=>void saveCloudDraftRevision()} style={styles.draftAction}><Text style={styles.draftActionText}>Guardar cambios</Text></Pressable>
                <Pressable onPress={()=>void publishCloudDraft()} style={styles.draftPublish}><Text style={styles.draftPublishText}>Publicar</Text></Pressable>
                <Pressable onPress={()=>{
                  draftRestoreRef.current+=1;
                  draftPreviewRef.current+=1;
                  draftEditorGenerationRef.current+=1;
                  draftEditorTargetIdRef.current=null;
                  draftResolvedEditorIdRef.current=null;
                  setEditingDraft(null);
                  setEditingDraftCaption('');
                }} style={styles.draftAction}><Text style={styles.draftActionText}>Cerrar</Text></Pressable>
              </View>
            </View>
          ) : null}
          ListFooterComponent={isLoadingMoreDrafts ? (
            <View style={styles.draftContinuationStatus}>
              <ActivityIndicator color={Colors.primary}/>
              <Text style={styles.draftPreviewStatusText}>Cargando más borradores...</Text>
            </View>
          ) : draftContinuationError ? (
            <View style={styles.draftContinuationError} accessibilityRole="alert">
              <Text style={styles.draftErrorTitle}>{draftContinuationError}</Text>
              <Pressable
                onPress={()=>void loadMoreDrafts()}
                style={styles.draftRetry}
                accessibilityRole="button"
                accessibilityLabel="Reintentar cargar más borradores"
              >
                <Text style={styles.draftRetryText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : null}
        />
      ) : activeTab==='drafts'&&draftLoadError ? (
        <View style={styles.draftErrorFiller}/>
      ) : currentItems.length === 0 ? (
        <View style={styles.emptyState}>
          <LinearGradient
            colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']}
            style={styles.emptyIcon}
          >
            <MaterialCommunityIcons
              name={activeTab === 'saved' ? 'bookmark-outline' : activeTab === 'drafts' ? 'file-outline' : 'video-plus-outline'}
              size={40}
              color={Colors.primary}
            />
          </LinearGradient>
          <Text style={styles.emptyTitle}>
            {activeTab === 'saved' ? 'Sin guardados'
              : activeTab === 'drafts' ? 'Sin borradores'
              : activeTab === 'stories' ? 'Sin historias'
              : 'Sin publicaciones'}
          </Text>
          <Text style={styles.emptySub}>
            {activeTab === 'saved' ? 'Guarda contenido de otros creadores'
              : 'Crea y sube tu primer contenido'}
          </Text>
          {activeTab !== 'saved' && activeTab !== 'drafts' && activeTab !== 'stories' ? (
            <Pressable
              style={styles.createBtn}
              onPress={() => router.push('/(tabs)/upload')}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.createBtnGrad}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#fff" />
                <Text style={styles.createBtnText}>Crear contenido</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={currentItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={12}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  sortBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Stats
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  statLbl: { color: Colors.textSubtle, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },

  // Tabs
  tabsScroll: { maxHeight: 48, marginBottom: Spacing.xs },
  tabsContent: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabLabel: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  tabLabelActive: { color: '#fff', fontWeight: FontWeight.semibold },
  tabBadge: {
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },

  // Grid
  row: { gap: GRID_GAP },
  gridItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE * 1.25,
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  gridThumb: { ...StyleSheet.absoluteFillObject },
  gridOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 5, justifyContent: 'flex-end',
    height: '50%',
  },
  gridStats: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  gridStatText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.semibold },
  typeBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  draftCard:{
    minHeight:78,flexDirection:'row',alignItems:'center',gap:Spacing.sm,
    padding:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surfaceElevated,
    borderWidth:1,borderColor:Colors.border,
  },
  draftTitle:{color:Colors.textPrimary,fontWeight:FontWeight.semibold},
  draftMeta:{color:Colors.textSubtle,fontSize:FontSize.xs},
  draftAction:{paddingHorizontal:8,paddingVertical:7,borderRadius:Radius.md,backgroundColor:Colors.primaryDim},
  draftActionText:{color:Colors.primaryLight,fontSize:FontSize.xs,fontWeight:FontWeight.semibold},
  draftDelete:{padding:7},
  draftEditor:{gap:Spacing.sm,padding:Spacing.md,borderRadius:Radius.lg,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.primary},
  draftEditorTitle:{color:Colors.textPrimary,fontWeight:FontWeight.bold},
  draftPreviewStatus:{minHeight:96,alignItems:'center',justifyContent:'center',gap:Spacing.xs},
  draftPreviewStatusText:{color:Colors.textSubtle,fontSize:FontSize.xs},
  draftPreviews:{gap:Spacing.sm},
  draftPreviewImage:{width:160,height:160,borderRadius:Radius.md,backgroundColor:Colors.surfaceElevated},
  draftPreviewFailure:{gap:Spacing.sm,padding:Spacing.sm,borderRadius:Radius.md,borderWidth:1,borderColor:Colors.error},
  draftPreviewFailureText:{color:Colors.textPrimary,fontSize:FontSize.sm},
  draftInput:{minHeight:76,color:Colors.textPrimary,backgroundColor:Colors.surfaceElevated,borderRadius:Radius.md,padding:Spacing.sm,textAlignVertical:'top'},
  draftEditorActions:{flexDirection:'row',alignItems:'center',gap:Spacing.sm,flexWrap:'wrap'},
  draftPublish:{paddingHorizontal:12,paddingVertical:8,borderRadius:Radius.md,backgroundColor:Colors.primary},
  draftPublishText:{color:'#fff',fontSize:FontSize.xs,fontWeight:FontWeight.bold},
  draftSectionHeader:{paddingHorizontal:Spacing.md,paddingTop:Spacing.xs,paddingBottom:Spacing.sm,gap:2},
  draftSectionTitle:{color:Colors.textPrimary,fontSize:FontSize.md,fontWeight:FontWeight.bold},
  draftSectionSub:{color:Colors.textSubtle,fontSize:FontSize.xs},
  draftError:{
    flexDirection:'row',alignItems:'center',gap:Spacing.sm,marginHorizontal:Spacing.md,
    marginBottom:Spacing.sm,padding:Spacing.sm,borderRadius:Radius.md,
    backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.error,
  },
  draftErrorCopy:{flex:1,gap:2},
  draftErrorTitle:{color:Colors.textPrimary,fontSize:FontSize.sm,fontWeight:FontWeight.semibold},
  draftErrorSub:{color:Colors.textSubtle,fontSize:FontSize.xs},
  draftRetry:{paddingHorizontal:10,paddingVertical:8,borderRadius:Radius.md,backgroundColor:Colors.primaryDim},
  draftRetryText:{color:Colors.primaryLight,fontSize:FontSize.xs,fontWeight:FontWeight.bold},
  draftErrorFiller:{flex:1},
  draftContinuationStatus:{padding:Spacing.md,alignItems:'center',gap:Spacing.xs},
  draftContinuationError:{
    flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.sm,
    marginTop:Spacing.sm,padding:Spacing.sm,borderRadius:Radius.md,
    backgroundColor:Colors.surfaceElevated,borderWidth:1,borderColor:Colors.error,
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  createBtn: { borderRadius: Radius.full, overflow: 'hidden', marginTop: Spacing.sm },
  createBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  createBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
