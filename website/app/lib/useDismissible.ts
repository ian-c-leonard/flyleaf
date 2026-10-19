import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  dismissalManager,
  type DismissLayer,
  type DismissReason,
} from './dismissal';

export const DismissParent = createContext<symbol | null>(null);

type Options = Omit<DismissLayer, 'id' | 'parent'> & {
  enabled: boolean;
  parent?: symbol | null;
};

/** Register only transient open panels; responsive permanent columns stay out. */
export function useDismissible(options: Options) {
  const id = useRef(Symbol('dismissible'));
  const inheritedParent = useContext(DismissParent);
  const current = useRef(options);
  const registration = useRef<{
    layer: DismissLayer;
    manager: ReturnType<typeof dismissalManager>;
  } | null>(null);
  useLayoutEffect(() => {
    current.current = options;
  });
  const parent =
    options.parent === undefined ? inheritedParent : options.parent;
  const { enabled, modal, consumeOutside } = options;
  useLayoutEffect(() => {
    if (!enabled) return;
    const document = current.current.root()?.ownerDocument;
    if (!document) return;
    const manager = dismissalManager(document);
    const layer: DismissLayer = {
      id: id.current,
      parent,
      root: () => current.current.root(),
      inside: () => current.current.inside(),
      trigger: () => current.current.trigger(),
      fallback: () => current.current.fallback?.() || null,
      modal,
      consumeOutside,
      onDismiss: (reason) => current.current.onDismiss(reason),
    };
    registration.current = { manager, layer };
    const remove = manager.register(layer);
    return () => {
      remove();
      registration.current = null;
    };
  }, [enabled, modal, consumeOutside, parent]);
  return {
    id: id.current,
    dismiss(reason: DismissReason = 'close') {
      const entry = registration.current;
      if (entry) entry.manager.dismiss(entry.layer, reason);
    },
    cancel(event: Event) {
      registration.current?.manager.cancel(id.current, event);
    },
  };
}

export function useMediaQuery(query: string) {
  // Kept separate from registration so a permanent column is never transient
  // merely because a toggle was used before the viewport grew.
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useLayoutEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
