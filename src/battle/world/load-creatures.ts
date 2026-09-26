/** Loads the valley's animated enemies on device: the manifest (bundled JSON) and one blob per creature (Metro assets). */
import { Asset } from "expo-asset";
import { File } from "expo-file-system";

import manifestJson from "../gen/creatures.json";
import { buildCreatures, type CreatureManifest } from "./creature";

// Metro bundles binary assets through require(), which needs literal paths
/* eslint-disable @typescript-eslint/no-require-imports */
const BLOBS: Record<string, number> = {
  bandit: require("../../../assets/creatures/bandit.bin"),
  golem: require("../../../assets/creatures/golem.bin"),
  river_demon: require("../../../assets/creatures/river_demon.bin"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

export const CREATURES = manifestJson as unknown as CreatureManifest;

/** Every creature kind, built and ready to spawn (see Creature). */
export async function loadCreatures() {
  const blobs: Record<string, ArrayBuffer> = {};
  await Promise.all(
    Object.keys(CREATURES.creatures)
      .filter((name) => BLOBS[name] !== undefined)
      .map(async (name) => {
        const asset = Asset.fromModule(BLOBS[name]);
        await asset.downloadAsync();
        blobs[name] = await new File(asset.localUri ?? asset.uri).arrayBuffer();
      }),
  );
  return buildCreatures(CREATURES, blobs);
}
