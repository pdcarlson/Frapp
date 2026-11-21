// The shell's main and preload processes run in Node, not a browser page.
import { config } from "@repo/eslint-config/base";

export default [...config, { ignores: ["dist/**", "release/**"] }];
