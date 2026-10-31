import js from "@eslint/js";
import noComments from "eslint-plugin-no-comments";
import globals from "globals";

const WORKAROUND_TERMS = [
  "todo",
  "fixme",
  "xxx",
  "hack",
  "workaround",
  "work around",
  "for now",
  "temporary",
  "temporarily",
  "not ideal",
  "should be",
  "ideally",
  "revisit",
  "later",
];

export default [
  { ignores: ["node_modules/**", "public/fonts/**", "evidence-fixtures/**", "marketing/**"] },
  js.configs.recommended,
  { rules: { "no-irregular-whitespace": ["error", { skipTemplates: true }] } },
  {
    files: ["**/*.mjs", "test/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser, ...globals.node, HTMLRewriter: "readonly" } },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: globals.browser },
  },
  {
    files: ["src/**/*.js", "public/**/*.js", "test/**/*.mjs"],
    plugins: { "no-comments": noComments },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: {
      "no-comments/disallowComments": ["error", { allow: ["eslint", "global"] }],
      "no-inline-comments": "error",
      "no-warning-comments": ["error", { terms: WORKAROUND_TERMS, location: "anywhere" }],
    },
  },
];
