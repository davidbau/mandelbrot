/**
 * Tests for coverage merging logic.
 * Verifies that:
 * 1. Line numbers match between unit tests (c8) and integration tests (V8/CDP)
 * 2. Function union is properly captured when merging coverage from different sources
 */

const fs = require('fs');
const path = require('path');

// Import the merge function by loading the run-coverage script
// We'll extract the mergeCoverageObjects function for testing
const runCoveragePath = path.join(__dirname, '../scripts/run-coverage.js');
const runCoverageSource = fs.readFileSync(runCoveragePath, 'utf-8');

// Extract the mergeCoverageObjects function from the script
const fnMatch = runCoverageSource.match(
  /function mergeCoverageObjects\(a, b\) \{[\s\S]*?^}/m
);
if (!fnMatch) {
  throw new Error('Could not extract mergeCoverageObjects from run-coverage.js');
}
// eslint-disable-next-line no-eval
const mergeCoverageObjects = eval('(' + fnMatch[0] + ')');

describe('Coverage Merge Logic', () => {
  describe('mergeCoverageObjects', () => {
    test('returns b when a is null/undefined', () => {
      const b = { path: '/test.js', s: { '0': 1 }, statementMap: {} };
      expect(mergeCoverageObjects(null, b)).toBe(b);
      expect(mergeCoverageObjects(undefined, b)).toBe(b);
    });

    test('returns a when b is null/undefined', () => {
      const a = { path: '/test.js', s: { '0': 1 }, statementMap: {} };
      expect(mergeCoverageObjects(a, null)).toBe(a);
      expect(mergeCoverageObjects(a, undefined)).toBe(a);
    });

    test('unions statement maps from both sources', () => {
      const a = {
        path: '/test.js',
        statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
        fnMap: {},
        branchMap: {},
        s: { '0': 5 },
        f: {},
        b: {}
      };
      const b = {
        path: '/test.js',
        statementMap: { '1': { start: { line: 2 }, end: { line: 2 } } },
        fnMap: {},
        branchMap: {},
        s: { '1': 3 },
        f: {},
        b: {}
      };

      const merged = mergeCoverageObjects(a, b);

      expect(Object.keys(merged.statementMap)).toContain('0');
      expect(Object.keys(merged.statementMap)).toContain('1');
      expect(merged.s['0']).toBe(5);
      expect(merged.s['1']).toBe(3);
    });

    test('sums statement counts when both have same statement', () => {
      const a = {
        path: '/test.js',
        statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
        fnMap: {},
        branchMap: {},
        s: { '0': 5 },
        f: {},
        b: {}
      };
      const b = {
        path: '/test.js',
        statementMap: { '0': { start: { line: 1 }, end: { line: 1 } } },
        fnMap: {},
        branchMap: {},
        s: { '0': 3 },
        f: {},
        b: {}
      };

      const merged = mergeCoverageObjects(a, b);

      expect(merged.s['0']).toBe(8);
    });

    test('unions function maps from both sources', () => {
      const a = {
        path: '/test.js',
        statementMap: {},
        fnMap: { '0': { name: 'foo', loc: { start: { line: 1 } } } },
        branchMap: {},
        s: {},
        f: { '0': 10 },
        b: {}
      };
      const b = {
        path: '/test.js',
        statementMap: {},
        fnMap: { '1': { name: 'bar', loc: { start: { line: 5 } } } },
        branchMap: {},
        s: {},
        f: { '1': 7 },
        b: {}
      };

      const merged = mergeCoverageObjects(a, b);

      expect(Object.keys(merged.fnMap)).toContain('0');
      expect(Object.keys(merged.fnMap)).toContain('1');
      expect(merged.fnMap['0'].name).toBe('foo');
      expect(merged.fnMap['1'].name).toBe('bar');
      expect(merged.f['0']).toBe(10);
      expect(merged.f['1']).toBe(7);
    });

    test('sums function counts when both have same function', () => {
      const a = {
        path: '/test.js',
        statementMap: {},
        fnMap: { '0': { name: 'foo', loc: { start: { line: 1 } } } },
        branchMap: {},
        s: {},
        f: { '0': 10 },
        b: {}
      };
      const b = {
        path: '/test.js',
        statementMap: {},
        fnMap: { '0': { name: 'foo', loc: { start: { line: 1 } } } },
        branchMap: {},
        s: {},
        f: { '0': 5 },
        b: {}
      };

      const merged = mergeCoverageObjects(a, b);

      expect(merged.f['0']).toBe(15);
    });

    test('unions branch maps from both sources', () => {
      const a = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '0': { type: 'if', loc: { start: { line: 1 } } } },
        s: {},
        f: {},
        b: { '0': [5, 3] }
      };
      const b = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '1': { type: 'if', loc: { start: { line: 5 } } } },
        s: {},
        f: {},
        b: { '1': [2, 1] }
      };

      const merged = mergeCoverageObjects(a, b);

      expect(Object.keys(merged.branchMap)).toContain('0');
      expect(Object.keys(merged.branchMap)).toContain('1');
      expect(merged.b['0']).toEqual([5, 3]);
      expect(merged.b['1']).toEqual([2, 1]);
    });

    test('sums branch counts when both have same branch', () => {
      const a = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '0': { type: 'if', loc: { start: { line: 1 } } } },
        s: {},
        f: {},
        b: { '0': [5, 3] }
      };
      const b = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '0': { type: 'if', loc: { start: { line: 1 } } } },
        s: {},
        f: {},
        b: { '0': [2, 1] }
      };

      const merged = mergeCoverageObjects(a, b);

      expect(merged.b['0']).toEqual([7, 4]);
    });

    test('handles branch arrays of different lengths', () => {
      const a = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '0': { type: 'switch', loc: { start: { line: 1 } } } },
        s: {},
        f: {},
        b: { '0': [5, 3] }
      };
      const b = {
        path: '/test.js',
        statementMap: {},
        fnMap: {},
        branchMap: { '0': { type: 'switch', loc: { start: { line: 1 } } } },
        s: {},
        f: {},
        b: { '0': [2, 1, 4] }
      };

      const merged = mergeCoverageObjects(a, b);

      expect(merged.b['0']).toEqual([7, 4, 4]);
    });
  });
});

