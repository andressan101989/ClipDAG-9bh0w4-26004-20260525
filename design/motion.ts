export const motion = {
  duration: { instant: 90, fast: 160, standard: 240, deliberate: 340 },
  spring: {
    subtle: { damping: 22, stiffness: 240, mass: 0.8 },
    responsive: { damping: 18, stiffness: 280, mass: 0.72 },
  },
  pressedScale: 0.97,
} as const;
