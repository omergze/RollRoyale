import type { QuaternionLike, Vector3Like } from '../types/game';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function vec3(x = 0, y = 0, z = 0): Vector3Like {
  return { x, y, z };
}

export function cloneVec3(v: Vector3Like): Vector3Like {
  return { x: v.x, y: v.y, z: v.z };
}

export function lerpVec3(a: Vector3Like, b: Vector3Like, t: number): Vector3Like {
  const alpha = clamp(t, 0, 1);
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

export function lengthXZ(v: Vector3Like): number {
  return Math.hypot(v.x, v.z);
}

export function lengthVec3(v: Vector3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function distanceXZ(a: Vector3Like, b: Vector3Like): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function normalizeXZ(v: Vector3Like): Vector3Like {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-6) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / len, y: 0, z: v.z / len };
}

export function dotXZ(a: Vector3Like, b: Vector3Like): number {
  return a.x * b.x + a.z * b.z;
}

export function identityQuat(): QuaternionLike {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function cloneQuat(q: QuaternionLike): QuaternionLike {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function normalizeQuat(q: QuaternionLike): QuaternionLike {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len < 1e-8) {
    return identityQuat();
  }
  return {
    x: q.x / len,
    y: q.y / len,
    z: q.z / len,
    w: q.w / len,
  };
}

export function multiplyQuat(a: QuaternionLike, b: QuaternionLike): QuaternionLike {
  return normalizeQuat({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

export function quatFromAxisAngle(axis: Vector3Like, angleRad: number): QuaternionLike {
  const len = Math.hypot(axis.x, axis.y, axis.z);
  if (len < 1e-6 || Math.abs(angleRad) < 1e-7) {
    return identityQuat();
  }
  const half = angleRad * 0.5;
  const s = Math.sin(half) / len;
  return normalizeQuat({
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(half),
  });
}

export function slerpQuat(a: QuaternionLike, b: QuaternionLike, t: number): QuaternionLike {
  const alpha = clamp(t, 0, 1);
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;

  let cosHalfTheta = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosHalfTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }

  if (cosHalfTheta >= 0.9995) {
    return normalizeQuat({
      x: a.x + alpha * (bx - a.x),
      y: a.y + alpha * (by - a.y),
      z: a.z + alpha * (bz - a.z),
      w: a.w + alpha * (bw - a.w),
    });
  }

  const halfTheta = Math.acos(clamp(cosHalfTheta, -1, 1));
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  if (Math.abs(sinHalfTheta) < 0.001) {
    return normalizeQuat({
      x: a.x * 0.5 + bx * 0.5,
      y: a.y * 0.5 + by * 0.5,
      z: a.z * 0.5 + bz * 0.5,
      w: a.w * 0.5 + bw * 0.5,
    });
  }

  const ratioA = Math.sin((1 - alpha) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(alpha * halfTheta) / sinHalfTheta;

  return normalizeQuat({
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  });
}

/**
 * Integrates visual rolling rotation for a sphere of radius R moving by (dx, dz) on a flat floor.
 */
export function integrateRollingRotation(
  currentRotation: QuaternionLike,
  dx: number,
  dz: number,
  radius: number
): QuaternionLike {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-5 || radius <= 0) {
    return currentRotation;
  }
  // Rolling axis on horizontal plane: n x v = (0, 1, 0) x (dx, 0, dz) = (dz, 0, -dx)
  const axis: Vector3Like = { x: dz / dist, y: 0, z: -dx / dist };
  const angle = dist / radius;
  const deltaQuat = quatFromAxisAngle(axis, angle);
  return multiplyQuat(deltaQuat, currentRotation);
}
