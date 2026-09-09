import { useCallback, useEffect, useState } from 'react';
import { getMediaUrl } from '@/services/mediaService';
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
    setUrl(null);
    setHasError(false);

    if (!isActive) {
      setIsLoading(false);
      return () => { mounted = false; };
    }

    if (!story.mediaAssetId) {
      const legacyUrl = typeof story.mediaUrl === 'string' && /^https:\/\//i.test(story.mediaUrl)
        ? story.mediaUrl
        : null;
      setUrl(legacyUrl);
      setIsLoading(false);
      setHasError(!legacyUrl);
      return () => { mounted = false; };
    }

    setIsLoading(true);
    void getMediaUrl(story.mediaAssetId).then(nextUrl => {
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
  }, [attempt, isActive, story.id, story.mediaAssetId, story.mediaUrl]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const fail = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);
  return { url, isLoading, hasError, retry, fail };
}
