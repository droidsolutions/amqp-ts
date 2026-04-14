import { defineConfig, globalIgnores } from "eslint/config";

import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import mocha from "eslint-plugin-mocha";
import eslintjs from "@eslint/js";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: eslintjs.configs.recommended,
  allConfig: eslintjs.configs.all,
});

export default defineConfig([
  {
    ignores: ["eslint.config.mjs"],
  },
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
      "plugin:n/recommended-module",
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
  globalIgnores(["**/coverage", "**/lib", "test/__test", "tools/alive.js", "tutorials/**/*.js", "**/.eslintrc.js"]),
  {
    files: ["tutorials/**/**"],

    rules: {
      "no-var-requires": "off",
      "no-console": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "no-undef": "off",
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
