import * as THREE from 'three';
import { getArenaDefinition, type ArenaDefinition } from '../config/arenas';
import { ARENA_CONSTANTS } from '../config/constants';
import type { ArenaId, ArenaState, BallEntityState, GraphicsQuality } from '../types/game';
import { clamp } from '../utils/math';

interface BumperVisual {
  id: string;
  group: THREE.Group;
  coreMat: THREE.MeshStandardMaterial;
  ringMat: THREE.MeshBasicMaterial;
  pulseTimer: number;
}

interface HoleVisual {
  id: string;
  x: number;
  z: number;
  radius: number;
  rimMat: THREE.MeshStandardMaterial;
  dangerRingMat: THREE.MeshBasicMaterial;
}

export class ArenaRenderer {
  public readonly group = new THREE.Group();

  private currentArenaId: ArenaId = 'classic';
  private definition: ArenaDefinition;
  private lastBuiltOuterRadius = 0;

  private deckContainer = new THREE.Group();
  private deckMesh: THREE.Mesh | null = null;
  private surfaceTexture: THREE.CanvasTexture | null = null;
  private sideMaterial: THREE.MeshStandardMaterial;
  private topMaterial: THREE.MeshStandardMaterial;

  private outerRimGroup = new THREE.Group();
  private rimMesh!: THREE.Mesh;
  private rimMaterial!: THREE.MeshStandardMaterial;
  private dangerRingMesh!: THREE.Mesh;
  private dangerRingMaterial!: THREE.MeshBasicMaterial;

  private ghostBoundaryLine!: THREE.LineLoop;
  private ghostBoundaryMat!: THREE.LineBasicMaterial;

  private underDeckGroup = new THREE.Group();
  private coreGlowMat!: THREE.MeshBasicMaterial;

  private holesGroup = new THREE.Group();
  private holeVisuals: HoleVisual[] = [];

  private bumpersGroup = new THREE.Group();
  private bumperVisuals = new Map<string, BumperVisual>();

  private pylonsGroup = new THREE.Group();
  private pylonMat!: THREE.MeshStandardMaterial;
  private starfield: THREE.Points | null = null;

  constructor(initialArenaId: ArenaId = 'classic') {
    this.definition = getArenaDefinition(initialArenaId);

    this.sideMaterial = new THREE.MeshStandardMaterial({
      color: this.definition.theme.sideMetalHex,
      metalness: 0.65,
      roughness: 0.35,
      emissive: 0x0a1931,
      emissiveIntensity: 0.4,
    });

    this.topMaterial = new THREE.MeshStandardMaterial({
      metalness: 0.3,
      roughness: 0.42,
      emissive: 0x0b1d3a,
      emissiveIntensity: 0.22,
    });

    this.group.add(this.deckContainer);
    this.group.add(this.outerRimGroup);
    this.group.add(this.underDeckGroup);
    this.group.add(this.holesGroup);
    this.group.add(this.bumpersGroup);

    this.buildEnvironmentBackdrop();
    this.loadArena(initialArenaId);
  }

  public loadArena(arenaId: ArenaId): void {
    this.currentArenaId = arenaId;
    this.definition = getArenaDefinition(arenaId);
    const def = this.definition;

    // Update theme materials
    this.sideMaterial.color.setHex(def.theme.sideMetalHex);
    if (this.surfaceTexture) {
      this.surfaceTexture.dispose();
    }
    this.surfaceTexture = this.createArenaSurfaceTexture(def);
    this.topMaterial.map = this.surfaceTexture;
    this.topMaterial.needsUpdate = true;

    this.rebuildDeckMesh(def.baseRadius);
    this.rebuildOuterRimAndGhost(def);
    this.rebuildUnderDeck(def);
    this.rebuildHoles(def);
    this.rebuildBumpers(def);

    if (this.pylonMat) {
      this.pylonMat.emissive.set(def.theme.primaryHex);
    }
  }

