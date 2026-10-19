import { defineConfig, globalIgnores } from "eslint/config";

import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import mocha from "eslint-plugin-mocha";
import eslintjs from "@eslint/js";
import n from "eslint-plugin-n";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: eslintjs.configs.recommended,
  allConfig: eslintjs.configs.all,
});

export default defineConfig([
  {
    ignores: ["eslint.config.mjs", "release.config.mjs", "test/release-config.test.mjs"],
  },
  n.configs["flat/recommended-module"],
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },

      parser: tsParser,
      ecmaVersion: 9,
      sourceType: "module",

      parserOptions: {
        tsConfigRootDir: import.meta.dirname,
        project: ["./tsconfig.json"],
      },
    },

    plugins: {
      "@typescript-eslint": typescriptEslint,
    },

    extends: compat.extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/eslint-recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "prettier",
    ),

    settings: {
      n: {
        tryExtensions: [".js", ".json", ".node", ".ts"],
      },
    },

    rules: {
      "comma-dangle": ["error", "always-multiline"],
      "dot-notation": ["error"],
      "max-classes-per-file": ["error", 1],

      "max-len": [
        "warn",
        {
          code: 120,
        },
      ],

      "no-console": "error",

      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "interface",
          format: ["PascalCase"],

          custom: {
            regex: "^I[A-Z]",
            match: false,
          },
        },
      ],

      "@typescript-eslint/no-explicit-any": "off",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "all",
          argsIgnorePattern: "^_",
        },
      ],

      "@typescript-eslint/no-floating-promises": ["off"],
    },
  },
  globalIgnores(["**/coverage", "**/lib", "test/__test", "test/cjs-smoke.cjs"]),
  {
    // the examples are plain JavaScript outside the TypeScript project, so they are linted without type information
    files: ["tutorials/**/*.mjs"],
    extends: [typescriptEslint.configs["flat/disable-type-checked"]],
    languageOptions: {
      ecmaVersion: "latest",
    },
    rules: {
      "no-console": "off",
      // command line examples exit with a usage message, as the RabbitMQ originals do
      "n/no-process-exit": "off",
      // the package's own name resolves to lib/, which only exists after a build
      "n/no-missing-import": ["error", { allowModules: ["@droidsolutions-oss/amqp-ts"] }],
    },
  },
  {
    files: ["test/**/*"],
    ...mocha.configs.recommended,
    languageOptions: {
      ...mocha.configs.recommended.languageOptions,
      parserOptions: {
        ...mocha.configs.recommended.languageOptions?.parserOptions,
        project: "test/tsconfig.json",
      },
    },
    rules: {
      ...mocha.configs.recommended.rules,
      "@typescript-eslint/ban-ts-ignore": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-empty-function": "off",
      "dot-notation": ["off"],
    },
  },
]);
