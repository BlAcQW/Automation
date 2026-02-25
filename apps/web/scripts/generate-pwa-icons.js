// Generate PWA PNG icons from SVG using sharp (no native deps)
// Run: npm install sharp --save-dev && node scripts/generate-pwa-icons.js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const outDir = path.join(__dirname, '..', 'public', 'icons');

async function generate() {
    const svg = fs.readFileSync(svgPath);
    for (const size of sizes) {
        await sharp(svg)
            .resize(size, size)
            .png()
            .toFile(path.join(outDir, `icon-${size}.png`));
        console.log(`✓ icon-${size}.png`);
    }
    console.log('All PWA icons generated!');
}

generate().catch(console.error);
