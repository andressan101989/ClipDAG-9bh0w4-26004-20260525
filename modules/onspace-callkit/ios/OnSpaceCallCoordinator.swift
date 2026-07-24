import Foundation
import PushKit
import CallKit
import AVFoundation
import UIKit

/// Singleton that owns PushKit + CallKit for the whole app lifetime.
///
/// Started as early as possible by `OnSpaceCallAppDelegateSubscriber`
/// (`subscriberDidRegister()`), which — per Expo's own documentation on
/// `ExpoAppDelegateSubscriberProtocol` — runs before any other
/// `UIApplicationDelegate` function when loaded from the generated modules
/// provider, i.e. before `AppDelegate` even starts React Native. That is
/// what lets a cold-start VoIP push register the `PKPushRegistry` delegate
/// before JS exists.
///
/// IOS-A SCOPE ONLY. This class must not:
///   - talk to Supabase;
///   - accept/reject calls against any backend;
///   - connect to Agora;
///   - activate/deactivate AVAudioSession;
///   - override an external Bluetooth/CarPlay/user-selected route;
///   - add a custom ringtone.
/// Audio category/mode setup before answer is intentionally the one exception;
/// CallKit remains the activation owner. This class otherwise owns the native
/// PushKit/CallKit plumbing and re-emits raw events to JS.
public final class OnSpaceCallCoordinator: NSObject {
  public static let shared = OnSpaceCallCoordinator()

  private enum DefaultsKey {
    static let voipToken = "com.clipdag.onspace.callkit.voipToken"
    static let voipTokenUpdatedAt = "com.clipdag.onspace.callkit.voipTokenUpdatedAt"
    static let pendingEvents = "com.clipdag.onspace.callkit.pendingEvents.v1"
    static let retainedCallState = "com.clipdag.onspace.callkit.retainedCallState.v1"
    static let terminalTombstones = "com.clipdag.onspace.callkit.terminalTombstones.v1"
  }

  private enum PendingEventPolicy {
    static let maxEvents = 50
    static let ttlSeconds: TimeInterval = 24 * 60 * 60
  }

  private enum TerminalTombstonePolicy {
    static let version = 1
    static let maxEntries = 100
    static let ttlMilliseconds: TimeInterval = 24 * 60 * 60 * 1000
  }

  private enum TerminalVoipEvent: String, CaseIterable {
    case cancelled = "call_cancelled"
    case expired = "call_expired"
    case rejected = "call_rejected"
    case ended = "call_ended"
    case answeredElsewhere = "call_answered_elsewhere"

    var callKitReason: CXCallEndedReason {
      switch self {
      case .cancelled, .expired:
        return .unanswered
      case .rejected:
        return .declinedElsewhere
      case .ended:
        return .remoteEnded
      case .answeredElsewhere:
        return .answeredElsewhere
      }
    }
  }

  /// Event names — must match `Events(...)` in OnSpaceCallKitModule exactly.
  public enum EventName: String {
    case voipTokenUpdated
    case voipTokenInvalidated
    case incomingCall
    case answerCall
    case endCall
    case muteCall
    case audioSessionActivated
    case audioSessionDeactivated
    case providerReset
  }

  /// Set by OnSpaceCallKitModule once JS has attached at least one listener
  /// (`OnStartObserving`) and cleared on `OnStopObserving`. While nil,
  /// events are queued (cold-start queue) instead of dropped, and flushed
  /// in order once a real emitter is attached.
  var eventEmitter: ((_ name: String, _ body: [String: Any]) -> Void)? {
    didSet { flushPendingEvents() }
  }

  private let stateLock = NSLock()
  private var started = false
  private var registryConfigured = false
  private var pushRegistry: PKPushRegistry?
  private var callProvider: CXProvider?
  private let callController = CXCallController()
  private var lastVoipTokenHex: String?
  private var lastVoipTokenUpdatedAt: TimeInterval?
  private var pendingEvents: [(name: String, body: [String: Any])] = []
  private var seenIncomingCallIds: [String: TimeInterval] = [:]
  private var currentCallId: String?
  private var currentCallUuid: UUID?
  private var hasReportedCall = false
  private var wasAnswered = false
  private var audioSessionActive = false
  private var currentCallHasVideo = false
  private var callSpeakerPreference: (callId: String, enabled: Bool)?
  private var currentCallNativeOrigin: String?
  private var currentCallWasVisibleBeforePush = false
  private var currentHandoffEventId: String?
  private var handoffStarted = false
  private var handoffCompleted = false

  private override init() {
    super.init()
    loadPersistedVoipTokenLocked()
    restoreRetainedCallStateLocked()
  }

