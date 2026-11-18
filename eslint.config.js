import babelParser from "@babel/eslint-parser";
import sonarjs from "eslint-plugin-sonarjs";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
    languageOptions: {
      // typescript-eslint does not yet support this workspace's TypeScript 7 version.
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: {
            plugins: [["decorators", { version: "2023-11" }], "typescript"],
          },
        },
      },
    },
    plugins: {
      sonarjs,
    },
    rules: {
      "sonarjs/cognitive-complexity": ["warn", 15],
    },
  },
];
