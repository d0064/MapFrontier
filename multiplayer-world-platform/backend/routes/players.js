const express = require('express');
const Joi = require('joi');
const { Player, PlayerMovement, Country } = require('../models');
const { authenticateToken, checkMovementCooldown, validateCoordinates } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const moveSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  movement_type: Joi.string().valid('walk', 'run', 'teleport').default('walk')
});

// POST /api/players/move - Update player position
router.post('/move', authenticateToken, checkMovementCooldown, validateCoordinates, async (req, res) => {
  try {
    const { movement_type = 'walk' } = req.body;
    const { lat, lng } = req.coordinates;

    // Check if player belongs to a country
    if (!req.player.country_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You must join a country before moving'
      });
    }

    // Get current position
    const oldPosition = req.player.current_position;
    const oldLat = oldPosition ? oldPosition.coordinates[1] : null;
    const oldLng = oldPosition ? oldPosition.coordinates[0] : null;

    // Calculate resource cost
    const baseCost = movement_type === 'run' ? 2 : movement_type === 'teleport' ? 10 : 1;
    
    // Check if player has enough resources
    if (req.player.resources < baseCost) {
      return res.status(400).json({
        error: 'Insufficient Resources',
        message: `Not enough resources for ${movement_type}. Required: ${baseCost}, Available: ${req.player.resources}`
      });
    }

    // TODO: Validate movement is within country boundaries
    // This would use PostGIS functions to check if the new position is within the country polygon

    // Update player position
    await req.player.updatePosition(lat, lng);
    
    // Consume resources
    await req.player.consumeResources(baseCost);

    // Record movement in history
    const movementRecord = await PlayerMovement.create({
      player_id: req.player.id,
      from_position: oldPosition,
      to_position: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      country_id: req.player.country_id,
      movement_type,
      resources_consumed: baseCost,
      timestamp: new Date()
    });

    // Broadcast movement to other players via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`country_${req.player.country_id}`).emit('player:moved', {
        player_id: req.player.id,
        username: req.player.username,
        position: { lat, lng },
        movement_type,
        timestamp: new Date()
      });
    }

    res.json({
      message: 'Movement successful',
      position: { lat, lng },
      resources_remaining: req.player.resources - baseCost,
      movement_type,
      movement_id: movementRecord.id
    });

  } catch (error) {
    console.error('Movement error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update position'
    });
  }
});

// GET /api/players/position - Get current player position
router.get('/position', authenticateToken, (req, res) => {
  const position = req.player.current_position;
  
  res.json({
    position: position ? {
      lat: position.coordinates[1],
      lng: position.coordinates[0]
    } : null,
    country_id: req.player.country_id,
    last_movement: req.player.last_movement,
    can_move: req.player.canMove()
  });
});

// GET /api/players/nearby - Get nearby players
router.get('/nearby', authenticateToken, async (req, res) => {
  try {
    const { radius = 1000 } = req.query; // radius in meters

    if (!req.player.current_position) {
      return res.json({ players: [] });
    }

    // TODO: Use PostGIS ST_DWithin to find players within radius
    // For now, return players in the same country
    const nearbyPlayers = await Player.findAll({
      where: {
        country_id: req.player.country_id,
        id: { [require('sequelize').Op.ne]: req.player.id },
        is_online: true,
        current_position: { [require('sequelize').Op.ne]: null }
      },
      attributes: [
        'id', 'username', 'display_name', 'current_position', 
        'last_movement', 'is_online'
      ],
      limit: 50
    });

    res.json({
      players: nearbyPlayers.map(player => ({
        id: player.id,
        username: player.username,
        display_name: player.display_name,
        position: player.current_position ? {
          lat: player.current_position.coordinates[1],
          lng: player.current_position.coordinates[0]
        } : null,
        last_movement: player.last_movement,
        is_online: player.is_online
      }))
    });

  } catch (error) {
    console.error('Nearby players error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch nearby players'
    });
  }
});

