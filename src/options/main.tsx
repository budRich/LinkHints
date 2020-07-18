import { createElement, render } from "preact";

import { isUnknownDict } from "../shared/main";
import OptionsProgram from "./Program";

function start() {
  const { body } = document;
  if (body == null) {
    return;
  }

  render(
    createElement(OptionsProgram, {
      ref: (program: OptionsProgram) => {
        // Attach the instance to `window` for debugging in the regular Web
        // Console.
        if (isUnknownDict(window)) {
          window.optionsProgram = program;
        }
      },
    }),
    body
  );
}

start();
