import type { ImpactTier } from '../types/game';
import { clamp } from '../utils/math';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private enabled = true;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private getContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') {
      return null;
    }
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playClick(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.055);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.065);
  }

  public playBoost(isPlayer: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    const baseFreq = isPlayer ? 170 : 140;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.8, now + 0.24);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(2400, now + 0.22);

    const volume = isPlayer ? 0.14 : 0.05;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playCollision(
    relativeSpeed: number,
    isBoosted: boolean,
    impactTier: ImpactTier = isBoosted ? 'boost' : 'normal'
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const intensity = clamp(relativeSpeed / 22.0, 0.18, 1.0);

    // 1. Primary low-end impact punch
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type =
      impactTier === 'perfect_boost' || impactTier === 'boost'
        ? 'square'
        : impactTier === 'heavy'
          ? 'triangle'
          : 'sine';
    const startFreq =
      impactTier === 'glancing' ? 110 : 145 + intensity * (isBoosted ? 135 : 95);
    const endFreq = impactTier === 'perfect_boost' ? 36 : 44;
    const duration =
      impactTier === 'perfect_boost' ? 0.21 : isBoosted ? 0.17 : impactTier === 'glancing' ? 0.09 : 0.14;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    const tierVolMult =
      impactTier === 'perfect_boost'
        ? 0.26
        : impactTier === 'boost'
          ? 0.22
          : impactTier === 'heavy'
            ? 0.18
            : impactTier === 'normal'
              ? 0.14
              : 0.06;
    const volume = clamp(intensity * tierVolMult, 0.03, 0.27);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.01);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);

    // 2. Crisp harmonic metallic transient on Perfect Impact
    if (impactTier === 'perfect_boost') {
      const chimeOsc = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chimeOsc.type = 'triangle';
      chimeOsc.frequency.setValueAtTime(740, now);
      chimeOsc.frequency.exponentialRampToValueAtTime(1180, now + 0.14);

      chimeGain.gain.setValueAtTime(0.12, now);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      chimeOsc.connect(chimeGain);
      chimeGain.connect(ctx.destination);

      chimeOsc.start(now);
      chimeOsc.stop(now + 0.19);
    }
  }

  public playKnockout(isPlayerAttacker: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = isPlayerAttacker ? [523.25, 659.25, 783.99, 1046.5] : [392.0, 523.25];
    const spacing = isPlayerAttacker ? 0.065 : 0.08;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * spacing;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      const vol = isPlayerAttacker ? 0.14 : 0.07;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.23);
    });
  }

  public playSelfFall(isPlayerVictim: boolean): void {
    if (!isPlayerVictim) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.38);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);

    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.42);
  }

  public playShrinkWarning(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    [0, 0.22].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + offset;

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.linearRampToValueAtTime(587.33, t + 0.16);

      gain.gain.setValueAtTime(0.11, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.19);
    });
  }

  public playMatchEnd(playerWon: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = playerWon
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5]
      : [440.0, 392.0, 349.23, 329.63];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = now + idx * 0.09;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  public playBumperHit(isPlayer: boolean): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(310, now + 0.18);

    const vol = isPlayer ? 0.16 : 0.07;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }
}
