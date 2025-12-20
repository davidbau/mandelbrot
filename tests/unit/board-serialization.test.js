/**
 * Unit tests for Board serialization
 * Tests that boards can be serialized midway through computation,
 * restored, and continue to produce correct results.
 *
 * Test strategy:
 * 1. Create ground truth: run board for N iterations uninterrupted
 * 2. Create test board: run for N/2 iterations, serialize, restore, run N/2 more
 * 3. Compare test board results against ground truth
 *
 * CPU boards are compared against themselves (exact match expected)
 * GPU boards are compared against CPU equivalents (tolerance allowed)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { setTimeout: sleep } = require('node:timers/promises');

// Test parameters
const TEST_TIMEOUT = 60000;
const SMALL_GRID = { width: 8, height: 8 }; // 64 pixels - enough variety
const TOTAL_ITERATIONS = 50; // Total iterations for ground truth
const SERIALIZE_AT = 25; // Serialize after this many iterations

// Test location - default Mandelbrot view with mix of diverging/converging
const TEST_LOCATION = {
  name: 'Default view',
  center: [-0.5, 0.0],
  size: 4.0
};

// CPU board types to test
const CPU_BOARD_TYPES = [
  'CpuBoard',
  'QDCpuBoard',
  'DDZhuoranBoard',
  'QDZhuoranBoard',
];

// GPU board types and their CPU equivalents for ground truth
const GPU_BOARD_MAPPINGS = {
  'GpuBoard': 'CpuBoard',
  'GpuZhuoranBoard': 'DDZhuoranBoard',
  'AdaptiveGpuBoard': 'QDZhuoranBoard',
};

describe('Board Serialization', () => {
  let browser;
  let page;

  beforeAll(async () => {
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    // Use unique profile directory to avoid conflicts with parallel tests
    const userDataDir = path.join(__dirname, '../../.puppeteer-profile-serialization');
    const chromeHome = path.join(__dirname, '../../.chrome-home-serialization');
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(chromeHome, { recursive: true });

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-crash-reporter',
        '--disable-features=Crashpad,Breakpad',
        `--user-data-dir=${userDataDir}`,
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=metal',
      ],
      userDataDir,
      executablePath: chromePath || undefined,
      env: {
        ...process.env,
        HOME: chromeHome,
        XDG_CONFIG_HOME: chromeHome,
        XDG_CACHE_HOME: chromeHome,
      }
    });

    page = await browser.newPage();

    // Load the page
    const htmlPath = `file://${path.join(__dirname, '../../index.html')}`;
    await page.goto(htmlPath, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Load worker code into main thread
    const { extractAllScripts, SCRIPTS_DIR } = require('../utils/extract-scripts');
    extractAllScripts();
    const workerScriptPath = path.join(SCRIPTS_DIR, 'workerCode.js');
    await page.addScriptTag({ path: workerScriptPath });

    await sleep(1000);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (browser) {
      if (page) {
        try {
          await page.evaluate(() => {
            if (window.explorer?.scheduler?.workers) {
              window.explorer.scheduler.workers.forEach(w => w.terminate());
              window.explorer.scheduler.workers = [];
            }
          });
        } catch (e) { /* ignore */ }
      }
      await new Promise(r => setTimeout(r, 200));
      await browser.close();
    }
  });

  /**
   * Test serialization for a CPU board type
   * Compares interrupted+serialized run against uninterrupted run
   */
  async function testCpuBoardSerialization(boardTypeName) {
    return await page.evaluate(async (typeName, loc, dims, totalIters, serializeAt) => {
      const config = {
        dimsWidth: dims.width,
        dimsHeight: dims.height,
        dimsArea: dims.width * dims.height,
        aspectRatio: dims.width / dims.height,
        exponent: 2,
        enableGPU: false
      };

      const center_re = [loc.center[0], 0, 0, 0];
      const center_im = [loc.center[1], 0, 0, 0];

      // Get the board class
      const boardClasses = {
        'CpuBoard': typeof CpuBoard !== 'undefined' ? CpuBoard : null,
        'QDCpuBoard': typeof QDCpuBoard !== 'undefined' ? QDCpuBoard : null,
        'DDZhuoranBoard': typeof DDZhuoranBoard !== 'undefined' ? DDZhuoranBoard : null,
        'QDZhuoranBoard': typeof QDZhuoranBoard !== 'undefined' ? QDZhuoranBoard : null,
      };

      const BoardClass = boardClasses[typeName];
      if (!BoardClass) {
        return { error: `${typeName} not defined` };
      }

      // ===== GROUND TRUTH: Run for totalIters uninterrupted =====
      let groundTruth;
      try {
        groundTruth = new BoardClass(0, loc.size, center_re, center_im, config);
      } catch (e) {
        return { error: `Failed to create ground truth board: ${e.message}` };
      }

      const startTime = Date.now();
      const timeLimit = 30000;
      while (groundTruth.un > 0 && groundTruth.it < totalIters && (Date.now() - startTime) < timeLimit) {
        try {
          groundTruth.iterate();
        } catch (e) {
          return { error: `Ground truth iteration failed: ${e.message}` };
        }
      }

      // Capture ground truth state
      const groundTruthState = {
        it: groundTruth.it,
        un: groundTruth.un,
        di: groundTruth.di,
        ch: groundTruth.ch || 0,
        nn: Array.from(groundTruth.nn),
      };

      // ===== TEST: Run for serializeAt, serialize, restore, run remainder =====
      let testBoard;
      try {
        testBoard = new BoardClass(0, loc.size, center_re, center_im, config);
      } catch (e) {
        return { error: `Failed to create test board: ${e.message}` };
      }

      // Run for serializeAt iterations
      while (testBoard.un > 0 && testBoard.it < serializeAt && (Date.now() - startTime) < timeLimit) {
        try {
          testBoard.iterate();
        } catch (e) {
          return { error: `Test board iteration (phase 1) failed: ${e.message}` };
        }
      }

      // Serialize
      let serialized;
      try {
        serialized = await testBoard.serialize();
      } catch (e) {
        return { error: `Serialization failed: ${e.message}` };
      }

      // Verify serialization has required fields
      if (!serialized.type) {
        return { error: 'Serialized data missing type field' };
      }

      // Restore from serialization
      let restoredBoard;
      try {
        restoredBoard = Board.fromSerialized(serialized);
      } catch (e) {
        return { error: `Deserialization failed: ${e.message}` };
      }

      // Verify restored board has same iteration count
      if (restoredBoard.it !== testBoard.it) {
        return {
          error: `Restored board has wrong iteration count: ${restoredBoard.it} vs ${testBoard.it}`
        };
      }

      // Continue running to match ground truth iterations
      while (restoredBoard.un > 0 && restoredBoard.it < totalIters && (Date.now() - startTime) < timeLimit) {
        try {
          restoredBoard.iterate();
        } catch (e) {
          return { error: `Restored board iteration failed: ${e.message}` };
        }
      }

      // Capture restored board state
      const restoredState = {
        it: restoredBoard.it,
        un: restoredBoard.un,
        di: restoredBoard.di,
        ch: restoredBoard.ch || 0,
        nn: Array.from(restoredBoard.nn),
      };

      // Compare states
      const comparison = {
        itMatch: groundTruthState.it === restoredState.it,
        unMatch: groundTruthState.un === restoredState.un,
        diMatch: groundTruthState.di === restoredState.di,
        chMatch: groundTruthState.ch === restoredState.ch,
        pixelMatches: 0,
        pixelMismatches: 0,
        mismatchDetails: [],
      };

      for (let i = 0; i < config.dimsArea; i++) {
        if (groundTruthState.nn[i] === restoredState.nn[i]) {
          comparison.pixelMatches++;
        } else {
          comparison.pixelMismatches++;
          if (comparison.mismatchDetails.length < 5) {
            comparison.mismatchDetails.push({
              pixel: i,
              expected: groundTruthState.nn[i],
              actual: restoredState.nn[i]
            });
          }
        }
      }

      return {
        boardType: typeName,
        groundTruth: groundTruthState,
        restored: restoredState,
        comparison,
        serializedSize: JSON.stringify(serialized).length,
      };
    }, boardTypeName, TEST_LOCATION, SMALL_GRID, TOTAL_ITERATIONS, SERIALIZE_AT);
  }

  // Test each CPU board type
  describe('CPU Board Serialization', () => {
    for (const boardType of CPU_BOARD_TYPES) {
      test(`${boardType} serialization preserves computation state`, async () => {
        const result = await testCpuBoardSerialization(boardType);

        if (result.error) {
          console.log(`${boardType} error:`, result.error);
        }
        expect(result.error).toBeUndefined();

        // Verify metadata matches
        expect(result.comparison.itMatch).toBe(true);
        expect(result.comparison.unMatch).toBe(true);
        expect(result.comparison.diMatch).toBe(true);

        // Verify all pixels match exactly
        if (result.comparison.pixelMismatches > 0) {
          console.log(`${boardType} pixel mismatches:`, result.comparison.mismatchDetails);
        }
        expect(result.comparison.pixelMismatches).toBe(0);
        expect(result.comparison.pixelMatches).toBe(SMALL_GRID.width * SMALL_GRID.height);
      }, TEST_TIMEOUT);
    }
  });

  describe('Serialization data integrity', () => {
    test('CpuBoard serialized data contains required fields', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: false
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        const board = new CpuBoard(0, loc.size, center_re, center_im, config);

        // Run a few iterations
        for (let i = 0; i < 10 && board.un > 0; i++) {
          board.iterate();
        }

        const serialized = await board.serialize();

        return {
          hasType: 'type' in serialized,
          hasK: 'k' in serialized,
          hasSizesQD: 'sizesQD' in serialized,
          hasId: 'id' in serialized,
          hasIt: 'it' in serialized,
          hasUn: 'un' in serialized,
          hasDi: 'di' in serialized,
          hasSs: 'ss' in serialized,
          hasZz: 'zz' in serialized,
          hasBb: 'bb' in serialized,
          hasPp: 'pp' in serialized,
          type: serialized.type,
          it: serialized.it,
          ssLength: serialized.ss?.length,
        };
      }, TEST_LOCATION, SMALL_GRID);

      expect(result.hasType).toBe(true);
      expect(result.hasK).toBe(true);
      expect(result.hasSizesQD).toBe(true);
      expect(result.hasIt).toBe(true);
      expect(result.hasUn).toBe(true);
      expect(result.hasDi).toBe(true);
      expect(result.hasSs).toBe(true);
      expect(result.hasZz).toBe(true);
      expect(result.hasBb).toBe(true);
      expect(result.hasPp).toBe(true);
      expect(result.type).toBe('CpuBoard');
    }, TEST_TIMEOUT);

    test('DDZhuoranBoard serialized data contains reference orbit', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: false
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        if (typeof DDZhuoranBoard === 'undefined') {
          return { error: 'DDZhuoranBoard not defined' };
        }

        const board = new DDZhuoranBoard(0, loc.size, center_re, center_im, config);

        // Run a few iterations to build reference orbit
        for (let i = 0; i < 20 && board.un > 0; i++) {
          board.iterate();
        }

        const serialized = await board.serialize();

        return {
          hasRefOrbit: 'refOrbit' in serialized,
          hasRefC: 'refC' in serialized,
          type: serialized.type,
          refOrbitLength: serialized.refOrbit?.length,
          refIterations: board.refIterations,
        };
      }, TEST_LOCATION, SMALL_GRID);

      expect(result.error).toBeUndefined();
      expect(result.hasRefOrbit).toBe(true);
      expect(result.hasRefC).toBe(true);
      expect(result.type).toBe('DDZhuoranBoard');
      expect(result.refOrbitLength).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('QDZhuoranBoard serialized data contains QD reference orbit', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: false
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        if (typeof QDZhuoranBoard === 'undefined') {
          return { error: 'QDZhuoranBoard not defined' };
        }

        const board = new QDZhuoranBoard(0, loc.size, center_re, center_im, config);

        // Run a few iterations
        for (let i = 0; i < 20 && board.un > 0; i++) {
          board.iterate();
        }

        const serialized = await board.serialize();

        return {
          hasQdRefOrbit: 'qdRefOrbit' in serialized,
          hasRefC_qd: 'refC_qd' in serialized,
          hasDc: 'dc' in serialized,
          hasDz: 'dz' in serialized,
          hasRefIter: 'refIter' in serialized,
          hasPixelIndexes: 'pixelIndexes' in serialized,
          type: serialized.type,
        };
      }, TEST_LOCATION, SMALL_GRID);

      expect(result.error).toBeUndefined();
      expect(result.hasQdRefOrbit).toBe(true);
      expect(result.hasRefC_qd).toBe(true);
      expect(result.hasDc).toBe(true);
      expect(result.hasDz).toBe(true);
      expect(result.hasRefIter).toBe(true);
      expect(result.hasPixelIndexes).toBe(true);
      expect(result.type).toBe('QDZhuoranBoard');
    }, TEST_TIMEOUT);

  });

  describe('Edge cases', () => {
    test('Serialization works before any iterate() calls', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: false
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        const board = new CpuBoard(0, loc.size, center_re, center_im, config);

        // Don't run any iterations - serialize immediately
        // Note: Board constructor sets it=1 (z=c is iteration 1)
        const serialized = await board.serialize();
        const restored = Board.fromSerialized(serialized);

        // Run restored board for 50 iterations
        for (let i = 0; i < 50 && restored.un > 0; i++) {
          restored.iterate();
        }

        // Run fresh board for comparison
        const fresh = new CpuBoard(0, loc.size, center_re, center_im, config);
        for (let i = 0; i < 50 && fresh.un > 0; i++) {
          fresh.iterate();
        }

        // Compare
        let matches = 0;
        for (let i = 0; i < config.dimsArea; i++) {
          if (restored.nn[i] === fresh.nn[i]) matches++;
        }

        return {
          serializedIt: serialized.it,
          restoredDi: restored.di,
          freshDi: fresh.di,
          pixelMatches: matches,
          totalPixels: config.dimsArea,
        };
      }, TEST_LOCATION, SMALL_GRID);

      // Boards start at iteration 1 (z = c) per constructor
      expect(result.serializedIt).toBe(1);
      expect(result.restoredDi).toBe(result.freshDi);
      expect(result.pixelMatches).toBe(result.totalPixels);
    }, TEST_TIMEOUT);

    test('Serialization works after all pixels complete', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: false
        };

        // Use a location where all pixels diverge quickly
        const center_re = [2.0, 0, 0, 0];
        const center_im = [0.0, 0, 0, 0];

        const board = new CpuBoard(0, 0.1, center_re, center_im, config);

        // Run until all complete
        while (board.un > 0) {
          board.iterate();
        }

        const serialized = await board.serialize();
        const restored = Board.fromSerialized(serialized);

        return {
          originalUn: board.un,
          restoredUn: restored.un,
          originalDi: board.di,
          restoredDi: restored.di,
          originalIt: board.it,
          restoredIt: restored.it,
          ssLength: serialized.ss?.length, // Should be 0 - no active pixels
        };
      }, TEST_LOCATION, SMALL_GRID);

      expect(result.originalUn).toBe(0);
      expect(result.restoredUn).toBe(0);
      expect(result.originalDi).toBe(result.restoredDi);
      expect(result.originalIt).toBe(result.restoredIt);
      expect(result.ssLength).toBe(0); // No active pixels to serialize
    }, TEST_TIMEOUT);
  });

  describe('GPU Board Serialization', () => {
    /**
     * Test serialization for a GPU board type
     * GPU boards use async initialization and compute, so we need to handle that
     */
    async function testGpuBoardSerialization(boardTypeName, cpuEquivalentName) {
      return await page.evaluate(async (gpuTypeName, cpuTypeName, loc, dims, totalIters, serializeAt) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: true
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        // Get the board classes
        const gpuBoardClasses = {
          'GpuBoard': typeof GpuBoard !== 'undefined' ? GpuBoard : null,
          'GpuZhuoranBoard': typeof GpuZhuoranBoard !== 'undefined' ? GpuZhuoranBoard : null,
          'AdaptiveGpuBoard': typeof AdaptiveGpuBoard !== 'undefined' ? AdaptiveGpuBoard : null,
        };
        const cpuBoardClasses = {
          'CpuBoard': typeof CpuBoard !== 'undefined' ? CpuBoard : null,
          'DDZhuoranBoard': typeof DDZhuoranBoard !== 'undefined' ? DDZhuoranBoard : null,
          'QDZhuoranBoard': typeof QDZhuoranBoard !== 'undefined' ? QDZhuoranBoard : null,
        };

        const GpuBoardClass = gpuBoardClasses[gpuTypeName];
        const CpuBoardClass = cpuBoardClasses[cpuTypeName];

        if (!GpuBoardClass) {
          return { error: `${gpuTypeName} not defined` };
        }
        if (!CpuBoardClass) {
          return { error: `${cpuTypeName} not defined` };
        }

        // ===== GROUND TRUTH: Run CPU board for totalIters =====
        let groundTruth;
        try {
          groundTruth = new CpuBoardClass(0, loc.size, center_re, center_im, config);
        } catch (e) {
          return { error: `Failed to create ground truth board: ${e.message}` };
        }

        const startTime = Date.now();
        const timeLimit = 30000;
        while (groundTruth.un > 0 && groundTruth.it < totalIters && (Date.now() - startTime) < timeLimit) {
          try {
            groundTruth.iterate();
          } catch (e) {
            return { error: `Ground truth iteration failed: ${e.message}` };
          }
        }

        const groundTruthNn = Array.from(groundTruth.nn);

        // ===== TEST: Create GPU board, serialize, restore, continue =====
        let testBoard;
        try {
          testBoard = new GpuBoardClass(0, loc.size, center_re, center_im, config);
        } catch (e) {
          return { error: `Failed to create GPU test board: ${e.message}` };
        }

        // Wait for GPU initialization
        try {
          await testBoard.ensureGPUReady();
        } catch (e) {
          return { skip: true, reason: `GPU not available: ${e.message}` };
        }

        if (!testBoard.isGPUReady) {
          return { skip: true, reason: 'GPU initialization failed' };
        }

        // Run for serializeAt iterations using compute()
        while (testBoard.un > 0 && testBoard.it < serializeAt && (Date.now() - startTime) < timeLimit) {
          try {
            await testBoard.compute();
          } catch (e) {
            return { error: `GPU test board compute (phase 1) failed: ${e.message}` };
          }
        }

        const preSerializeState = {
          it: testBoard.it,
          un: testBoard.un,
          di: testBoard.di,
        };

        // Serialize
        let serialized;
        try {
          serialized = await testBoard.serialize();
        } catch (e) {
          return { error: `GPU serialization failed: ${e.message}` };
        }

        // Verify serialization has required fields
        if (!serialized.type) {
          return { error: 'Serialized data missing type field' };
        }
        if (!serialized.gpuPixelData) {
          return { error: 'Serialized data missing gpuPixelData' };
        }

        // Restore from serialization
        let restoredBoard;
        try {
          restoredBoard = Board.fromSerialized(serialized);
        } catch (e) {
          return { error: `GPU deserialization failed: ${e.message}` };
        }

        // Wait for async restoration to complete
        try {
          await restoredBoard.gpuInitPromise;
        } catch (e) {
          return { error: `GPU restoration failed: ${e.message}` };
        }

        // Verify restored board has same iteration count
        if (restoredBoard.it !== preSerializeState.it) {
          return {
            error: `Restored board has wrong iteration count: ${restoredBoard.it} vs ${preSerializeState.it}`
          };
        }

        // Continue running to match ground truth iterations
        while (restoredBoard.un > 0 && restoredBoard.it < totalIters && (Date.now() - startTime) < timeLimit) {
          try {
            await restoredBoard.compute();
          } catch (e) {
            return { error: `Restored GPU board compute failed: ${e.message}` };
          }
        }

        // Compare against CPU ground truth
        // GPU boards may have some tolerance due to float32 vs float64 precision
        let pixelMatches = 0;
        let pixelMismatches = 0;
        let bigMismatches = 0;  // More than 1 iteration off
        const mismatchDetails = [];

        for (let i = 0; i < config.dimsArea; i++) {
          if (groundTruthNn[i] === restoredBoard.nn[i]) {
            pixelMatches++;
          } else {
            pixelMismatches++;
            const diff = Math.abs(groundTruthNn[i] - restoredBoard.nn[i]);
            if (diff > 1) {
              bigMismatches++;
            }
            if (mismatchDetails.length < 5) {
              mismatchDetails.push({
                pixel: i,
                expected: groundTruthNn[i],
                actual: restoredBoard.nn[i],
                diff
              });
            }
          }
        }

        return {
          boardType: gpuTypeName,
          cpuEquivalent: cpuTypeName,
          groundTruth: { it: groundTruth.it, di: groundTruth.di },
          restored: { it: restoredBoard.it, di: restoredBoard.di },
          comparison: {
            pixelMatches,
            pixelMismatches,
            bigMismatches,
            mismatchDetails,
          },
          serializedSize: JSON.stringify(serialized).length,
          hasGpuPixelData: !!serialized.gpuPixelData,
        };
      }, boardTypeName, cpuEquivalentName, TEST_LOCATION, SMALL_GRID, TOTAL_ITERATIONS, SERIALIZE_AT);
    }

    test('GpuBoard serialization preserves computation state', async () => {
      const result = await testGpuBoardSerialization('GpuBoard', 'CpuBoard');

      if (result.skip) {
        console.log(`GpuBoard test skipped: ${result.reason}`);
        return; // Skip test if GPU not available
      }

      if (result.error) {
        console.log('GpuBoard error:', result.error);
      }
      expect(result.error).toBeUndefined();

      // Verify GPU-specific serialization
      expect(result.hasGpuPixelData).toBe(true);

      // Allow some tolerance for GPU vs CPU differences (float32 vs float64)
      const totalPixels = SMALL_GRID.width * SMALL_GRID.height;
      const tolerance = Math.floor(totalPixels * 0.16); // 16% can differ
      const bigTolerance = Math.ceil(totalPixels * 0.07); // 7% can differ by more than 1 iteration
      if (result.comparison.pixelMismatches > tolerance || result.comparison.bigMismatches > bigTolerance) {
        console.log('GpuBoard pixel mismatches:', result.comparison.mismatchDetails);
      }
      expect(result.comparison.pixelMismatches).toBeLessThanOrEqual(tolerance);
      expect(result.comparison.bigMismatches).toBeLessThanOrEqual(bigTolerance);
    }, TEST_TIMEOUT);

    test('GpuZhuoranBoard serialization preserves computation state', async () => {
      const result = await testGpuBoardSerialization('GpuZhuoranBoard', 'DDZhuoranBoard');

      if (result.skip) {
        console.log(`GpuZhuoranBoard test skipped: ${result.reason}`);
        return;
      }

      if (result.error) {
        console.log('GpuZhuoranBoard error:', result.error);
      }
      expect(result.error).toBeUndefined();

      expect(result.hasGpuPixelData).toBe(true);

      // Allow some tolerance for GPU vs CPU differences
      const totalPixels = SMALL_GRID.width * SMALL_GRID.height;
      const tolerance = Math.floor(totalPixels * 0.16); // 16% can differ
      const bigTolerance = Math.ceil(totalPixels * 0.07); // 7% can differ by more than 1 iteration
      if (result.comparison.pixelMismatches > tolerance || result.comparison.bigMismatches > bigTolerance) {
        console.log('GpuZhuoranBoard pixel mismatches:', result.comparison.mismatchDetails);
      }
      expect(result.comparison.pixelMismatches).toBeLessThanOrEqual(tolerance);
      expect(result.comparison.bigMismatches).toBeLessThanOrEqual(bigTolerance);
    }, TEST_TIMEOUT);

    test('AdaptiveGpuBoard serialization preserves computation state', async () => {
      const result = await testGpuBoardSerialization('AdaptiveGpuBoard', 'QDZhuoranBoard');

      if (result.skip) {
        console.log(`AdaptiveGpuBoard test skipped: ${result.reason}`);
        return;
      }

      if (result.error) {
        console.log('AdaptiveGpuBoard error:', result.error);
      }
      expect(result.error).toBeUndefined();

      expect(result.hasGpuPixelData).toBe(true);

      // Allow some tolerance for GPU vs CPU differences
      const totalPixels = SMALL_GRID.width * SMALL_GRID.height;
      const tolerance = Math.floor(totalPixels * 0.16); // 16% can differ
      const bigTolerance = Math.ceil(totalPixels * 0.07); // 7% can differ by more than 1 iteration
      if (result.comparison.pixelMismatches > tolerance || result.comparison.bigMismatches > bigTolerance) {
        console.log('AdaptiveGpuBoard pixel mismatches:', result.comparison.mismatchDetails);
      }
      expect(result.comparison.pixelMismatches).toBeLessThanOrEqual(tolerance);
      expect(result.comparison.bigMismatches).toBeLessThanOrEqual(bigTolerance);
    }, TEST_TIMEOUT);

    test('GpuBoard serialized data contains required fields', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: true
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        if (typeof GpuBoard === 'undefined') {
          return { error: 'GpuBoard not defined' };
        }

        const board = new GpuBoard(0, loc.size, center_re, center_im, config);

        try {
          await board.ensureGPUReady();
        } catch (e) {
          return { skip: true, reason: `GPU not available: ${e.message}` };
        }

        if (!board.isGPUReady) {
          return { skip: true, reason: 'GPU initialization failed' };
        }

        // Run a few compute iterations
        for (let i = 0; i < 3 && board.un > 0; i++) {
          await board.compute();
        }

        const serialized = await board.serialize();

        return {
          hasType: 'type' in serialized,
          hasGpuPixelData: 'gpuPixelData' in serialized,
          hasCpuStatus: 'cpuStatus' in serialized,
          hasEffort: 'effort' in serialized,
          hasCompletedIndexes: 'completedIndexes' in serialized,
          hasCompletedNn: 'completedNn' in serialized,
          type: serialized.type,
          gpuPixelDataLength: serialized.gpuPixelData?.length,
        };
      }, TEST_LOCATION, SMALL_GRID);

      if (result.skip) {
        console.log(`Test skipped: ${result.reason}`);
        return;
      }

      expect(result.error).toBeUndefined();
      expect(result.hasType).toBe(true);
      expect(result.hasGpuPixelData).toBe(true);
      expect(result.hasCompletedIndexes).toBe(true);
      expect(result.hasCompletedNn).toBe(true);
      expect(result.type).toBe('GpuBoard');
      expect(result.gpuPixelDataLength).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('GpuZhuoranBoard serialized data contains reference orbit', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: true
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        if (typeof GpuZhuoranBoard === 'undefined') {
          return { error: 'GpuZhuoranBoard not defined' };
        }

        const board = new GpuZhuoranBoard(0, loc.size, center_re, center_im, config);

        try {
          await board.ensureGPUReady();
        } catch (e) {
          return { skip: true, reason: `GPU not available: ${e.message}` };
        }

        if (!board.isGPUReady) {
          return { skip: true, reason: 'GPU initialization failed' };
        }

        // Run a few compute iterations to build reference orbit
        for (let i = 0; i < 5 && board.un > 0; i++) {
          await board.compute();
        }

        const serialized = await board.serialize();

        return {
          hasGpuPixelData: 'gpuPixelData' in serialized,
          hasRefOrbit: 'refOrbit' in serialized,
          hasRefC: 'refC' in serialized,
          hasRefIterations: 'refIterations' in serialized,
          type: serialized.type,
          refOrbitLength: serialized.refOrbit?.length,
          refIterations: serialized.refIterations,
        };
      }, TEST_LOCATION, SMALL_GRID);

      if (result.skip) {
        console.log(`Test skipped: ${result.reason}`);
        return;
      }

      expect(result.error).toBeUndefined();
      expect(result.hasGpuPixelData).toBe(true);
      expect(result.hasRefOrbit).toBe(true);
      expect(result.hasRefC).toBe(true);
      expect(result.hasRefIterations).toBe(true);
      expect(result.type).toBe('GpuZhuoranBoard');
      expect(result.refOrbitLength).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('AdaptiveGpuBoard serialized data contains QD reference orbit', async () => {
      const result = await page.evaluate(async (loc, dims) => {
        const config = {
          dimsWidth: dims.width,
          dimsHeight: dims.height,
          dimsArea: dims.width * dims.height,
          aspectRatio: dims.width / dims.height,
          exponent: 2,
          enableGPU: true
        };

        const center_re = [loc.center[0], 0, 0, 0];
        const center_im = [loc.center[1], 0, 0, 0];

        if (typeof AdaptiveGpuBoard === 'undefined') {
          return { error: 'AdaptiveGpuBoard not defined' };
        }

        const board = new AdaptiveGpuBoard(0, loc.size, center_re, center_im, config);

        try {
          await board.ensureGPUReady();
        } catch (e) {
          return { skip: true, reason: `GPU not available: ${e.message}` };
        }

        if (!board.isGPUReady) {
          return { skip: true, reason: 'GPU initialization failed' };
        }

        // Run a few compute iterations
        for (let i = 0; i < 5 && board.un > 0; i++) {
          await board.compute();
        }

        const serialized = await board.serialize();

        return {
          hasGpuPixelData: 'gpuPixelData' in serialized,
          hasQdRefOrbit: 'qdRefOrbit' in serialized,
          hasRefC_qd: 'refC_qd' in serialized,
          hasRefIterations: 'refIterations' in serialized,
          hasInitialScale: 'initialScale' in serialized,
          type: serialized.type,
          qdRefOrbitLength: serialized.qdRefOrbit?.length,
        };
      }, TEST_LOCATION, SMALL_GRID);

      if (result.skip) {
        console.log(`Test skipped: ${result.reason}`);
        return;
      }

      expect(result.error).toBeUndefined();
      expect(result.hasGpuPixelData).toBe(true);
      expect(result.hasQdRefOrbit).toBe(true);
      expect(result.hasRefC_qd).toBe(true);
      expect(result.hasRefIterations).toBe(true);
      expect(result.hasInitialScale).toBe(true);
      expect(result.type).toBe('AdaptiveGpuBoard');
      expect(result.qdRefOrbitLength).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });
});
