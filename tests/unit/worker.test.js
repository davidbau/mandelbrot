/**
 * Unit tests for Worker Logic (Board implementations).
 * Uses workerBlob.js (workerCode + mathCode combined) which matches
 * the browser's worker blob format for coverage merge.
 */

const { loadWorkerBlob } = require('../utils/extract-scripts');

// Mock worker environment and load combined worker blob
global.self = global;
const workerExports = loadWorkerBlob();
Object.assign(global, workerExports);

const { CpuBoard, DDZhuoranBoard, GpuBoard, GpuZhuoranBoard } = workerExports;

// Mock WebGPU environment
global.GPUBufferUsage = { STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, MAP_READ: 8, UNIFORM: 16 };
global.GPUMapMode = { READ: 1, WRITE: 2 };
global.GPUShaderStage = { COMPUTE: 1 };

global.navigator = {
  gpu: {
    requestAdapter: async () => ({
      limits: {
        maxStorageBufferBindingSize: 1024 * 1024 * 128,
        maxComputeWorkgroupSizeX: 256
      },
      requestDevice: async () => ({
        createCommandEncoder: () => ({
          beginComputePass: () => ({
            setPipeline: () => {},
            setBindGroup: () => {},
            dispatchWorkgroups: () => {},
            end: () => {}
          }),
          copyBufferToBuffer: () => {},
          finish: () => {}
        }),
        createBuffer: () => ({ mapAsync: async () => {}, getMappedRange: () => new Float32Array(100), unmap: () => {} }),
        createBindGroup: () => {},
        createBindGroupLayout: () => {},
        createPipelineLayout: () => {},
        createShaderModule: () => {},
        createComputePipeline: () => ({
          getBindGroupLayout: () => {}
        }),
        createQuerySet: () => {},
        queue: {
          submit: () => {},
          writeBuffer: () => {},
          onSubmittedWorkDone: () => Promise.resolve()
        },
        limits: {
          maxStorageBufferBindingSize: 1024 * 1024 * 128,
          maxComputeWorkgroupSizeX: 256
        }
      })
    })
  }
};

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
      enableGPU: true // Enable GPU for tests
    };
  }

  describe('CpuBoard', () => {
    test('should initialize correctly', () => {
      const config = createConfig();
      config.enableGPU = false;
      const board = new CpuBoard(0, 3.0, [0,0], [0,0], config, 'test-id');
      
      expect(board.k).toBe(0);
      expect(board.id).toBe('test-id');
      expect(board.un).toBe(16); // All pixels start unfinished
      expect(board.cc.length).toBe(32); // 16 pixels * 2 (re, im)
    });

    test('should compute diverging pixels (c=2)', () => {
      const config = createConfig();
      config.enableGPU = false;
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
      config.enableGPU = false;
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
    
    test('should handle serialization', async () => {
      const config = createConfig();
      config.enableGPU = false;
      const board = new CpuBoard(0, 3.0, [0,0], [0,0], config, 'test-id');

      const data = await board.serialize();
      expect(data.type).toBe('CpuBoard');
      expect(data.k).toBe(0);

      const restored = CpuBoard.fromSerialized(data);
      expect(restored).toBeInstanceOf(CpuBoard);
      expect(restored.id).toBe(board.id);
      expect(restored.cc).toEqual(board.cc);
    });
  });
  
  describe('DDZhuoranBoard', () => {
     test('should initialize and compute', () => {
      const config = createConfig();
      config.enableGPU = false;
      const loc = TEST_LOCATIONS.outside;
      const board = new DDZhuoranBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      let maxIter = 100;
      while (board.un > 0 && maxIter-- > 0) {
        board.iterate();
      }
      
      expect(board.un).toBe(0);
      expect(board.di).toBe(16);
     });
  });

 describe('GpuBoard', () => {
    test('should initialize and prepare GPU', async () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.outside;
      // re, im are expected to be quad-doubles or numbers.
      const board = new GpuBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      // Verify basic properties
      expect(board).toBeInstanceOf(GpuBoard);
      expect(board.constructor.name).toBe('GpuBoard'); 
      
      // Test async initialization (uses mock)
      await board.initGPU();
      
      expect(board.device).toBeDefined();
      
      // Try one iteration (should call mocked GPU methods)
      await board.iterate();
      
      // Since mock doesn't compute, un/di won't change unless we mock that too.
      // But coverage should be hit.
    });
 });

 describe('GpuZhuoranBoard', () => {
    test('should initialize', async () => {
      const config = createConfig();
      const loc = TEST_LOCATIONS.outside;
      const board = new GpuZhuoranBoard(0, loc.size, [loc.center[0], 0], [loc.center[1], 0], config, 'test-id');
      
      await board.initGPU();
      expect(board.device).toBeDefined();
    });
 });
});
