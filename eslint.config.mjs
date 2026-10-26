import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.local-db*/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      "fixtures/**",
      "docs/**",
      "packages/db/test/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        FormData: "readonly",
        React: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        indexedDB: "readonly",

        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        crypto: "readonly",
        structuredClone: "readonly",
        atob: "readonly",
        btoa: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",

        self: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "eqeqeq": ["error", "smart"],
      "prefer-const": "error",
      "no-console": "off",
      "no-undef": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
