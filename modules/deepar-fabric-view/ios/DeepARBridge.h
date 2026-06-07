#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface DeepARBridge : NSObject

- (nullable UIView *)createRenderViewWithApiKey:(NSString *)apiKey
                                          frame:(CGRect)frame
                                 cameraPosition:(NSString *)cameraPosition;
- (void)switchEffect:(NSString *)path;
- (void)clearEffect;
- (void)setCameraPosition:(NSString *)cameraPosition;
- (void)shutdown;

@end

NS_ASSUME_NONNULL_END
