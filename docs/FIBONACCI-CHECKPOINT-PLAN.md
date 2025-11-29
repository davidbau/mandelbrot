# Fibonacci Checkpoint Implementation Plan

## Goal
Replace power-of-2 checkpoint intervals with Fibonacci sequence to reduce period harmonic detection (detecting 60, 120 instead of fundamental period 30).

## Risk Assessment & Implementation Order

### Phase 1: Low Risk - Core Function Replacement
**Risk: LOW** - Pure function replacements, no architectural changes

1. ✅ Create branch `fibonacci-checkpoints`
2. Replace global `figurePeriod` with `fibonacciPeriod` (line 5936)
3. Replace `GpuBoard.figurePeriod` method (line 4365)
4. Update function comments/documentation
5. **Commit:** "Replace figurePeriod with Fibonacci sequence for CPU boards"
6. **Test scope:** CPU Board, CPU ZhuoranBoard at all zoom levels

### Phase 2: Low-Medium Risk - CPU Board Types
**Risk: LOW-MEDIUM** - Uses updated global function, no GPU changes

7. Replace QuadBoard bit-shift logic with `fibonacciPeriod()` call (line 2857-2862)
8. **Commit:** "Update QuadBoard to use Fibonacci checkpoints"
9. **Test scope:** QuadBoard at all zoom levels

### Phase 3: Medium Risk - GPU ZhuoranBoard Verification
**Risk: MEDIUM** - Already uses precomputation, just verify it picks up new function

10. Verify GpuZhuoranBoard uses global `fibonacciPeriod` for precomputation (line 5092)
11. Test checkpoint generation for high iteration counts
12. **Commit:** "Verify GpuZhuoranBoard works with Fibonacci checkpoints"
13. **Test scope:** Deep zoom (pixelSize <= 1e-6) - the user-reported bug scenario

### Phase 4: High Risk - Old GpuBoard Refactoring
**Risk: HIGH** - Requires architectural changes to match GpuZhuoranBoard

14. Refactor GpuBoard to use precomputed checkpoints:
    - Add checkpoint precomputation in JavaScript (like GpuZhuoranBoard line 5082-5100)
    - Extend Params struct with checkpoint fields
    - Replace `is_power_of_2(iter)` shader logic with checkpoint lookup
15. Remove old `is_power_of_2()` function (line 3895)
16. **Commit:** "Refactor GpuBoard to use precomputed Fibonacci checkpoints"
17. **Test scope:** Shallow zoom (pixelSize > 1e-6)

### Phase 5: Low Risk - Thread-Following Thresholds
**Risk: LOW** - Simple constant replacements

18. Replace 8192 → 10946 (line 4910, GPU Zhuoran shader)
19. Replace 5000 → 6765 (line 3559, CPU GpuBoard) [user to confirm]
20. Update comments referencing power-of-2
21. **Commit:** "Update thread-following thresholds to Fibonacci numbers"
22. **Test scope:** High iteration count regions (>8192 iterations)

### Phase 6: Documentation
**Risk: NONE** - Comment updates only

23. Update all comments referencing "power-of-2":
    - Line 2604, 2861, 3515, 3894, 4725, 5938
24. **Commit:** "Update documentation to reference Fibonacci checkpoints"

## Implementation Details

### Fibonacci Function
```javascript
function fibonacciPeriod(iteration) {
  if (iteration === 0) return 1;
  if (iteration === 1) return 1;

  // Find largest Fibonacci number <= iteration
  let a = 1, b = 1;
  while (b < iteration) {
    [a, b] = [b, a + b];
  }

  // Return 1 if iteration is exact Fibonacci, else distance from previous
  if (b === iteration) return 1;
  return iteration - a + 1;
}
```

### Fibonacci Numbers Reference
```
1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584,
4181, 6765, 10946, 17711, 28657, 46368, 75025, 121393, 196418, 317811, ...
```

### Threshold Replacements
- 8192 → **10946** (nearest larger Fibonacci)
- 5000 → **6765** (nearest larger Fibonacci) [pending user confirmation]

## Testing Strategy (for user)

1. **Phase 1 commits:** Test CPU Board, CPU ZhuoranBoard
2. **Phase 2 commits:** Test QuadBoard
3. **Phase 3 commits:** Test deep zoom with period detection
4. **Phase 4 commits:** Test shallow zoom with period detection
5. **Phase 5 commits:** Test high iteration count regions
6. **Final:** Compare harmonic detection vs main branch

## Success Criteria

- All board types compute correctly
- Period detection still works
- Reduced harmonic detection (30 instead of 60, 120)
- No performance regression (especially GPU)
