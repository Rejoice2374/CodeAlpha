import { useEffect, useRef } from "react";

// ============================================================
// QR VERSION / CAPACITY DATA
// ============================================================

const VERSION_INFO = {
  1: { total: 26, data: { L: 19, M: 16, Q: 13, H: 9 }, align: [] },
  2: { total: 44, data: { L: 34, M: 28, Q: 22, H: 16 }, align: [6, 18] },
  3: { total: 70, data: { L: 55, M: 44, Q: 34, H: 26 }, align: [6, 22] },
  4: { total: 100, data: { L: 80, M: 64, Q: 48, H: 36 }, align: [6, 26] },
  5: { total: 134, data: { L: 108, M: 86, Q: 62, H: 46 }, align: [6, 30] },
  6: { total: 172, data: { L: 136, M: 108, Q: 76, H: 60 }, align: [6, 34] },
  7: { total: 196, data: { L: 156, M: 124, Q: 88, H: 66 }, align: [6, 22, 38] },
  8: {
    total: 242,
    data: { L: 194, M: 154, Q: 110, H: 86 },
    align: [6, 24, 42],
  },
  9: {
    total: 292,
    data: { L: 232, M: 182, Q: 132, H: 100 },
    align: [6, 26, 46],
  },
  10: {
    total: 346,
    data: { L: 274, M: 216, Q: 154, H: 122 },
    align: [6, 28, 50],
  },
};

const ECC_FORMAT_BITS = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

const BLOCKS = {
  1: {
    L: [1, 19, 0, 0, 7],
    M: [1, 16, 0, 0, 10],
    Q: [1, 13, 0, 0, 13],
    H: [1, 9, 0, 0, 17],
  },
  2: {
    L: [1, 34, 0, 0, 10],
    M: [1, 28, 0, 0, 16],
    Q: [1, 22, 0, 0, 22],
    H: [1, 16, 0, 0, 28],
  },
  3: {
    L: [1, 55, 0, 0, 15],
    M: [1, 44, 0, 0, 26],
    Q: [2, 17, 0, 0, 18],
    H: [2, 13, 0, 0, 22],
  },
  4: {
    L: [1, 80, 0, 0, 20],
    M: [2, 32, 0, 0, 18],
    Q: [2, 24, 0, 0, 26],
    H: [4, 9, 0, 0, 16],
  },
  5: {
    L: [1, 108, 0, 0, 26],
    M: [2, 43, 0, 0, 24],
    Q: [2, 15, 2, 16, 18],
    H: [2, 11, 2, 12, 22],
  },
  6: {
    L: [2, 68, 0, 0, 18],
    M: [4, 27, 0, 0, 16],
    Q: [4, 19, 0, 0, 24],
    H: [4, 15, 0, 0, 28],
  },
  7: {
    L: [2, 78, 0, 0, 20],
    M: [4, 31, 0, 0, 18],
    Q: [2, 14, 4, 15, 18],
    H: [4, 13, 1, 14, 26],
  },
  8: {
    L: [2, 97, 0, 0, 24],
    M: [2, 38, 2, 39, 22],
    Q: [4, 18, 2, 19, 22],
    H: [4, 14, 2, 15, 26],
  },
  9: {
    L: [2, 116, 0, 0, 30],
    M: [3, 36, 2, 37, 22],
    Q: [4, 16, 4, 17, 20],
    H: [4, 12, 4, 13, 24],
  },
  10: {
    L: [2, 68, 2, 69, 18],
    M: [4, 43, 1, 44, 26],
    Q: [6, 19, 2, 20, 24],
    H: [6, 15, 2, 16, 28],
  },
};

// ============================================================
// BIT BUFFER
// ============================================================

class BitBuffer {
  constructor() {
    this.bits = [];
  }

  put(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  get length() {
    return this.bits.length;
  }

  toBytes() {
    const bytes = [];

    for (let i = 0; i < this.bits.length; i += 8) {
      let value = 0;

      for (let j = 0; j < 8; j++) {
        value = (value << 1) | (this.bits[i + j] ?? 0);
      }

      bytes.push(value);
    }

    return bytes;
  }
}

// ============================================================
// GALOIS FIELD
// ============================================================

const EXP = new Array(512);
const LOG = new Array(256);

(function initGaloisField() {
  let x = 1;

  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;

    x <<= 1;

    if (x & 0x100) {
      x ^= 0x11d;
    }
  }

  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255];
  }

  LOG[0] = -Infinity;
})();

function gfMultiply(a, b) {
  if (a === 0 || b === 0) return 0;

  return EXP[LOG[a] + LOG[b]];
}

// ============================================================
// REED-SOLOMON
// ============================================================

