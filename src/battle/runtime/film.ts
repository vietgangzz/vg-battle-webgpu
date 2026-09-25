/**
 * The exported film: manifest (gen/film.json) + one binary blob (assets/film/film.bin).
 *
 * Every animated value is a per-frame track at 24 fps. The player runs at the
 * display rate and samples between frames: linear for continuous tracks, held
 * for step tracks (visibility), so hit-stops and cuts land on the same frames
 * as the Blender render.
 */

export interface TrackMeta {
  /** byte offset into the blob */
  o: number;
  /** samples: 1 = constant, else one per frame */
  n: number;
  /** components per sample */
  c: number;
  /** held between frames (no interpolation) */
  s: boolean;
}

export interface AttrMeta {
  o: number;
  w: number;
}

export interface MeshMeta {
  count: number;
  attrs: Record<string, AttrMeta>;
  index: { o: number; n: number };
  bbox: number[];
}

export interface XfMeta {
  p: string;
  q: string;
  s: string;
}

export interface ObjectMeta {
  name: string;
  mesh: number;
  groups: { start: number; count: number; mat: string }[];
  xf: XfMeta;
  vis: string;
  overlay?: string;
  deform?: { o: number; n: number; verts: number };
}

export interface ParticleMeta {
  name: string;
  group: string;
  count: number;
  attrs: Record<string, AttrMeta>;
  inputs: Record<string, string>;
  shape: { mesh: MeshMeta; mat: string } | null;
  xf: XfMeta;
}

export interface CameraMeta {
  name: string;
  xf: XfMeta;
  lens: string;
  sensor: number;
  clip: [number, number];
  dof: { fstop: number; focus: string } | null;
}

export interface LightMeta {
  name: string;
  type: "SUN" | "POINT" | "SPOT" | "AREA";
  color: number[];
  radius: number;
  volume: number;
  energy: string;
  xf: XfMeta;
}

export interface Manifest {
  version: number;
  fps: number;
  frames: number;
  exposure: number;
  objects: ObjectMeta[];
  meshes: MeshMeta[];
  materials: Record<string, import("./materials").MaterialDef>;
  world: { fn: string; params: Record<string, { d: number; t?: string }> };
  particles: ParticleMeta[];
  cameras: CameraMeta[];
  cuts: [number, number][];
  lights: LightMeta[];
  post: Record<string, string>;
  tracks: Record<string, TrackMeta>;
}

const SCRATCH = [0, 0, 0, 0];

export class Track {
  private readonly data: Float32Array;

  constructor(
    blob: ArrayBuffer,
    readonly meta: TrackMeta,
    private readonly last: number,
  ) {
    this.data = new Float32Array(blob, meta.o, meta.n * meta.c);
  }

  get constant() {
    return this.meta.n === 1;
  }

  /** Sample at a fractional frame into `out` (length >= components). */
  read(frame: number, out: number[] | Float32Array) {
    const { c, n, s } = this.meta;
    if (n === 1) {
      for (let k = 0; k < c; k++) out[k] = this.data[k];
      return out;
    }
    const f = Math.min(Math.max(frame, 0), this.last);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, this.last);
    const t = s ? 0 : f - i0;
    for (let k = 0; k < c; k++) {
      const a = this.data[i0 * c + k];
      out[k] = t === 0 ? a : a + (this.data[i1 * c + k] - a) * t;
    }
    return out;
  }

  value(frame: number) {
    this.read(frame, SCRATCH);
    return SCRATCH[0];
  }
}

export class Film {
  private readonly tracks = new Map<string, Track>();

  constructor(
    readonly manifest: Manifest,
    readonly blob: ArrayBuffer,
  ) {}

  get fps() {
    return this.manifest.fps;
  }

  /** film length in seconds (frame 0 .. last frame, inclusive) */
  get duration() {
    return this.manifest.frames / this.manifest.fps;
  }

  track(key: string) {
    let t = this.tracks.get(key);
    if (!t) {
      const meta = this.manifest.tracks[key];
      if (!meta) throw new Error(`[film] missing track ${key}`);
      t = new Track(this.blob, meta, this.manifest.frames - 1);
      this.tracks.set(key, t);
    }
    return t;
  }

  f32(offset: number, length: number) {
    return new Float32Array(this.blob, offset, length);
  }

  u32(offset: number, length: number) {
    return new Uint32Array(this.blob, offset, length);
  }
}
