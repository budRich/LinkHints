declare type AnyFunction = (...args: Array<unknown>) => unknown;

declare type Browser = "chrome" | "firefox";

declare const BROWSER: Browser;

declare const BUILD_ID: string;

declare const COLOR_BADGE: string;
declare const COLOR_GREEN: string;
declare const COLOR_PURPLE: string;
declare const COLOR_YELLOW: string;

declare const DEFAULT_LOG_LEVEL_CONFIG: mixed;

declare const DEFAULT_STORAGE_SYNC: mixed;

declare const META_HOMEPAGE: string;
declare const META_ICON: string;
declare const META_NAME: string;
declare const META_SLUG: string;
declare const META_TUTORIAL: string;
declare const META_VERSION: string;

declare const PROD: boolean;

declare function exportFunction(
  AnyFunction,
  mixed,
  options?: { defineAs: string }
): AnyFunction;

declare function XPCNativeWrapper<T>(x: T): T;

declare type HTMLFrameElement = HTMLIFrameElement;

declare type SVGElement = Element;

declare global {
  interface Window {
    wrappedJSObject?: Window;
  }
}
