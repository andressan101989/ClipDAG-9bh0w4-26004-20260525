import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import LottieView from 'lottie-react-native';
import type { LiveGiftEvent } from '@/types/liveGifts';

const { width: W, height: H } = Dimensions.get('window');

type Props = {
  gift: LiveGiftEvent;
  floating?: boolean;
};

type RegisteredLottieAsset = React.ComponentProps<typeof LottieView>['source'];

const LOTTIE_ASSETS: Record<string, RegisteredLottieAsset> = {};
const GOLD_PARTICLES = [0.08, 0.18, 0.29, 0.42, 0.56, 0.68, 0.78, 0.9];
const GALAXY_STARS = [0.07, 0.16, 0.23, 0.34, 0.41, 0.53, 0.61, 0.72, 0.84, 0.93];
const SPEED_LINES = [0.12, 0.22, 0.34, 0.48, 0.62, 0.78];

function getRegisteredLottie(asset?: string | null) {
  if (!asset) return null;
  return LOTTIE_ASSETS[asset] ?? null;
}

function GiftCaption({ gift, compact = false }: { gift: LiveGiftEvent; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const username = gift.senderUsername || 'Invitado';
  const initial = username.trim().charAt(0).toUpperCase() || '?';

  return (
    <View style={[styles.caption, compact && styles.captionCompact]}>
      {gift.senderAvatarUrl && !imageFailed ? (
        <Image
          source={{ uri: gift.senderAvatarUrl }}
          style={styles.avatar}
          contentFit="cover"
          transition={120}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.avatarFallback}><Text style={styles.avatarInitial}>{initial}</Text></View>
      )}
      <View style={styles.captionText}>
        <Text style={styles.sender} numberOfLines={1}>{username}</Text>
        <Text style={styles.title} numberOfLines={1}>envio {gift.giftName}</Text>
      </View>
      <View style={styles.captionGiftIconWrap}>
        <Text style={styles.captionGiftIcon}>{gift.icon}</Text>
      </View>
      <Text style={styles.amount}>{gift.amountBdag} BDAG</Text>
    </View>
  );
}

function LottieGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  const source = getRegisteredLottie(gift.animationAsset);
  if (!source) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.centerWrap,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ scale: progress.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.72, 1, 1] }) }],
        },
      ]}
    >
      <LottieView source={source} autoPlay loop={false} style={styles.lottie} />
      <GiftCaption gift={gift} />
    </Animated.View>
  );
}

function FloatingGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floating,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.15, 0.82, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [80, -150] }) },
            { translateX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, gift.giftId === 'fire' ? 26 : -18, 12] }) },
            { scale: progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.75, 1.1, 1] }) },
          ],
        },
      ]}
    >
      <Text style={styles.floatingIcon}>{gift.icon}</Text>
      <GiftCaption gift={gift} compact />
    </Animated.View>
  );
}

function LionGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <Animated.View style={[styles.centerWrap, styles.goldScene, fadeScale(progress, 0.42, 1.2)]} pointerEvents="none">
      {[0, 1, 2].map(index => (
        <Animated.View
          key={index}
          style={[
            styles.impactRing,
            {
              opacity: progress.interpolate({ inputRange: [0.08 + index * 0.08, 0.32 + index * 0.1, 0.72], outputRange: [0, 0.72, 0] }),
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55 + index * 0.2, 2.2 + index * 0.35] }) }],
            },
          ]}
        />
      ))}
      <Animated.Text
        style={[
          styles.heroIcon,
          styles.lionIcon,
          {
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 0.12, 0.18, 0.24, 1], outputRange: [0, -9, 9, -5, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 0.18, 0.8, 1], outputRange: [0.3, 1.28, 1, 0.9] }) },
            ],
          },
        ]}
      >
        {gift.icon}
      </Animated.Text>
      <ParticleField progress={progress} color="#FFD54A" symbols={['*', '+', '*']} />
      <GiftCaption gift={gift} />
    </Animated.View>
  );
}

function RocketGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.fullLayer}>
      <Animated.View
        style={[
          styles.rocketWrap,
          {
            opacity: progress.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 0.72, 1], outputRange: [H * 0.55, -H * 0.18, -H * 0.45] }) },
              { translateX: progress.interpolate({ inputRange: [0, 0.18, 0.28, 0.38, 1], outputRange: [0, -6, 8, -4, 0] }) },
              { rotate: '-14deg' },
            ],
          },
        ]}
      >
        <Text style={styles.rocketIcon}>{gift.icon}</Text>
        <View style={styles.fireTrail}>
          {[0, 1, 2, 3].map(index => <Animated.View key={index} style={[styles.smoke, { opacity: progress.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0.65, 0.42, 0] }), transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.5 + index * 0.1, 1.9 + index * 0.18] }) }] }]} />)}
        </View>
      </Animated.View>
      <View style={styles.bottomCaption}><GiftCaption gift={gift} compact /></View>
    </View>
  );
}

function PrivateJetGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.fullLayer}>
      <Animated.View style={[styles.jetSkyFlash, { opacity: progress.interpolate({ inputRange: [0, 0.16, 0.7, 1], outputRange: [0, 0.28, 0.18, 0] }) }]} />
      {SPEED_LINES.map((top, index) => (
        <Animated.View
          key={top}
          style={[
            styles.jetSpeedLine,
            {
              top: H * (0.28 + top * 0.34),
              opacity: progress.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 0.85, 0.6, 0] }),
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [W * (0.85 + index * 0.12), -W * 0.4] }) },
                { rotate: '-16deg' },
              ],
            },
          ]}
        />
      ))}
      <Animated.View
        style={[
          styles.jetWrap,
          {
            opacity: progress.interpolate({ inputRange: [0, 0.08, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 0.78, 1], outputRange: [-W * 0.42, W * 0.44, W * 1.08] }) },
              { translateY: progress.interpolate({ inputRange: [0, 0.42, 0.78, 1], outputRange: [H * 0.22, -H * 0.08, -H * 0.18, -H * 0.28] }) },
              { rotate: '-18deg' },
              { scale: progress.interpolate({ inputRange: [0, 0.18, 0.82, 1], outputRange: [0.82, 1.2, 1.08, 0.96] }) },
            ],
          },
        ]}
      >
        <View style={styles.jetGlow} />
        <Text style={styles.jetIcon}>{gift.icon}</Text>
        <View style={styles.jetTrail} />
        <View style={styles.jetTrailThin} />
      </Animated.View>
      <View style={styles.bottomCaption}><GiftCaption gift={gift} compact /></View>
    </View>
  );
}

function PhoenixGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <Animated.View style={[styles.centerWrap, fadeScale(progress, 0.5, 1.25)]} pointerEvents="none">
      <Animated.View style={[styles.phoenixAura, { transform: [{ scale: progress.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1.8, 2.2] }) }] }]} />
      <Animated.Text style={[styles.wing, styles.leftWing, { transform: [{ rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-35deg', '-8deg', '-28deg'] }) }] }]}>⌒</Animated.Text>
      <Animated.Text style={[styles.wing, styles.rightWing, { transform: [{ rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['35deg', '8deg', '28deg'] }) }] }]}>⌒</Animated.Text>
      <Animated.Text style={[styles.heroIcon, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 0.32, 1], outputRange: [100, 0, -16] }) }, { scale: progress.interpolate({ inputRange: [0, 0.35, 0.85, 1], outputRange: [0.35, 1.3, 1, 0.94] }) }] }]}>{gift.icon}</Animated.Text>
      <ParticleField progress={progress} color="#FFB13B" symbols={['*', '+', '•']} />
      <GiftCaption gift={gift} />
    </Animated.View>
  );
}

function DragonGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.fullLayer}>
      <Animated.View style={[styles.fullscreenDim, { opacity: progress.interpolate({ inputRange: [0, 0.14, 0.84, 1], outputRange: [0, 0.32, 0.28, 0] }) }]} />
      <Animated.View
        style={[
          styles.dragonWrap,
          {
            opacity: progress.interpolate({ inputRange: [0, 0.1, 0.88, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 0.65, 1], outputRange: [-W * 0.45, W * 0.15, W * 0.85] }) },
              { translateY: progress.interpolate({ inputRange: [0, 0.65, 1], outputRange: [H * 0.35, -H * 0.08, -H * 0.25] }) },
              { rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-18deg', '10deg', '24deg'] }) },
              { scale: progress.interpolate({ inputRange: [0, 0.28, 1], outputRange: [0.65, 1.55, 1.2] }) },
            ],
          },
        ]}
      >
        <Text style={styles.dragonIcon}>{gift.icon}</Text>
        <Text style={styles.fireBreath}>🔥🔥🔥</Text>
      </Animated.View>
      <ParticleField progress={progress} color="#FF5A2D" symbols={['*', '•', '+']} fullscreen />
      <View style={styles.topCaption}><GiftCaption gift={gift} compact /></View>
    </View>
  );
}

function CastleGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <Animated.View style={[styles.centerWrap, fadeScale(progress, 0.55, 1.08)]} pointerEvents="none">
      <Animated.View style={[styles.castleGlow, { opacity: progress.interpolate({ inputRange: [0, 0.22, 0.82, 1], outputRange: [0, 0.9, 0.6, 0] }) }]} />
      <View style={styles.castleTowers}>
        {[0, 1, 2].map(index => <Animated.View key={index} style={[styles.tower, index === 1 && styles.towerTall, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 0.28, 1], outputRange: [90 + index * 12, 0, 0] }) }] }]} />)}
      </View>
      <Animated.Text style={[styles.heroIcon, styles.castleIcon, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [120, 0, -4] }) }] }]}>{gift.icon}</Animated.Text>
      <Text style={styles.flag}>⚑</Text>
      <ParticleField progress={progress} color="#DCE8FF" symbols={['*', '+', '*']} />
      <GiftCaption gift={gift} />
    </Animated.View>
  );
}

function GalaxyGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <View pointerEvents="none" style={styles.fullLayer}>
      <Animated.View style={[styles.galaxyDim, { opacity: progress.interpolate({ inputRange: [0, 0.15, 0.86, 1], outputRange: [0, 0.46, 0.42, 0] }) }]} />
      <Animated.View
        style={[
          styles.galaxyCore,
          {
            opacity: progress.interpolate({ inputRange: [0, 0.12, 0.9, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '210deg'] }) },
              { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 1.55, 2.15] }) },
            ],
          },
        ]}
      >
        <View style={styles.orbitOne} />
        <View style={styles.orbitTwo} />
        <Text style={styles.galaxyIcon}>{gift.icon}</Text>
      </Animated.View>
      {GALAXY_STARS.map((left, index) => (
        <Animated.Text
          key={left}
          style={[
            styles.star,
            {
              left: W * left,
              top: H * (0.16 + ((index * 17) % 58) / 100),
              opacity: progress.interpolate({ inputRange: [0, 0.2, 0.86, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1.2 + (index % 3) * 0.2, 0.7] }) }],
            },
          ]}
        >
          *
        </Animated.Text>
      ))}
      <View style={styles.topCaption}><GiftCaption gift={gift} compact /></View>
    </View>
  );
}

function CenterGift({ gift, progress }: { gift: LiveGiftEvent; progress: Animated.Value }) {
  return (
    <Animated.View style={[styles.centerWrap, fadeScale(progress, 0.45, gift.category === 'legendary' ? 1.18 : 1.08)]} pointerEvents="none">
      <View style={[styles.aura, gift.category === 'legendary' && styles.legendaryAura]} />
      <Animated.Text style={[styles.heroIcon, { transform: [{ scale: progress.interpolate({ inputRange: [0, 0.2, 0.78, 1], outputRange: [0.45, 1.18, 1, 0.9] }) }] }]}>{gift.icon}</Animated.Text>
      <ParticleField progress={progress} color={gift.giftId === 'diamond' ? '#7DEBFF' : '#FFD54A'} symbols={['*', '+', '*']} />
      <GiftCaption gift={gift} />
    </Animated.View>
  );
}

