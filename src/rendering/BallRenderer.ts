import * as THREE from 'three';
import { GRAPHICS_PRESETS } from '../config/constants';
import type { BallEntityState, GraphicsQuality } from '../types/game';
import { lerpVec3, slerpQuat } from '../utils/math';

interface BallVisualNode {
  root: THREE.Group;
  deformGroup: THREE.Group;
  sphereMesh: THREE.Mesh;
  sphereMat: THREE.MeshStandardMaterial;
  groundRing: THREE.Mesh;
  groundRingMat: THREE.MeshBasicMaterial;
  playerCrown: THREE.Mesh | null;
  shieldMesh: THREE.Mesh;
  shieldMat: THREE.MeshBasicMaterial;
  labelSprite: THREE.Sprite;
  labelCanvas: HTMLCanvasElement;
  labelTexture: THREE.CanvasTexture;
  lastRenderedScore: number;
  lastRenderedName: string;
}

export class BallRenderer {
  public readonly group = new THREE.Group();
  private nodes = new Map<string, BallVisualNode>();
  private quality: GraphicsQuality = 'high';

  public setGraphicsQuality(quality: GraphicsQuality): void {
    this.quality = quality;
    const preset = GRAPHICS_PRESETS[quality];
    for (const node of this.nodes.values()) {
      node.sphereMesh.castShadow = preset.shadowsEnabled;
      node.sphereMesh.receiveShadow = preset.shadowsEnabled;
    }
  }

  public syncEntities(
    entities: ReadonlyArray<BallEntityState>,
    alpha: number,
    elapsedTime: number
  ): void {
    const activeSet = new Set<string>();

    for (const entity of entities) {
      activeSet.add(entity.id);
      let node = this.nodes.get(entity.id);
      if (!node) {
        node = this.createBallNode(entity);
        this.nodes.set(entity.id, node);
        this.group.add(node.root);
      }

      if (!entity.isAlive) {
        node.root.visible = false;
        continue;
      }

      node.root.visible = true;

      // Interpolate position and rotation between fixed physics steps
      const interpPos = lerpVec3(entity.prevPosition, entity.position, alpha);
      const interpQuat = slerpQuat(entity.prevRotation, entity.rotation, alpha);

      node.root.position.set(interpPos.x, interpPos.y, interpPos.z);

      // Apply squash-and-stretch deformation on deformGroup, and rolling rotation on sphereMesh
      node.deformGroup.scale.set(
        entity.squashStretch.x,
        entity.squashStretch.y,
        entity.squashStretch.z
      );
      node.sphereMesh.quaternion.set(interpQuat.x, interpQuat.y, interpQuat.z, interpQuat.w);

      // Boost & hazard danger glow feedback
      const danger = entity.dangerLevel ?? 0;
      if (entity.boostActiveTimer > 0) {
        node.sphereMat.emissiveIntensity = 0.85;
        node.groundRing.scale.setScalar(1.28);
        node.groundRingMat.color.set(entity.colorPrimary);
        node.groundRingMat.opacity = 0.95;
      } else if (danger > 0.28) {
        const dangerPulse = 0.5 + 0.5 * Math.sin(elapsedTime * 14.0);
        node.sphereMat.emissiveIntensity = 0.34 + danger * 0.28;
        node.groundRing.scale.setScalar(1.0 + danger * 0.22 * dangerPulse);
        node.groundRingMat.color.setHex(dangerPulse > 0.45 ? 0xff2e93 : 0xff9f1c);
        node.groundRingMat.opacity = 0.65 + danger * 0.32;
      } else {
        node.sphereMat.emissiveIntensity = 0.28;
        node.groundRing.scale.setScalar(1.0);
        node.groundRingMat.color.set(entity.colorPrimary);
        node.groundRingMat.opacity = entity.isPlayer ? 0.8 : 0.48;
      }

      // Keep ground ring just above deck level when ball is near deck
      node.groundRing.position.y = -entity.radius + 0.04;

      // Animate player locator crown
      if (node.playerCrown) {
        node.playerCrown.position.y = entity.radius + 0.85 + Math.sin(elapsedTime * 5.0) * 0.12;
        node.playerCrown.rotation.y = elapsedTime * 2.4;
      }

      // Spawn protection shield bubble
      if (entity.spawnProtectionTimer > 0) {
        node.shieldMesh.visible = true;
        node.shieldMesh.rotation.y = elapsedTime * 3.0;
        node.shieldMat.opacity = 0.25 + 0.15 * Math.sin(elapsedTime * 14.0);
      } else {
        node.shieldMesh.visible = false;
      }

      // Update floating score/name badge if changed
      if (entity.score !== node.lastRenderedScore || entity.name !== node.lastRenderedName) {
        this.drawLabelCanvas(
          node.labelCanvas,
          entity.name,
          entity.score,
          entity.colorPrimary,
          entity.isPlayer
        );
        node.labelTexture.needsUpdate = true;
        node.lastRenderedScore = entity.score;
        node.lastRenderedName = entity.name;
      }
    }

    // Remove nodes for despawned entities
    for (const [id, node] of this.nodes.entries()) {
      if (!activeSet.has(id)) {
        this.group.remove(node.root);
        this.nodes.delete(id);
      }
    }
  }

