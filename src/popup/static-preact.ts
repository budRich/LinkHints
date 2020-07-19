const h = {
  createElement(
    tag: string,
    props:
      | ({
          [prop: string]: string | undefined;
        } & {
          className?: string | undefined;
          onClick?: ((event: MouseEvent) => unknown) | undefined;
        })
      | undefined,
    ...children: Array<string | HTMLElement | boolean | undefined>
  ): HTMLElement {
    const element = document.createElement(tag);

    if (props != null) {
      const { className, onClick, ...rest } = props;

      if (className != null) {
        element.className = className;
      }

      if (onClick != null) {
        element.onclick = onClick;
      }

      for (const key of Object.keys(rest)) {
        const value = rest[key];
        if (value != null) {
          element.setAttribute(key, value);
        }
      }
    }

    for (const child of children) {
      if (child != null && typeof child !== "boolean") {
        element.append(
          typeof child === "string" ? document.createTextNode(child) : child
        );
      }
    }

    return element;
  },
};

export default h;
