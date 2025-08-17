const jwt = require('jsonwebtoken');
const { Player, Country, BorderPush } = require('../models');

// Store active connections
const activeConnections = new Map();
const countryRooms = new Map();

// Middleware to authenticate socket connections
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const player = await Player.findByPk(decoded.playerId, {
      include: [
        {
          model: Country,
          as: 'country',
          attributes: ['id', 'name', 'color']
        }
      ],
      attributes: { exclude: ['password_hash'] }
    });

    if (!player) {
      return next(new Error('Authentication error: Player not found'));
    }

    if (player.is_banned) {
      return next(new Error('Authentication error: Player is banned'));
    }

    socket.player = player;
    next();
  } catch (error) {
    next(new Error('Authentication error: Invalid token'));
  }
};

// Handle socket connection
const handleConnection = (io) => {
  return (socket) => {
    console.log(`Player ${socket.player.username} connected (${socket.id})`);
    
    // Store connection
    activeConnections.set(socket.player.id, {
      socketId: socket.id,
      player: socket.player,
      connectedAt: new Date()
    });

    // Update player online status
    socket.player.update({ is_online: true, last_active: new Date() });

    // Join country room if player belongs to one
    if (socket.player.country_id) {
      const roomName = `country_${socket.player.country_id}`;
      socket.join(roomName);
      
      // Track country room membership
      if (!countryRooms.has(socket.player.country_id)) {
        countryRooms.set(socket.player.country_id, new Set());
      }
      countryRooms.get(socket.player.country_id).add(socket.player.id);

      // Notify other players in the country
      socket.to(roomName).emit('player:joined_country', {
        player: {
          id: socket.player.id,
          username: socket.player.username,
          display_name: socket.player.display_name
        },
        timestamp: new Date()
      });

      console.log(`Player ${socket.player.username} joined country room: ${roomName}`);
    }

    // Send initial game state
    socket.emit('connection:established', {
      player: {
        id: socket.player.id,
        username: socket.player.username,
        display_name: socket.player.display_name,
        country_id: socket.player.country_id,
        country: socket.player.country,
        current_position: socket.player.current_position,
        resources: socket.player.resources,
        is_online: true
      },
      server_time: new Date(),
      online_players: activeConnections.size
    });

    // Handle player movement
    socket.on('player:move', async (data) => {
      try {
        const { lat, lng, movement_type = 'walk' } = data;

        // Validate coordinates
        if (typeof lat !== 'number' || typeof lng !== 'number' ||
            lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          socket.emit('error', { message: 'Invalid coordinates' });
          return;
        }

        // Check if player can move
        if (!socket.player.canMove()) {
          socket.emit('error', { message: 'Movement is on cooldown' });
          return;
        }

        // Update position (basic validation - in production would check boundaries)
        await socket.player.updatePosition(lat, lng);

        // Broadcast to country room
        if (socket.player.country_id) {
          socket.to(`country_${socket.player.country_id}`).emit('player:moved', {
            player_id: socket.player.id,
            username: socket.player.username,
            position: { lat, lng },
            movement_type,
            timestamp: new Date()
          });
        }

        // Confirm movement to client
        socket.emit('player:move_confirmed', {
          position: { lat, lng },
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Movement error:', error);
        socket.emit('error', { message: 'Failed to process movement' });
      }
    });

    // Handle country joining
    socket.on('country:join', async (data) => {
      try {
        const { country_id } = data;

        if (socket.player.country_id) {
          socket.emit('error', { message: 'Already in a country' });
          return;
        }

        const country = await Country.findByPk(country_id);
        if (!country) {
          socket.emit('error', { message: 'Country not found' });
          return;
        }

        if (!country.canAcceptNewSoldier()) {
          socket.emit('error', { message: 'Country is full' });
          return;
        }

        // Join country
        let becameOwner = false;
        if (!country.is_claimed) {
          await country.claimCountry(socket.player.id);
          becameOwner = true;
        } else {
          await country.addSoldier();
        }

        await socket.player.update({ country_id: country.id });

        // Join socket room
        const roomName = `country_${country.id}`;
        socket.join(roomName);

        // Track room membership
        if (!countryRooms.has(country.id)) {
          countryRooms.set(country.id, new Set());
        }
        countryRooms.get(country.id).add(socket.player.id);

        // Broadcast to country
        socket.to(roomName).emit('player:joined_country', {
          player: {
            id: socket.player.id,
            username: socket.player.username,
            display_name: socket.player.display_name
          },
          became_owner: becameOwner,
          timestamp: new Date()
        });

        // Confirm to client
        socket.emit('country:joined', {
          country: await Country.findByPk(country.id),
          became_owner: becameOwner,
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Country join error:', error);
        socket.emit('error', { message: 'Failed to join country' });
      }
    });

    // Handle country leaving
    socket.on('country:leave', async () => {
      try {
        if (!socket.player.country_id) {
          socket.emit('error', { message: 'Not in a country' });
          return;
        }

        const countryId = socket.player.country_id;
        const country = await Country.findByPk(countryId);
        const wasOwner = country.owner_id === socket.player.id;

        // Leave country
        await country.removeSoldier();
        await socket.player.update({ 
          country_id: null,
          current_position: null 
        });

        // Leave socket room
        socket.leave(`country_${countryId}`);

        // Update room tracking
        if (countryRooms.has(countryId)) {
          countryRooms.get(countryId).delete(socket.player.id);
          if (countryRooms.get(countryId).size === 0) {
            countryRooms.delete(countryId);
          }
        }

        // Broadcast to former country
        socket.to(`country_${countryId}`).emit('player:left_country', {
          player: {
            id: socket.player.id,
            username: socket.player.username
          },
          was_owner: wasOwner,
          timestamp: new Date()
        });

        // Confirm to client
        socket.emit('country:left', {
          was_owner: wasOwner,
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Country leave error:', error);
        socket.emit('error', { message: 'Failed to leave country' });
      }
    });

    // Handle border push updates
    socket.on('border_push:update', async (data) => {
      try {
        const { push_id } = data;

        const borderPush = await BorderPush.findByPk(push_id);
        if (!borderPush || borderPush.status !== 'active') {
          socket.emit('error', { message: 'Border push not found or not active' });
          return;
        }

        // Update progress
        await borderPush.updateProgress();

        // Broadcast update to both countries
        const updateData = {
          push_id: borderPush.id,
          progress: borderPush.calculateCurrentProgress(),
          timestamp: new Date()
        };

        io.to(`country_${borderPush.source_country_id}`).emit('border_push:progress', updateData);
        io.to(`country_${borderPush.target_country_id}`).emit('border_push:progress', updateData);

      } catch (error) {
        console.error('Border push update error:', error);
        socket.emit('error', { message: 'Failed to update border push' });
      }
    });

    // Handle chat messages
    socket.on('chat:message', async (data) => {
      try {
        const { message, type = 'country' } = data;

        if (!message || message.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        if (message.length > 500) {
          socket.emit('error', { message: 'Message too long' });
          return;
        }

        const chatData = {
          id: Date.now() + Math.random(),
          player: {
            id: socket.player.id,
            username: socket.player.username,
            display_name: socket.player.display_name
          },
          message: message.trim(),
          type,
          timestamp: new Date()
        };

        if (type === 'country' && socket.player.country_id) {
          // Send to country room
          io.to(`country_${socket.player.country_id}`).emit('chat:message', chatData);
        } else if (type === 'global') {
          // Send to all connected players
          io.emit('chat:message', chatData);
        }

      } catch (error) {
        console.error('Chat message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle ping for latency measurement
    socket.on('ping', (data) => {
      socket.emit('pong', {
        ...data,
        server_time: Date.now()
      });
    });

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      console.log(`Player ${socket.player.username} disconnected (${socket.id}): ${reason}`);

      try {
        // Update player offline status
        await socket.player.update({ is_online: false });

        // Remove from active connections
        activeConnections.delete(socket.player.id);

        // Remove from country room tracking
        if (socket.player.country_id && countryRooms.has(socket.player.country_id)) {
          countryRooms.get(socket.player.country_id).delete(socket.player.id);
          if (countryRooms.get(socket.player.country_id).size === 0) {
            countryRooms.delete(socket.player.country_id);
          }

          // Notify country members
          socket.to(`country_${socket.player.country_id}`).emit('player:disconnected', {
            player: {
              id: socket.player.id,
              username: socket.player.username
            },
            timestamp: new Date()
          });
        }

        // Broadcast updated online count
        io.emit('server:stats', {
          online_players: activeConnections.size,
          active_countries: countryRooms.size
        });

      } catch (error) {
        console.error('Disconnect handling error:', error);
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    // Broadcast updated online count
    io.emit('server:stats', {
      online_players: activeConnections.size,
      active_countries: countryRooms.size
    });
  };
};

// Periodic updates
const startPeriodicUpdates = (io) => {
  // Update border push progress every 5 seconds
  setInterval(async () => {
    try {
      const activePushes = await BorderPush.findActivePushes();
      
      for (const push of activePushes) {
        const progress = push.calculateCurrentProgress();
        
        // Check if push should end (would implement proper territory calculation)
        if (progress.distance > 10000) { // 10km limit for demo
          await push.stopPush('successful');
          
          io.to(`country_${push.source_country_id}`).emit('border_push:completed', {
            push_id: push.id,
            result: 'successful',
            territory_gained: progress.territory
          });
          
          io.to(`country_${push.target_country_id}`).emit('border_push:lost', {
            push_id: push.id,
            territory_lost: progress.territory
          });
        } else {
          // Send progress update
          const updateData = {
            push_id: push.id,
            progress,
            timestamp: new Date()
          };
          
          io.to(`country_${push.source_country_id}`).emit('border_push:progress', updateData);
          io.to(`country_${push.target_country_id}`).emit('border_push:progress', updateData);
        }
      }
    } catch (error) {
      console.error('Periodic border push update error:', error);
    }
  }, 5000);

  // Send server statistics every 30 seconds
  setInterval(() => {
    io.emit('server:stats', {
      online_players: activeConnections.size,
      active_countries: countryRooms.size,
      timestamp: new Date()
    });
  }, 30000);

  // Resource generation every minute
  setInterval(async () => {
    try {
      // Generate resources for all claimed countries
      const claimedCountries = await Country.findAll({
        where: { is_claimed: true }
      });

      for (const country of claimedCountries) {
        await country.generateResources();
        
        // Notify country members of resource generation
        if (countryRooms.has(country.id)) {
          io.to(`country_${country.id}`).emit('country:resources_generated', {
            country_id: country.id,
            resources: country.resources,
            generated: Math.floor(country.resource_generation_rate),
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      console.error('Resource generation error:', error);
    }
  }, 60000);
};

// Main socket handler setup
const socketHandler = (io) => {
  // Apply authentication middleware
  io.use(authenticateSocket);

  // Handle connections
  io.on('connection', handleConnection(io));

  // Start periodic updates
  startPeriodicUpdates(io);

  // Store io instance for use in routes
  io.app = io;

  console.log('✅ Socket.IO handler initialized');
};

// Utility functions for external use
const getActiveConnections = () => activeConnections;
const getCountryRooms = () => countryRooms;
const broadcastToCountry = (io, countryId, event, data) => {
  io.to(`country_${countryId}`).emit(event, data);
};

module.exports = {
  socketHandler,
  getActiveConnections,
  getCountryRooms,
  broadcastToCountry
};