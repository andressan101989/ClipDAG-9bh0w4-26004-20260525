import { useCallback, useEffect, useRef, useState } from 'react';
import { storyQuestionHandoffs, type StoryQuestionReplySource } from '@/services/storyQuestionHandoff';
import type { StoryQuestionAnswerPreflight } from '@/contexts/StoriesContext';

type QuestionRoute = { pathname: '/(tabs)'; params: { handoffToken: string } }
  | { pathname: '/chat/[userId]'; params: { userId: string; handoffToken: string } };
type TransitionLease = { token: symbol; lock: { current: boolean | symbol }; cancel: () => void };

function releaseTransition(lease: TransitionLease) {
  // Other viewer transitions can replace the reservation; retirement owns only this token.
  if (lease.lock.current === lease.token) lease.lock.current = false;
  lease.cancel();
}

/** Coordinates only read-only preparation, private issuance and the existing viewer's dismissal. */
export function useStoryQuestionInbox(options: {
  visible: boolean; actorId?: string; storyId?: string; isOwner: boolean;
  prepare?: StoryQuestionAnswerPreflight;
  transitionLock: { current: boolean | symbol };
  onExit: () => void; onClose: () => void; navigate: (route: QuestionRoute) => void;
}) {
  const currentRef = useRef(options);
  currentRef.current = options;
  const sessionRef = useRef(0);
  const pendingRef = useRef<{ route: QuestionRoute; session: number; actorId: string; storyId: string; lease: TransitionLease } | null>(null);
  const leaseRef = useRef<TransitionLease | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const retire = useCallback(() => {
    const lease = leaseRef.current;
    if (lease) releaseTransition(lease);
    leaseRef.current = null;
    pendingRef.current = null;
    closingRef.current = false;
    setClosing(false);
  }, []);
  const prepareAvailable = Boolean(options.prepare);
  useEffect(() => {
    sessionRef.current += 1;
    retire();
    return () => { sessionRef.current += 1; retire(); };
  }, [options.actorId, options.isOwner, options.storyId, options.visible, prepareAvailable, retire]);

  const reply = useCallback(async (
    kind: 'story' | 'chat', source: StoryQuestionReplySource,
    rowIsCurrent: () => boolean, dismissResults: () => Promise<boolean>,
  ) => {
    const initial = currentRef.current;
    const session = sessionRef.current;
    const isCurrent = () => sessionRef.current === session && currentRef.current.visible
      && currentRef.current.isOwner && currentRef.current.actorId === initial.actorId
      && currentRef.current.storyId === initial.storyId;
    if (!initial.visible || !initial.isOwner || !initial.actorId || !initial.prepare
      || source.storyId !== initial.storyId || !rowIsCurrent() || pendingRef.current || initial.transitionLock.current) throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
    const prepared = await initial.prepare(source);
    if (!isCurrent() || !rowIsCurrent() || pendingRef.current || currentRef.current.transitionLock.current
      || !prepared || Object.keys(prepared).sort().join(',') !== 'question,respondentId'
      || prepared.respondentId !== source.respondentId) throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
    // The singleton validates text, identifiers and purpose before returning only an opaque token.
    const token = kind === 'story'
      ? storyQuestionHandoffs.issueStoryReply({ actorId: initial.actorId, source, question: prepared.question, answer: '' })
      : storyQuestionHandoffs.issueChatDraft({ actorId: initial.actorId, recipientId: prepared.respondentId, text: prepared.question });
    if (!token) throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
    let cancel!: () => void;
    const cancellation = new Promise<boolean>(resolve => { cancel = () => resolve(false); });
    const lease = { token: Symbol('story-question-exit'), lock: initial.transitionLock, cancel };
    const pending = { route: kind === 'story'
      ? { pathname: '/(tabs)' as const, params: token }
      : { pathname: '/chat/[userId]' as const, params: { userId: prepared.respondentId, ...token } },
    session, actorId: initial.actorId, storyId: source.storyId, lease };
    pendingRef.current = pending;
    leaseRef.current = lease;
    initial.transitionLock.current = lease.token;
    try {
      if (!await Promise.race([dismissResults(), cancellation]) || !isCurrent() || pendingRef.current !== pending) throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
      currentRef.current.onExit();
      closingRef.current = true;
      setClosing(true);
    } catch {
      if (leaseRef.current === lease) {
        releaseTransition(lease);
        leaseRef.current = null;
      }
      if (pendingRef.current === pending) {
        pendingRef.current = null;
        closingRef.current = false;
        setClosing(false);
      }
      throw new Error('STORY_QUESTION_REPLY_UNAVAILABLE');
    }
  }, []);

  const dismissalLease = leaseRef.current;
  const onDismiss = useCallback(() => {
    const pending = pendingRef.current;
    const current = currentRef.current;
    if (!dismissalLease || pending?.lease !== dismissalLease || !closingRef.current || !pending || pending.session !== sessionRef.current || !current.visible || !current.isOwner
      || pending.actorId !== current.actorId || pending.storyId !== current.storyId) return;
    pendingRef.current = null;
    closingRef.current = false;
    current.onClose();
    current.navigate(pending.route);
  }, [dismissalLease]);
  return { reply: options.prepare && options.isOwner && options.actorId ? reply : undefined, closing, onDismiss };
}
