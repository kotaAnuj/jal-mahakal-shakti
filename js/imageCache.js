export const ImageCache = {
  waterTower: null,
  valve: null,
  loaded: false,

  async preload() {
    const promises = [
      this.loadImage('water-tower.png', 'waterTower'),
      this.loadImage('valve.png', 'valve')
    ];
    try {
      await Promise.all(promises);
      this.loaded = true;
    } catch (err) {
      console.warn('Image preload failed, using fallback', err);
      this.loaded = false;
    }
  },

  loadImage(url, key) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this[key] = img;
        resolve();
      };
      img.onerror = () => {
        console.warn(`Failed to load ${key} image`);
        resolve();
      };
      img.src = url;
    });
  }
};