  /// Idempotent — safe to call more than once (cold-start subscriber path,
  /// JS-side `ensureStarted()` safety net, Fast Refresh). Only the first
  /// call actually creates the registry/provider; later calls are no-ops.
  public func start() {
    guard Thread.isMainThread else {
      DispatchQueue.main.async { [weak self] in
        self?.start()
      }
      return
    }
    print("[OnSpaceCallKit] coordinator start requested")
    stateLock.lock()
    defer { stateLock.unlock() }
    loadPersistedVoipTokenLocked()
    guard !started else {
      print("[OnSpaceCallKit] coordinator already started")
      return
    }
    started = true

    let registry = PKPushRegistry(queue: .main)
    registry.delegate = self
    registry.desiredPushTypes = [.voIP]
    pushRegistry = registry
    registryConfigured = true
    print("[OnSpaceCallKit] PKPushRegistry created")
    print("[OnSpaceCallKit] desiredPushTypes configured: voIP")

    // localizedName is a get-only property on CXProviderConfiguration in the
    // CallKit headers this project actually builds against (Xcode 16.2, per
    // eas.json's "development" profile) — confirmed by a real EAS build
    // failure ("cannot assign to property: 'localizedName' is a get-only
    // property") after an earlier attempt to set it post-init. It can only
    // be set through this initializer, deprecation warning notwithstanding.
    let configuration = CXProviderConfiguration(localizedName: "OnSpace")
    configuration.supportsVideo = true
    configuration.maximumCallGroups = 1
    configuration.maximumCallsPerCallGroup = 1
    configuration.supportedHandleTypes = [.generic]
    // NOTE: CXProviderConfiguration has no supportsHolding / supportsGrouping
    // / supportsUngrouping properties — verified against the real CallKit
    // API surface, they don't exist on this type. With maximumCallGroups = 1
    // and maximumCallsPerCallGroup = 1 there is nothing to hold or group;
    // IOS-A also never implements CXSetHeldCallAction, which is the actual
    // mechanism that would need to exist for holding to be possible.

    let provider = CXProvider(configuration: configuration)
    provider.setDelegate(self, queue: nil)
    callProvider = provider
  }

  public var currentVoipTokenHex: String? {
    stateLock.lock()
    defer { stateLock.unlock() }
    loadPersistedVoipTokenLocked()
    return lastVoipTokenHex
  }

  public func nativeState() -> [String: Any] {
    stateLock.lock()
    defer { stateLock.unlock() }
    return [
      "currentCallId": currentCallId ?? NSNull(),
      "currentCallUuid": currentCallUuid?.uuidString ?? NSNull(),
      "hasReportedCall": hasReportedCall,
      "wasAnswered": wasAnswered,
      "audioSessionActive": audioSessionActive,
      "nativeOrigin": currentCallNativeOrigin ?? NSNull(),
      "wasAppVisibleBeforeVoipPush": currentCallWasVisibleBeforePush,
      "pendingEventCount": loadPendingEventsLocked().count,
      "handoffStarted": handoffStarted,
      "handoffCompleted": handoffCompleted,
    ]
  }

  public func pendingEventDictionaries() -> [[String: Any]] {
    stateLock.lock()
    defer { stateLock.unlock() }
    let events = loadPendingEventsLocked()
    for event in events where (event["name"] as? String) == EventName.answerCall.rawValue {
      if let callId = event["callId"] as? String {
        logHandoff("answer_replayed_on_launch", callId: callId, eventId: event["eventId"] as? String)
      }
    }
    return events
  }

  @discardableResult
  public func consumePendingEvent(eventId: String) -> Bool {
    stateLock.lock()
    var events = loadPendingEventsLocked()
    let originalCount = events.count
    events.removeAll { ($0["eventId"] as? String) == eventId }
    if events.count != originalCount {
      savePendingEventsLocked(events)
    }
    stateLock.unlock()
    return events.count != originalCount
  }

