module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  testTimeout: 30000, // 30 seconds for API calls
};
