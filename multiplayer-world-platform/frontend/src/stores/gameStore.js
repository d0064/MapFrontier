import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const useGameStore = create(
  devtools(
    (set, get) => ({
      // Authentication state
      isAuthenticated: false,
      token: localStorage.getItem('token'),
      player: null,

      // Game state
      countries: [],
      activePlayers: [],
      wars: [],
      borderPushes: [],
      serverStats: {
        online_players: 0,
        active_countries: 0
      },

      // UI state
      selectedCountry: null,
      showChat: false,
      showLeaderboard: false,
      showCountryPanel: false,
      isLoading: false,
      error: null,

      // Socket connection
      socket: null,
      isConnected: false,

      // Actions
      setAuth: (token, player) => set({
        isAuthenticated: !!token,
        token,
        player
      }),

      logout: () => {
        localStorage.removeItem('token');
        const { socket } = get();
        if (socket) {
          socket.disconnect();
        }
        set({
          isAuthenticated: false,
          token: null,
          player: null,
          socket: null,
          isConnected: false
        });
      },

      setSocket: (socket) => set({ socket }),

      setConnected: (isConnected) => set({ isConnected }),

      setPlayer: (player) => set({ player }),

      updatePlayerPosition: (position) => set((state) => ({
        player: state.player ? { ...state.player, current_position: position } : null
      })),

      updatePlayerResources: (resources) => set((state) => ({
        player: state.player ? { ...state.player, resources } : null
      })),

      setCountries: (countries) => set({ countries }),

      updateCountry: (countryId, updates) => set((state) => ({
        countries: state.countries.map(country =>
          country.id === countryId ? { ...country, ...updates } : country
        )
      })),

      setActivePlayers: (players) => set({ activePlayers: players }),

      updateActivePlayer: (playerId, updates) => set((state) => ({
        activePlayers: state.activePlayers.map(player =>
          player.id === playerId ? { ...player, ...updates } : player
        )
      })),

      addActivePlayer: (player) => set((state) => ({
        activePlayers: [...state.activePlayers.filter(p => p.id !== player.id), player]
      })),

      removeActivePlayer: (playerId) => set((state) => ({
        activePlayers: state.activePlayers.filter(player => player.id !== playerId)
      })),

      setWars: (wars) => set({ wars }),

      addWar: (war) => set((state) => ({
        wars: [...state.wars, war]
      })),

      updateWar: (warId, updates) => set((state) => ({
        wars: state.wars.map(war =>
          war.id === warId ? { ...war, ...updates } : war
        )
      })),

      removeWar: (warId) => set((state) => ({
        wars: state.wars.filter(war => war.id !== warId)
      })),

      setBorderPushes: (borderPushes) => set({ borderPushes }),

      addBorderPush: (borderPush) => set((state) => ({
        borderPushes: [...state.borderPushes, borderPush]
      })),

      updateBorderPush: (pushId, updates) => set((state) => ({
        borderPushes: state.borderPushes.map(push =>
          push.id === pushId ? { ...push, ...updates } : push
        )
      })),

      removeBorderPush: (pushId) => set((state) => ({
        borderPushes: state.borderPushes.filter(push => push.id !== pushId)
      })),

      setServerStats: (stats) => set({ serverStats: stats }),

      setSelectedCountry: (country) => set({ selectedCountry: country }),

      setShowChat: (show) => set({ showChat: show }),

      setShowLeaderboard: (show) => set({ showLeaderboard: show }),

      setShowCountryPanel: (show) => set({ showCountryPanel: show }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      clearError: () => set({ error: null }),

      // Computed getters
      getCountryById: (countryId) => {
        const { countries } = get();
        return countries.find(country => country.id === countryId);
      },

      getPlayerCountry: () => {
        const { player, countries } = get();
        if (!player?.country_id) return null;
        return countries.find(country => country.id === player.country_id);
      },

      getActiveWarsForCountry: (countryId) => {
        const { wars } = get();
        return wars.filter(war => 
          (war.aggressor_country_id === countryId || war.defender_country_id === countryId) &&
          war.status === 'active'
        );
      },

      getActiveBorderPushesForCountry: (countryId) => {
        const { borderPushes } = get();
        return borderPushes.filter(push =>
          (push.source_country_id === countryId || push.target_country_id === countryId) &&
          push.status === 'active'
        );
      },

      isCountryAtWar: (countryId) => {
        const { wars } = get();
        return wars.some(war =>
          (war.aggressor_country_id === countryId || war.defender_country_id === countryId) &&
          war.status === 'active'
        );
      },

      canPlayerDeclareWar: () => {
        const { player } = get();
        const playerCountry = get().getPlayerCountry();
        return player && playerCountry && playerCountry.owner_id === player.id;
      },

      canPlayerJoinCountry: (countryId) => {
        const { player, countries } = get();
        if (!player || player.country_id) return false;
        
        const country = countries.find(c => c.id === countryId);
        return country && country.soldier_count < country.max_soldiers;
      }
    }),
    {
      name: 'game-store',
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
);

export default useGameStore;