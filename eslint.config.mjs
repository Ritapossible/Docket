import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Lints the TypeScript that the Solidity formatter never sees. The contracts had `forge fmt`
 * and `forge lint` from the start; the SDK, the indexer and the console had nothing.
 *
 * Type-aware rules are deliberately off. They need a project reference per package and the
 * three packages here use different tsconfigs with different module resolutions; the syntactic
 * ruleset plus `tsc --noEmit` per package already covers what matters, and CI runs both.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "contracts/lib/**",
      "contracts/out/**",
      "console/src/generated/**",
      "sdk/src/abi.ts",
      "indexer/src/abi.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The chain data this project handles is bigint and hex strings, and a few casts through
      // `unknown` are unavoidable at the viem boundary. Flag unused code and shadowed bindings,
      // which are real, rather than every cast, which is noise.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", {argsIgnorePattern: "^_"}],
      "no-console": "off",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["console/src/**/*.{ts,tsx}"],
    plugins: {"react-hooks": reactHooks},
    rules: {
      // These catch real bugs, not style: a missing dependency in a polling hook is how a
      // console ends up rendering data it fetched once and never refreshed.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Node scripts: the runtime globals they legitimately use. Listing them rather than
    // switching off no-undef keeps a genuine typo an error.
    files: ["**/*.mjs", "script/**", "bench/**", "**/scripts/**"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        performance: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        __dirname: "readonly",
      },
    },
  },
);
