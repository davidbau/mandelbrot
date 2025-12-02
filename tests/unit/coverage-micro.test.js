/**
 * Micro test for coverage line number verification.
 * Tests that coverageTestDummy() coverage reports correct line numbers.
 *
 * This test uses the full workerBlob.js extracted from index.html,
 * which includes the coverageTestDummy function for coverage testing.
 */

const { getWorkerBlobSource, loadWorkerBlob } = require('../utils/extract-scripts');

// Mock worker environment before loading
global.self = global;

describe('Coverage Micro Test - Unit', () => {
  let coverageTestDummy;
  let expectedLine;

  beforeAll(() => {
    // Get the source to find line numbers
    const source = getWorkerBlobSource();
    const lines = source.split('\n');
    const lineIndex = lines.findIndex(l =>
      l.includes('function coverageTestDummy')
    );
    expectedLine = lineIndex + 1; // 1-based

    // Load the module (requires global.self mock)
    const exports = loadWorkerBlob();
    coverageTestDummy = exports.coverageTestDummy;
  });

  test('function is found in workerBlob', () => {
    expect(coverageTestDummy).toBeDefined();
    expect(typeof coverageTestDummy).toBe('function');
    console.log(`coverageTestDummy at line ${expectedLine}`);
  });

  test('exercise positive branch (x > 0)', () => {
    const result = coverageTestDummy(5);
    expect(result).toBe(10); // 5 * 2
  });

  test('exercise negative branch (x <= 0)', () => {
    const result = coverageTestDummy(-3);
    expect(result).toBe(-9); // -3 * 3
  });

  test('exercise zero branch (x <= 0)', () => {
    const result = coverageTestDummy(0);
    expect(result).toBe(0); // 0 * 3
  });
});
