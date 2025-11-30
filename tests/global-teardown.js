/**
 * Jest global teardown - runs once after all tests
 */

const { writeCoverageReport } = require('./utils/coverage');

module.exports = async () => {
  if (process.env.COLLECT_COVERAGE === '1') {
    await writeCoverageReport();
  }
};
