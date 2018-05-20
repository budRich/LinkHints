// @flow

const fs = require("fs");

const replace = require("rollup-plugin-replace");
const uglify = require("rollup-plugin-uglify");
const rimraf = require("rimraf");
const flow = require("rollup-plugin-flow");

const config = require("./project.config");

const PROD = config.browser != null;

const UGLIFY_OPTIONS = {
  compress: {
    booleans: false,
    comparisons: false,
    conditionals: false,
    hoist_props: false,
    keep_fnames: true,
    keep_infinity: true,
    loops: false,
    reduce_funcs: false,
    reduce_vars: false,
    sequences: false,
    toplevel: true,
    typeofs: false,
  },
  mangle: false,
  output: {
    beautify: true,
    bracketize: true,
    indent_level: 2,
    comments: /\S/,
  },
};

setup();

// $FlowIgnore: Flow wants a type annotation here, but that’s just annoying.
module.exports = [
  js(config.setup),
  js(config.background),
  js(config.allFrames),
  js(config.topFrame),
  template(config.manifest),
  template(config.iconsCompilation),
  copy(config.polyfill),
].map(entry => ({
  ...entry,
  input: `${config.src}/${entry.input}`,
  output: {
    ...entry.output,
    file: `${config.src}/${entry.output.file}`,
  },
}));

function setup() {
  if (PROD) {
    rimraf.sync(config.rimraf);
  }
}

function js({ input, output } /* : {| input: string, output: string |} */) {
  return {
    input,
    output: {
      file: output,
      format: "iife",
      sourcemap: !PROD,
    },
    plugins: [
      flow({ pretty: true }),
      ...(config.browser == null
        ? []
        : [
            replace({
              BROWSER: JSON.stringify(config.browser),
            }),
            uglify(UGLIFY_OPTIONS),
          ]),
    ].filter(Boolean),
  };
}

// `input` must be a JavaScript file containing:
//
//     module.exports = data => compile(data)
//
// The function must return a string, and may optionally use `data`. Whatever
// string is returned will end up in `output`.
function template(
  {
    input,
    output,
    data,
  } /* : {|
  input: string,
  output: string,
  data?: any,
|} */
) {
  let content = "";
  return {
    input,
    output: {
      file: output,
      format: "es",
    },
    treeshake: false,
    plugins: [
      {
        name: "template",
        load: id => {
          delete require.cache[id];
          content = require(id)(data);
          return "0";
        },
        transformBundle: () => content,
      },
    ],
  };
}

function copy({ input, output } /* : {| input: string, output: string, |} */) {
  let content = "";
  return {
    input,
    output: {
      file: output,
      format: "es",
    },
    treeshake: false,
    plugins: [
      {
        name: "copy",
        load: id => {
          content = fs.readFileSync(id, "utf8");
          return "0";
        },
        transformBundle: () => content,
      },
    ],
  };
}