#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#if __has_include(<DeepAR/DeepAR.h>)
#import <DeepAR/DeepAR.h>
#elif __has_include("DeepAR.h")
#import "DeepAR.h"
#else
#error "DeepAR headers not found"
#endif

NS_ASSUME_NONNULL_BEGIN

@interface DeepARBridge : NSObject <DeepARDelegate>

// ── Lifecycle ──────────────────────────────────────────────────────────────────
- (nullable UIView *)createRenderViewWithApiKey:(NSString *)apiKey
                                          frame:(CGRect)frame
                                 cameraPosition:(NSString *)cameraPosition;
- (void)setCameraPosition:(NSString *)cameraPosition;
- (void)shutdown;

// ── Effects ───────────────────────────────────────────────────────────────────
- (void)switchEffect:(NSString *)path;
- (void)clearEffect;

// ── Capture ───────────────────────────────────────────────────────────────────
- (void)takeScreenshot;
- (void)startVideoRecording;
- (void)finishVideoRecording;

// ── Callbacks (set by DeepARFabricView before any capture call) ───────────────
@property (nonatomic, copy, nullable) void (^onInitialized)(void);
@property (nonatomic, copy, nullable) void (^onScreenshotTaken)(NSString *uri);
@property (nonatomic, copy, nullable) void (^onVideoRecordingFinished)(NSString *uri);
@property (nonatomic, copy, nullable) void (^onCaptureError)(NSString *error);

@end

NS_ASSUME_NONNULL_END
