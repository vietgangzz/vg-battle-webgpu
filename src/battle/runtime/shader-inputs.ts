/**
 * What the generated shader factories (gen/materials.ts, gen/particles.ts) are
 * given by the player: TypeGPU accessors for three.js uniforms and attributes.
 */
import type * as t3 from "@typegpu/three";
import type { d } from "typegpu";

// the accessor's TSL node type does not matter to the shaders
export type Accessor<T extends d.AnyWgslData> = t3.TSLAccessor<T, any>;

export interface MatInputs {
  /** an animated (or constant) Value node of the material */
  p(name: string, def: number): Accessor<d.F32>;
  /** a float mesh attribute (the exporter's u / v / ts) */
  attr(name: string): Accessor<d.F32>;
  /** a per-instance value computed by the particle motion ("age", "pseed") */
  inst(name: string): () => number;
  /** planar ground reflection: 0 = sharp, 1 = blurred */
  reflection(level: 0 | 1): Accessor<d.Vec3f>;
  /** shading normal in world / view space ("use gpu" functions; particles turn theirs with the instance) */
  normalWorld: () => d.v3f;
  normalView: () => d.v3f;
}

export interface GnInputs {
  /** a geometry-node group input (Time, Drag, Gravity, ...) */
  i(name: string): Accessor<d.F32>;
  /** the point's rest position */
  p0: Accessor<d.Vec3f>;
  af(name: string): Accessor<d.F32>;
  av(name: string): Accessor<d.Vec3f>;
}