function ParticleField({ progress, color, symbols, fullscreen = false }: { progress: Animated.Value; color: string; symbols: string[]; fullscreen?: boolean }) {
  const points = fullscreen ? GALAXY_STARS : GOLD_PARTICLES;
  return (
    <View style={styles.particles}>
      {points.map((left, index) => (
        <Animated.Text
          key={`${left}-${index}`}
          style={[
            styles.particle,
            {
              left: fullscreen ? W * left : `${8 + index * 11}%`,
              bottom: fullscreen ? H * (0.18 + ((index * 13) % 50) / 100) : 40,
              color,
              opacity: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [20, -70 - index * 5] }) },
                { scale: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.4, 1, 0.6] }) },
              ],
            },
          ]}
        >
          {symbols[index % symbols.length]}
        </Animated.Text>
      ))}
    </View>
  );
}

function fadeScale(progress: Animated.Value, startScale: number, peakScale: number) {
  return {
    opacity: progress.interpolate({ inputRange: [0, 0.1, 0.86, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 0.16, 0.88, 1], outputRange: [38, 0, 0, -18] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.18, 0.76, 1], outputRange: [startScale, peakScale, 1, 0.92] }) },
    ],
  };
}

export const LiveGiftAnimationRenderer = memo(function LiveGiftAnimationRenderer({ gift, floating = false }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const lottieSource = useMemo(() => getRegisteredLottie(gift.animationAsset), [gift.animationAsset]);

  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(1000, gift.durationMs),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [gift.transactionId, gift.durationMs, progress]);

  if (floating) return <FloatingGift gift={gift} progress={progress} />;
  if (lottieSource) return <LottieGift gift={gift} progress={progress} />;

  switch (gift.giftId) {
    case 'lion':
      return <LionGift gift={gift} progress={progress} />;
    case 'rocket':
      return <RocketGift gift={gift} progress={progress} />;
    case 'private_jet':
      return <PrivateJetGift gift={gift} progress={progress} />;
    case 'phoenix':
      return <PhoenixGift gift={gift} progress={progress} />;
    case 'dragon':
      return <DragonGift gift={gift} progress={progress} />;
    case 'castle':
      return <CastleGift gift={gift} progress={progress} />;
    case 'galaxy':
      return <GalaxyGift gift={gift} progress={progress} />;
    default:
      return <CenterGift gift={gift} progress={progress} />;
  }
});

