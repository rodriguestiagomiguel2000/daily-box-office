import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

async function generateFavicons() {
  const rootDir = process.cwd();
  const inputLogo = path.join(rootDir, "public", "logo-icon.png");

  if (!fs.existsSync(inputLogo)) {
    console.error(`Error: Logo file not found at ${inputLogo}`);
    process.exit(1);
  }

  const targets = [
    { name: "favicon-32.png", size: 32 },
    { name: "favicon-48.png", size: 48 },
    { name: "apple-touch-icon.png", size: 180 },
  ];

  console.log(`Reading source logo from: ${inputLogo}`);

  for (const target of targets) {
    const publicPath = path.join(rootDir, "public", target.name);
    await sharp(inputLogo)
      .resize(target.size, target.size)
      .png()
      .toFile(publicPath);

    console.log(`✓ Generated public/${target.name} (${target.size}×${target.size})`);

    // Sync to dist if present
    const distDir = path.join(rootDir, "dist");
    if (fs.existsSync(distDir)) {
      const distPath = path.join(distDir, target.name);
      fs.copyFileSync(publicPath, distPath);
      console.log(`  ✓ Synced to dist/${target.name}`);
    }
  }

  console.log("Favicon generation completed successfully.");
}

generateFavicons().catch((err) => {
  console.error("Failed to generate favicons:", err);
  process.exit(1);
});
