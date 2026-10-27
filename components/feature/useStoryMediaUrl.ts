import { useCallback, useEffect, useState } from 'react';
import { getMediaUrl } from '@/services/mediaService';
import { getStoryStreamPlayback } from '@/services/streamService';
import type { StoryItem } from './StoriesBar';

const SIGNED_URL_REFRESH_MS = 270_000;

export function useStoryMediaUrl(story: StoryItem, isActive: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const isDirectVideo = story.mediaType === 'video' && story.storyKind === 'media';
    setUrl(null);
    setHasError(false);

    if (!isActive) {
      setIsLoading(false);
      return () => { mounted = false; };
    }

    if (!isDirectVideo && !story.mediaAssetId) {
      const legacyUrl = typeof story.mediaUrl === 'string' && /^https:\/\//i.test(story.mediaUrl)
        ? story.mediaUrl
        : null;
      setUrl(legacyUrl);
      setIsLoading(false);
      setHasError(!legacyUrl);
      return () => { mounted = false; };
    }

    setIsLoading(true);
    const loadUrl = isDirectVideo
      ? getStoryStreamPlayback(story.id).then(grant => grant.hlsUrl).catch(error => {
        // Pre-B1 Story videos remain readable through their private R2 link;
        // new Story videos never expose or authorize playback by raw asset id.
        if (story.mediaAssetId) return getMediaUrl(story.mediaAssetId);
        throw error;
      })
      : getMediaUrl(story.mediaAssetId!);
    void loadUrl.then(nextUrl => {
      if (!mounted) return;
      setUrl(nextUrl);
      setIsLoading(false);
      refreshTimer = setTimeout(() => setAttempt(value => value + 1), SIGNED_URL_REFRESH_MS);
    }).catch(() => {
      if (!mounted) return;
      setIsLoading(false);
      setHasError(true);
    });

    return () => {
      mounted = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [attempt, isActive, story.id, story.mediaAssetId, story.mediaType, story.mediaUrl, story.storyKind]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const fail = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);
  return { url, isLoading, hasError, retry, fail };
}
