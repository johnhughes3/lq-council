import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface Tsconfig {
  compilerOptions?: {
    types?: string[];
  };
  include?: string[];
}

interface PackageJson {
  files?: string[];
  private?: boolean;
  scripts?: {
    typecheck?: string;
  };
}

describe("scripts TypeScript project", () => {
  it("typechecks the Node CLI without Workers Buffer types", async () => {
    const [rootRaw, scriptsRaw, packageRaw, cliSource] = await Promise.all([
      readFile("tsconfig.json", "utf8"),
      readFile("tsconfig.scripts.json", "utf8"),
      readFile("package.json", "utf8"),
      readFile("scripts/lqbot.ts", "utf8"),
    ]);

    const root = JSON.parse(rootRaw) as Tsconfig;
    const scripts = JSON.parse(scriptsRaw) as Tsconfig;
    const pkg = JSON.parse(packageRaw) as PackageJson;

    expect(root.include).not.toContain("scripts");
    expect(scripts.include).toEqual(["scripts"]);
    expect(scripts.compilerOptions?.types).toEqual(["node"]);
    expect(scripts.compilerOptions?.types).not.toContain("@cloudflare/workers-types");
    expect(pkg.scripts?.typecheck).toBe("tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json");
    if (pkg.private) {
      await expect(readFile("tsconfig.scripts.json", "utf8")).resolves.toBe(scriptsRaw);
    } else {
      expect(pkg.files).toContain("tsconfig.scripts.json");
    }
    expect(cliSource).toContain('randomBytes(32).toString("base64url")');
    expect(cliSource).not.toContain("bytesToBase64Url");
    expect(cliSource).not.toContain("../src/security/auth");
    expect(cliSource).not.toContain("../src/types");
  });
});
