import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    lqbot: "scripts/lqbot.ts",
  },
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
});
