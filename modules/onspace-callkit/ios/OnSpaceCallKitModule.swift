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

    Function("consumePendingEvents") { () -> [[String: Any]] in
      return OnSpaceCallCoordinator.shared.consumePendingEventDictionaries()
    }

    Function("getNativeState") { () -> [String: Any] in
      return OnSpaceCallCoordinator.shared.nativeState()
    }
  }
}