describe('Worker Blob Line Number Alignment', () => {
  const { getScriptPath } = require('../utils/extract-scripts');

  /**
   * Build the worker blob format matching both:
   * - loadWorkerBlob() in extract-scripts.js (for unit tests)
   * - writeCoverageReport() in coverage.js (for integration tests)
   * - assembleWorkerCode() in index.html when navigator.webdriver is true
   */
  function buildWorkerBlob() {
    const workerCodePath = getScriptPath('workerCode');
    const quadCodePath = getScriptPath('quadCode');
    const workerCode = fs.readFileSync(workerCodePath, 'utf-8');
    const quadCode = fs.readFileSync(quadCodePath, 'utf-8');

    return '// Linefeeds to align line numbers with HTML.\n' +
           '// <script id="workerCode">' +
           workerCode +
           '// </script>\n' +
           '// <script id="quadCode">' +
           quadCode +
           '// </script>\n';
  }

  test('workerBlob has no empty line padding prefix', () => {
    const blob = buildWorkerBlob();
    const lines = blob.split('\n');

    // First line should be the comment, not empty padding
    expect(lines[0]).toBe('// Linefeeds to align line numbers with HTML.');
    // Second line should start with the script tag comment
    expect(lines[1].startsWith('// <script id="workerCode">')).toBe(true);
    // No sequence of empty lines at the start
    expect(lines.slice(0, 10).filter(l => l === '').length).toBeLessThan(3);
  });

  test('specific function locations are consistent in blob', () => {
    const blob = buildWorkerBlob();
    const lines = blob.split('\n');

    // Find qdDouble function (a simple 3-line function in quadCode)
    const qdDoubleIndex = lines.findIndex(l => l.includes('function qdDouble'));
    expect(qdDoubleIndex).toBeGreaterThan(0);

    // Verify the function content is on expected subsequent lines
    expect(lines[qdDoubleIndex]).toContain('function qdDouble(a)');
    expect(lines[qdDoubleIndex + 1]).toContain('return [a[0] * 2, a[1] * 2]');
    expect(lines[qdDoubleIndex + 2]).toBe('}');

    // Find CpuBoard class (in workerCode)
    const cpuBoardIndex = lines.findIndex(l => l.includes('class CpuBoard'));
    expect(cpuBoardIndex).toBeGreaterThan(0);
    expect(cpuBoardIndex).toBeLessThan(qdDoubleIndex); // workerCode before quadCode
  });

  test('workerCode.js and quadCode.js are extracted correctly', () => {
    const workerCodePath = getScriptPath('workerCode');
    const quadCodePath = getScriptPath('quadCode');

    expect(fs.existsSync(workerCodePath)).toBe(true);
    expect(fs.existsSync(quadCodePath)).toBe(true);

    const workerCode = fs.readFileSync(workerCodePath, 'utf-8');
    const quadCode = fs.readFileSync(quadCodePath, 'utf-8');

    expect(workerCode.length).toBeGreaterThan(100);
    expect(quadCode.length).toBeGreaterThan(100);

    // workerCode should contain Board class
    expect(workerCode).toContain('class Board');
    // quadCode should contain quad-double functions
    expect(quadCode).toContain('qdAdd');
  });
});
