import * as THREE from 'three';
import { ARENA_CONSTANTS } from '../config/constants';
import type { ArenaState, GraphicsQuality } from '../types/game';

export class ArenaRenderer {
  public readonly group = new THREE.Group();

  private deckGroup = new THREE.Group();
  private deckMesh: THREE.Mesh;
  private rimMesh: THREE.Mesh;
  private rimMaterial: THREE.MeshStandardMaterial;
  private dangerRingMesh: THREE.Mesh;
  private dangerRingMaterial: THREE.MeshBasicMaterial;
  private ghostBoundaryLine: THREE.LineLoop;
  private ghostBoundaryMat: THREE.LineBasicMaterial;
  private coreGlowMesh: THREE.Mesh;
  private coreGlowMat: THREE.MeshBasicMaterial;
  private pylonsGroup = new THREE.Group();
  private starfield: THREE.Points | null = null;
  private baseRadius: number;

  constructor(baseRadius: number = ARENA_CONSTANTS.BASE_RADIUS) {
    this.baseRadius = baseRadius;

    // 1. Main Playable Deck Cylinder
    const deckHeight = ARENA_CONSTANTS.DECK_THICKNESS;
    const deckGeo = new THREE.CylinderGeometry(baseRadius, baseRadius * 0.94, deckHeight, 72, 1);
    const surfaceTex = this.createArenaSurfaceTexture();
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x162447,
      metalness: 0.65,
      roughness: 0.35,
      emissive: 0x0a1931,
      emissiveIntensity: 0.4,
    });
    const topMat = new THREE.MeshStandardMaterial({
      map: surfaceTex,
      metalness: 0.3,
      roughness: 0.42,
      emissive: 0x0b1d3a,
      emissiveIntensity: 0.22,
    });
    const bottomMat = new THREE.MeshStandardMaterial({
      color: 0x090f1d,
      metalness: 0.7,
      roughness: 0.4,
    });

    this.deckMesh = new THREE.Mesh(deckGeo, [sideMat, topMat, bottomMat]);
    this.deckMesh.position.y = -deckHeight * 0.5;
    this.deckMesh.receiveShadow = true;
    this.deckGroup.add(this.deckMesh);

    // 2. Glowing Outer Energy Rim (slightly below surface so balls roll cleanly off)
    const rimGeo = new THREE.TorusGeometry(baseRadius + 0.14, 0.22, 16, 96);
    rimGeo.rotateX(Math.PI * 0.5);
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d9ff,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.5,
    });
    this.rimMesh = new THREE.Mesh(rimGeo, this.rimMaterial);
    this.rimMesh.position.y = -0.12;
    this.deckGroup.add(this.rimMesh);

    // 3. Edge Danger Pulsing Ring Overlay on Top Surface
    const dangerGeo = new THREE.RingGeometry(baseRadius * 0.84, baseRadius * 0.995, 72);
    dangerGeo.rotateX(-Math.PI * 0.5);
    this.dangerRingMaterial = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.dangerRingMesh = new THREE.Mesh(dangerGeo, this.dangerRingMaterial);
    this.dangerRingMesh.position.y = 0.015;
    this.deckGroup.add(this.dangerRingMesh);

    // 4. Under-Deck Futuristic Reactor Core & Support Struts
    const underCoreGeo = new THREE.CylinderGeometry(baseRadius * 0.65, baseRadius * 0.28, 4.8, 12);
    const underCoreMat = new THREE.MeshStandardMaterial({
      color: 0x0d172a,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x051229,
      emissiveIntensity: 0.5,
    });
    const underCoreMesh = new THREE.Mesh(underCoreGeo, underCoreMat);
    underCoreMesh.position.y = -deckHeight - 2.4;
    this.deckGroup.add(underCoreMesh);

    const reactorRingGeo = new THREE.TorusGeometry(baseRadius * 0.45, 0.28, 12, 48);
    reactorRingGeo.rotateX(Math.PI * 0.5);
    this.coreGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.75,
    });
    this.coreGlowMesh = new THREE.Mesh(reactorRingGeo, this.coreGlowMat);
    this.coreGlowMesh.position.y = -deckHeight - 1.6;
    this.deckGroup.add(this.coreGlowMesh);

    this.group.add(this.deckGroup);

    // 5. Original Arena Boundary Ghost Ring (visible when arena shrinks)
    const ghostPoints: THREE.Vector3[] = [];
    const segments = 96;
    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      ghostPoints.push(
        new THREE.Vector3(Math.cos(theta) * baseRadius, 0.05, Math.sin(theta) * baseRadius)
      );
    }
    const ghostGeo = new THREE.BufferGeometry().setFromPoints(ghostPoints);
    this.ghostBoundaryMat = new THREE.LineBasicMaterial({
      color: 0xff4757,
      transparent: true,
      opacity: 0.0,
    });
    this.ghostBoundaryLine = new THREE.LineLoop(ghostGeo, this.ghostBoundaryMat);
    this.group.add(this.ghostBoundaryLine);

    // 6. Distant Floating Monoliths & Starfield Backdrop
    this.buildEnvironmentBackdrop();
  }

  private createArenaSurfaceTexture(): THREE.CanvasTexture {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size * 0.5;
    const cy = size * 0.5;
    const maxR = size * 0.5;

    // Deep stylized radial background gradient
    const bgGrad = ctx.createRadialGradient(cx, cy, maxR * 0.05, cx, cy, maxR);
    bgGrad.addColorStop(0, '#1B2D52');
    bgGrad.addColorStop(0.55, '#12203D');
    bgGrad.addColorStop(0.84, '#0D1830');
    bgGrad.addColorStop(1, '#1A1428');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle hexagonal/geometric radial sector lines
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.lineWidth = 3;
    const sectors = 12;
    for (let i = 0; i < sectors; i++) {
      const angle = (i * Math.PI * 2) / sectors;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * maxR * 0.18, Math.sin(angle) * maxR * 0.18);
      ctx.lineTo(Math.cos(angle) * maxR * 0.86, Math.sin(angle) * maxR * 0.86);
      ctx.stroke();
    }
    ctx.restore();

    // Concentric arcade distance rings
    const ringRadii = [0.18, 0.36, 0.56, 0.74, 0.86];
    ringRadii.forEach((ratio, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
      ctx.strokeStyle =
        idx === ringRadii.length - 1 ? 'rgba(255, 168, 0, 0.45)' : 'rgba(0, 240, 255, 0.22)';
      ctx.lineWidth = idx === 0 || idx === ringRadii.length - 1 ? 5 : 3;
      ctx.stroke();
    });

    // Center Emblem Hexagon
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    const hexR = maxR * 0.13;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const hx = Math.cos(a) * hexR;
      const hy = Math.sin(a) * hexR;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.16)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.65)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    // Outer Hazard Warning Track (ticks around the edge)
    ctx.save();
    ctx.translate(cx, cy);
    const hazardTicks = 48;
    for (let i = 0; i < hazardTicks; i++) {
      const a = (i * Math.PI * 2) / hazardTicks;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * maxR * 0.88, Math.sin(a) * maxR * 0.88);
      ctx.lineTo(Math.cos(a) * maxR * 0.96, Math.sin(a) * maxR * 0.96);
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 94, 58, 0.65)' : 'rgba(255, 195, 0, 0.35)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  private buildEnvironmentBackdrop(): void {
    // Distant floating geometric pylons around the arena
    const pylonCount = 10;
    const pylonGeo = new THREE.OctahedronGeometry(2.2, 0);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x162a4a,
      roughness: 0.35,
      metalness: 0.7,
      emissive: 0x0066aa,
      emissiveIntensity: 0.35,
    });

    for (let i = 0; i < pylonCount; i++) {
      const angle = (i / pylonCount) * Math.PI * 2;
      const dist = this.baseRadius + 18 + (i % 3) * 6;
      const pylon = new THREE.Mesh(pylonGeo, pylonMat);
      pylon.position.set(
        Math.cos(angle) * dist,
        -3 + (i % 4) * 2.5,
        Math.sin(angle) * dist
      );
      pylon.scale.set(0.8, 2.4 + (i % 3) * 0.7, 0.8);
      this.pylonsGroup.add(pylon);
    }
    this.group.add(this.pylonsGroup);

    // Ambient starfield / floating energy motes
    const starCount = 450;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const c1 = new THREE.Color(0x00f0ff);
    const c2 = new THREE.Color(0xff2e93);
    const c3 = new THREE.Color(0xffffff);

    let seed = 42;
    const rand = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    for (let i = 0; i < starCount; i++) {
      const r = 36 + rand() * 85;
      const theta = rand() * Math.PI * 2;
      const y = -28 + rand() * 62;
      positions[i * 3] = Math.cos(theta) * r;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(theta) * r;

      const pick = i % 5 === 0 ? c1 : i % 7 === 0 ? c2 : c3;
      colors[i * 3] = pick.r;
      colors[i * 3 + 1] = pick.g;
      colors[i * 3 + 2] = pick.b;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 0.65,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
    });
    this.starfield = new THREE.Points(starGeo, starMat);
    this.group.add(this.starfield);
  }

  public applyGraphicsQuality(quality: GraphicsQuality): void {
    this.pylonsGroup.visible = quality !== 'low';
    if (this.starfield) {
      this.starfield.visible = true;
    }
  }

  public update(arena: ArenaState, elapsedTime: number): void {
    const scaleRatio = arena.currentRadius / this.baseRadius;
    this.deckGroup.scale.set(scaleRatio, 1, scaleRatio);

    // Rotate distant backdrop slowly for spatial dynamism
    this.pylonsGroup.rotation.y = elapsedTime * 0.04;
    if (this.starfield) {
      this.starfield.rotation.y = -elapsedTime * 0.015;
    }

    // Pulse rim and hazard overlay during final 30s shrinking phase
    if (arena.isShrinking) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 8.5);
      this.rimMaterial.color.setHex(0xff4733);
      this.rimMaterial.emissive.setHex(0xff2a00);
      this.rimMaterial.emissiveIntensity = 1.0 + pulse * 0.9;

      this.dangerRingMaterial.opacity = 0.22 + pulse * 0.28;
      this.ghostBoundaryMat.opacity = 0.38;
      this.coreGlowMat.color.setHex(0xff4733);
    } else {
      const gentlePulse = 0.5 + 0.5 * Math.sin(elapsedTime * 2.5);
      this.rimMaterial.color.setHex(0x00f0ff);
      this.rimMaterial.emissive.setHex(0x00c8ff);
      this.rimMaterial.emissiveIntensity = 0.9 + gentlePulse * 0.3;

      this.dangerRingMaterial.opacity = 0.12 + gentlePulse * 0.06;
      this.ghostBoundaryMat.opacity = 0.0;
      this.coreGlowMat.color.setHex(0x00f0ff);
    }
  }
}
