/** Loads the Ninh Bình valley on device: the manifest (bundled JSON) and the binary blob (a Metro asset). */
import { Asset } from "expo-asset";
import { File } from "expo-file-system";

import manifestJson from "../gen/world-ninh-binh.json";
import { WorldData, type WorldManifest } from "./data";

// Metro bundles binary assets through require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WORLD_BIN = require("../../../assets/world/ninh-binh.bin");

export async function loadWorld(): Promise<WorldData> {
  const asset = Asset.fromModule(WORLD_BIN);
  await asset.downloadAsync();
  const blob = await new File(asset.localUri ?? asset.uri).arrayBuffer();
  return new WorldData(manifestJson as unknown as WorldManifest, blob);
}
