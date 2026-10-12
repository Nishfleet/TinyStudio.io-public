import { mkdir, readFile, writeFile } from "node:fs/promises";
import subsetFont from "subset-font";

const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const text = `${ascii} £·×é–—‘’“”•…→₹`;

const fonts = [
  ["fraunces", "fraunces-latin-opsz-normal"],
  ["fraunces", "fraunces-latin-opsz-italic"],
  ["karla", "karla-latin-wght-normal"]
];

await mkdir("public/fonts", { recursive: true });
for (const [pkg, name] of fonts) {
  const source = await readFile(`node_modules/@fontsource-variable/${pkg}/files/${name}.woff2`);
  await writeFile(`public/fonts/${name}.woff2`, await subsetFont(source, text, { targetFormat: "woff2" }));
}
