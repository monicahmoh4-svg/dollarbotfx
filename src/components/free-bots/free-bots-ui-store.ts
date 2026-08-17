// Free Bots used to be its own floating pill button that managed its
// open/closed state locally. Moving the trigger into the nav menu (desktop
// MenuItems + mobile menu drawer) means the "open" action now happens deep
// inside the Header component tree, while the modal itself is mounted once
// at the app root — two different branches of the tree that don't share
// props. Rather than thread a callback through Header -> MenuItems /
// MobileMenu (touching several vendored layout files just to pass a
// function down), this is a minimal, dependency-free event target both
// sides can talk to — the same pattern already used by the AI Bot engine.
export class FreeBotsUIStore extends EventTarget {
    private open = false;

    isOpen(): boolean {
        return this.open;
    }

    show(): void {
        if (this.open) return;
        this.open = true;
        this.dispatchEvent(new CustomEvent('change', { detail: this.open }));
    }

    hide(): void {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new CustomEvent('change', { detail: this.open }));
    }

    toggle(): void {
        this.open ? this.hide() : this.show();
    }
}

export const freeBotsUIStore = new FreeBotsUIStore();
