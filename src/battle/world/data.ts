/**
 * The valley's exported data (vg-showcase-demo/world/build.py): a manifest
 * (gen/world-ninh-binh.json) and one binary blob (assets/world/ninh-binh.bin).
 */

export interface WorldMesh {
  count: number;
  attrs: Record<string, { o: number; w: number }>;
  index: { o: number; n: number };
  bbox: number[];
}

export interface WorldChunk {
  /** rows of (x, y, z, yaw, scale) */
  o: number;
  n: number;
  center: [number, number, number];
  radius: number;
}

export type InstanceKind = "foliage" | "grass" | "rice" | "lotus" | "rock";

export interface WorldManifest {
  version: number;
  size: number;
  water: number;
  heightfield: { o: number; n: number; x0: number; cell: number };
  meshes: WorldMesh[];
  /** `tex`: a hero piece's painted texture (see WorldTexture) */
  statics: { name: string; mesh: number; kind: "terrain" | "karst" | "prop" | "hero" | "glow"; tex?: WorldTexture }[];
  instances: { name: string; mesh: number; kind: InstanceKind; count: number; chunks: WorldChunk[] }[];
  /** Meshy pieces placed many times: one model and texture, rows of (x, y, z, turn, scale) per cell */
  heroInstances?: { name: string; mesh: number; tex: WorldTexture; chunks: WorldChunk[] }[];
  colliders: { x: number; y: number; r: number }[];
  markers: { name: string; type: "spawn" | "shrine" | "camp" | "boss"; at: [number, number]; z: number; yaw?: number; waves?: number }[];
  spirits: { x: number; y: number; z: number }[];
  stairs: [[number, number], [number, number]];
  bridge: [[number, number], [number, number]];
  river: [number, number][];
  paths: [number, number][][];
  village: [number, number, number];
  temple: [number, number];
  terraces: [number, number, number, number];
  /** the valley's lights, for the glow drawn round them */
  halos?: [number, number, number, "silk" | "flame"][];
}

/**
 * A hero piece's painted texture (sRGB, bottom row first): ASTC blocks of
 * `astc` x `astc` texels, a level per mip, in the texture blob (`levels`:
 * [offset, bytes, width, height]); or, from an older export, raw RGB rows at
 * `o` in the main blob.
 */
export interface WorldTexture {
  w: number;
  h: number;
  o?: number;
  astc?: number;
  levels?: [number, number, number, number][];
}

export class WorldData {
  constructor(
    readonly manifest: WorldManifest,
    readonly blob: ArrayBuffer,
    /** the hero pieces' compressed textures (assets/world/ninh-binh-tex.bin) */
    readonly textures: ArrayBuffer | null = null,
  ) {}

  f32(offset: number, length: number) {
    return new Float32Array(this.blob, offset, length);
  }

  u32(offset: number, length: number) {
    return new Uint32Array(this.blob, offset, length);
  }

  u8(offset: number, length: number) {
    return new Uint8Array(this.blob, offset, length);
  }
}

/** The walkable ground: bilinear heights on the exported grid. */
export class Heightfield {
  private readonly h: Float32Array;
  private readonly n: number;
  private readonly x0: number;
  private readonly cell: number;

  constructor(data: WorldData) {
    const hf = data.manifest.heightfield;
    this.n = hf.n;
    this.x0 = hf.x0;
    this.cell = hf.cell;
    this.h = data.f32(hf.o, hf.n * hf.n);
  }

  at(x: number, y: number) {
    const f = (x - this.x0) / this.cell;
    const g = (y - this.x0) / this.cell;
    const n = this.n;
    const i = Math.min(Math.max(Math.floor(f), 0), n - 2);
    const j = Math.min(Math.max(Math.floor(g), 0), n - 2);
    const fx = Math.min(Math.max(f - i, 0), 1);
    const fy = Math.min(Math.max(g - j, 0), 1);
    const h = this.h;
    const a = h[j * n + i] * (1 - fx) + h[j * n + i + 1] * fx;
    const b = h[(j + 1) * n + i] * (1 - fx) + h[(j + 1) * n + i + 1] * fx;
    return a * (1 - fy) + b * fy;
  }
}
