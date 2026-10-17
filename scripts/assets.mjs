import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const svg = await readFile('public/icon.svg');
const resources = 'android/app/src/main/res';
for (const [density, size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})) {
  const folder = path.join(resources, `mipmap-${density}`); await mkdir(folder, { recursive: true });
  for (const name of ['ic_launcher','ic_launcher_round','ic_launcher_foreground']) await sharp(svg).resize(size,size).png().toFile(path.join(folder, `${name}.png`));
}
// Replace all generated drawable splash files, including landscape variants.
const { readdir } = await import('node:fs/promises');
const splashIcon = await sharp(svg).resize(300,300).png().toBuffer();
for (const entry of await readdir(resources, {withFileTypes:true})) {
  if (entry.isDirectory() && entry.name.startsWith('drawable')) {
    const folder = path.join(resources,entry.name);
    if ((await readdir(folder)).includes('splash.png')) await sharp({ create: { width:1200,height:1200,channels:4,background:'#0F1020' } }).composite([{input:splashIcon,gravity:'centre'}]).png().toFile(path.join(folder,'splash.png'));
  }
}
console.log('Android icons and splash images generated.');
