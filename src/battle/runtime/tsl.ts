/**
 * three/tsl, untyped, for the compositor graph in post.ts.
 *
 * TSL's generic node typings (Node<"float">, Node<"vec3">, ...) reject the
 * float/vector mixing a compositor chain does freely, so post.ts builds its
 * graph through this alias. Shaders proper are TypeGPU (typed) elsewhere.
 */
import * as TSL from "three/tsl";

export const T: any = TSL;
