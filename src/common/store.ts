import { useRef, useSyncExternalStore } from "react";

type UpdateFunc<T> = (prev: T) => T;
type EqualityFn<T> = (left: T, right: T) => boolean;

interface ISelectorCache<T, TSelected> {
    hasSelection: boolean;
    selector: (value: T) => TSelected;
    equality: EqualityFn<TSelected>;
    storeValue: T | typeof UNINITIALIZED;
    selection?: TSelected;
}

const UNINITIALIZED = Symbol("store-uninitialized");

/**
 * A small external store that is safe with React concurrent rendering.
 *
 * `useSelector` keeps the previously selected snapshot when the configured
 * equality function considers the result unchanged, avoiding broad rerenders
 * for stores that contain several independent fields.
 */
export default class Store<T> {
    private value: T;
    private subscribers = new Set<() => void>();
    private valueChangeCbs = new Set<(newValue: T, oldValue: T) => void>();

    constructor(initValue: T) {
        this.value = initValue;
    }

    public getValue = () => this.value;

    public subscribe = (subscriber: () => void) => {
        this.subscribers.add(subscriber);
        return () => {
            this.subscribers.delete(subscriber);
        };
    };

    public useValue = () => useSyncExternalStore(
        this.subscribe,
        this.getValue,
        this.getValue,
    );

    public useSelector = <TSelected>(
        selector: (value: T) => TSelected,
        equality: EqualityFn<TSelected> = Object.is,
    ) => {
        const cacheRef = useRef<ISelectorCache<T, TSelected>>({
            hasSelection: false,
            selector,
            equality,
            storeValue: UNINITIALIZED,
        });
        const cache = cacheRef.current;

        if (cache.selector !== selector || cache.equality !== equality) {
            cache.selector = selector;
            cache.equality = equality;
            cache.storeValue = UNINITIALIZED;
        }

        const getSelectedSnapshot = () => {
            const storeValue = this.getValue();
            if (cache.storeValue === storeValue && cache.hasSelection) {
                return cache.selection as TSelected;
            }

            const nextSelection = cache.selector(storeValue);
            cache.storeValue = storeValue;
            if (
                cache.hasSelection
                && cache.equality(cache.selection as TSelected, nextSelection)
            ) {
                return cache.selection as TSelected;
            }

            cache.hasSelection = true;
            cache.selection = nextSelection;
            return nextSelection;
        };

        return useSyncExternalStore(
            this.subscribe,
            getSelectedSnapshot,
            getSelectedSnapshot,
        );
    };

    public setValue = (value: T | UpdateFunc<T>) => {
        const oldValue = this.value;
        const newValue = typeof value === "function"
            ? (value as UpdateFunc<T>)(oldValue)
            : value;

        if (Object.is(oldValue, newValue)) {
            return oldValue;
        }

        this.value = newValue;
        this.valueChangeCbs.forEach((cb) => cb(newValue, oldValue));
        this.subscribers.forEach((subscriber) => subscriber());
        return newValue;
    };

    public onValueChange = (cb: (newValue: T, oldValue: T) => void) => {
        this.valueChangeCbs.add(cb);
        return () => {
            this.valueChangeCbs.delete(cb);
        };
    };
}

export function useStore<T>(store: Store<T>) {
    return [store.useValue(), store.setValue] as const;
}
