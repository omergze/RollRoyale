import { PLAYER_ENTITY_ID } from '../simulation/GameSimulation';
import type { PlayerInputCommand } from '../types/game';
import { clamp } from '../utils/math';

export interface InputCallbacks {
  onPauseToggle: () => void;
}

export class InputManager {
  private pressedKeys = new Set<string>();
  private sensitivity = 1.0;
  private boostTriggeredSinceLastRead = false;

  // Touch / Virtual Joystick state
  private joystickZoneEl: HTMLElement | null = null;
  private joystickBaseEl: HTMLElement | null = null;
  private joystickKnobEl: HTMLElement | null = null;
  private boostBtnEl: HTMLElement | null = null;

  private activeJoystickPointerId: number | null = null;
  private activeBoostPointerId: number | null = null;
  private joystickOrigin = { x: 0, y: 0 };
  private joystickVector = { x: 0, y: 0 };
  private touchBoostHeld = false;
  private maxJoystickRadius = 56;

  private callbacks: InputCallbacks;

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
    this.bindKeyboardEvents();
  }

  public setSensitivity(sensitivity: number): void {
    this.sensitivity = clamp(sensitivity, 0.6, 1.5);
  }

  public bindTouchElements(
    joystickZoneEl: HTMLElement,
    joystickBaseEl: HTMLElement,
    joystickKnobEl: HTMLElement,
    boostBtnEl: HTMLElement
  ): void {
    this.joystickZoneEl = joystickZoneEl;
    this.joystickBaseEl = joystickBaseEl;
    this.joystickKnobEl = joystickKnobEl;
    this.boostBtnEl = boostBtnEl;

    // Prevent browser scrolling/gestures on touch controls
    const preventDefaultTouch = (e: TouchEvent) => {
      e.preventDefault();
    };
    this.joystickZoneEl.addEventListener('touchstart', preventDefaultTouch, { passive: false });
    this.joystickZoneEl.addEventListener('touchmove', preventDefaultTouch, { passive: false });
    this.boostBtnEl.addEventListener('touchstart', preventDefaultTouch, { passive: false });

    // Multi-touch pointer events for virtual joystick
    this.joystickZoneEl.addEventListener('pointerdown', (e: PointerEvent) => {
      if (this.activeJoystickPointerId !== null) return;
      e.preventDefault();
      this.activeJoystickPointerId = e.pointerId;
      try {
        this.joystickZoneEl?.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic event pointer capture errors
      }

      const rect = this.joystickBaseEl!.getBoundingClientRect();
      this.joystickOrigin = {
        x: rect.left + rect.width * 0.5,
        y: rect.top + rect.height * 0.5,
      };
      this.maxJoystickRadius = Math.max(36, rect.width * 0.42);
      this.joystickBaseEl?.classList.add('active');
      this.updateJoystickFromPoint(e.clientX, e.clientY);
    });

    this.joystickZoneEl.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== this.activeJoystickPointerId) return;
      e.preventDefault();
      this.updateJoystickFromPoint(e.clientX, e.clientY);
    });

    const endJoystick = (e: PointerEvent) => {
      if (e.pointerId !== this.activeJoystickPointerId) return;
      this.resetJoystick();
    };

    this.joystickZoneEl.addEventListener('pointerup', endJoystick);
    this.joystickZoneEl.addEventListener('pointercancel', endJoystick);

    // Multi-touch pointer events for Boost button (simultaneous with joystick!)
    this.boostBtnEl.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      this.activeBoostPointerId = e.pointerId;
      this.touchBoostHeld = true;
      this.boostTriggeredSinceLastRead = true;
      this.boostBtnEl?.classList.add('pressed');
      try {
        this.boostBtnEl?.setPointerCapture(e.pointerId);
      } catch {
        // Ignore synthetic pointer capture errors
      }
    });

    const endBoost = (e: PointerEvent) => {
      if (this.activeBoostPointerId !== null && e.pointerId !== this.activeBoostPointerId) {
        return;
      }
      this.activeBoostPointerId = null;
      this.touchBoostHeld = false;
      this.boostBtnEl?.classList.remove('pressed');
    };

    this.boostBtnEl.addEventListener('pointerup', endBoost);
    this.boostBtnEl.addEventListener('pointercancel', endBoost);
  }

  private updateJoystickFromPoint(clientX: number, clientY: number): void {
    const dx = clientX - this.joystickOrigin.x;
    const dy = clientY - this.joystickOrigin.y;
    const dist = Math.hypot(dx, dy);

    const effectiveMax = this.maxJoystickRadius / this.sensitivity;
    const clampedVisualDist = Math.min(dist, this.maxJoystickRadius);
    const angle = Math.atan2(dy, dx);

    const visualX = Math.cos(angle) * clampedVisualDist;
    const visualY = Math.sin(angle) * clampedVisualDist;

    if (this.joystickKnobEl) {
      this.joystickKnobEl.style.transform = `translate3d(${visualX.toFixed(1)}px, ${visualY.toFixed(1)}px, 0)`;
    }

    const normMag = clamp(dist / effectiveMax, 0, 1);
    if (normMag < 0.08) {
      this.joystickVector = { x: 0, y: 0 };
    } else {
      this.joystickVector = {
        x: Math.cos(angle) * normMag,
        y: Math.sin(angle) * normMag,
      };
    }
  }

  public resetJoystick(): void {
    this.activeJoystickPointerId = null;
    this.joystickVector = { x: 0, y: 0 };
    this.joystickBaseEl?.classList.remove('active');
    if (this.joystickKnobEl) {
      this.joystickKnobEl.style.transform = 'translate3d(0px, 0px, 0)';
    }
  }

  public clearAllInputs(): void {
    this.pressedKeys.clear();
    this.boostTriggeredSinceLastRead = false;
    this.touchBoostHeld = false;
    this.resetJoystick();
  }

  private bindKeyboardEvents(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (!e.repeat) {
          this.callbacks.onPauseToggle();
        }
        return;
      }

      if (
        e.code === 'Space' ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight'
      ) {
        e.preventDefault();
      }

      this.pressedKeys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.boostTriggeredSinceLastRead = true;
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.pressedKeys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.clearAllInputs();
    });
  }

  public getPlayerInputCommand(): PlayerInputCommand {
    let keyX = 0;
    let keyZ = 0;

    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) {
      keyX -= 1;
    }
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) {
      keyX += 1;
    }
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) {
      keyZ -= 1;
    }
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) {
      keyZ += 1;
    }

    // Normalize keyboard diagonal vector
    if (keyX !== 0 && keyZ !== 0) {
      const inv = 1 / Math.SQRT2;
      keyX *= inv;
      keyZ *= inv;
    }

    // Combine keyboard input and virtual joystick input
    const moveX = clamp(keyX + this.joystickVector.x, -1, 1);
    const moveZ = clamp(keyZ + this.joystickVector.y, -1, 1);

    const keyBoost =
      this.pressedKeys.has('Space') ||
      this.pressedKeys.has('ShiftLeft') ||
      this.pressedKeys.has('ShiftRight');

    const boostPressed = keyBoost || this.touchBoostHeld || this.boostTriggeredSinceLastRead;
    this.boostTriggeredSinceLastRead = false;

    return {
      entityId: PLAYER_ENTITY_ID,
      moveX,
      moveZ,
      boostPressed,
    };
  }
}
