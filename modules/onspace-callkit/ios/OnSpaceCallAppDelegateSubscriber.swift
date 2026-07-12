import ExpoModulesCore

/// Starts OnSpaceCallCoordinator as early as possible in the app lifecycle.
///
/// `subscriberDidRegister()` is documented on
/// `ExpoAppDelegateSubscriberProtocol` to run before any other
/// `UIApplicationDelegate` function when the subscriber is loaded from the
/// generated modules provider — i.e. before `AppDelegate.application(_:
/// didFinishLaunchingWithOptions:)` starts React Native. That is what lets
/// a cold-start VoIP push register the PKPushRegistry delegate before JS
/// exists.
///
/// Per IOS-A instructions, AppDelegate.swift itself is not modified — this
/// subscriber is the sole entry point. `OnSpaceCallCoordinator.start()` is
/// idempotent, so this being called more than once (or JS later calling the
/// `ensureStarted()` safety net) is harmless.
public class OnSpaceCallAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func subscriberDidRegister() {
    print("[OnSpaceCallKit] subscriber subscriberDidRegister")
    OnSpaceCallCoordinator.shared.start()
  }

  // Diagnostic + defense-in-depth only: subscriberDidRegister() above is the
  // real, verified-earliest trigger (fires from EXAppDelegatesLoader's
  // Objective-C +load, before AppDelegate.didFinishLaunchingWithOptions).
  // start() is idempotent, so these two extra call sites cannot cause a
  // second PKPushRegistry/CXProvider — they only give us log visibility (and
  // a harmless fallback) if subscriberDidRegister ever unexpectedly doesn't
  // fire on a given launch.
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    print("[OnSpaceCallKit] subscriber didFinishLaunching")
    OnSpaceCallCoordinator.shared.start()
    return true
  }

  public func applicationDidBecomeActive(_ application: UIApplication) {
    print("[OnSpaceCallKit] subscriber applicationDidBecomeActive")
    OnSpaceCallCoordinator.shared.start()
  }
}
