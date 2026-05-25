import { useContext } from 'react';
import { MessagesContext } from '@/contexts/MessagesContext';

export function useMessages() {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error('useMessages must be used within MessagesProvider');
  return ctx;
}