// GET /api/players/movement-history - Get player movement history
router.get('/movement-history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const movements = await PlayerMovement.getPlayerTrail(req.player.id, parseInt(limit));

    res.json({
      movements: movements.map(movement => ({
        id: movement.id,
        from_position: movement.from_position ? {
          lat: movement.from_position.coordinates[1],
          lng: movement.from_position.coordinates[0]
        } : null,
        to_position: {
          lat: movement.to_position.coordinates[1],
          lng: movement.to_position.coordinates[0]
        },
        movement_type: movement.movement_type,
        distance_meters: movement.distance_meters,
        resources_consumed: movement.resources_consumed,
        timestamp: movement.timestamp
      }))
    });

  } catch (error) {
    console.error('Movement history error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch movement history'
    });
  }
});

// GET /api/players/:id - Get public player info
router.get('/:id', async (req, res) => {
  try {
    const player = await Player.findByPk(req.params.id, {
      include: [
        {
          model: Country,
          as: 'country',
          attributes: ['id', 'name', 'color']
        },
        {
          model: Country,
          as: 'ownedCountries',
          attributes: ['id', 'name', 'soldier_count', 'area_km2']
        }
      ],
      attributes: [
        'id', 'username', 'display_name', 'avatar_url', 
        'is_online', 'last_active', 'countries_owned',
        'wars_declared', 'wars_won', 'territory_conquered',
        'total_playtime'
      ]
    });

    if (!player) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Player not found'
      });
    }

    res.json({ player });

  } catch (error) {
    console.error('Player fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch player'
    });
  }
});

// GET /api/players - Get players list with filtering
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      online, 
      country_id, 
      search,
      sort = 'last_active'
    } = req.query;
    
    const offset = (page - 1) * limit;
    const whereClause = {};

    if (online !== undefined) {
      whereClause.is_online = online === 'true';
    }

    if (country_id) {
      whereClause.country_id = country_id;
    }

    if (search) {
      whereClause[require('sequelize').Op.or] = [
        { username: { [require('sequelize').Op.iLike]: `%${search}%` } },
        { display_name: { [require('sequelize').Op.iLike]: `%${search}%` } }
      ];
    }

    const validSorts = ['last_active', 'username', 'countries_owned', 'wars_won'];
    const sortField = validSorts.includes(sort) ? sort : 'last_active';

    const players = await Player.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Country,
          as: 'country',
          attributes: ['id', 'name', 'color'],
          required: false
        }
      ],
      attributes: [
        'id', 'username', 'display_name', 'avatar_url',
        'is_online', 'last_active', 'countries_owned',
        'wars_declared', 'wars_won', 'territory_conquered'
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [[sortField, 'DESC']]
    });

    res.json({
      players: players.rows,
      pagination: {
        total: players.count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(players.count / limit)
      }
    });

  } catch (error) {
    console.error('Players list error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch players'
    });
  }
});

// GET /api/players/leaderboard - Get player leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { type = 'territory', limit = 50 } = req.query;

    const validTypes = ['territory', 'countries', 'wars'];
    const leaderboardType = validTypes.includes(type) ? type : 'territory';

    let orderField;
    switch (leaderboardType) {
      case 'countries':
        orderField = 'countries_owned';
        break;
      case 'wars':
        orderField = 'wars_won';
        break;
      case 'territory':
      default:
        orderField = 'territory_conquered';
        break;
    }

    const players = await Player.findAll({
      include: [
        {
          model: Country,
          as: 'country',
          attributes: ['id', 'name', 'color'],
          required: false
        }
      ],
      attributes: [
        'id', 'username', 'display_name', 'avatar_url',
        'countries_owned', 'wars_declared', 'wars_won',
        'territory_conquered', 'total_playtime'
      ],
      where: {
        [orderField]: { [require('sequelize').Op.gt]: 0 }
      },
      limit: parseInt(limit),
      order: [[orderField, 'DESC']]
    });

    res.json({
      leaderboard: players.map((player, index) => ({
        rank: index + 1,
        player,
        score: player[orderField]
      })),
      type: leaderboardType
    });

  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch leaderboard'
    });
  }
});

module.exports = router;