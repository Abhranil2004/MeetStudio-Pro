// scripts/package.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Simple cross-platform zip file generator using Node.js
function createZip(sourceDir, outPath) {
  const files = [];

  function readDir(dir) {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        readDir(fullPath);
      } else {
        const relative = path.relative(sourceDir, fullPath).replace(/\\/g, '/');
        files.push({ path: fullPath, name: relative });
      }
    }
  }

  readDir(sourceDir);

  // Minimal ZIP format generator
  const localHeaders = [];
  const centralDirectory = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.path);
    const uncompressedSize = data.length;
    const crc = crc32(data);
    const nameBuffer = Buffer.from(file.name, 'utf8');

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);          // Version needed (2.0)
    localHeader.writeUInt16LE(0, 6);           // Flags
    localHeader.writeUInt16LE(0, 8);           // Compression: 0 (Store)
    localHeader.writeUInt16LE(0, 10);          // Mod time
    localHeader.writeUInt16LE(0, 12);          // Mod date
    localHeader.writeUInt32LE(crc, 14);        // CRC32
    localHeader.writeUInt32LE(uncompressedSize, 18); // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);          // Extra field length
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, data);

    // Central directory header (46 bytes + name length)
    const cdHeader = Buffer.alloc(46 + nameBuffer.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    cdHeader.writeUInt16LE(20, 4);          // Version made by
    cdHeader.writeUInt16LE(20, 6);          // Version needed
    cdHeader.writeUInt16LE(0, 8);           // Flags
    cdHeader.writeUInt16LE(0, 10);          // Compression: 0
    cdHeader.writeUInt16LE(0, 12);          // Mod time
    cdHeader.writeUInt16LE(0, 14);          // Mod date
    cdHeader.writeUInt32LE(crc, 16);        // CRC32
    cdHeader.writeUInt32LE(uncompressedSize, 20); // Compressed size
    cdHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    cdHeader.writeUInt16LE(nameBuffer.length, 28); // File name length
    cdHeader.writeUInt16LE(0, 30);          // Extra field length
    cdHeader.writeUInt16LE(0, 32);          // File comment length
    cdHeader.writeUInt16LE(0, 34);          // Disk number start
    cdHeader.writeUInt16LE(0, 36);          // Internal file attributes
    cdHeader.writeUInt32LE(0, 38);          // External file attributes
    cdHeader.writeUInt32LE(offset, 42);     // Relative offset of local header
    nameBuffer.copy(cdHeader, 46);

    centralDirectory.push(cdHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirBuffer = Buffer.concat(centralDirectory);
  const cdOffset = offset;
  const cdSize = centralDirBuffer.length;

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                 // Disk number
  eocd.writeUInt16LE(0, 6);                 // Disk where CD starts
  eocd.writeUInt16LE(files.length, 8);      // Number of CD records on disk
  eocd.writeUInt16LE(files.length, 10);     // Total number of CD records
  eocd.writeUInt32LE(cdSize, 12);           // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);         // Offset of CD
  eocd.writeUInt16LE(0, 20);                // Comment length

  const finalZip = Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
  fs.writeFileSync(outPath, finalZip);
  console.log(`[Package] Generated zip: ${outPath} (${finalZip.length} bytes)`);
}

// CRC32 table calculator
function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }

  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const distDir = path.join(__dirname, '..', 'dist');
const outZip = path.join(__dirname, '..', 'meetstudio-extension.zip');

if (fs.existsSync(distDir)) {
  createZip(distDir, outZip);
} else {
  console.error('[Package] dist directory not found! Run webpack build first.');
  process.exit(1);
}
