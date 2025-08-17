import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import useGameStore from '../stores/gameStore';

let socket = null;

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

export const initializeSocket = (token) => {
  return new Promise((resolve, reject) => {
    try {
      // Disconnect existing socket if any
      if (socket) {
        socket.disconnect();
      }

      // Create new socket connection
      socket = io(SOCKET_URL, {
        auth: {
          token: token
        },
        transports: ['websocket', 'polling'],
        timeout: 20000,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      const store = useGameStore.getState();

      // Connection events
      socket.on('connect', () => {
        console.log('✅ Connected to server');
        store.setSocket(socket);
        store.setConnected(true);
        toast.success('Connected to game server');
        resolve(socket);
      });

      socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected from server:', reason);
        store.setConnected(false);
        
        if (reason === 'io server disconnect') {
          // Server disconnected us, try to reconnect
          socket.connect();
        }
      });

      socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        store.setConnected(false);
        
        if (error.message.includes('Authentication error')) {
          toast.error('Authentication failed. Please login again.');
          store.logout();
        } else {
          toast.error('Failed to connect to game server');
        }
        reject(error);
      });

      // Initial game state
      socket.on('connection:established', (data) => {
        console.log('Game state received:', data);
        store.setPlayer(data.player);
        
        toast.success(`Welcome, ${data.player.username}!`);
      });

      // Player events
      socket.on('player:moved', (data) => {
        store.updateActivePlayer(data.player_id, {
          current_position: data.position,
          last_movement: data.timestamp
        });
      });

      socket.on('player:joined_country', (data) => {
        store.addActivePlayer(data.player);
        
        if (data.became_owner) {
          toast.success(`${data.player.username} claimed the country!`);
        } else {
          toast(`${data.player.username} joined the country`);
        }
      });

      socket.on('player:left_country', (data) => {
        store.removeActivePlayer(data.player.id);
        
        if (data.was_owner) {
          toast.error(`${data.player.username} abandoned the country`);
        } else {
          toast(`${data.player.username} left the country`);
        }
      });

      socket.on('player:disconnected', (data) => {
        store.removeActivePlayer(data.player.id);
      });

      // Country events
      socket.on('country:joined', (data) => {
        store.updateCountry(data.country.id, data.country);
        store.setPlayer({
          ...store.player,
          country_id: data.country.id,
          country: data.country
        });
        
        if (data.became_owner) {
          toast.success('🏰 You are now the ruler of this country!');
        } else {
          toast.success('🏰 Welcome to your new country!');
        }
      });

      socket.on('country:left', (data) => {
        store.setPlayer({
          ...store.player,
          country_id: null,
          country: null,
          current_position: null
        });
        
        if (data.was_owner) {
          toast.error('👑 You have abandoned your kingdom');
        } else {
          toast('You have left the country');
        }
      });

      socket.on('country:resources_generated', (data) => {
        store.updateCountry(data.country_id, {
          resources: data.resources
        });
        
        // Only show notification to country members
        if (store.player?.country_id === data.country_id) {
          toast(`💰 +${data.generated} resources generated`);
        }
      });

      // War events
      socket.on('war:declared', (data) => {
        store.addWar(data);
        
        // Update countries as at war
        store.updateCountry(data.aggressor.id, { is_at_war: true });
        store.updateCountry(data.defender.id, { is_at_war: true });
        
        toast.error(`⚔️ ${data.aggressor.name} declared war on ${data.defender.name}!`);
      });

      socket.on('war:ended', (data) => {
        store.removeWar(data.war_id);
        toast(`🏳️ War ended by ${data.ended_by}`);
      });

      // Border push events
      socket.on('border_push:started', (data) => {
        store.addBorderPush(data);
        toast(`🚀 ${data.player} started a border push!`);
      });

      socket.on('border_push:incoming', (data) => {
        toast.error(`🛡️ Your borders are under attack!`);
      });

      socket.on('border_push:progress', (data) => {
        store.updateBorderPush(data.push_id, {
          current_progress: data.progress
        });
      });

      socket.on('border_push:support_added', (data) => {
        store.updateBorderPush(data.push_id, {
          supporting_soldiers: data.total_supporters,
          push_strength: data.new_strength,
          push_speed: data.new_speed
        });
        
        toast(`💪 ${data.supporter} joined the push!`);
      });

      socket.on('border_push:defense_added', (data) => {
        store.updateBorderPush(data.push_id, {
          defending_soldiers: data.total_defenders,
          resistance_strength: data.new_resistance,
          push_speed: data.new_speed
        });
        
        toast(`🛡️ ${data.defender} joined the defense!`);
      });

      socket.on('border_push:completed', (data) => {
        store.removeBorderPush(data.push_id);
        
        if (data.result === 'successful') {
          toast.success(`🎉 Border push successful! Gained ${data.territory_gained.toFixed(2)} km²`);
        }
      });

      socket.on('border_push:lost', (data) => {
        store.removeBorderPush(data.push_id);
        toast.error(`😞 Lost ${data.territory_lost.toFixed(2)} km² of territory`);
      });

      // Chat events
      socket.on('chat:message', (data) => {
        // Handle chat messages (would implement chat store)
        console.log('Chat message:', data);
      });

      // Server stats
      socket.on('server:stats', (data) => {
        store.setServerStats(data);
      });

      // Error handling
      socket.on('error', (data) => {
        toast.error(data.message || 'An error occurred');
      });

      // Movement confirmation
      socket.on('player:move_confirmed', (data) => {
        store.updatePlayerPosition(data.position);
      });

      // Reconnection events
      socket.on('reconnect', (attemptNumber) => {
        console.log(`Reconnected after ${attemptNumber} attempts`);
        toast.success('Reconnected to game server');
        store.setConnected(true);
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`Reconnection attempt ${attemptNumber}`);
        toast(`Reconnecting... (${attemptNumber}/5)`);
      });

      socket.on('reconnect_failed', () => {
        console.log('Failed to reconnect');
        toast.error('Failed to reconnect to game server');
        store.setConnected(false);
      });

    } catch (error) {
      console.error('Socket initialization error:', error);
      reject(error);
    }
  });
};

// Socket utility functions
export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const emitPlayerMove = (position) => {
  if (socket && socket.connected) {
    socket.emit('player:move', position);
  }
};

export const emitJoinCountry = (countryId) => {
  if (socket && socket.connected) {
    socket.emit('country:join', { country_id: countryId });
  }
};

export const emitLeaveCountry = () => {
  if (socket && socket.connected) {
    socket.emit('country:leave');
  }
};

export const emitChatMessage = (message, type = 'country') => {
  if (socket && socket.connected) {
    socket.emit('chat:message', { message, type });
  }
};

export const emitBorderPushUpdate = (pushId) => {
  if (socket && socket.connected) {
    socket.emit('border_push:update', { push_id: pushId });
  }
};

export const emitPing = (data = {}) => {
  if (socket && socket.connected) {
    const timestamp = Date.now();
    socket.emit('ping', { ...data, client_time: timestamp });
    
    return new Promise((resolve) => {
      socket.once('pong', (response) => {
        const latency = Date.now() - timestamp;
        resolve({ ...response, latency });
      });
    });
  }
  return Promise.resolve({ latency: -1 });
};

export default {
  initializeSocket,
  getSocket,
  disconnectSocket,
  emitPlayerMove,
  emitJoinCountry,
  emitLeaveCountry,
  emitChatMessage,
  emitBorderPushUpdate,
  emitPing
};