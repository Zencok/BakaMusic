import type { NavigateFunction, NavigateOptions, To } from "react-router-dom";

let navigateImpl: NavigateFunction | null = null;

/** Register the app router navigate (call from a component under HashRouter). */
export function setAppNavigate(navigate: NavigateFunction) {
    navigateImpl = navigate;
}

export function appNavigate(to: To, options?: NavigateOptions) {
    if (!navigateImpl) {
        return false;
    }
    navigateImpl(to, options);
    return true;
}
