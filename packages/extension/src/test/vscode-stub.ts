const noop = (): unknown => undefined;

function universalProxy(): any {
  return new Proxy(noop, {
    get: (_target, prop) => (prop === 'then' ? undefined : universalProxy()),
    apply: () => universalProxy(),
    construct: () => universalProxy(),
  });
}

export const window = universalProxy();
export const workspace = universalProxy();
export const commands = universalProxy();
export const extensions = universalProxy();
export const Uri = universalProxy();
export const Range = universalProxy();
export const TabInputText = universalProxy();
export const ProgressLocation = universalProxy();
