module.exports = {
  root: true,
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier",
    "prettier/@typescript-eslint",
    // TODO: React
  ],
  plugins: ["simple-import-sort"],
  parserOptions: {
    project: "./tsconfig.json",
  },
  root: true,
  plugins: [
    "@typescript-eslint",
    "import",
    "react",
    "react-hooks",
    "simple-import-sort",
  ],
  env: {
    es6: true,
    node: true,
  },
  rules: {
    "import/no-restricted-paths": [
      "error",
      {
        basePath: "src",
        // Disallow these dirs from importing from each other.
        zones: makeRestrictedPathsZones([
          "background",
          "options",
          "popup",
          "renderer",
          "worker",
        ]),
      },
    ],
    "react/self-closing-comp": "error",
    "require-await": "error",
    "simple-import-sort/sort": "error",
  },
  overrides: [
    {
      files: ["src/*/**/*.ts"],
      env: {
        es6: true,
        node: false,
      },
      // globals: {
      //   ...baseRules.browserEnv(),
      //   BROWSER: false,
      //   browser: false,
      //   BUILD_ID: false,
      //   COLOR_BADGE: false,
      //   COLOR_GREEN: false,
      //   COLOR_PURPLE: false,
      //   COLOR_YELLOW: false,
      //   DEFAULT_LOG_LEVEL_CONFIG: false,
      //   DEFAULT_STORAGE_SYNC: false,
      //   exportFunction: false,
      //   META_HOMEPAGE: false,
      //   META_ICON: false,
      //   META_NAME: false,
      //   META_SLUG: false,
      //   META_TUTORIAL: false,
      //   META_VERSION: false,
      //   navigator: false,
      //   PROD: false,
      //   XPCNativeWrapper: false,
      // },
      rules: {
        "no-console": "error",
      },
    },
    {
      files: ["*.es5.js"],
      parser: "espree",
      parserOptions: { ecmaVersion: 5 },
      env: {
        es6: false,
        node: false,
      },
      // globals: baseRules.browserEnv(),
      rules: {
        "no-implicit-globals": "off",
        "no-var": "off",
        "object-shorthand": "off",
        "prefer-const": "off",
        "prefer-destructuring": "off",
        "prefer-rest-params": "off",
        "prefer-spread": "off",
        "prefer-template": "off",
        strict: "off",
      },
    },
    {
      files: ["html/**/*.js"],
      env: {
        es6: true,
        node: false,
      },
      // globals: baseRules.browserEnv(),
      rules: {
        "flowtype/require-parameter-type": "off",
      },
    },
  ],
  settings: {
    react: {
      version: "16.10",
    },
  },
};

function makeRestrictedPathsZones(dirs) {
  return [].concat(
    ...dirs.map((dir) => {
      const otherDirs = dirs.filter((dir2) => dir2 !== dir);
      return otherDirs.map((dir2) => ({ target: dir, from: dir2 }));
    }),
    ...dirs.map((dir) => ({ target: "shared", from: dir }))
  );
}
