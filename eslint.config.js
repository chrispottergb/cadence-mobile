// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*', 'coverage/*'],
  },
  {
    files: ['jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly', require: 'readonly' } },
  },
]);
