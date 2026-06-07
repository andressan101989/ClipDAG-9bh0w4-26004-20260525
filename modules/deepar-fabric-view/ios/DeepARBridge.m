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
  [_deepAR setLicenseKey:apiKey];

  _renderView = [_deepAR createARViewWithFrame:frame];
  if (_renderView == nil) {
    return nil;
  }

  _cameraController = [[CameraController alloc] init];
  _cameraController.deepAR = _deepAR;
  _cameraController.position = [self capturePositionFromString:cameraPosition];
  [_cameraController startCamera];

  return _renderView;
}

- (void)switchEffect:(NSString *)path {
  if (_deepAR == nil) {
    return;
  }

  if (path == nil || path.length == 0) {
    [self clearEffect];
    return;
  }

  [_deepAR switchEffectWithSlot:@"mask" path:path];
}

- (void)clearEffect {
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

@end