  @discardableResult
  public func markCallHandoffStarted(callId: String, eventId: String) -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard currentCallId == callId,
          currentHandoffEventId == eventId,
          loadPendingEventsLocked().contains(where: { ($0["eventId"] as? String) == eventId }) else {
      return false
    }
    handoffStarted = true
    persistRetainedCallStateLocked()
    logHandoff("handoff_started", callId: callId, eventId: eventId)
    return true
  }

  @discardableResult
  public func markCallHandoffCompleted(callId: String, eventId: String) -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    guard currentCallId == callId, currentHandoffEventId == eventId else { return false }
    var events = loadPendingEventsLocked()
    events.removeAll { ($0["eventId"] as? String) == eventId }
    savePendingEventsLocked(events)
    handoffStarted = true
    handoffCompleted = true
    persistRetainedCallStateLocked()
    logHandoff("handoff_completed", callId: callId, eventId: eventId)
    logHandoff("answer_acknowledged", callId: callId, eventId: eventId)
    return true
  }

  // MARK: - Event plumbing

  private func emit(_ name: EventName, _ body: [String: Any] = [:]) {
    stateLock.lock()
    let currentEmitter = eventEmitter
    if currentEmitter == nil {
      let safeBody = queueSafeBody(for: name, body: body)
      pendingEvents.append((name: name.rawValue, body: safeBody))
      if pendingEvents.count > 50 {
        pendingEvents.removeFirst(pendingEvents.count - 50)
      }
      stateLock.unlock()
      return
    }
    stateLock.unlock()
    currentEmitter?(name.rawValue, body)
  }

  private func flushPendingEvents() {
    stateLock.lock()
    guard let currentEmitter = eventEmitter, !pendingEvents.isEmpty else {
      stateLock.unlock()
      return
    }
    let queued = pendingEvents
    pendingEvents.removeAll()
    stateLock.unlock()

    for event in queued {
      currentEmitter(event.name, event.body)
    }
  }

  private func queueSafeBody(for name: EventName, body: [String: Any]) -> [String: Any] {
    if name == .voipTokenUpdated {
      return [
        "hasToken": !(lastVoipTokenHex ?? "").isEmpty,
        "tokenLength": lastVoipTokenHex?.count ?? 0,
        "timestamp": Date().timeIntervalSince1970 * 1000,
      ]
    }
    return body.merging(["timestamp": Date().timeIntervalSince1970 * 1000]) { current, _ in current }
  }

  private func makeCallKitEvent(
    _ name: EventName,
    callId: String,
    callUuid: UUID,
    payload: [String: Any] = [:],
    eventId: String = UUID().uuidString,
    timestamp: TimeInterval = Date().timeIntervalSince1970 * 1000
  ) -> [String: Any] {
    return [
      "eventId": eventId,
      "name": name.rawValue,
      "type": name.rawValue,
      "callId": callId,
      "callUuid": callUuid.uuidString,
      "timestamp": timestamp,
      "payload": payload,
    ]
  }

  private func makeNullableCallKitEvent(
    _ name: EventName,
    callId: String?,
    callUuid: UUID?,
    payload: [String: Any] = [:],
    eventId: String = UUID().uuidString,
    timestamp: TimeInterval = Date().timeIntervalSince1970 * 1000
  ) -> [String: Any] {
    return [
      "eventId": eventId,
      "name": name.rawValue,
      "type": name.rawValue,
      "callId": callId ?? NSNull(),
      "callUuid": callUuid?.uuidString ?? NSNull(),
      "timestamp": timestamp,
      "payload": payload,
    ]
  }

  private func liveEmitCallKitEvent(
    _ name: EventName,
    callId: String,
    callUuid: UUID,
    payload: [String: Any] = [:]
  ) {
    emit(name, makeCallKitEvent(name, callId: callId, callUuid: callUuid, payload: payload))
  }

  private func liveEmitNullableCallKitEvent(
    _ name: EventName,
    callId: String?,
    callUuid: UUID?,
    payload: [String: Any] = [:]
  ) {
    emit(name, makeNullableCallKitEvent(name, callId: callId, callUuid: callUuid, payload: payload))
  }

  private func loadPendingEventsLocked() -> [[String: Any]] {
    let now = Date().timeIntervalSince1970 * 1000
    let ttlMs = PendingEventPolicy.ttlSeconds * 1000
    let raw = UserDefaults.standard.array(forKey: DefaultsKey.pendingEvents) as? [[String: Any]] ?? []
    let filtered = raw.filter { event in
      guard let timestamp = event["timestamp"] as? TimeInterval else { return false }
      return now - timestamp <= ttlMs
    }
    if filtered.count != raw.count {
      for event in raw where !filtered.contains(where: { ($0["eventId"] as? String) == (event["eventId"] as? String) }) {
        logHandoff(
          "stale_event_discarded",
          callId: event["callId"] as? String ?? "unknown",
          eventId: event["eventId"] as? String
        )
      }
      savePendingEventsLocked(filtered)
    }
    return filtered
  }

  private func savePendingEventsLocked(_ events: [[String: Any]]) {
    UserDefaults.standard.set(events, forKey: DefaultsKey.pendingEvents)
  }

  private func persistRetainedCallStateLocked() {
    guard let callId = currentCallId, let callUuid = currentCallUuid else {
      UserDefaults.standard.removeObject(forKey: DefaultsKey.retainedCallState)
      return
    }
    UserDefaults.standard.set([
      "callId": callId,
      "callUuid": callUuid.uuidString,
      "hasReportedCall": hasReportedCall,
      "wasAnswered": wasAnswered,
      "hasVideo": currentCallHasVideo,
      "nativeOrigin": currentCallNativeOrigin ?? "background",
      "wasVisibleBeforePush": currentCallWasVisibleBeforePush,
      "handoffEventId": currentHandoffEventId ?? "",
      "handoffStarted": handoffStarted,
      "handoffCompleted": handoffCompleted,
      "updatedAt": Date().timeIntervalSince1970 * 1000,
    ], forKey: DefaultsKey.retainedCallState)
  }

  private func restoreRetainedCallStateLocked() {
    guard let state = UserDefaults.standard.dictionary(forKey: DefaultsKey.retainedCallState),
          let callId = state["callId"] as? String,
          let uuidRaw = state["callUuid"] as? String,
          let callUuid = UUID(uuidString: uuidRaw),
          let updatedAt = state["updatedAt"] as? TimeInterval,
          Date().timeIntervalSince1970 * 1000 - updatedAt <= PendingEventPolicy.ttlSeconds * 1000 else {
      UserDefaults.standard.removeObject(forKey: DefaultsKey.retainedCallState)
      return
    }
    currentCallId = callId
    currentCallUuid = callUuid
    hasReportedCall = state["hasReportedCall"] as? Bool ?? true
    wasAnswered = state["wasAnswered"] as? Bool ?? false
    currentCallHasVideo = state["hasVideo"] as? Bool ?? false
    currentCallNativeOrigin = state["nativeOrigin"] as? String
    currentCallWasVisibleBeforePush = state["wasVisibleBeforePush"] as? Bool ?? false
    currentHandoffEventId = (state["handoffEventId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    handoffStarted = state["handoffStarted"] as? Bool ?? false
    handoffCompleted = state["handoffCompleted"] as? Bool ?? false
    logHandoff("state_retained", callId: callId, eventId: currentHandoffEventId)
  }

  private func logHandoff(_ event: String, callId: String, eventId: String?) {
    let safeCallId = String(callId.prefix(8))
    let safeEventId = eventId.map { String($0.prefix(8)) } ?? "none"
    print("[OnSpaceCallKit] \(event) call=\(safeCallId)… event=\(safeEventId)…")
  }

  private func persistPendingEvent(_ event: [String: Any]) throws -> [String: Any] {
    guard let eventId = event["eventId"] as? String else {
      throw NSError(domain: "OnSpaceCallKit", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing eventId"])
    }
    let eventName = event["name"] as? String
    let callId = event["callId"] as? String

    stateLock.lock()
    var events = loadPendingEventsLocked()
    if let eventName, let callId, let existing = events.first(where: {
      ($0["name"] as? String) == eventName && ($0["callId"] as? String) == callId
    }) {
      stateLock.unlock()
      return existing
    }
    events.removeAll { ($0["eventId"] as? String) == eventId }
    events.append(event)
    if events.count > PendingEventPolicy.maxEvents {
      events.removeFirst(events.count - PendingEventPolicy.maxEvents)
    }
    savePendingEventsLocked(events)
    let synchronized = UserDefaults.standard.synchronize()
    let persisted = loadPendingEventsLocked().contains { ($0["eventId"] as? String) == eventId }
    stateLock.unlock()

    if !synchronized || !persisted {
      throw NSError(domain: "OnSpaceCallKit", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to persist CallKit event"])
    }
    return event
  }

  private func callId(for uuid: UUID) -> String {
    stateLock.lock()
    let id = currentCallUuid == uuid ? currentCallId : nil
    stateLock.unlock()
    return id ?? uuid.uuidString
  }

  private func currentCallIdentity() -> (callId: String, callUuid: UUID)? {
    stateLock.lock()
    let id = currentCallId
    let uuid = currentCallUuid
    stateLock.unlock()
    guard let id, let uuid else { return nil }
    return (id, uuid)
  }

  private func loadPersistedVoipTokenLocked() {
    let defaults = UserDefaults.standard
    guard let token = defaults.string(forKey: DefaultsKey.voipToken), !token.isEmpty else {
      if lastVoipTokenHex == nil {
        lastVoipTokenUpdatedAt = nil
      }
      return
    }
    lastVoipTokenHex = token
    let updatedAt = defaults.double(forKey: DefaultsKey.voipTokenUpdatedAt)
    lastVoipTokenUpdatedAt = updatedAt > 0 ? updatedAt : nil
  }

  private func persistVoipTokenLocked(_ token: String) {
    let now = Date().timeIntervalSince1970
    lastVoipTokenHex = token
    lastVoipTokenUpdatedAt = now
    let defaults = UserDefaults.standard
    defaults.set(token, forKey: DefaultsKey.voipToken)
    defaults.set(now, forKey: DefaultsKey.voipTokenUpdatedAt)
  }

  private func clearPersistedVoipTokenLocked() {
    lastVoipTokenHex = nil
    lastVoipTokenUpdatedAt = nil
    let defaults = UserDefaults.standard
    defaults.removeObject(forKey: DefaultsKey.voipToken)
    defaults.removeObject(forKey: DefaultsKey.voipTokenUpdatedAt)
  }

  private func markIncomingCallSeenLocked(_ callId: String) -> Bool {
    let now = Date().timeIntervalSince1970
    let ttl: TimeInterval = 10 * 60
    seenIncomingCallIds = seenIncomingCallIds.filter { now - $0.value < ttl }
    if seenIncomingCallIds[callId] != nil {
      return false
    }
    seenIncomingCallIds[callId] = now
    if seenIncomingCallIds.count > 50 {
      let sorted = seenIncomingCallIds.sorted { $0.value < $1.value }
      for entry in sorted.prefix(seenIncomingCallIds.count - 50) {
        seenIncomingCallIds.removeValue(forKey: entry.key)
      }
    }
    return true
  }

  @discardableResult
  public func reportCallConnected(callId: String) -> Bool {
    stateLock.lock()
    let matchesCurrentCall = hasReportedCall && (currentCallId == callId || currentCallUuid?.uuidString == callId)
    if matchesCurrentCall {
      wasAnswered = true
    }
    stateLock.unlock()
    return matchesCurrentCall
  }

  @discardableResult
  public func reportCallEnded(callId: String, reason: String) -> Bool {
    guard let callUuid = UUID(uuidString: callId) else { return false }
    guard reason != "localEnded" else { return false }
    guard let callKitReason = callKitReasonForBridgeReason(reason) else { return false }

    // Realtime can observe the terminal state before either APNs push arrives.
    // Persist first so a delayed incoming push cannot resurrect this call. The
    // tombstone does not affect the Bool contract below.
    if let terminalEvent = terminalEventForBridgeReason(reason) {
      _ = persistTerminalTombstone(callId: callId, eventType: terminalEvent)
    }

    let providerToUse: CXProvider?
    stateLock.lock()
    let matchesCurrentCall = hasReportedCall
      && currentCallId == callId
      && currentCallUuid == callUuid
    providerToUse = matchesCurrentCall ? callProvider : nil
    if matchesCurrentCall && providerToUse != nil {
      clearCurrentCallStateLocked()
    }
    stateLock.unlock()

    guard let providerToUse else { return false }
    providerToUse.reportCall(with: callUuid, endedAt: Date(), reason: callKitReason)
    return true
  }

  private func callKitReasonForBridgeReason(_ reason: String) -> CXCallEndedReason? {
    switch reason {
    case "cancelled", "expired", "unanswered":
      return .unanswered
    case "rejected":
      return .declinedElsewhere
    case "remoteEnded":
      return .remoteEnded
    case "answeredElsewhere":
      return .answeredElsewhere
    case "failed":
      return .failed
    default:
      return nil
    }
  }

  private func terminalEventForBridgeReason(_ reason: String) -> TerminalVoipEvent? {
    switch reason {
    case "cancelled":
      return .cancelled
    case "expired":
      return .expired
    case "rejected":
      return .rejected
    case "remoteEnded":
      return .ended
    case "answeredElsewhere":
      return .answeredElsewhere
    case "unanswered":
      // Internal tombstone classification only: both missed/unanswered and
      // expired suppress a delayed incoming and map to CX .unanswered.
      return .expired
    default:
      return nil
    }
  }

  private func clearCurrentCallStateLocked() {
    let clearedCallId = currentCallId
    let clearedEventId = currentHandoffEventId
    if let clearedCallId {
      var events = loadPendingEventsLocked()
      events.removeAll {
        ($0["callId"] as? String) == clearedCallId
          && ($0["name"] as? String) == EventName.answerCall.rawValue
      }
      savePendingEventsLocked(events)
      logHandoff("state_cleared", callId: clearedCallId, eventId: clearedEventId)
    }
    hasReportedCall = false
    currentCallId = nil
    currentCallUuid = nil
    wasAnswered = false
    currentCallHasVideo = false
    callSpeakerPreference = nil
    currentCallNativeOrigin = nil
    currentCallWasVisibleBeforePush = false
    currentHandoffEventId = nil
    handoffStarted = false
    handoffCompleted = false
    UserDefaults.standard.removeObject(forKey: DefaultsKey.retainedCallState)
    audioSessionActive = false
  }

  private func outputNames(_ session: AVAudioSession) -> [String] {
    return session.currentRoute.outputs.map { $0.portType.rawValue }
  }

  private func hasExternalOutput(_ session: AVAudioSession) -> Bool {
    return session.currentRoute.outputs.contains { output in
      switch output.portType {
      case .builtInReceiver, .builtInSpeaker:
        return false
      default:
        return true
      }
    }
  }

  public func setCallSpeakerEnabled(
    callId: String,
    enabled: Bool,
    completion: @escaping ([String: Any]) -> Void
  ) {
    let session = AVAudioSession.sharedInstance()
    let beforeOutputs = outputNames(session)

    stateLock.lock()
    let callMatches = hasReportedCall && currentCallId == callId
    let sessionIsActive = audioSessionActive
    stateLock.unlock()

    func result(applied: Bool, afterOutputs: [String], errorCode: String? = nil) -> [String: Any] {
      var value: [String: Any] = [
        "applied": applied,
        "requestedSpeaker": enabled,
        "beforeOutputs": beforeOutputs,
        "afterOutputs": afterOutputs,
        "callMatches": callMatches,
        "audioSessionActive": sessionIsActive,
      ]
      if let errorCode { value["errorCode"] = errorCode }
      return value
    }

    guard callMatches else {
      completion(result(applied: false, afterOutputs: beforeOutputs, errorCode: "call_mismatch"))
      return
    }
    guard sessionIsActive else {
      completion(result(applied: false, afterOutputs: beforeOutputs, errorCode: "audio_session_inactive"))
      return
    }
    if enabled && hasExternalOutput(session) {
      completion(result(applied: false, afterOutputs: beforeOutputs, errorCode: "external_route_active"))
      return
    }

    let beforeUsesSpeaker = session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
    if enabled == beforeUsesSpeaker {
      stateLock.lock()
      if hasReportedCall && currentCallId == callId {
        callSpeakerPreference = (callId: callId, enabled: enabled)
      }
      stateLock.unlock()
      completion(result(applied: true, afterOutputs: beforeOutputs))
      return
    }

    do {
      try session.overrideOutputAudioPort(enabled ? .speaker : .none)
      func verifyRoute(attempt: Int) {
        let afterOutputs = outputNames(session)
        let usesSpeaker = session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
        let applied = enabled ? usesSpeaker : !usesSpeaker
        if applied {
          stateLock.lock()
          if hasReportedCall && currentCallId == callId {
            callSpeakerPreference = (callId: callId, enabled: enabled)
          }
          stateLock.unlock()
          completion(result(applied: true, afterOutputs: afterOutputs))
          return
        }
        guard attempt < 12 else {
          completion(result(applied: false, afterOutputs: afterOutputs, errorCode: "route_not_applied"))
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
          verifyRoute(attempt: attempt + 1)
        }
      }
      verifyRoute(attempt: 0)
    } catch {
      completion(result(
        applied: false,
        afterOutputs: outputNames(session),
        errorCode: "override_failed"
      ))
    }
  }

  private func configureAudioSessionForAnswer(callUuid: UUID) throws -> Bool {
    stateLock.lock()
    let matchesCurrentCall = hasReportedCall && currentCallUuid == callUuid
    let hasVideo = currentCallHasVideo
    stateLock.unlock()

    guard matchesCurrentCall else {
      throw NSError(domain: "OnSpaceCallKit", code: 3, userInfo: [
        NSLocalizedDescriptionKey: "CallKit answer does not match the active call",
      ])
    }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: hasVideo ? .videoChat : .voiceChat, options: [
      .allowBluetooth,
    ])
    // CallKit owns setActive for incoming calls. Agora is restricted from
    // reconfiguring this session while it is used by the matching call.
    return hasVideo
  }

  private func loadTerminalTombstonesLocked(now: TimeInterval = Date().timeIntervalSince1970 * 1000) -> [[String: Any]] {
    let defaults = UserDefaults.standard
    let container = defaults.dictionary(forKey: DefaultsKey.terminalTombstones)
    let version = container?["version"] as? Int
    let rawEntries = container?["entries"] as? [[String: Any]] ?? []
    let validEntries = version == TerminalTombstonePolicy.version
      ? rawEntries.filter { entry in
          guard let callId = entry["callId"] as? String,
                UUID(uuidString: callId) != nil,
                let eventType = entry["eventType"] as? String,
                TerminalVoipEvent(rawValue: eventType) != nil,
                let timestamp = entry["timestamp"] as? TimeInterval else {
            return false
          }
          return now >= timestamp && now - timestamp <= TerminalTombstonePolicy.ttlMilliseconds
        }
      : []

    if version != TerminalTombstonePolicy.version || validEntries.count != rawEntries.count {
      saveTerminalTombstonesLocked(validEntries)
    }
    return validEntries
  }

  private func saveTerminalTombstonesLocked(_ entries: [[String: Any]]) {
    UserDefaults.standard.set([
      "version": TerminalTombstonePolicy.version,
      "entries": entries,
    ], forKey: DefaultsKey.terminalTombstones)
  }

  @discardableResult
  private func persistTerminalTombstone(callId: String, eventType: TerminalVoipEvent) -> Bool {
    let timestamp = Date().timeIntervalSince1970 * 1000
    stateLock.lock()
    var entries = loadTerminalTombstonesLocked(now: timestamp)
    entries.removeAll { ($0["callId"] as? String) == callId }
    entries.append([
      "callId": callId,
      "eventType": eventType.rawValue,
      "timestamp": timestamp,
    ])
    if entries.count > TerminalTombstonePolicy.maxEntries {
      entries.removeFirst(entries.count - TerminalTombstonePolicy.maxEntries)
    }
    saveTerminalTombstonesLocked(entries)
    let synchronized = UserDefaults.standard.synchronize()
    let persisted = loadTerminalTombstonesLocked(now: timestamp).contains {
      ($0["callId"] as? String) == callId
    }
    stateLock.unlock()
    return synchronized && persisted
  }

  private func hasTerminalTombstone(callId: String) -> Bool {
    return terminalTombstoneEvent(callId: callId) != nil
  }

  private func terminalTombstoneEvent(callId: String) -> TerminalVoipEvent? {
    stateLock.lock()
    let eventType = loadTerminalTombstonesLocked().first {
      ($0["callId"] as? String) == callId
    }?["eventType"] as? String
    stateLock.unlock()
    guard let eventType else { return nil }
    return TerminalVoipEvent(rawValue: eventType)
  }

  @discardableResult
  private func endMatchingCall(callId: String, callUuid: UUID, reason: CXCallEndedReason) -> Bool {
    let providerToUse: CXProvider?
    stateLock.lock()
    let matchesCurrentCall = hasReportedCall
      && currentCallId == callId
      && currentCallUuid == callUuid
    providerToUse = matchesCurrentCall ? callProvider : nil
    if matchesCurrentCall && providerToUse != nil {
      clearCurrentCallStateLocked()
    }
    stateLock.unlock()

    guard let providerToUse else { return false }
    providerToUse.reportCall(with: callUuid, endedAt: Date(), reason: reason)
    return true
  }

  public func requestEndCall(callId: String, completion: @escaping ([String: Any]) -> Void) {
    let uuidToEnd: UUID?
    stateLock.lock()
    if currentCallId == callId || currentCallUuid?.uuidString == callId {
      uuidToEnd = currentCallUuid
    } else {
      uuidToEnd = UUID(uuidString: callId)
    }
    stateLock.unlock()

    guard let uuidToEnd else {
      completion(["success": false, "error": "call_not_found"])
      return
    }

    let endAction = CXEndCallAction(call: uuidToEnd)
    let transaction = CXTransaction(action: endAction)
    callController.request(transaction) { error in
      if let error {
        completion(["success": false, "error": error.localizedDescription])
        return
      }
      completion(["success": true])
    }
  }
}

// MARK: - PKPushRegistryDelegate

extension OnSpaceCallCoordinator: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    guard type == .voIP else { return }
    let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    guard !hex.isEmpty else { return }

    stateLock.lock()
    let didChange = lastVoipTokenHex != hex
    persistVoipTokenLocked(hex)
    stateLock.unlock()

    // Never log the full token — only its length, so a rotation is visible
    // in logs without leaking a credential that could be used to trigger a
    // VoIP push against this device.
    print("[OnSpaceCallKit] didUpdatePushCredentials called, token length=\(hex.count)")
    if didChange {
      emit(.voipTokenUpdated, ["token": hex])
    }
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    guard type == .voIP else { return }
    stateLock.lock()
    clearPersistedVoipTokenLocked()
    stateLock.unlock()
    print("[OnSpaceCallKit] didInvalidatePushToken called")
    emit(.voipTokenInvalidated)
  }

  /// IOS-A: structure only. There is no APNs VoIP backend yet (that is
  /// IOS-B), so this will not fire from a real push today — but the
  /// contract below is what IOS-B must rely on:
  ///   - only handle type .voIP;
  ///   - call `completion` exactly once;
  ///   - never wait on JavaScript or query Supabase before reporting to
  ///     CallKit — report immediately, emit the JS event after;
  ///   - parse call_id / caller_name / call_type / has_video only, never
  ///     channel_name, an Agora token, or any other secret.
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let completionLock = NSLock()
    var didFinish = false
    let finishOnce: () -> Void = {
      completionLock.lock()
      guard !didFinish else {
        completionLock.unlock()
        return
      }
      didFinish = true
      completionLock.unlock()
      completion()
    }

    guard type == .voIP else {
      finishOnce()
      return
    }

    // Capture the pre-push truth before CallKit can wake/foreground JS.
    // An attached emitter proves the process was already alive; without one,
    // a non-active launch is a PushKit cold start.
    let applicationStateBeforePush = UIApplication.shared.applicationState
    stateLock.lock()
    let hadJavaScriptBeforePush = eventEmitter != nil
    stateLock.unlock()
    let wasVisibleBeforePush = applicationStateBeforePush == .active
    let nativeOrigin = wasVisibleBeforePush
      ? "foreground"
      : (hadJavaScriptBeforePush ? "background" : "cold_start")

    let dict = payload.dictionaryPayload
    let eventType = (dict["type"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let eventType, eventType != "incoming_call" {
      if let terminalEvent = TerminalVoipEvent(rawValue: eventType) {
        handleTerminalVoipPush(dict, event: terminalEvent, finishOnce: finishOnce)
      } else {
#if DEBUG
        print("[OnSpaceCallKit] ignored unknown VoIP push type")
#endif
        finishOnce()
      }
      return
    }

    let callIdRaw = dict["call_id"] as? String
    let callerName = (dict["caller_name"] as? String) ?? "OnSpace"
    let callType = (dict["call_type"] as? String) ?? "audio"
    let hasVideo = (dict["has_video"] as? Bool) ?? (callType == "video")

    // completion() must fire exactly once no matter what. Resolve the
    // provider into a non-optional local first: `callProvider` can only be
    // nil if start() never ran, which cannot happen once PKPushRegistry's
    // delegate is set (start() sets both in the same call) — but guard it
    // explicitly anyway rather than silently dropping completion() behind
    // optional chaining if that invariant is ever violated.
    guard let provider = callProvider else {
      print("[OnSpaceCallKit] didReceiveIncomingPushWith fired with no CXProvider — this should be unreachable")
      finishOnce()
      return
    }

    guard let callIdRaw, let callUUID = UUID(uuidString: callIdRaw) else {
      // Malformed/missing call_id: Apple still requires reporting *a* call
      // to CallKit before the completion handler returns, or iOS will
      // eventually revoke this app's ability to receive VoIP pushes. Report
      // a call and end it immediately rather than silently dropping it.
      let fallbackUUID = UUID()
      let update = CXCallUpdate()
      update.localizedCallerName = callerName
      update.hasVideo = hasVideo
      update.supportsHolding = false
      update.supportsGrouping = false
      update.supportsUngrouping = false
      update.supportsDTMF = false
      provider.reportNewIncomingCall(with: fallbackUUID, update: update) { [weak self] _ in
        self?.callProvider?.reportCall(with: fallbackUUID, endedAt: nil, reason: .failed)
        finishOnce()
      }
      return
    }

    if hasTerminalTombstone(callId: callIdRaw) {
      finishOnce()
      return
    }

    stateLock.lock()
    let shouldReportIncoming = markIncomingCallSeenLocked(callIdRaw)
    stateLock.unlock()
    if !shouldReportIncoming {
      finishOnce()
      return
    }

    let update = CXCallUpdate()
    update.localizedCallerName = callerName
    update.hasVideo = hasVideo
    update.remoteHandle = CXHandle(type: .generic, value: callerName)
    update.supportsHolding = false
    update.supportsGrouping = false
    update.supportsUngrouping = false
    update.supportsDTMF = false

    provider.reportNewIncomingCall(with: callUUID, update: update) { [weak self] error in
      guard let self else {
        finishOnce()
        return
      }
      if let error {
        print("[OnSpaceCallKit] reportNewIncomingCall error: \(error.localizedDescription)")
      }
      if error == nil, let terminalEvent = terminalTombstoneEvent(callId: callIdRaw) {
        provider.reportCall(with: callUUID, endedAt: Date(), reason: terminalEvent.callKitReason)
        finishOnce()
        return
      }
      if error == nil {
        stateLock.lock()
        currentCallId = callIdRaw
        currentCallUuid = callUUID
        hasReportedCall = true
        wasAnswered = false
        currentCallHasVideo = hasVideo
        callSpeakerPreference = (callId: callIdRaw, enabled: hasVideo)
         currentCallNativeOrigin = nativeOrigin
         currentCallWasVisibleBeforePush = wasVisibleBeforePush
         currentHandoffEventId = nil
         handoffStarted = false
         handoffCompleted = false
         persistRetainedCallStateLocked()
         stateLock.unlock()
      }
      liveEmitCallKitEvent(.incomingCall, callId: callIdRaw, callUuid: callUUID, payload: [
        "callerName": callerName,
        "callType": callType,
        "hasVideo": hasVideo,
        "nativeOrigin": nativeOrigin,
        "wasAppVisibleBeforeVoipPush": wasVisibleBeforePush,
      ])
      finishOnce()
    }
  }

  private func handleTerminalVoipPush(
    _ dict: [AnyHashable: Any],
    event: TerminalVoipEvent,
    finishOnce: @escaping () -> Void
  ) {
    guard let callId = dict["call_id"] as? String,
          let callUuid = UUID(uuidString: callId),
          let status = dict["status"] as? String, !status.isEmpty,
          let reason = dict["reason"] as? String, !reason.isEmpty,
          let timestamp = dict["timestamp"] as? String, !timestamp.isEmpty else {
#if DEBUG
      print("[OnSpaceCallKit] ignored invalid terminal VoIP push")
#endif
      finishOnce()
      return
    }

    _ = persistTerminalTombstone(callId: callId, eventType: event)
    _ = endMatchingCall(callId: callId, callUuid: callUuid, reason: event.callKitReason)
    finishOnce()
  }
}

// MARK: - CXProviderDelegate

extension OnSpaceCallCoordinator: CXProviderDelegate {
  public func providerDidReset(_ provider: CXProvider) {
    let identity = currentCallIdentity()
    stateLock.lock()
    audioSessionActive = false
    clearCurrentCallStateLocked()
    stateLock.unlock()
    liveEmitNullableCallKitEvent(.providerReset, callId: identity?.callId, callUuid: identity?.callUuid)
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    let resolvedCallId = callId(for: action.callUUID)
    let hasVideo: Bool
    do {
      hasVideo = try configureAudioSessionForAnswer(callUuid: action.callUUID)
    } catch {
      print("[OnSpaceCallKit] unable to configure call audio session")
      action.fail()
      return
    }
    let event = makeCallKitEvent(.answerCall, callId: resolvedCallId, callUuid: action.callUUID, payload: [
      "callType": hasVideo ? "video" : "audio",
      "nativeOrigin": currentCallNativeOrigin ?? "background",
    ])
    let persistedEvent: [String: Any]
    do {
      persistedEvent = try persistPendingEvent(event)
    } catch {
      print("[OnSpaceCallKit] failed to persist answerCall event: \(error.localizedDescription)")
      action.fail()
      return
    }
    stateLock.lock()
    currentCallId = resolvedCallId
    currentCallUuid = action.callUUID
    hasReportedCall = true
    wasAnswered = true
    currentCallHasVideo = hasVideo
    currentHandoffEventId = persistedEvent["eventId"] as? String
    handoffStarted = false
    handoffCompleted = false
    persistRetainedCallStateLocked()
    stateLock.unlock()
    logHandoff("answer_queued", callId: resolvedCallId, eventId: currentHandoffEventId)
    emit(.answerCall, persistedEvent)
    logHandoff("answer_emitted", callId: resolvedCallId, eventId: currentHandoffEventId)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    let resolvedCallId = callId(for: action.callUUID)
    stateLock.lock()
    let answered = wasAnswered
    stateLock.unlock()
    let event = makeCallKitEvent(.endCall, callId: resolvedCallId, callUuid: action.callUUID, payload: [
      "wasAnswered": answered,
    ])
    let persistedEvent: [String: Any]
    do {
      persistedEvent = try persistPendingEvent(event)
    } catch {
      print("[OnSpaceCallKit] failed to persist endCall event: \(error.localizedDescription)")
      action.fail()
      return
    }
    stateLock.lock()
    if currentCallUuid == action.callUUID && currentCallId == resolvedCallId {
      clearCurrentCallStateLocked()
    }
    stateLock.unlock()
    emit(.endCall, persistedEvent)
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    let resolvedCallId = callId(for: action.callUUID)
    liveEmitCallKitEvent(.muteCall, callId: resolvedCallId, callUuid: action.callUUID, payload: [
      "muted": action.isMuted,
    ])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // CallKit already activated this session; never call setActive here.
    stateLock.lock()
    audioSessionActive = true
    let preference = callSpeakerPreference
    stateLock.unlock()
    if let preference {
      setCallSpeakerEnabled(callId: preference.callId, enabled: preference.enabled) { _ in }
    }
    let identity = currentCallIdentity()
    liveEmitNullableCallKitEvent(.audioSessionActivated, callId: identity?.callId, callUuid: identity?.callUuid, payload: [
      "active": true,
    ])
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    stateLock.lock()
    audioSessionActive = false
    stateLock.unlock()
    let identity = currentCallIdentity()
    liveEmitNullableCallKitEvent(.audioSessionDeactivated, callId: identity?.callId, callUuid: identity?.callUuid, payload: [
      "active": false,
    ])
  }
}
