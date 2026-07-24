import ExpoModulesCore

/// JS-facing bridge for OnSpaceCallCoordinator. IOS-A only: exposes the
/// PushKit VoIP token and re-emits raw CallKit action events. Does not
/// implement any call/Agora/AVAudioSession logic itself — see
/// OnSpaceCallCoordinator for what is and isn't wired up in this phase.
public final class OnSpaceCallKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OnSpaceCallKit")

    Property("isAvailable") { () -> Bool in
      true
    }

    Events(
      "voipTokenUpdated",
      "voipTokenInvalidated",
      "incomingCall",
      "answerCall",
      "endCall",
      "muteCall",
      "audioSessionActivated",
      "audioSessionDeactivated",
      "providerReset"
    )

    OnStartObserving {
      OnSpaceCallCoordinator.shared.eventEmitter = { [weak self] name, body in
        self?.sendEvent(name, body)
      }
    }

    OnStopObserving {
      OnSpaceCallCoordinator.shared.eventEmitter = nil
    }

    Function("getVoipToken") { () -> String? in
      OnSpaceCallCoordinator.shared.start()
      return OnSpaceCallCoordinator.shared.currentVoipTokenHex
    }

    // OnSpaceCallCoordinator.shared.start() already runs from
    // OnSpaceCallAppDelegateSubscriber.subscriberDidRegister(), before JS
    // ever loads. This is only a safety net for the (should-not-happen)
    // case where that hook doesn't fire — start() is idempotent either way.
    Function("ensureStarted") {
      OnSpaceCallCoordinator.shared.start()
    }

    Function("start") {
      OnSpaceCallCoordinator.shared.start()
    }

    Function("getPendingEvents") { () -> [[String: Any]] in
      return OnSpaceCallCoordinator.shared.pendingEventDictionaries()
    }

    Function("consumePendingEvent") { (eventId: String) -> Bool in
      return OnSpaceCallCoordinator.shared.consumePendingEvent(eventId: eventId)
    }

    Function("markCallHandoffStarted") { (callId: String, eventId: String) -> Bool in
      return OnSpaceCallCoordinator.shared.markCallHandoffStarted(callId: callId, eventId: eventId)
    }

    Function("markCallHandoffCompleted") { (callId: String, eventId: String) -> Bool in
      return OnSpaceCallCoordinator.shared.markCallHandoffCompleted(callId: callId, eventId: eventId)
    }

    Function("reportCallConnected") { (callId: String) -> Bool in
      return OnSpaceCallCoordinator.shared.reportCallConnected(callId: callId)
    }

    Function("reportCallEnded") { (callId: String, reason: String) -> Bool in
      return OnSpaceCallCoordinator.shared.reportCallEnded(callId: callId, reason: reason)
    }

    AsyncFunction("setCallSpeakerEnabled") { (callId: String, enabled: Bool) async -> [String: Any] in
      return await withCheckedContinuation { continuation in
        OnSpaceCallCoordinator.shared.setCallSpeakerEnabled(callId: callId, enabled: enabled) { result in
          continuation.resume(returning: result)
        }
      }
    }

    AsyncFunction("requestEndCall") { (callId: String) async -> [String: Any] in
      return await withCheckedContinuation { continuation in
        OnSpaceCallCoordinator.shared.requestEndCall(callId: callId) { result in
          continuation.resume(returning: result)
        }
      }
    }

    Function("getNativeState") { () -> [String: Any] in
      return OnSpaceCallCoordinator.shared.nativeState()
    }
  }
}
