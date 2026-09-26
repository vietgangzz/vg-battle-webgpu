import * as t3 from "@typegpu/three";
import * as TSL from "three/tsl";
import type { d } from "typegpu";

/**
 * A uniform in three's render group, uploaded once per pass for every draw.
 * A plain uniform lives in the object group, which three sends again only
 * when its object changes: a mesh that never moves (the valley's ground, its
 * lanterns) would keep the first value it drew with (the sun as it rose, the
 * shadows where they first fell).
 */
export function shared<TValue, TDataType extends d.AnyWgslData>(value: TValue, type: TDataType) {
  const u = t3.uniform(value, type);
  u.node.setGroup(TSL.renderGroup);
  return u;
}
