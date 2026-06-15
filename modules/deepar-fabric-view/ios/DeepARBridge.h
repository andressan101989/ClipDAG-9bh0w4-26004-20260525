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

/** Called when didTakeScreenshot: fires with the captured UIImage. */
@property (nonatomic, copy, nullable) void (^onScreenshotTaken)(UIImage *screenshot);
/** Called when didFinishVideoRecording: fires with the temporary video file path. */
@property (nonatomic, copy, nullable) void (^onVideoRecordingFinished)(NSString *videoFilePath);

- (nullable UIView *)createRenderViewWithApiKey:(NSString *)apiKey
                                          frame:(CGRect)frame
                                 cameraPosition:(NSString *)cameraPosition;
- (void)switchEffect:(NSString *)path;
- (void)clearEffect;
- (void)setCameraPosition:(NSString *)cameraPosition;
- (void)takeScreenshot;
- (void)startVideoRecording;
- (void)finishVideoRecording;
- (void)shutdown;

@end

NS_ASSUME_NONNULL_END
