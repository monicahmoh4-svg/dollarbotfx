export class AutoTraderUIStore extends EventTarget {
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

export const autoTraderUIStore = new AutoTraderUIStore();
