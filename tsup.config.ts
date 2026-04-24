import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    lqbot: "scripts/lqbot.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
});