const styles = StyleSheet.create({
  fullLayer: { ...StyleSheet.absoluteFillObject, zIndex: 18 },
  floating: { position: 'absolute', left: 14, bottom: 150, maxWidth: W * 0.88, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 18 },
  floatingIcon: { fontSize: 29, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  centerWrap: { position: 'absolute', left: 18, right: 18, top: H * 0.23, minHeight: 270, alignItems: 'center', justifyContent: 'center', zIndex: 18 },
  lottie: { width: 260, height: 260 },
  goldScene: { top: H * 0.22 },
  fullscreenDim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#120607' },
  galaxyDim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#030313' },
  aura: { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,184,0,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  legendaryAura: { width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(124,92,255,0.24)' },
  heroIcon: { fontSize: 96, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 },
  lionIcon: { fontSize: 112 },
  impactRing: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: 'rgba(255,213,74,0.75)' },
  rocketWrap: { position: 'absolute', left: W * 0.42, top: H * 0.28, alignItems: 'center' },
  rocketIcon: { fontSize: 94, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  fireTrail: { alignItems: 'center', marginTop: -12 },
  smoke: { width: 24, height: 24, borderRadius: 12, marginTop: -8, backgroundColor: 'rgba(255,210,120,0.55)' },
  jetSkyFlash: { ...StyleSheet.absoluteFillObject, backgroundColor: '#9FD8FF' },
  jetWrap: { position: 'absolute', top: H * 0.44, left: 0, alignItems: 'center' },
  jetIcon: { fontSize: 106, textShadowColor: 'rgba(255,255,255,0.52)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  jetGlow: { position: 'absolute', width: 132, height: 60, borderRadius: 30, backgroundColor: 'rgba(125,235,255,0.22)', top: 28 },
  jetTrail: { position: 'absolute', right: 82, top: 48, width: 170, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.66)' },
  jetTrailThin: { position: 'absolute', right: 62, top: 66, width: 132, height: 4, borderRadius: 2, backgroundColor: 'rgba(125,235,255,0.72)' },
  jetSpeedLine: { position: 'absolute', left: 0, width: W * 0.5, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.48)' },
  phoenixAura: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,111,32,0.28)' },
  wing: { position: 'absolute', top: 72, color: '#FFB13B', fontSize: 96, fontWeight: '900', textShadowColor: 'rgba(255,90,45,0.85)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  leftWing: { left: W * 0.18 },
  rightWing: { right: W * 0.18, transform: [{ scaleX: -1 }] },
  dragonWrap: { position: 'absolute', left: 0, top: H * 0.28, alignItems: 'center' },
  dragonIcon: { fontSize: 132, textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 },
  fireBreath: { marginTop: -18, marginLeft: 88, fontSize: 34 },
  castleGlow: { position: 'absolute', width: 260, height: 180, borderRadius: 90, backgroundColor: 'rgba(220,232,255,0.2)' },
  castleTowers: { position: 'absolute', bottom: 92, flexDirection: 'row', alignItems: 'flex-end', gap: 20 },
  tower: { width: 34, height: 82, borderRadius: 8, backgroundColor: 'rgba(220,232,255,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' },
  towerTall: { height: 118 },
  castleIcon: { fontSize: 118 },
  flag: { position: 'absolute', top: 42, color: '#FFD54A', fontSize: 34, fontWeight: '900' },
  galaxyCore: { position: 'absolute', left: W / 2 - 95, top: H / 2 - 95, width: 190, height: 190, borderRadius: 95, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,92,255,0.18)' },
  orbitOne: { position: 'absolute', width: 220, height: 82, borderRadius: 110, borderWidth: 2, borderColor: 'rgba(125,235,255,0.55)', transform: [{ rotate: '24deg' }] },
  orbitTwo: { position: 'absolute', width: 250, height: 96, borderRadius: 125, borderWidth: 1, borderColor: 'rgba(255,213,74,0.45)', transform: [{ rotate: '-28deg' }] },
  galaxyIcon: { fontSize: 112, textShadowColor: 'rgba(255,255,255,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16 },
  star: { position: 'absolute', color: '#fff', fontSize: 18, fontWeight: '900', textShadowColor: 'rgba(125,235,255,0.8)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8 },
  particles: { ...StyleSheet.absoluteFillObject },
  particle: { position: 'absolute', fontSize: 18, fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  topCaption: { position: 'absolute', top: H * 0.12, left: 16, right: 16, alignItems: 'center' },
  bottomCaption: { position: 'absolute', bottom: H * 0.18, left: 16, right: 16, alignItems: 'center' },
  caption: { marginTop: 12, maxWidth: W * 0.88, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.54)', borderWidth: 1, borderColor: 'rgba(255,213,74,0.34)' },
  captionCompact: { marginTop: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.16)' },
  avatarFallback: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124,92,255,0.88)' },
  avatarInitial: { color: '#fff', fontSize: 14, fontWeight: '900' },
  captionText: { minWidth: 0, flex: 1 },
  sender: { color: '#fff', fontSize: 13, fontWeight: '800' },
  title: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600', marginTop: 2 },
  captionGiftIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,213,74,0.18)', borderWidth: 1, borderColor: 'rgba(255,213,74,0.32)' },
  captionGiftIcon: { fontSize: 18 },
  amount: { color: '#FFD54A', fontSize: 12, fontWeight: '800' },
});
