/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'test',
  testRegex: '.*[.]e2e-spec[.]ts$',
  setupFiles: ['<rootDir>/setup-env.ts'],
  transform: { '^.+[.]ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  testTimeout: 30000,
};