function polyMultiply(a, b) {
  const result = new Array(a.length + b.length - 1).fill(0);

  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      result[i + j] ^= gfMultiply(a[i], b[j]);
    }
  }

  return result;
}

function reedSolomonGenerator(degree) {
  let poly = [1];

  for (let i = 0; i < degree; i++) {
    poly = polyMultiply(poly, [1, EXP[i]]);
  }

  return poly;
}

function reedSolomonRemainder(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ result[0];

    result.shift();
    result.push(0);

    for (let i = 0; i < degree; i++) {
      result[i] ^= gfMultiply(generator[i + 1], factor);
    }
  }

  return result;
}

// ============================================================
// ENCODING
// ============================================================

function chooseVersion(byteLength, ecc) {
  for (let version = 1; version <= 10; version++) {
    const countBits = version <= 9 ? 8 : 16;
    const capacityBits = VERSION_INFO[version].data[ecc] * 8;

    const requiredBits = 4 + countBits + byteLength * 8;

    if (requiredBits <= capacityBits) {
      return version;
    }
  }

  throw new Error(
    "Input is too large. This implementation supports QR versions 1–10.",
  );
}

function makeDataCodewords(text, version, ecc) {
  const bytes = Array.from(new TextEncoder().encode(text));

  const capacityBytes = VERSION_INFO[version].data[ecc];

  const capacityBits = capacityBytes * 8;

  const countBits = version <= 9 ? 8 : 16;

  const bits = new BitBuffer();

  // Byte mode
  bits.put(0b0100, 4);

  // Character count
  bits.put(bytes.length, countBits);

  // Actual data
  for (const byte of bytes) {
    bits.put(byte, 8);
  }

  // Terminator
  const terminatorLength = Math.min(4, capacityBits - bits.length);

  bits.put(0, terminatorLength);

  // Align to byte boundary
  while (bits.length % 8 !== 0) {
    bits.put(0, 1);
  }

  const data = bits.toBytes();

  // Pad codewords
  const pads = [0xec, 0x11];

  let padIndex = 0;

  while (data.length < capacityBytes) {
    data.push(pads[padIndex]);
    padIndex ^= 1;
  }

  return data;
}

// ============================================================
// BLOCKS
// ============================================================

function makeBlocks(data, version, ecc) {
  const [group1Count, group1Data, group2Count, group2Data, eccCount] =
    BLOCKS[version][ecc];

  const blocks = [];

  let offset = 0;

  for (let i = 0; i < group1Count; i++) {
    blocks.push({
      data: data.slice(offset, offset + group1Data),
    });

    offset += group1Data;
  }

  for (let i = 0; i < group2Count; i++) {
    blocks.push({
      data: data.slice(offset, offset + group2Data),
    });

    offset += group2Data;
  }

  for (const block of blocks) {
    block.ecc = reedSolomonRemainder(block.data, eccCount);
  }

  return blocks;
}

function interleaveBlocks(blocks) {
  const result = [];

  const maxData = Math.max(...blocks.map((block) => block.data.length));

  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) {
      if (i < block.data.length) {
        result.push(block.data[i]);
      }
    }
  }

  const maxECC = Math.max(...blocks.map((block) => block.ecc.length));

  for (let i = 0; i < maxECC; i++) {
    for (const block of blocks) {
      if (i < block.ecc.length) {
        result.push(block.ecc[i]);
      }
    }
  }

  return result;
}

function getDataBits(codewords) {
  const bits = [];

  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >>> i) & 1);
    }
  }

  return bits;
}

// ============================================================
// MATRIX
// ============================================================

function createMatrix(version) {
  const size = 21 + 4 * (version - 1);

  return Array.from({ length: size }, () => Array(size).fill(null));
}

function setModule(matrix, row, col, value) {
  if (row >= 0 && row < matrix.length && col >= 0 && col < matrix.length) {
    matrix[row][col] = value ? 1 : 0;
  }
}

function addFinderPattern(matrix, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;

      let value = 0;

      if (inside) {
        value =
          r === 0 ||
          r === 6 ||
          c === 0 ||
          c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
            ? 1
            : 0;
      }

      setModule(matrix, row + r, col + c, value);
    }
  }
}

function addFinderPatterns(matrix) {
  const size = matrix.length;

  addFinderPattern(matrix, 0, 0);
  addFinderPattern(matrix, 0, size - 7);
  addFinderPattern(matrix, size - 7, 0);
}

function addTimingPatterns(matrix) {
  const size = matrix.length;

  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) {
      matrix[6][i] = i % 2 === 0 ? 1 : 0;
    }

    if (matrix[i][6] === null) {
      matrix[i][6] = i % 2 === 0 ? 1 : 0;
    }
  }
}

function addAlignmentPattern(matrix, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const distance = Math.max(Math.abs(r), Math.abs(c));

      matrix[row + r][col + c] = distance === 1 ? 0 : 1;
    }
  }
}

