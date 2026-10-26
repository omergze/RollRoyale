import * as THREE from 'three';
import { GRAPHICS_PRESETS } from '../config/constants';
import { PLAYER_ENTITY_ID } from '../simulation/GameSimulation';
import type { GameEvent, GameSettings, SimulationSnapshot } from '../types/game';
import { ArenaRenderer } from './ArenaRenderer';
import { BallRenderer } from './BallRenderer';
import { CameraController } from './CameraController';
import { EffectsRenderer } from './EffectsRenderer';

export class SceneManager {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private dirLight: THREE.DirectionalLight;

  private arenaRenderer: ArenaRenderer;
  private ballRenderer: BallRenderer;
  private effectsRenderer: EffectsRenderer;
  private cameraController: CameraController;

  constructor(container: HTMLElement, settings: GameSettings) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({
      antialias: settings.graphicsQuality !== 'low',
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060b18);
    this.scene.fog = new THREE.FogExp2(0x060b18, 0.0075);

    // Lighting setup
    const hemiLight = new THREE.HemisphereLight(0x8ecae6, 0x0b132b, 1.15);
    this.scene.add(hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.85);
    this.dirLight.position.set(18, 36, 22);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.camera.near = 5;
    this.dirLight.shadow.camera.far = 95;
    const shadowExtent = 26;
    this.dirLight.shadow.camera.left = -shadowExtent;
    this.dirLight.shadow.camera.right = shadowExtent;
    this.dirLight.shadow.camera.top = shadowExtent;
    this.dirLight.shadow.camera.bottom = -shadowExtent;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    // Subtle colored rim lights for arcade depth
    const cyanRimLight = new THREE.PointLight(0x00f0ff, 28, 55, 1.5);
    cyanRimLight.position.set(-24, 8, -18);
    this.scene.add(cyanRimLight);

    const magentaRimLight = new THREE.PointLight(0xff2e93, 24, 55, 1.5);
    magentaRimLight.position.set(24, 8, 18);
    this.scene.add(magentaRimLight);

    this.arenaRenderer = new ArenaRenderer();
    this.scene.add(this.arenaRenderer.group);

    this.ballRenderer = new BallRenderer();
    this.scene.add(this.ballRenderer.group);

    this.effectsRenderer = new EffectsRenderer();
    this.scene.add(this.effectsRenderer.group);

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.cameraController = new CameraController(width / Math.max(1, height));

    this.applySettings(settings);
    this.handleResize();

    window.addEventListener('resize', () => this.handleResize());
  }

  public applySettings(settings: GameSettings): void {
    const preset = GRAPHICS_PRESETS[settings.graphicsQuality];
    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = preset.shadowsEnabled;
    this.dirLight.castShadow = preset.shadowsEnabled;

    if (this.dirLight.shadow.mapSize.width !== preset.shadowMapSize) {
      this.dirLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        this.dirLight.shadow.map = null;
      }
    }

    this.arenaRenderer.applyGraphicsQuality(settings.graphicsQuality);
    this.ballRenderer.setGraphicsQuality(settings.graphicsQuality);
    this.effectsRenderer.configure(settings.graphicsQuality, settings.reducedEffects);
    this.cameraController.setReducedEffects(settings.reducedEffects);
    this.handleResize();
  }

  public handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height);
    this.cameraController.setAspect(width / Math.max(1, height));
  }

  public processEvents(
    events: ReadonlyArray<GameEvent>,
    snapshot: SimulationSnapshot
  ): void {
    const entityMap = new Map(snapshot.entities.map((e) => [e.id, e]));

    for (const ev of events) {
      if (ev.type === 'collision') {
        const entityA = entityMap.get(ev.entityAId);
        this.effectsRenderer.spawnCollisionEffect(
          ev.point,
          ev.impulse,
          ev.isBoostedImpact,
          entityA?.colorPrimary ?? '#FFD60A'
        );
        if (ev.entityAId === PLAYER_ENTITY_ID || ev.entityBId === PLAYER_ENTITY_ID) {
          this.cameraController.addImpactShake(ev.impulse);
        }
      } else if (ev.type === 'boost') {
        const entity = entityMap.get(ev.entityId);
        this.effectsRenderer.spawnBoostBurst(ev.position, entity?.colorPrimary ?? '#00F0FF');
      } else if (ev.type === 'knockout' || ev.type === 'self_fall') {
        const victim = entityMap.get(ev.victimId);
        this.effectsRenderer.spawnKnockoutSplash(ev.position, victim?.colorPrimary ?? '#FF2E93');
      } else if (ev.type === 'respawn') {
        const entity = entityMap.get(ev.entityId);
        this.effectsRenderer.spawnRespawnEffect(ev.position, entity?.colorPrimary ?? '#00F0FF');
      }
    }
  }

  public render(snapshot: SimulationSnapshot, alpha: number, dt: number): void {
    this.arenaRenderer.update(snapshot.arena, snapshot.elapsedTime);
    this.ballRenderer.syncEntities(snapshot.entities, alpha, snapshot.elapsedTime);
    this.effectsRenderer.update(snapshot.entities, dt);

    const player = snapshot.entities.find((e) => e.id === PLAYER_ENTITY_ID);
    this.cameraController.update(snapshot.phase, player, dt);

    this.renderer.render(this.scene, this.cameraController.camera);
  }
}
