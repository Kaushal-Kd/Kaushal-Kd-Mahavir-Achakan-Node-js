import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

let toastId = 0;

const createUIState = (set, get) => ({
  sidebarCollapsed: false,
  mobileNavOpen: false,
  isSearchOpen: false,
  toasts: [],
  syncStatus: 'idle',
  earningsVisibility: {},
  imagePreview: null,
  imageCropSession: null,

  toggleSidebar() {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
  },

  openMobileNav() {
    set({ mobileNavOpen: true });
  },
  closeMobileNav() {
    set({ mobileNavOpen: false });
  },
  toggleMobileNav() {
    set({ mobileNavOpen: !get().mobileNavOpen });
  },

  openSearch() {
    set({ isSearchOpen: true });
  },
  closeSearch() {
    set({ isSearchOpen: false });
  },

  setSyncStatus(status) {
    set({ syncStatus: status });
  },

  setEarningsVisibility(scope, field, visible) {
    const key = String(scope || 'default');
    set({
      earningsVisibility: {
        ...get().earningsVisibility,
        [key]: {
          ...(get().earningsVisibility[key] || {}),
          [field]: Boolean(visible),
        },
      },
    });
  },

  pushToast(toast) {
    const id = ++toastId;
    const t = {
      id,
      type: 'info',
      duration: 3500,
      ...toast,
    };
    set({ toasts: [...get().toasts, t] });
    if (t.duration > 0) setTimeout(() => get().dismissToast(id), t.duration);
    return id;
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  openImagePreview(src, alt) {
    const url = String(src ?? '').trim();
    if (!url) return;
    set({ imagePreview: { src: url, alt: String(alt ?? '').trim() || 'Image' } });
  },

  closeImagePreview() {
    set({ imagePreview: null });
  },

  /**
   * @param {File} file
   * @param {{ aspect?: number, title?: string }} [options]
   * @returns {Promise<File>}
   */
  requestImageCrop(file, options = {}) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file provided'));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      set({
        imageCropSession: {
          file,
          objectUrl,
          aspect: options.aspect,
          title: options.title || 'Crop image',
          resolve,
          reject,
        },
      });
    });
  },

  finishImageCrop(croppedFile) {
    const session = get().imageCropSession;
    if (!session) return;
    URL.revokeObjectURL(session.objectUrl);
    session.resolve(croppedFile);
    set({ imageCropSession: null });
  },

  cancelImageCrop() {
    const session = get().imageCropSession;
    if (!session) return;
    URL.revokeObjectURL(session.objectUrl);
    session.reject(new DOMException('Image crop cancelled', 'AbortError'));
    set({ imageCropSession: null });
  },
});

export const useUIStore = create(
  persist(createUIState, {
    name: 'wrs.ui',
    storage: createJSONStorage(() => localStorage),
    // Only the sidebar preference is persistable. The rest of this store holds
    // runtime state — toasts, and imageCropSession which carries a File, an
    // object URL and resolve/reject callbacks that must never be serialized.
    partialize: (s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      earningsVisibility: s.earningsVisibility,
    }),
  })
);

export const toast = {
  success: (msg, opts) => useUIStore.getState().pushToast({ type: 'success', message: msg, ...opts }),
  error: (msg, opts) => useUIStore.getState().pushToast({ type: 'error', message: msg, duration: 6000, ...opts }),
  info: (msg, opts) => useUIStore.getState().pushToast({ type: 'info', message: msg, ...opts }),
  warning: (msg, opts) =>
    useUIStore.getState().pushToast({ type: 'warning', message: msg, ...opts }),
};

export const imagePreview = {
  open: (src, alt) => useUIStore.getState().openImagePreview(src, alt),
  close: () => useUIStore.getState().closeImagePreview(),
};

export const imageCrop = {
  request: (file, options) => useUIStore.getState().requestImageCrop(file, options),
};
