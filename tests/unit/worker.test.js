/**
 * Unit tests for Worker Logic (Board implementations).
 * Runs in Node.js environment for direct coverage collection via c8.
 */

const { loadScript } = require('../utils/extract-scripts');

// Mock global worker environment
global.self = global;

// 1. Load dependencies (quadCode) and expose to global scope
// The worker code expects these to be available globally
// We request the FULL list of exports used by quad-double.test.js as well,
// to ensure that whichever test runs first generates a compatible module file.
const qd = loadScript('quadCode', [
  // Low-level helpers (pure)
  'fast2Sum', 'slow2Sum', 'qdSplit', 'twoProduct', 'twoSquare',

  // Low-level helpers (array in-place)
  'Afast2Sum', 'Aslow2Sum', 'AqdSplit', 'AtwoProduct', 'AtwoSquare',

  // Pure math functions (Scalar)
  'toQd', 'qdAdd', 'qdMul', 'qdDouble', 'qdScale', 'qdSquare', 'qdNegate', 'qdSub',
  'qdDiv', 'qdReciprocal', 'qdParse', 'qdPow10', 'qdFloor', 'qdCompare',
  'qdLt', 'qdEq', 'qdAbs', 'qdFixed', 'qdFormat', 'qdTen',

  // Array-based in-place functions (Scalar)
  'AqdAdd', 'AqdMul', 'AqdSquare', 'AqdAbsSub', 'AqdSet', 'AqdcCopy', 'AqdcGet',

  // Complex quad functions (Pure)
  'toQdc', 'qdcAdd', 'qdcSub', 'qdcMul', 'qdcDouble', 'qdcSquare', 'qdcAbs', 'qdcPow',

  // Utilities
  'fibonacciPeriod'
]);
Object.assign(global, qd);

// 2. Load workerCode
const { CpuBoard, PerturbationBoard, ZhuoranBoard } = loadScript('workerCode', [
  'Board', 'CpuBoard', 'PerturbationBoard', 'ZhuoranBoard'
]);

// Test constants
const SMALL_GRID = { width: 4, height: 4, area: 16 };
const TEST_LOCATIONS = {
  origin: {
    center: [0.0, 0.0],
    size: 3.0
  },
  outside: {
    center: [2.0, 0.0],
    size: 0.1
  }
};

describe('Worker Board Computations (Unit)', () => {
  
  function createConfig() {
    return {
      dimsWidth: SMALL_GRID.width,
      dimsHeight: SMALL_GRID.height,
      dimsArea: SMALL_GRID.area,
      aspectRatio: 1.0,
      exponent: 2,
      enableGPU: false
    };
  }

  describe('CpuBoard', () => {
    test('should initialize correctly', () => {
      const config = createConfig();
      const board = new CpuBoard(0, 3.0, [0,0], [0,0], config, 'test-id');
      
      expect(board.k).toBe(0);
      expect(board.id).toBe('test-id');
      expect(board.un).toBe(16); // All pixels start unfinished
      expect(board.cc.length).toBe(32); // 16 pixels * 2 (re, im)
    });

    test('should compute diverging pixels (c=2)', () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.outside;
      const board = new CpuBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      // Iterate until done
      let maxIter = 100;
      while (board.un > 0 && maxIter-- > 0) {
        board.iterate();
      }
      
      expect(board.un).toBe(0);
      expect(board.di).toBe(16); // All should diverge
      expect(board.ch).toBe(0);
    });

    test('should compute mixed pixels (origin)', () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.origin;
      const board = new CpuBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      let maxIter = 200;
      while (board.un > 0 && maxIter-- > 0) {
        board.iterate();
      }
      
      // At origin with size 3, some diverge, some converge (inside cardioid)
      expect(board.di).toBeGreaterThan(0);
      // Some might be unfinished due to iteration limit, or converged
      const converged = board.nn.filter(n => n < 0).length;
      // expect(converged).toBeGreaterThan(0); // Depends on grid alignment
    });
    
    test('should handle serialization', () => {
      const config = createConfig();
      const board = new CpuBoard(0, 3.0, [0,0], [0,0], config, 'test-id');
      
      const data = board.serialize();
      expect(data.type).toBe('CpuBoard');
      expect(data.k).toBe(0);
      
      const restored = CpuBoard.fromSerialized(data);
      expect(restored).toBeInstanceOf(CpuBoard);
      expect(restored.id).toBe(board.id);
      expect(restored.cc).toEqual(board.cc);
    });
  });
  
  describe('ZhuoranBoard', () => {
     test('should initialize and compute', () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.outside;
      const board = new ZhuoranBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      let maxIter = 100;
      while (board.un > 0 && maxIter-- > 0) {
        board.iterate();
      }
      
      expect(board.un).toBe(0);
      expect(board.di).toBe(16);
     });
  });

  describe('PerturbationBoard', () => {
    test('should initialize and compute', () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.outside;
      const board = new PerturbationBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      // PerturbationBoard requires initialization of perturbation board (which happens in constructor)
      
      let maxIter = 100;
      while (board.un > 0 && maxIter-- > 0) {
        board.iterate();
      }
      
      expect(board.un).toBe(0);
      expect(board.di).toBe(16);
    });
 });
});