  private createBallNode(entity: BallEntityState): BallVisualNode {
    const preset = GRAPHICS_PRESETS[this.quality];
    const root = new THREE.Group();
    const deformGroup = new THREE.Group();
    root.add(deformGroup);

    const sphereGeo = new THREE.SphereGeometry(
      entity.radius,
      preset.sphereSegments,
      preset.sphereSegments
    );
    const ballTex = this.createBallPatternTexture(entity.colorPrimary, entity.colorAccent);

    const sphereMat = new THREE.MeshStandardMaterial({
      map: ballTex,
      roughness: 0.22,
      metalness: 0.35,
      emissive: new THREE.Color(entity.colorPrimary),
      emissiveIntensity: 0.28,
    });

    const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
    sphereMesh.castShadow = preset.shadowsEnabled;
    sphereMesh.receiveShadow = preset.shadowsEnabled;
    deformGroup.add(sphereMesh);

    // Ground Locator Ring
    const ringInner = entity.isPlayer ? entity.radius * 1.12 : entity.radius * 1.05;
    const ringOuter = entity.isPlayer ? entity.radius * 1.42 : entity.radius * 1.24;
    const groundRingGeo = new THREE.RingGeometry(ringInner, ringOuter, 36);
    groundRingGeo.rotateX(-Math.PI * 0.5);
    const groundRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(entity.colorPrimary),
      transparent: true,
      opacity: entity.isPlayer ? 0.82 : 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const groundRing = new THREE.Mesh(groundRingGeo, groundRingMat);
    groundRing.position.y = -entity.radius + 0.04;
    root.add(groundRing);

    // Player Crown / Diamond Indicator above the human player's ball
    let playerCrown: THREE.Mesh | null = null;
    if (entity.isPlayer) {
      const crownGeo = new THREE.OctahedronGeometry(0.28, 0);
      const crownMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
      });
      playerCrown = new THREE.Mesh(crownGeo, crownMat);
      playerCrown.position.y = entity.radius + 0.85;
      root.add(playerCrown);
    }

    // Spawn Protection Shield Bubble
    const shieldGeo = new THREE.SphereGeometry(entity.radius * 1.32, 20, 16);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    shieldMesh.visible = false;
    root.add(shieldMesh);

    // Floating Name + Score Sprite
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 72;
    this.drawLabelCanvas(
      labelCanvas,
      entity.name,
      entity.score,
      entity.colorPrimary,
      entity.isPlayer
    );
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthTest: false,
    });
    const labelSprite = new THREE.Sprite(spriteMat);
    labelSprite.position.set(0, entity.radius + (entity.isPlayer ? 1.55 : 1.15), 0);
    labelSprite.scale.set(2.8, 0.78, 1);
    root.add(labelSprite);

    return {
      root,
      deformGroup,
      sphereMesh,
      sphereMat,
      groundRing,
      groundRingMat,
      playerCrown,
      shieldMesh,
      shieldMat,
      labelSprite,
      labelCanvas,
      labelTexture,
      lastRenderedScore: entity.score,
      lastRenderedName: entity.name,
    };
  }

  /**
   * Generates a high-contrast striped arcade sphere texture so ball rotation is visually unmistakable.
   */
  private createBallPatternTexture(primaryHex: string, accentHex: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Base fill
    ctx.fillStyle = primaryHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dark carbon meridian bands so rotation is easy to see from any angle
    ctx.fillStyle = '#0E172A';
    const stripeWidth = 42;
    for (let x = 32; x < canvas.width; x += 128) {
      ctx.fillRect(x, 0, stripeWidth, canvas.height);
    }

    // Accent racing stripes flanking each meridian band
    ctx.fillStyle = accentHex;
    for (let x = 32; x < canvas.width; x += 128) {
      ctx.fillRect(x - 8, 0, 8, canvas.height);
      ctx.fillRect(x + stripeWidth, 0, 8, canvas.height);
    }

    // Equatorial glowing core stripe
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, canvas.height * 0.44, canvas.width, canvas.height * 0.12);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, canvas.height * 0.46, canvas.width, canvas.height * 0.08);

    // Polar caps
    ctx.fillStyle = '#111A2E';
    ctx.fillRect(0, 0, canvas.width, 28);
    ctx.fillRect(0, canvas.height - 28, canvas.width, 28);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private drawLabelCanvas(
    canvas: HTMLCanvasElement,
    name: string,
    score: number,
    colorHex: string,
    isPlayer: boolean
  ): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pill background
    const w = 220;
    const h = 48;
    const x = (canvas.width - w) * 0.5;
    const y = (canvas.height - h) * 0.5;
    const r = 24;

    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = isPlayer ? 'rgba(6, 22, 46, 0.9)' : 'rgba(10, 16, 32, 0.78)';
    ctx.fill();
    ctx.lineWidth = isPlayer ? 4 : 2.5;
    ctx.strokeStyle = colorHex;
    ctx.stroke();

    // Name text
    ctx.font = '800 22px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(name, x + 20, canvas.height * 0.5 + 1);

    // Score badge
    ctx.textAlign = 'right';
    ctx.fillStyle = colorHex;
    ctx.font = '900 24px "Inter", "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`${score}`, x + w - 20, canvas.height * 0.5 + 1);
  }
}
