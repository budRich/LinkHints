import { array, Decoder, map, repr, string } from "tiny-decoders";

import { decodeElementType, ElementType } from "./hints";
import {
  addListener,
  decodeUnsignedFloat,
  decodeUnsignedInt,
  deepEqual,
  getErrorMessage,
  log,
} from "./main";
import { DEBUG_PREFIX } from "./options";

type UnsignedInt = {
  type: "UnsignedInt";
  value: number;
};

type UnsignedFloat = {
  type: "UnsignedFloat";
  value: number;
};

type StringSet = {
  type: "StringSet";
  value: Set<string>;
};

type ElementTypeSet = {
  type: "ElementTypeSet";
  value: Set<ElementType>;
};

type SelectorString = {
  type: "SelectorString";
  value: string;
};

export type TweakableValue =
  | UnsignedInt
  | UnsignedFloat
  | StringSet
  | ElementTypeSet
  | SelectorString;

export type TweakableMapping = { [key: string]: TweakableValue };

export type TweakableMeta = {
  namespace: string;
  defaults: TweakableMapping;
  changed: { [key: string]: boolean };
  errors: { [key: string]: string | undefined };
  loaded: Promise<void>;
  unlisten: () => void;
};

export function unsignedInt(value: number): UnsignedInt {
  return {
    type: "UnsignedInt",
    value,
  };
}

export function unsignedFloat(value: number): UnsignedFloat {
  return {
    type: "UnsignedFloat",
    value,
  };
}

export function stringSet(value: Set<string>): StringSet {
  return {
    type: "StringSet",
    value,
  };
}

export function elementTypeSet(value: Set<ElementType>): ElementTypeSet {
  return {
    type: "ElementTypeSet",
    value,
  };
}

export function selectorString(value: string): SelectorString {
  return {
    type: "SelectorString",
    value,
  };
}

export function tweakable(
  namespace: string,
  mapping: TweakableMapping
): TweakableMeta {
  const prefix = "tweakable";
  const keyPrefix = `${DEBUG_PREFIX}${namespace}.`;
  const defaults = { ...mapping };
  const changed: { [key in keyof typeof mapping]: boolean } = {};
  const errors: { [key in keyof typeof mapping]: string | undefined } = {};

  function update(data: { [key: string]: unknown }) {
    for (const [key, value] of Object.entries(data)) {
      try {
        if (!{}.hasOwnProperty.call(defaults, key)) {
          throw new TypeError(`Unknown key: ${repr(key)}`);
        }

        const original: TweakableValue = defaults[key];
        errors[key] = undefined;
        changed[key] = false;

        if (value == null) {
          mapping[key] = original;
          continue;
        }

        ((): undefined => {
          switch (original.type) {
            case "UnsignedInt": {
              const decoded = decodeUnsignedInt(value);
              mapping[key] = {
                type: "UnsignedInt",
                value: decoded,
              };
              changed[key] = decoded !== original.value;
              return undefined;
            }

            case "UnsignedFloat": {
              const decoded = decodeUnsignedFloat(value);
              mapping[key] = {
                type: "UnsignedFloat",
                value: decoded,
              };
              changed[key] = decoded !== original.value;
              return undefined;
            }

            case "StringSet": {
              const decoded = decodeStringSet(string)(value);
              mapping[key] = {
                type: "StringSet",
                value: decoded,
              };
              changed[key] = !equalStringSets(decoded, original.value);
              return undefined;
            }

            case "ElementTypeSet": {
              const decoded: Set<ElementType> = decodeStringSet(
                map(string, decodeElementType)
              )(value);
              mapping[key] = {
                type: "ElementTypeSet",
                value: decoded,
              };
              changed[key] = !equalStringSets(
                new Set(decoded),
                new Set(original.value)
              );
              return undefined;
            }

            case "SelectorString": {
              const decoded = map(string, (val) => {
                document.querySelector(val);
                return val;
              })(value);
              mapping[key] = {
                type: "SelectorString",
                value: decoded,
              };
              changed[key] = decoded !== original.value;
              return undefined;
            }
          }
        })();
      } catch (error) {
        errors[key] = getErrorMessage(error);
      }
    }
  }

  const loaded = browser.storage.sync
    .get(Object.keys(defaults).map((key) => `${keyPrefix}${key}`))
    .then((rawData) => {
      const data = Object.fromEntries(
        Object.entries(rawData).map(([fullKey, value]) => [
          fullKey.slice(keyPrefix.length),
          value,
        ])
      );
      update(data);
    })
    .catch((error: Error) => {
      log("error", prefix, "First load failed.", {
        namespace,
        mapping,
        error,
      });
    });

  const unlisten = addListener(
    browser.storage.onChanged,
    (changes, areaName) => {
      if (areaName === "sync") {
        const data = Object.fromEntries(
          Object.keys(changes).flatMap((fullKey) => {
            if (fullKey.startsWith(keyPrefix)) {
              const key = fullKey.slice(keyPrefix.length);
              if ({}.hasOwnProperty.call(defaults, key)) {
                return [[key, changes[fullKey].newValue]];
              }
            }
            return [];
          })
        );
        update(data);
      }
    }
  );

  return {
    namespace,
    defaults,
    changed,
    errors,
    loaded,
    unlisten,
  };
}

export function normalizeStringArray(
  arrayOrSet: Array<string> | Set<string>
): Array<string> {
  return Array.from(arrayOrSet)
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .sort();
}

function decodeStringSet<T extends string>(
  decoder: Decoder<T>
): Decoder<Set<T>> {
  return map(
    array(string),
    (arr) => new Set(array(decoder)(normalizeStringArray(arr)))
  );
}

function equalStringSets(a: Set<string>, b: Set<string>): boolean {
  return deepEqual(normalizeStringArray(a), normalizeStringArray(b));
}
