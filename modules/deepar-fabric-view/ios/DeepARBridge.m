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
  DeepAR           *_deepAR;
  CameraController *_cameraController;
  UIView           *_renderView;
}

@synthesize onInitialized, onScreenshotTaken, onVideoRecordingFinished, onCaptureError;

- (void)dealloc { [self shutdown]; }

- (nullable UIView *)createRenderViewWithApiKey:(NSString *)apiKey
                                          frame:(CGRect)frame
                                 cameraPosition:(NSString *)cameraPosition {
  if (_renderView) return _renderView;

  _deepAR = [[DeepAR alloc] init];
  _deepAR.delegate = self;
  [_deepAR setLicenseKey:apiKey];

  _renderView = [_deepAR createARViewWithFrame:frame];
  if (!_renderView) {
    NSLog(@"[DeepARNative] createARViewWithFrame returned nil frame=%@", NSStringFromCGRect(frame));
    return nil;
  }

  _cameraController = [[CameraController alloc] init];
  _cameraController.deepAR = _deepAR;
  _cameraController.position = [self _positionFromString:cameraPosition];
  [_cameraController startCamera];
  return _renderView;
}

- (void)setCameraPosition:(NSString *)cameraPosition {
  if (_cameraController) _cameraController.position = [self _positionFromString:cameraPosition];
}

- (void)shutdown {
  [_cameraController stopCamera];
  _cameraController = nil;
  [_deepAR shutdown];
  _deepAR = nil;
  [_renderView removeFromSuperview];
  _renderView = nil;
}

- (void)switchEffect:(NSString *)path {
  if (!_deepAR) return;
  if (!path.length) { [self clearEffect]; return; }
  [_deepAR switchEffectWithSlot:@"mask" path:path];
}

- (void)clearEffect {
  if (_deepAR) [_deepAR switchEffectWithSlot:@"mask" path:nil];
}

- (void)takeScreenshot {
  NSLog(@"[DeepARNativeCapture] takeScreenshot");
  if (!_deepAR || !_deepAR.renderingInitialized) {
    NSLog(@"[DeepARNativeCapture] takeScreenshot SKIP — not ready");
    if (self.onCaptureError) self.onCaptureError(@"DeepAR not ready");
    return;
  }
  [_deepAR takeScreenshot];
}

- (void)startVideoRecording {
  NSLog(@"[DeepARNativeCapture] startVideoRecording");
  if (!_deepAR || !_deepAR.renderingInitialized) {
    NSLog(@"[DeepARNativeCapture] startVideoRecording SKIP — not ready");
    if (self.onCaptureError) self.onCaptureError(@"DeepAR not ready");
    return;
  }
  int w = (int)MAX(_renderView.bounds.size.width, 1.0);
  int h = (int)MAX(_renderView.bounds.size.height, 1.0);
  if ([_deepAR respondsToSelector:@selector(startVideoRecordingWithOutputWidth:outputHeight:)]) {
    [_deepAR startVideoRecordingWithOutputWidth:w outputHeight:h];
  } else if ([_deepAR respondsToSelector:@selector(startVideoRecording)]) {
    [_deepAR startVideoRecording];
  } else {
    NSLog(@"[DeepARNativeCapture] no startVideoRecording selector found");
    if (self.onCaptureError) self.onCaptureError(@"startVideoRecording unavailable");
  }
}

- (void)finishVideoRecording {
  NSLog(@"[DeepARNativeCapture] finishVideoRecording");
  if (_deepAR) [_deepAR finishVideoRecording];
}

- (AVCaptureDevicePosition)_positionFromString:(NSString *)pos {
  return [pos isEqualToString:@"back"] ? AVCaptureDevicePositionBack : AVCaptureDevicePositionFront;
}

// MARK: - DeepARDelegate

- (void)didInitialize {
  NSLog(@"[DeepARNative] didInitialize");
  dispatch_async(dispatch_get_main_queue(), ^{ if (self.onInitialized) self.onInitialized(); });
}

- (void)didSwitchEffect:(NSString *)slot {
  NSLog(@"[DeepARNative] didSwitchEffect slot=%@", slot);
}

- (void)onErrorWithCode:(ARErrorType)code error:(NSString *)error {
  NSLog(@"[DeepARNative] onError code=%ld %@", (long)code, error);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.onCaptureError) self.onCaptureError(error ?: @"DeepAR native error");
  });
}

- (void)didFinishShutdown {
  NSLog(@"[DeepARNative] didFinishShutdown");
}

- (void)didTakeScreenshot:(UIImage *)screenshot {
  NSLog(@"[DeepARNativeCapture] didTakeScreenshot size=%@", NSStringFromCGSize(screenshot.size));
  NSString *name   = [NSString stringWithFormat:@"deepar_%lld.jpg",
                      (long long)([[NSDate date] timeIntervalSince1970] * 1000)];
  NSString *path   = [NSTemporaryDirectory() stringByAppendingPathComponent:name];
  NSData   *jpeg   = UIImageJPEGRepresentation(screenshot, 0.92);
  if (!jpeg) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.onCaptureError) self.onCaptureError(@"JPEG encode failed");
    });
    return;
  }
  NSError *err = nil;
  [jpeg writeToFile:path options:NSDataWritingAtomic error:&err];
  if (err) {
    NSLog(@"[DeepARNativeCapture] write error: %@", err.localizedDescription);
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.onCaptureError) self.onCaptureError(@"Write failed");
    });
    return;
  }
  NSString *uri = [@"file://" stringByAppendingString:path];
  NSLog(@"[DeepARNativeCapture] screenshot uri=%@", uri);
  dispatch_async(dispatch_get_main_queue(), ^{ if (self.onScreenshotTaken) self.onScreenshotTaken(uri); });
}

- (void)didStartVideoRecording {
  NSLog(@"[DeepARNativeCapture] didStartVideoRecording");
}

- (void)didFinishVideoRecording:(NSString *)videoFilePath {
  NSLog(@"[DeepARNativeCapture] didFinishVideoRecording path=%@", videoFilePath);
  NSString *uri = videoFilePath;
  if (!uri.length) {
    NSLog(@"[DeepARNativeCapture] video path empty");
    dispatch_async(dispatch_get_main_queue(), ^{
      if (self.onCaptureError) self.onCaptureError(@"Video recording finished without a file path");
    });
    return;
  }
  if (![uri hasPrefix:@"file://"]) uri = [@"file://" stringByAppendingString:uri];
  NSLog(@"[DeepARNativeCapture] video uri=%@", uri);
  dispatch_async(dispatch_get_main_queue(), ^{ if (self.onVideoRecordingFinished) self.onVideoRecordingFinished(uri); });
}

@end