function addAlignmentPatterns(matrix, version) {
  if (version === 1) return;

  const positions = VERSION_INFO[version].align;

  for (const row of positions) {
    for (const col of positions) {
      const size = matrix.length;

      const topLeft = row < 9 && col < 9;

      const topRight = row < 9 && col > size - 10;

      const bottomLeft = row > size - 10 && col < 9;

      if (topLeft || topRight || bottomLeft) {
        continue;
      }

      addAlignmentPattern(matrix, row, col);
    }
  }
}

function reserveFormatAreas(matrix) {
  const size = matrix.length;

  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === null) {
      matrix[8][i] = 0;
    }

    if (matrix[i][8] === null) {
      matrix[i][8] = 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    if (matrix[8][size - 1 - i] === null) {
      matrix[8][size - 1 - i] = 0;
    }

    if (matrix[size - 1 - i][8] === null) {
      matrix[size - 1 - i][8] = 0;
    }
  }

  // Fixed dark module
  matrix[size - 8][8] = 1;
}

function setupMatrix(version) {
  const matrix = createMatrix(version);

  addFinderPatterns(matrix);
  addTimingPatterns(matrix);
  addAlignmentPatterns(matrix, version);
  reserveFormatAreas(matrix);

  return matrix;
}

// ============================================================
// DATA PLACEMENT
// ============================================================

function placeDataBits(matrix, bits) {
  const size = matrix.length;

  let bitIndex = 0;
  let upward = true;

  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) {
      col--;
    }

    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;

      for (let c = 0; c < 2; c++) {
        const currentCol = col - c;

        if (matrix[row][currentCol] !== null) {
          continue;
        }

        matrix[row][currentCol] = bitIndex < bits.length ? bits[bitIndex++] : 0;
      }
    }

    upward = !upward;
  }

  if (bitIndex !== bits.length) {
    throw new Error("QR data placement failed.");
  }
}

// ============================================================
// FORMAT INFORMATION
// ============================================================

function dataBitLength(value) {
  let length = 0;

  while (value !== 0) {
    length++;
    value >>>= 1;
  }

  return length;
}

function formatBch(value) {
  const generator = 0x537;

  let data = value << 10;

  while (dataBitLength(data) >= dataBitLength(generator)) {
    data ^= generator << (dataBitLength(data) - dataBitLength(generator));
  }

  return ((value << 10) | data) ^ 0x5412;
}

function writeFormatBits(matrix, ecc, mask) {
  const size = matrix.length;

  const format = formatBch((ECC_FORMAT_BITS[ecc] << 3) | mask);

  const bits = [];

  for (let i = 14; i >= 0; i--) {
    bits.push((format >>> i) & 1);
  }

  const vertical = [
    [0, 8],
    [1, 8],
    [2, 8],
    [3, 8],
    [4, 8],
    [5, 8],
    [7, 8],
    [8, 8],
    [8, 7],
    [8, 5],
    [8, 4],
    [8, 3],
    [8, 2],
    [8, 1],
    [8, 0],
  ];

  for (let i = 0; i < 15; i++) {
    matrix[vertical[i][0]][vertical[i][1]] = bits[i];
  }

  const horizontal = [
    [8, size - 1],
    [8, size - 2],
    [8, size - 3],
    [8, size - 4],
    [8, size - 5],
    [8, size - 6],
    [8, size - 7],
    [8, size - 8],
    [size - 7, 8],
    [size - 6, 8],
    [size - 5, 8],
    [size - 4, 8],
    [size - 3, 8],
    [size - 2, 8],
    [size - 1, 8],
  ];

  for (let i = 0; i < 15; i++) {
    matrix[horizontal[i][0]][horizontal[i][1]] = bits[i];
  }

  matrix[size - 8][8] = 1;
}

// ============================================================
// MASKS
// ============================================================

function maskCondition(mask, row, col) {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;

    case 1:
      return row % 2 === 0;

    case 2:
      return col % 3 === 0;

    case 3:
      return (row + col) % 3 === 0;

    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;

    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;

    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;

    case 7:
      return (((row * col) % 3) + ((row + col) % 2)) % 2 === 0;

    default:
      throw new Error("Invalid QR mask.");
  }
}

function sizeToVersion(size) {
  return Math.floor((size - 17) / 4);
}

function applyMask(baseMatrix, mask, ecc) {
  const matrix = baseMatrix.map((row) => row.slice());

  const size = matrix.length;
  const version = sizeToVersion(size);

  const reserved = createMatrix(version);

  addFinderPatterns(reserved);
  addTimingPatterns(reserved);
  addAlignmentPatterns(reserved, version);
  reserveFormatAreas(reserved);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c] === null) {
        if (maskCondition(mask, r, c)) {
          matrix[r][c] ^= 1;
        }
      }
    }
  }

  writeFormatBits(matrix, ecc, mask);

  return matrix;
}

