module.exports = {
  env: { node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 9,
    sourceType: "module",
    tsConfigRootDir: __dirname,
    project: ["./tsconfig.json"],
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier/@typescript-eslint",
  ],
  ignorePatterns: ["coverage", "lib", "test/__test", ".eslintrc.js"],
  rules: {
    "comma-dangle": ["error", "always-multiline"],
    "dot-notation": ["error"],
    "max-classes-per-file": ["error", 1],
    "max-len": ["warn", { code: 120 }],
    "no-console": "error",
    "@typescript-eslint/ban-types": "error",
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
    "@typescript-eslint/quotes": ["warn", "double", { allowTemplateLiterals: true }],
    "@typescript-eslint/no-floating-promises": ["off"],
  },
  overrides: [
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
      },
    },
    {
      files: ["test/**/*"],
      env: { mocha: true },
      extends: ["plugin:mocha/recommended"],
      parserOptions: { project: "test/tsconfig.json" },
      plugins: ["mocha"],
      rules: {
        "@typescript-eslint/ban-ts-ignore": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/unbound-method": "off",
        "@typescript-eslint/no-empty-function": "off",
        "dot-notation": ["off"],
      },
    },
  ],
};
