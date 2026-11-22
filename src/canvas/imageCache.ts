type LoadListener = () => void;

export class TileImageCache {
  private readonly images = new Map<string, HTMLImageElement | 'loading' | 'error'>();
  private readonly listeners = new Set<LoadListener>();

  subscribe(listener: LoadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  get(url: string): HTMLImageElement | null {
    const entry = this.images.get(url);
    if (entry instanceof HTMLImageElement) {
      return entry;
    }
    if (entry === 'loading' || entry === 'error') {
      return null;
    }

    this.images.set(url, 'loading');
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.images.set(url, img);
      this.notify();
    };
    img.onerror = () => {
      this.images.set(url, 'error');
      this.notify();
    };
    img.src = url;
    return null;
  }
}
