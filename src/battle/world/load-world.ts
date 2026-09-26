/** Loads the Ninh Bình valley on device: the manifest (bundled JSON) and the binary blob (a Metro asset). */
import { Asset } from "expo-asset";
import { File } from "expo-file-system";

import manifestJson from "../gen/world-ninh-binh.json";
import { WorldData, type WorldManifest } from "./data";

// Metro bundles binary assets through require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WORLD_BIN = require("../../../assets/world/ninh-binh.bin");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TEXTURES_BIN = require("../../../assets/world/ninh-binh-tex.bin");

export async function loadWorld(): Promise<WorldData> {
  const read = async (mod: number) => {
    const asset = Asset.fromModule(mod);
    await asset.downloadAsync();
    return new File(asset.localUri ?? asset.uri).arrayBuffer();
  };
  const [blob, textures] = await Promise.all([read(WORLD_BIN), read(TEXTURES_BIN)]);
  return new WorldData(manifestJson as unknown as WorldManifest, blob, textures);
}
