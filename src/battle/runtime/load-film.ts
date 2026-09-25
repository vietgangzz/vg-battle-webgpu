/** Loads the exported film on device: the manifest (bundled JSON) and the binary blob (a Metro asset). */
import { Asset } from "expo-asset";
import { File } from "expo-file-system";

import manifestJson from "../gen/film.json";
import { Film, type Manifest } from "./film";

// Metro bundles binary assets through require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FILM_BIN = require("../../../assets/film/film.bin");

export async function loadFilm(): Promise<Film> {
  const manifest = manifestJson as unknown as Manifest;
  const asset = Asset.fromModule(FILM_BIN);
  await asset.downloadAsync();
  const blob = await new File(asset.localUri ?? asset.uri).arrayBuffer();
  return new Film(manifest, blob);
}
