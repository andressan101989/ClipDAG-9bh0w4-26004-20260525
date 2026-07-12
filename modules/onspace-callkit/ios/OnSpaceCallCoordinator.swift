import Foundation
import PushKit
import CallKit
import AVFoundation

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
///   - configure AVAudioSession (setCategory/setMode/setActive/output routing);
///   - do anything with speaker/Bluetooth;
///   - add a custom ringtone.
/// Those all belong to IOS-B/C/D. This class only owns the native
/// PushKit/CallKit plumbing and re-emits raw events to JS.
public final class OnSpaceCallCoordinator: NSObject {
  public static let shared = OnSpaceCallCoordinator()

  private enum DefaultsKey {
    static let voipToken = "com.clipdag.onspace.callkit.voipToken"
    static let voipTokenUpdatedAt = "com.clipdag.onspace.callkit.voipTokenUpdatedAt"
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
  private var lastVoipTokenHex: String?
  private var lastVoipTokenUpdatedAt: TimeInterval?
  private var pendingEvents: [(name: String, body: [String: Any])] = []
  private var seenIncomingCallIds: [String: TimeInterval] = [:]

  private override init() {
    super.init()
    loadPersistedVoipTokenLocked()
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
    loadPersistedVoipTokenLocked()
    return [
      "started": started,
      "registryConfigured": registryConfigured,
      "hasVoipToken": !(lastVoipTokenHex ?? "").isEmpty,
      "voipTokenLength": lastVoipTokenHex?.count ?? 0,
      "pendingEventCount": pendingEvents.count,
      "lastVoipTokenUpdatedAt": lastVoipTokenUpdatedAt.map { $0 as Any } ?? NSNull(),
    ]
  }

  public func pendingEventDictionaries() -> [[String: Any]] {
    stateLock.lock()
    defer { stateLock.unlock() }
    return pendingEvents.map { ["name": $0.name, "body": $0.body] }
  }

  public func consumePendingEventDictionaries() -> [[String: Any]] {
    stateLock.lock()
    let queued = pendingEvents.map { ["name": $0.name, "body": $0.body] }
    pendingEvents.removeAll()
    stateLock.unlock()
    return queued
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
    guard type == .voIP else {
      completion()
      return
    }

    let dict = payload.dictionaryPayload
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
      completion()
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
        completion()
      }
      return
    }

    stateLock.lock()
    let shouldReportIncoming = markIncomingCallSeenLocked(callIdRaw)
    stateLock.unlock()
    if !shouldReportIncoming {
      completion()
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
      if let error {
        print("[OnSpaceCallKit] reportNewIncomingCall error: \(error.localizedDescription)")
      }
      self?.emit(.incomingCall, [
        "callId": callIdRaw,
        "callerName": callerName,
        "callType": callType,
        "hasVideo": hasVideo,
      ])
      completion()
    }
  }
}

// MARK: - CXProviderDelegate

extension OnSpaceCallCoordinator: CXProviderDelegate {
  public func providerDidReset(_ provider: CXProvider) {
    emit(.providerReset)
  }

  public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
    // IOS-A: acknowledge the native action and emit it to JS only. Joining
    // Agora / validating against the backend belongs to IOS-C/D.
    emit(.answerCall, ["callId": action.callUUID.uuidString])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
    emit(.endCall, ["callId": action.callUUID.uuidString])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
    emit(.muteCall, ["callId": action.callUUID.uuidString, "muted": action.isMuted])
    action.fulfill()
  }

  public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
    // Strict IOS-A rule: no setCategory/setMode/setActive/output routing
    // here — only emit. Real audio-session coordination is IOS-C.
    emit(.audioSessionActivated)
  }

  public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
    emit(.audioSessionDeactivated)
  }
}