  private rebuildDeckMesh(outerRadius: number): void {
    if (this.deckMesh) {
      this.deckMesh.geometry.dispose();
      this.deckContainer.remove(this.deckMesh);
      this.deckMesh = null;
    }

    this.lastBuiltOuterRadius = outerRadius;
    const def = this.definition;
    const deckHeight = ARENA_CONSTANTS.DECK_THICKNESS;

    if (def.holes.length === 0) {
      // Solid cylinder deck
      const deckGeo = new THREE.CylinderGeometry(
        def.baseRadius,
        def.baseRadius * 0.95,
        deckHeight,
        72,
        1
      );
      this.deckMesh = new THREE.Mesh(deckGeo, [
        this.sideMaterial,
        this.topMaterial,
        this.sideMaterial,
      ]);
      this.deckMesh.position.y = -deckHeight * 0.5;
      this.deckMesh.receiveShadow = true;
      this.deckContainer.add(this.deckMesh);
      const ratio = outerRadius / def.baseRadius;
      this.deckContainer.scale.set(ratio, 1, ratio);
      return;
    }

    // Perforated 3D deck with genuine open holes using THREE.ExtrudeGeometry
    this.deckContainer.scale.set(1, 1, 1);
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

    for (const hole of def.holes) {
      // Note: after rotateX(-PI/2), shape Y maps to -world Z, so use -hole.z for exact alignment!
      const holePath = new THREE.Path();
      holePath.absarc(hole.x, -hole.z, hole.radius, 0, Math.PI * 2, true);
      shape.holes.push(holePath);
    }

    const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
      depth: deckHeight,
      bevelEnabled: false,
      curveSegments: 64,
    });
    extrudeGeo.rotateX(-Math.PI * 0.5);
    extrudeGeo.translate(0, -deckHeight, 0);

    // Compute planar UVs in [0, 1] across [-baseRadius, +baseRadius] so top surface texture aligns 1:1
    const posAttr = extrudeGeo.attributes.position;
    const uvAttr = extrudeGeo.attributes.uv;
    const maxR = def.baseRadius;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const u = vx / (maxR * 2) + 0.5;
      const v = 1.0 - (vz / (maxR * 2) + 0.5);
      uvAttr.setXY(i, u, v);
    }
    uvAttr.needsUpdate = true;

    // ExtrudeGeometry uses group 0 for top/bottom caps and group 1 for side/hole walls
    this.deckMesh = new THREE.Mesh(extrudeGeo, [this.topMaterial, this.sideMaterial]);
    this.deckMesh.receiveShadow = true;
    this.deckContainer.add(this.deckMesh);
  }

  private rebuildOuterRimAndGhost(def: ArenaDefinition): void {
    while (this.outerRimGroup.children.length > 0) {
      const child = this.outerRimGroup.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      this.outerRimGroup.remove(child);
    }

    const baseRadius = def.baseRadius;

    // Glowing Outer Energy Rim
    const rimGeo = new THREE.TorusGeometry(baseRadius + 0.14, 0.22, 16, 96);
    rimGeo.rotateX(Math.PI * 0.5);
    this.rimMaterial = new THREE.MeshStandardMaterial({
      color: def.theme.rimHex,
      emissive: def.theme.rimEmissiveHex,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.5,
    });
    this.rimMesh = new THREE.Mesh(rimGeo, this.rimMaterial);
    this.rimMesh.position.y = -0.12;
    this.outerRimGroup.add(this.rimMesh);

    // Edge Danger Pulsing Ring Overlay on Top Surface
    const dangerGeo = new THREE.RingGeometry(baseRadius * 0.87, baseRadius * 0.996, 72);
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
    this.outerRimGroup.add(this.dangerRingMesh);

    // Original Arena Boundary Ghost Ring (visible when arena shrinks)
    if (this.ghostBoundaryLine) {
      this.ghostBoundaryLine.geometry.dispose();
      this.group.remove(this.ghostBoundaryLine);
    }
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
  }

  private rebuildUnderDeck(def: ArenaDefinition): void {
    while (this.underDeckGroup.children.length > 0) {
      const child = this.underDeckGroup.children[0] as THREE.Mesh;
      child.geometry?.dispose();
      this.underDeckGroup.remove(child);
    }

    const deckHeight = ARENA_CONSTANTS.DECK_THICKNESS;
    const baseRadius = def.baseRadius;

    // For Donut or Crater, keep under-deck reactor struts outside the hole shafts so holes are 100% clear void!
    if (def.id === 'donut') {
      const outerSupportGeo = new THREE.TorusGeometry(baseRadius * 0.68, 0.55, 12, 48);
      outerSupportGeo.rotateX(Math.PI * 0.5);
      const outerSupportMat = new THREE.MeshStandardMaterial({
        color: 0x0d172a,
        metalness: 0.8,
        roughness: 0.3,
        emissive: 0x150826,
        emissiveIntensity: 0.5,
      });
      const supportMesh = new THREE.Mesh(outerSupportGeo, outerSupportMat);
      supportMesh.position.y = -deckHeight - 1.4;
      this.underDeckGroup.add(supportMesh);

      const glowRingGeo = new THREE.TorusGeometry(def.innerHoleRadius + 1.2, 0.24, 12, 64);
      glowRingGeo.rotateX(Math.PI * 0.5);
      this.coreGlowMat = new THREE.MeshBasicMaterial({
        color: def.theme.rimHex,
        transparent: true,
        opacity: 0.8,
      });
      const glowMesh = new THREE.Mesh(glowRingGeo, this.coreGlowMat);
      glowMesh.position.y = -deckHeight - 0.9;
      this.underDeckGroup.add(glowMesh);
      return;
    }

    const coreRadius = def.id === 'crater' ? 4.8 : baseRadius * 0.55;
    const underCoreGeo = new THREE.CylinderGeometry(coreRadius, coreRadius * 0.45, 4.4, 12);
    const underCoreMat = new THREE.MeshStandardMaterial({
      color: 0x0d172a,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0x051229,
      emissiveIntensity: 0.5,
    });
    const underCoreMesh = new THREE.Mesh(underCoreGeo, underCoreMat);
    underCoreMesh.position.y = -deckHeight - 2.2;
    this.underDeckGroup.add(underCoreMesh);

    const reactorRingGeo = new THREE.TorusGeometry(coreRadius * 0.78, 0.24, 12, 48);
    reactorRingGeo.rotateX(Math.PI * 0.5);
    this.coreGlowMat = new THREE.MeshBasicMaterial({
      color: def.theme.rimHex,
      transparent: true,
      opacity: 0.75,
    });
    const coreGlowMesh = new THREE.Mesh(reactorRingGeo, this.coreGlowMat);
    coreGlowMesh.position.y = -deckHeight - 1.4;
    this.underDeckGroup.add(coreGlowMesh);
  }

  private rebuildHoles(def: ArenaDefinition): void {
    while (this.holesGroup.children.length > 0) {
      const child = this.holesGroup.children[0];
      this.holesGroup.remove(child);
    }
    this.holeVisuals = [];

    const deckHeight = ARENA_CONSTANTS.DECK_THICKNESS;

    for (const hole of def.holes) {
      const holeSubGroup = new THREE.Group();
      holeSubGroup.position.set(hole.x, 0, hole.z);

      // 1. Glowing Top Hazard Rim Torus around the hole edge
      const rimGeo = new THREE.TorusGeometry(hole.radius + 0.04, 0.16, 16, 64);
      rimGeo.rotateX(Math.PI * 0.5);
      const rimMat = new THREE.MeshStandardMaterial({
        color: def.theme.hazardHex,
        emissive: def.theme.hazardHex,
        emissiveIntensity: 1.25,
        roughness: 0.25,
        metalness: 0.5,
      });
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.position.y = -0.04;
      holeSubGroup.add(rimMesh);

      // 2. Surface Warning Ring around the hole
      const warnGeo = new THREE.RingGeometry(hole.radius + 0.08, hole.radius + 1.15, 64);
      warnGeo.rotateX(-Math.PI * 0.5);
      const dangerRingMat = new THREE.MeshBasicMaterial({
        color: def.theme.hazardHex,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const warnMesh = new THREE.Mesh(warnGeo, dangerRingMat);
      warnMesh.position.y = 0.018;
      holeSubGroup.add(warnMesh);

      // 3. Deep Abyssal Energy Coil inside the hole shaft (adds unmistakable 3D depth to the opening)
      const deepCoilGeo = new THREE.TorusGeometry(hole.radius * 0.92, 0.11, 12, 48);
      deepCoilGeo.rotateX(Math.PI * 0.5);
      const deepCoilMat = new THREE.MeshBasicMaterial({
        color: def.theme.primaryHex,
        transparent: true,
        opacity: 0.65,
      });
      const deepCoilMesh = new THREE.Mesh(deepCoilGeo, deepCoilMat);
      deepCoilMesh.position.y = -deckHeight * 0.85;
      holeSubGroup.add(deepCoilMesh);

      this.holesGroup.add(holeSubGroup);
      this.holeVisuals.push({
        id: hole.id,
        x: hole.x,
        z: hole.z,
        radius: hole.radius,
        rimMat,
        dangerRingMat,
      });
    }
  }

  private rebuildBumpers(def: ArenaDefinition): void {
    while (this.bumpersGroup.children.length > 0) {
      const child = this.bumpersGroup.children[0];
      this.bumpersGroup.remove(child);
    }
    this.bumperVisuals.clear();

    for (const bumper of def.bumpers) {
      const bGroup = new THREE.Group();
      bGroup.position.set(bumper.x, 0, bumper.z);

      // 1. Metallic Pedestal Base
      const baseGeo = new THREE.CylinderGeometry(
        bumper.radius * 1.08,
        bumper.radius * 1.18,
        0.35,
        32
      );
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x16243b,
        metalness: 0.8,
        roughness: 0.25,
      });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.y = 0.175;
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      bGroup.add(baseMesh);

      // 2. Glowing Energy Bumper Core Cylinder
      const coreGeo = new THREE.CylinderGeometry(
        bumper.radius * 0.92,
        bumper.radius * 0.92,
        bumper.height - 0.35,
        32
      );
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x00f59b,
        emissive: 0x00c880,
        emissiveIntensity: 0.95,
        roughness: 0.2,
        metalness: 0.35,
      });
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.y = bumper.height * 0.5;
      coreMesh.castShadow = true;
      bGroup.add(coreMesh);

      // 3. Top Cap & Repulsor Halo Ring
      const capGeo = new THREE.CylinderGeometry(
        bumper.radius * 0.72,
        bumper.radius * 1.04,
        0.32,
        32
      );
      const capMesh = new THREE.Mesh(capGeo, baseMat);
      capMesh.position.y = bumper.height - 0.12;
      bGroup.add(capMesh);

      const haloGeo = new THREE.TorusGeometry(bumper.radius + 0.18, 0.12, 12, 40);
      haloGeo.rotateX(Math.PI * 0.5);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85,
      });
      const haloMesh = new THREE.Mesh(haloGeo, ringMat);
      haloMesh.position.y = 0.95;
      bGroup.add(haloMesh);

      // 4. Floor Danger / Rebound Zone Ring
      const floorRingGeo = new THREE.RingGeometry(bumper.radius + 0.15, bumper.radius + 0.95, 48);
      floorRingGeo.rotateX(-Math.PI * 0.5);
      const floorRingMat = new THREE.MeshBasicMaterial({
        color: 0x00f59b,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const floorRing = new THREE.Mesh(floorRingGeo, floorRingMat);
      floorRing.position.y = 0.02;
      bGroup.add(floorRing);

      this.bumpersGroup.add(bGroup);
      this.bumperVisuals.set(bumper.id, {
        id: bumper.id,
        group: bGroup,
        coreMat,
        ringMat,
        pulseTimer: 0,
      });
    }
  }

  public triggerBumperPulse(bumperId: string): void {
    const b = this.bumperVisuals.get(bumperId);
    if (b) {
      b.pulseTimer = 0.28;
    }
  }

  private createArenaSurfaceTexture(def: ArenaDefinition): THREE.CanvasTexture {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size * 0.5;
    const cy = size * 0.5;
    const maxR = size * 0.5;
    const worldToPx = maxR / def.baseRadius;

    // Deep stylized radial background gradient matching arena theme
    const bgGrad = ctx.createRadialGradient(cx, cy, maxR * 0.05, cx, cy, maxR);
    bgGrad.addColorStop(0, def.theme.deckColorCenter);
    bgGrad.addColorStop(0.55, def.theme.deckColorMid);
    bgGrad.addColorStop(0.85, '#0D1830');
    bgGrad.addColorStop(1, def.theme.deckColorEdge);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Subtle geometric radial sector lines
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.lineWidth = 3;
    const sectors = 12;
    const innerLineStart =
      def.innerHoleRadius > 0 ? (def.innerHoleRadius / def.baseRadius) * maxR * 1.08 : maxR * 0.18;
    for (let i = 0; i < sectors; i++) {
      const angle = (i * Math.PI * 2) / sectors;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * innerLineStart, Math.sin(angle) * innerLineStart);
      ctx.lineTo(Math.cos(angle) * maxR * 0.86, Math.sin(angle) * maxR * 0.86);
      ctx.stroke();
    }
    ctx.restore();

    // Concentric arcade distance rings
    const ringRadii =
      def.innerHoleRadius > 0
        ? [0.42, 0.58, 0.74, 0.86]
        : [0.18, 0.36, 0.56, 0.74, 0.86];
    ringRadii.forEach((ratio, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
      ctx.strokeStyle =
        idx === ringRadii.length - 1 ? 'rgba(255, 168, 0, 0.45)' : 'rgba(0, 240, 255, 0.22)';
      ctx.lineWidth = idx === 0 || idx === ringRadii.length - 1 ? 5 : 3;
      ctx.stroke();
    });

    // Center Emblem Hexagon (when center is solid)
    if (def.innerHoleRadius === 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      const hexR = maxR * 0.12;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const hx = Math.cos(a) * hexR;
        const hy = Math.sin(a) * hexR;
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 240, 255, 0.14)';
      ctx.fill();
      ctx.strokeStyle = def.theme.primaryHex;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }

    // Draw hazard warning ticks around every internal hole on the canvas texture too
    for (const hole of def.holes) {
      const hx = cx + hole.x * worldToPx;
      const hy = cy + hole.z * worldToPx;
      const hr = hole.radius * worldToPx;

      ctx.save();
      ctx.translate(hx, hy);
      const ticks = 28;
      for (let i = 0; i < ticks; i++) {
        const a = (i * Math.PI * 2) / ticks;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (hr + 6), Math.sin(a) * (hr + 6));
        ctx.lineTo(Math.cos(a) * (hr + 24), Math.sin(a) * (hr + 24));
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 59, 48, 0.8)' : 'rgba(255, 183, 3, 0.55)';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Outer Hazard Warning Track (ticks around the outer edge)
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
    const pylonCount = 10;
    const pylonGeo = new THREE.OctahedronGeometry(2.2, 0);
    this.pylonMat = new THREE.MeshStandardMaterial({
      color: 0x162a4a,
      roughness: 0.35,
      metalness: 0.7,
      emissive: 0x0066aa,
      emissiveIntensity: 0.35,
    });

    for (let i = 0; i < pylonCount; i++) {
      const angle = (i / pylonCount) * Math.PI * 2;
      const dist = 42 + (i % 3) * 6;
      const pylon = new THREE.Mesh(pylonGeo, this.pylonMat);
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
      const r = 38 + rand() * 85;
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

  public update(
    arena: ArenaState,
    elapsedTime: number,
    entities: ReadonlyArray<BallEntityState> = [],
    dt = 1 / 60
  ): void {
    if (arena.arenaId !== this.currentArenaId) {
      this.loadArena(arena.arenaId);
    }

    const scaleRatio = arena.currentRadius / this.definition.baseRadius;
    this.outerRimGroup.scale.set(scaleRatio, 1, scaleRatio);

    if (this.definition.holes.length === 0) {
      this.deckContainer.scale.set(scaleRatio, 1, scaleRatio);
    } else if (Math.abs(arena.currentRadius - this.lastBuiltOuterRadius) >= 0.22) {
      // Throttled rebuild of extruded perforated deck during final-30s shrink so holes stay fixed while outer rim contracts
      this.rebuildDeckMesh(arena.currentRadius);
    }

    // Rotate distant backdrop slowly for spatial dynamism
    this.pylonsGroup.rotation.y = elapsedTime * 0.04;
    if (this.starfield) {
      this.starfield.rotation.y = -elapsedTime * 0.015;
    }

    // Pulse hole warning rims brighter when any ball approaches a hole
    const baseHolePulse = 0.5 + 0.5 * Math.sin(elapsedTime * 5.0);
    for (const hVis of this.holeVisuals) {
      let minClearance = 999;
      for (const e of entities) {
        if (!e.isAlive) continue;
        const d = Math.hypot(e.position.x - hVis.x, e.position.z - hVis.z) - hVis.radius;
        if (d < minClearance) minClearance = d;
      }
      const proximityBoost = minClearance < 4.2 ? clamp(1 - minClearance / 4.2, 0, 1) : 0;
      hVis.rimMat.emissiveIntensity = 1.05 + baseHolePulse * 0.45 + proximityBoost * 1.1;
      hVis.dangerRingMat.opacity = 0.18 + baseHolePulse * 0.1 + proximityBoost * 0.35;
    }

    // Animate energy bumper pillars
    for (const bVis of this.bumperVisuals.values()) {
      if (bVis.pulseTimer > 0) {
        bVis.pulseTimer = Math.max(0, bVis.pulseTimer - dt);
        const p = bVis.pulseTimer / 0.28;
        bVis.coreMat.emissive.setHex(0xffffff);
        bVis.coreMat.emissiveIntensity = 1.2 + p * 1.6;
        bVis.group.scale.set(1 + p * 0.16, 1 - p * 0.08, 1 + p * 0.16);
      } else {
        const idlePulse = 0.5 + 0.5 * Math.sin(elapsedTime * 4.2);
        bVis.coreMat.emissive.setHex(0x00c880);
        bVis.coreMat.emissiveIntensity = 0.85 + idlePulse * 0.35;
        bVis.group.scale.set(1, 1, 1);
      }
      bVis.ringMat.opacity = 0.65 + 0.25 * Math.sin(elapsedTime * 6.0);
    }

    // Pulse outer rim and hazard overlay during final 30s shrinking phase
    if (arena.isShrinking) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsedTime * 8.5);
      this.rimMaterial.color.setHex(0xff4733);
      this.rimMaterial.emissive.setHex(0xff2a00);
      this.rimMaterial.emissiveIntensity = 1.0 + pulse * 0.9;

      this.dangerRingMaterial.opacity = 0.22 + pulse * 0.28;
      this.ghostBoundaryMat.opacity = 0.38;
      if (this.coreGlowMat) {
        this.coreGlowMat.color.setHex(0xff4733);
      }
    } else {
      const gentlePulse = 0.5 + 0.5 * Math.sin(elapsedTime * 2.5);
      this.rimMaterial.color.setHex(this.definition.theme.rimHex);
      this.rimMaterial.emissive.setHex(this.definition.theme.rimEmissiveHex);
      this.rimMaterial.emissiveIntensity = 0.9 + gentlePulse * 0.3;

      this.dangerRingMaterial.opacity = 0.12 + gentlePulse * 0.06;
      this.ghostBoundaryMat.opacity = 0.0;
      if (this.coreGlowMat) {
        this.coreGlowMat.color.setHex(this.definition.theme.rimHex);
      }
    }
  }
}
