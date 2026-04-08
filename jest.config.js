/**
 * Jest configuration for SSHIFT project
 */
module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test match patterns
  testMatch: [
    '**/src/tests/**/*.test.js',
    '**/src/tests/**/*.spec.js'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/tests/fixtures/',
    '/src/tests/helpers/'
  ],
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.js'],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server/index.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  
  // Coverage reporters
  coverageReporters: ['text', 'lcov', 'html'],
  
  // Coverage directory
  coverageDirectory: 'coverage',
  
  // Test timeout (30 seconds for integration tests)
  testTimeout: 30000,
  
  // Verbose output
  verbose: true,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Force exit after tests complete
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,
  
  // Module paths
  moduleDirectories: ['node_modules', 'src'],
  
  // Global variables available in tests
  globals: {
    'SERVER_URL': 'http://localhost:8022'
  }
};