// ============================================================
// MASK PENALTY
// ============================================================

function penaltyScore(matrix) {
  const size = matrix.length;

  let score = 0;

  // Rule 1
  for (let r = 0; r < size; r++) {
    let runColor = matrix[r][0];
    let runLength = 1;

    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) {
          score += 3 + (runLength - 5);
        }

        runColor = matrix[r][c];

        runLength = 1;
      }
    }

    if (runLength >= 5) {
      score += 3 + (runLength - 5);
    }
  }

  // Columns
  for (let c = 0; c < size; c++) {
    let runColor = matrix[0][c];
    let runLength = 1;

    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) {
          score += 3 + (runLength - 5);
        }

        runColor = matrix[r][c];

        runLength = 1;
      }
    }

    if (runLength >= 5) {
      score += 3 + (runLength - 5);
    }
  }

  // Rule 2
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const a = matrix[r][c];

      if (
        matrix[r][c + 1] === a &&
        matrix[r + 1][c] === a &&
        matrix[r + 1][c + 1] === a
      ) {
        score += 3;
      }
    }
  }

  // Rule 3
  const pattern = [1, 0, 1, 1, 1, 0, 1];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 7; c++) {
      let matches = true;

      for (let i = 0; i < 7; i++) {
        if (matrix[r][c + i] !== pattern[i]) {
          matches = false;
          break;
        }
      }

      if (matches) score += 40;
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 7; r++) {
      let matches = true;

      for (let i = 0; i < 7; i++) {
        if (matrix[r + i][c] !== pattern[i]) {
          matches = false;
          break;
        }
      }

      if (matches) score += 40;
    }
  }

  // Rule 4
  let dark = 0;

  for (const row of matrix) {
    for (const cell of row) {
      if (cell === 1) {
        dark++;
      }
    }
  }

  const total = size * size;
  const percent = (dark * 100) / total;

  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

// ============================================================
// MAIN QR GENERATOR
//
// This is the function you actually reuse.
//
// generateQRCode("https://favochino.com")
//
// Default:
// errorCorrection = "H"
// ============================================================

export function generateQRCode(value, { errorCorrection = "H" } = {}) {
  if (typeof value !== "string") {
    throw new TypeError("QR value must be a string.");
  }

  if (!value.trim()) {
    throw new Error("QR value cannot be empty.");
  }

  const ecc = errorCorrection.toUpperCase();

  if (!["L", "M", "Q", "H"].includes(ecc)) {
    throw new Error("Error correction must be L, M, Q or H.");
  }

  const bytes = Array.from(new TextEncoder().encode(value));

  const version = chooseVersion(bytes.length, ecc);

  const dataCodewords = makeDataCodewords(value, version, ecc);

  const blocks = makeBlocks(dataCodewords, version, ecc);

  const codewords = interleaveBlocks(blocks);

  const bits = getDataBits(codewords);

  const base = setupMatrix(version);

  placeDataBits(base, bits);

  let bestMatrix = null;
  let bestMask = 0;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(base, mask, ecc);

    const score = penaltyScore(candidate);

    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return {
    matrix: bestMatrix,
    version,
    size: bestMatrix.length,
    errorCorrection: ecc,
    mask: bestMask,
    score: bestScore,
    bytes: bytes.length,
  };
}

// ============================================================
// REACT COMPONENT
//
// Usage:
//
// <QRCode value="https://favochino.com" />
//
// Optional:
//
// <QRCode
//   value="https://favochino.com"
//   errorCorrection="M"
// />
// ============================================================

export function QRCode({
  value,
  errorCorrection = "H",
  size = 300,
  className = "",
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!value) return;

    const result = generateQRCode(value, { errorCorrection });

    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const quietZone = 4;

    const moduleCount = result.matrix.length;

    const pixelSize = Math.max(
      1,
      Math.floor(size / (moduleCount + quietZone * 2)),
    );

    const actualSize = (moduleCount + quietZone * 2) * pixelSize;

    canvas.width = actualSize;
    canvas.height = actualSize;

    ctx.fillStyle = "#FFFFFF";

    ctx.fillRect(0, 0, actualSize, actualSize);

    ctx.fillStyle = "#000000";

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (result.matrix[row][col] === 1) {
          ctx.fillRect(
            (col + quietZone) * pixelSize,

            (row + quietZone) * pixelSize,

            pixelSize,
            pixelSize,
          );
        }
      }
    }
  }, [value, errorCorrection, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: size,
        height: size,
        imageRendering: "pixelated",
      }}
    />
  );
}
