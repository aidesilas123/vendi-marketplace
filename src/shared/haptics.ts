import { Haptics, ImpactStyle } from '@capacitor/haptics';

export { ImpactStyle };

export const hapticImpact = async (style: ImpactStyle = ImpactStyle.Light) => {
  try {
    await Haptics.impact({ style });
  } catch {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(style === ImpactStyle.Heavy ? 35 : style === ImpactStyle.Medium ? 25 : 15);
    }
  }
};
