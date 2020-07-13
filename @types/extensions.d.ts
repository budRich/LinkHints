declare global {
  interface Window {
    wrappedJSObject?: Window;
    Event: typeof Event;
    Boolean: typeof Boolean;
    String: typeof String;
  }
}

export {};
