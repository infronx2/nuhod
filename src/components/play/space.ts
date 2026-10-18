/**
 * Units and axes for the web majlis. Everything is in centimetres, like the Unreal game, so the
 * room, the reaches and the task radii port one to one.
 *
 * Unreal (and the pose server) use X forward, Y right, Z up. three.js uses x right, y up and looks
 * down -z, so a game point (fwd, right, up) is the three.js point (right, up, -fwd).
 */
import * as THREE from 'three'

export function ue(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(y, z, -x)
}

/** Unreal-style rotator (pitch, yaw, roll in degrees) as a three.js quaternion. */
export function ueRot(pitch: number, yaw: number, roll: number): THREE.Quaternion {
  // Unreal applies roll about X (forward), then pitch about Y (right), then yaw about Z (up).
  const d = THREE.MathUtils.degToRad
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), d(roll))
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), d(pitch))
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -d(yaw))
  return qYaw.multiply(qPitch).multiply(qRoll)
}

// Room layout (cm), from NuhoudMajlis.cpp. The actor origin is the centre of the floor.
export const ROOM = {
  halfX: 300,
  halfY: 250,
  ceiling: 320,
  wall: 20,
  windowBottom: 95,
  windowTop: 235,
  mattressHeight: 14,
  mattressDepth: 70,
}

/** Cross-legged on the back-wall mattress; eyes about 76 cm above the seat. */
export const EYES = ue(-235, 0, 90)

/** The table top sits 45 cm below the eyes, like a desk in front of a camera, so reaches map 1:1. */
export const TABLE = { centerX: -195, centerY: 0, top: 45, diameter: 84 }

/** A point on the table: offset x away from the patient, y to the patient's right, height above the top. */
export function tablePoint(x: number, y: number, h = 0): THREE.Vector3 {
  return ue(TABLE.centerX + x, TABLE.centerY + y, TABLE.top + h)
}

export const LAYOUT = {
  tray: [14, 0] as const,
  bowl: [-10, -16] as const,
  cups: [[-10, 15], [-2, 22], [-12, 27]] as const,
  lanternSpotRight: [6, 30] as const,
  plateSpotRight: [8, 33] as const,
  trayTopZ: 0.9,
  bowlFloorZ: 1,
}

/** Hooks for the lanterns already hung, along the front and side walls. */
export const HANG_SLOTS = [
  [255, 0, 160], [255, -100, 160], [255, 100, 160], [255, -175, 175], [255, 175, 175],
  [170, -215, 180], [170, 215, 180], [70, -215, 180], [70, 215, 180], [-30, -215, 180], [-30, 215, 180],
].map(([x, y, z]) => ue(x, y, z))

/** The mouth relative to the eyes: slightly forward and below. */
export const MOUTH = EYES.clone().add(ue(6, 0, -9))

/** Unreal linear colour (0-1, linear) as a three.js colour. */
export function lin(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace)
}
