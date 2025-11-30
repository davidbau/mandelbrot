/**
 * Jest global setup - runs once before all tests
 */

const { clearCoverage } = require('./utils/coverage');

module.exports = async () => {
  if (process.env.COLLECT_COVERAGE === '1') {
    clearCoverage();
  }
};
