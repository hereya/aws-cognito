module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/test/e2e/'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
