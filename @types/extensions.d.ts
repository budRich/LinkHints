declare global {
  interface Window {
    wrappedJSObject?: Window;
    Event: typeof Event;
    Boolean: typeof Boolean;
    String: typeof String;
  }

  interface HTMLElement {
    scrollLeftMax: number;
    scrollTopMax: number;
  }
}

export {};
