// Test script for extractPlate function from frontend plateOCR.js
// Copied inline to avoid ES module import issues

const TR_CITY_CODES = new Set();
for (let i = 1; i <= 81; i++) TR_CITY_CODES.add(String(i).padStart(2, '0'));

const CHAR_FIXES = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1',
  Z: '2',
  S: '5',
  B: '8',
  G: '6',
};
const REV_FIXES = {
  '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G',
};

function fixPlateChars(s) {
  if (!s) return s;
  if (s.length < 5) return s;
  const fix = (ch, table) => table[ch] || ch;
  let out = '';
  let cityRead = '';
  let i = 0;
  while (i < 2 && i < s.length) {
    cityRead += fix(s[i], CHAR_FIXES);
    i++;
  }
  out += cityRead;
  let j = i;
  while (j < s.length && /[A-Z]/.test(fix(s[j], REV_FIXES))) {
    out += fix(s[j], REV_FIXES);
    j++;
    if (j - i >= 3) break;
  }
  while (j < s.length) {
    out += fix(s[j], CHAR_FIXES);
    j++;
  }
  return out;
}

function extractPlate(rawText) {
  if (!rawText) return { guess: '', matched: false };

  const lines = rawText.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean);
  const candidates = [];

  for (const rawLine of lines) {
    const cleaned = rawLine.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!cleaned || cleaned.length < 5) continue;

    const standardRe = /\d{2}[A-Z]{1,3}\d{2,4}/g;
    let m;
    while ((m = standardRe.exec(cleaned)) !== null) {
      const plate = m[0];
      const extraChars = cleaned.length - plate.length;
      if (TR_CITY_CODES.has(plate.slice(0, 2))) {
        candidates.push({ plate, length: plate.length, kind: 'standard', extraChars });
      }
      if (m.index === standardRe.lastIndex) standardRe.lastIndex++;
    }

    const diplRe = /(CC|CD)\d{4,5}/g;
    while ((m = diplRe.exec(cleaned)) !== null) {
      const extraChars = cleaned.length - m[0].length;
      candidates.push({ plate: m[0], length: m[0].length, kind: 'diplomatic', extraChars });
    }

    if (!/^\d{2}/.test(cleaned)) {
      for (let len = Math.min(10, cleaned.length); len >= 5; len--) {
        for (let i = 0; i + len <= cleaned.length; i++) {
          const sub = cleaned.slice(i, i + len);
          if (!TR_CITY_CODES.has(sub.slice(0, 2))) continue;
          const fixed = fixPlateChars(sub);
          if (/^\d{2}[A-Z]{1,3}\d{2,4}$/.test(fixed) && TR_CITY_CODES.has(fixed.slice(0, 2))) {
            const extraChars = cleaned.length - fixed.length;
            candidates.push({ plate: fixed, length: fixed.length, kind: 'fixed', extraChars });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      if (a.extraChars === 0 && b.extraChars > 0) return -1;
      if (a.extraChars > 0 && b.extraChars === 0) return 1;
      if (b.length !== a.length) return b.length - a.length;
      const order = { standard: 0, fixed: 1, diplomatic: 2 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { guess: candidates[0].plate, matched: true };
  }

  const fallback = lines
    .map((l) => l.toUpperCase().replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
    .join('')
    .slice(0, 16);
  return { guess: fallback, matched: false };
}

// Test cases
const tests = [
  {
    name: 'Newline should not concatenate (34BHP198\\n5)',
    input: '34BHP198\n5',
    expected: '34BHP198',
  },
  {
    name: 'Extra digit at start ignored (234AFE290)',
    input: '234AFE290',
    expected: '34AFE290',
  },
  {
    name: 'Trailing garbage ignored (34AFE290\\nSOMETHING)',
    input: '34AFE290\nSOMETHING',
    expected: '34AFE290',
  },
  {
    name: 'Normal case (34ABC123)',
    input: '34ABC123',
    expected: '34ABC123',
  },
];

let passed = 0;
let failed = 0;

console.log('Running extractPlate tests...\n');

for (const test of tests) {
  const result = extractPlate(test.input);
  const success = result.guess === test.expected;

  if (success) {
    console.log(`✓ PASS: ${test.name}`);
    console.log(`  Input:    "${test.input}"`);
    console.log(`  Expected: "${test.expected}"`);
    console.log(`  Got:      "${result.guess}"\n`);
    passed++;
  } else {
    console.log(`✗ FAIL: ${test.name}`);
    console.log(`  Input:    "${test.input}"`);
    console.log(`  Expected: "${test.expected}"`);
    console.log(`  Got:      "${result.guess}"\n`);
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed > 0 ? 1 : 0);
