// Generate PWA PNG icons from SVG using sharp (no native deps)
// Run: npm install sharp --save-dev && node scripts/generate-pwa-icons.js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const svgPath = path.join(__dirname, '..', 'public', 'icons', 'icon.svg');
const outDir = path.join(__dirname, '..', 'public', 'icons');
const publicDir = path.join(__dirname, '..', 'public');

async function generate() {
    const svg = fs.readFileSync(svgPath);
    for (const size of sizes) {
        await sharp(svg)
            .resize(size, size)
            .png()
            .toFile(path.join(outDir, `icon-${size}.png`));
        console.log(`✓ icon-${size}.png`);
    }

    // iOS home-screen icon — must live at the public root.
    await sharp(svg).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
    console.log('✓ apple-touch-icon.png');

    // Browser-tab favicon. .ico isn't supported by sharp, so emit a 32px PNG
    // named favicon.ico — every modern browser accepts a PNG payload here.
    await sharp(svg).resize(32, 32).png().toFile(path.join(publicDir, 'favicon.ico'));
    console.log('✓ favicon.ico');

    console.log('All PWA icons generated!');
}

generate().catch(console.error);
