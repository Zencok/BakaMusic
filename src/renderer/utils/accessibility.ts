let accessibilitySetup = false;

const customButtonSelector = "[role='button']:not(button):not(a):not(input)";
const nativeInteractiveSelector = "button, a[href], input, select, textarea, summary";

function isDisabled(element: HTMLElement) {
    return element.getAttribute("aria-disabled") === "true"
        || (element.hasAttribute("data-disabled")
            && element.getAttribute("data-disabled") !== "false");
}

function enhanceButton(element: HTMLElement) {
    if (!element.matches(customButtonSelector)) {
        return;
    }
    const dataDisabled = element.hasAttribute("data-disabled")
        && element.getAttribute("data-disabled") !== "false";
    if (!dataDisabled && element.dataset.a11yManagedDisabled === "true") {
        if (element.getAttribute("aria-disabled") === "true") {
            element.removeAttribute("aria-disabled");
        }
        delete element.dataset.a11yManagedDisabled;
    }
    const managed = element.dataset.a11yManagedTabindex === "true";
    if (isDisabled(element)) {
        if (element.getAttribute("aria-disabled") !== "true") {
            element.setAttribute("aria-disabled", "true");
            element.dataset.a11yManagedDisabled = "true";
        }
        if (!element.hasAttribute("tabindex") || managed) {
            if (element.tabIndex !== -1) {
                element.tabIndex = -1;
            }
            element.dataset.a11yManagedTabindex = "true";
        }
        return;
    }
    if (!element.hasAttribute("tabindex") || managed) {
        if (element.tabIndex !== 0) {
            element.tabIndex = 0;
        }
        element.dataset.a11yManagedTabindex = "true";
    }
    if (!element.hasAttribute("aria-label") && element.title) {
        element.setAttribute("aria-label", element.title);
    }
}

function enhanceTree(root: ParentNode) {
    if (root instanceof HTMLElement) {
        enhanceButton(root);
    }
    root.querySelectorAll<HTMLElement>(customButtonSelector).forEach(enhanceButton);
}

function findCustomButton(target: EventTarget | null) {
    if (!(target instanceof Element)) {
        return null;
    }
    const nativeControl = target.closest(nativeInteractiveSelector);
    const customButton = target.closest<HTMLElement>(customButtonSelector);
    if (!customButton || (nativeControl && nativeControl !== customButton)) {
        return null;
    }
    return customButton;
}

/**
 * Legacy themed controls use role="button" on div/span elements. This single
 * delegated keyboard layer gives them native Enter/Space activation and focus
 * semantics while those controls are progressively migrated to <button>.
 */
export default function setupKeyboardAccessibility() {
    if (accessibilitySetup) {
        return;
    }
    accessibilitySetup = true;
    enhanceTree(document);

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === "attributes") {
                enhanceButton(mutation.target as HTMLElement);
            } else {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement) {
                        enhanceTree(node);
                    }
                });
            }
        }
    });
    observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["role", "data-disabled", "aria-disabled", "title"],
    });

    document.addEventListener("keydown", (event) => {
        const button = findCustomButton(event.target);
        if (!button || isDisabled(button) || event.repeat) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            button.click();
        } else if (event.key === " ") {
            event.preventDefault();
        }
    }, true);

    document.addEventListener("keyup", (event) => {
        const button = findCustomButton(event.target);
        if (!button || isDisabled(button) || event.key !== " ") {
            return;
        }
        event.preventDefault();
        button.click();
    }, true);
}
