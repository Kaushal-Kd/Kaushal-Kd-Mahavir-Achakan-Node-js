import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const initialState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  rememberedIdentity: '',
  ipAccessRestricted: false,
  ipValidationPending: false,
  accessDeniedMessage: null,
};

export const useAuthStore = create(
  persist(
    (set) => ({
      ...initialState,

      setSession(user, accessToken, refreshToken, ipAccessRestricted = false) {
        set({
          user,
          accessToken,
          refreshToken,
          ipAccessRestricted: Boolean(ipAccessRestricted),
          ipValidationPending: false,
          accessDeniedMessage: null,
        });
      },

      setUser(user) {
        set({ user });
      },

      setTokens(accessToken, refreshToken) {
        set((s) => ({
          accessToken,
          refreshToken: refreshToken ?? s.refreshToken,
        }));
      },

      setIpAccessState(ipAccessRestricted, ipValidationPending = false) {
        set({
          ipAccessRestricted: Boolean(ipAccessRestricted),
          ipValidationPending: Boolean(ipValidationPending),
        });
      },

      setIpValidationPending(ipValidationPending) {
        set({ ipValidationPending: Boolean(ipValidationPending) });
      },

      clearAccessDeniedMessage() {
        set({ accessDeniedMessage: null });
      },

      setRememberedIdentity(identity) {
        set({ rememberedIdentity: identity || '' });
      },

      logout(accessDeniedMessage = null) {
        set({ ...initialState, accessDeniedMessage });
      },
    }),
    {
      name: 'wrs.auth',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        rememberedIdentity: s.rememberedIdentity,
        ipAccessRestricted: s.ipAccessRestricted,
      }),
      migrate: (state, version) => {
        if (version < 2 && state?.rememberedEmail) {
          return { ...state, rememberedIdentity: state.rememberedEmail };
        }
        return state;
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[auth] persist rehydrate error', error);
        }
      },
    }
  )
);
