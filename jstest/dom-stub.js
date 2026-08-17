// A DOM small enough to fit in one file and large enough to render the app.
//
// Only the handful of APIs web/js actually uses are implemented. Anything the
// client starts relying on that is missing here will throw, which is the point.

class StubNode {
  constructor(nodeName, namespace = null) {
    this.nodeName = nodeName;
    this.namespace = namespace;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.ownText = '';
  }

  /**
   * Like the real DOM: reading concatenates the subtree, writing replaces every
   * child with the new text.
   */
  get textContent() {
    if (this.children.length === 0) return this.ownText;
    return this.children.map((c) => c.textContent ?? '').join('');
  }

  set textContent(value) {
    this.children = [];
    this.ownText = String(value);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof StubFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  focus() {
    stubDocument.activeElement = this;
  }

  get className() {
    return this.attributes.class ?? '';
  }

  set className(value) {
    this.attributes.class = value;
  }

  get id() {
    return this.attributes.id ?? '';
  }

  // Real elements reflect these between property and attribute, and the app
  // sets them both ways: as an attribute when rendering, as a property when
  // updating in place.
  get disabled() {
    return this.attributes.disabled !== undefined;
  }

  set disabled(value) {
    if (value) this.attributes.disabled = '';
    else delete this.attributes.disabled;
  }

  get checked() {
    return this.attributes.checked !== undefined;
  }

  set checked(value) {
    if (value) this.attributes.checked = '';
    else delete this.attributes.checked;
  }

  /** Every descendant, depth first, including this node. */
  *walk() {
    yield this;
    for (const child of this.children) {
      if (child instanceof StubNode) yield* child.walk();
      else yield child;
    }
  }

  /** Concatenated text of the whole subtree. */
  get text() {
    return this.textContent;
  }
}

class StubFragment extends StubNode {
  constructor() {
    super('#fragment');
  }
}

const stubDocument = {
  activeElement: null,
  visibilityState: 'visible',
  createElement: (name) => new StubNode(name),
  createElementNS: (ns, name) => new StubNode(name, ns),
  createDocumentFragment: () => new StubFragment(),
  createTextNode(text) {
    const node = new StubNode('#text');
    node.textContent = String(text);
    return node;
  },
  getElementById(id) {
    for (const node of stubDocument.body.walk()) {
      if (node instanceof StubNode && node.id === id) return node;
    }
    return null;
  },
  addEventListener() {},
  body: new StubNode('body'),
};

/**
 * Install the stub as the global DOM. Call before importing web/js modules.
 *
 * Returns the `#app` root plus `fire`, which runs the handlers registered on
 * window for an event — enough to drive navigation in a test.
 */
export function installDOM({ hash = '' } = {}) {
  const app = new StubNode('div');
  app.setAttribute('id', 'app');
  stubDocument.body = new StubNode('body');
  stubDocument.body.append(app);
  stubDocument.activeElement = null;

  const listeners = {};
  globalThis.Node = StubNode;
  globalThis.document = stubDocument;
  globalThis.location = { hash };
  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    confirm: () => true,
    location: globalThis.location,
  };

  const fire = (type) => Promise.all((listeners[type] ?? []).map((fn) => fn()));
  return { document: stubDocument, app, fire };
}

/** All descendants of `node` carrying the given class. */
export function byClass(node, className) {
  return [...node.walk()].filter(
    (n) => n instanceof StubNode && n.className.split(/\s+/).includes(className),
  );
}

export { StubNode };
