import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
    const resolved = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(resolved)) && existsSync(`${fileURLToPath(resolved)}.js`))
      return { url: `${resolved.href}.js`, shortCircuit: true };
  }
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const base = path.resolve(process.cwd(), "src", specifier.slice(2));
  const target = existsSync(base) && statSync(base).isFile() ? base : existsSync(`${base}.js`) ? `${base}.js` : path.join(base, "index.js");
  return { url: pathToFileURL(target).href, shortCircuit: true };
}
