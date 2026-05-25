import { useContext } from 'react';
import { StoriesContext } from '@/contexts/StoriesContext';

export function useStories() {
  const context = useContext(StoriesContext);
  if (!context) throw new Error('useStories must be used within StoriesProvider');
  return context;
}
