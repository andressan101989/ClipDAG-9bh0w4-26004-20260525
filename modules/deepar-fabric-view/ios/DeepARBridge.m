#import "DeepARBridge.h"

#if __has_include(<DeepAR/DeepAR.h>)
#import <DeepAR/DeepAR.h>
#import <DeepAR/CameraController.h>
#elif __has_include("DeepAR.h")
#import "DeepAR.h"
#import "CameraController.h"
#else
#error "DeepAR headers not found"
#endif

#import <AVFoundation/AVFoundation.h>

@implementation DeepARBridge {
  DeepAR *_deepAR;
  CameraController *_cameraController;
  UIView *_renderView;
}

- (void)dealloc {
  [self shutdown];
}

- (nullable UIView *)createRenderViewWithApiKey:(NSString *)apiKey
                                          frame:(CGRect)frame
                                 cameraPosition:(NSString *)cameraPosition {
  if (_renderView != nil) {
    return _renderView;
  }

  _deepAR = [[DeepAR alloc] init];
  _deepAR.delegate = self;

  NSString *keyPrefix = apiKey.length >= 8 ? [apiKey substringToIndex:8] : apiKey;
  NSLog(@"[DeepARNative] bridge key prefix %@", keyPrefix);
  [_deepAR setLicenseKey:apiKey];

  _renderView = [_deepAR createARViewWithFrame:frame];
  if (_renderView == nil) {
    NSLog(@"[DeepARNative] createARViewWithFrame returned nil — frame=%@", NSStringFromCGRect(frame));
    return nil;
  }
  NSLog(@"[DeepARNative] createARViewWithFrame OK frame=%@", NSStringFromCGRect(frame));

  _cameraController = [[CameraController alloc] init];
  _cameraController.deepAR = _deepAR;
  _cameraController.position = [self capturePositionFromString:cameraPosition];
  [_cameraController startCamera];
  NSLog(@"[DeepARNative] CameraController startCamera called position=%@", cameraPosition);

  return _renderView;
}

- (void)switchEffect:(NSString *)path {
  NSLog(@"[DeepARNative] switchEffect received path=%@", path);

  if (_deepAR == nil) {
    NSLog(@"[DeepARNative] switchEffect SKIP — _deepAR is nil");
    return;
  }

  NSLog(@"[DeepARNative] switchEffect renderingInitialized=%d", _deepAR.renderingInitialized);

  if (path == nil || path.length == 0) {
    NSLog(@"[DeepARNative] switchEffect path empty/nil — delegating to clearEffect");
    [self clearEffect];
    return;
  }

  BOOL fileExists = [[NSFileManager defaultManager] fileExistsAtPath:path];
  NSLog(@"[DeepARNative] switchEffect fileExists=%d", fileExists);

  if (fileExists) {
    NSError *attrError = nil;
    NSDictionary *attrs = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:&attrError];
    if (attrError) {
      NSLog(@"[DeepARNative] switchEffect fileAttributes error=%@", attrError.localizedDescription);
    } else {
      NSLog(@"[DeepARNative] switchEffect fileSize=%llu bytes", [attrs fileSize]);
    }
    // Check if the path is a directory (some effects ship as bundles)
    BOOL isDir = NO;
    [[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&isDir];
    NSLog(@"[DeepARNative] switchEffect isDirectory=%d", isDir);
  } else {
    NSLog(@"[DeepARNative] switchEffect FILE NOT FOUND at path — effect will not load");
  }

  NSLog(@"[DeepARNative] calling [_deepAR switchEffectWithSlot:mask path:%@]", path);
  [_deepAR switchEffectWithSlot:@"mask" path:path];
  NSLog(@"[DeepARNative] switchEffectWithSlot returned — result arrives via didSwitchEffect: delegate");
}

- (void)clearEffect {
  NSLog(@"[DeepARNative] clearEffect called _deepAR=%@", _deepAR ? @"set" : @"nil");
  if (_deepAR == nil) {
    return;
  }
  [_deepAR switchEffectWithSlot:@"mask" path:nil];
}

- (void)setCameraPosition:(NSString *)cameraPosition {
  if (_cameraController == nil) {
    return;
  }
  _cameraController.position = [self capturePositionFromString:cameraPosition];
}

- (void)shutdown {
  NSLog(@"[DeepARNative] bridge shutdown");
  [_cameraController stopCamera];
  _cameraController = nil;

  [_deepAR shutdown];
  _deepAR = nil;

  [_renderView removeFromSuperview];
  _renderView = nil;
}

- (AVCaptureDevicePosition)capturePositionFromString:(NSString *)cameraPosition {
  return [cameraPosition isEqualToString:@"back"]
    ? AVCaptureDevicePositionBack
    : AVCaptureDevicePositionFront;
}

// MARK: - DeepARDelegate

- (void)didInitialize {
  NSLog(@"[DeepARNative] delegate didInitialize — renderingInitialized=%d visionInitialized=%d",
        _deepAR.renderingInitialized, _deepAR.visionInitialized);
}

- (void)didSwitchEffect:(NSString *)slot {
  NSLog(@"[DeepARNative] delegate didSwitchEffect slot=%@  ← effect loaded successfully", slot);
}

- (void)onErrorWithCode:(ARErrorType)code error:(NSString *)error {
  NSLog(@"[DeepARNative] delegate onError code=%ld error=%@", (long)code, error);
}

- (void)didFinishShutdown {
  NSLog(@"[DeepARNative] delegate didFinishShutdown");
}

@end
