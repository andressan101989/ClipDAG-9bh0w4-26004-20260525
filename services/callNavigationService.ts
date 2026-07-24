type CallRouter = { push: (href: any) => void; replace: (href: any) => void };

type AcceptedCallRoute = {
  callId: string;
  callerId: string;
  channelName: string;
  callerName: string;
  callerAvatar: string;
  callType: 'audio' | 'video';
};

export function navigateToAcceptedCall(router: CallRouter, call: AcceptedCallRoute, owner: 'onspace' | 'callkit') {
  const screen = call.callType === 'audio' ? 'call' : 'video-call';
  const qs = new URLSearchParams({
    mode: 'answer', channel: call.channelName, callId: call.callId,
    callerName: call.callerName, callerAvatar: call.callerAvatar,
    answerHandoff: 'accepted',
  }).toString();
  const href = `/${screen}/${call.callerId}?${qs}` as any;
  console.log('[CallNavigation] route_requested', { callId: `${call.callId.slice(0, 8)}…`, screen, owner });
  if (owner === 'callkit') router.replace(href);
  else router.push(href);
  return screen;
}

export function replaceCallWithHome(router: Pick<CallRouter, 'replace'>) {
  router.replace('/(tabs)' as any);
}
