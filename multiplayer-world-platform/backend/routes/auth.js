const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { Player } = require('../models');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const registerSchema = Joi.object({
  username: Joi.string()
    .alphanum()
    .min(3)
    .max(50)
    .required()
    .messages({
      'string.alphanum': 'Username must only contain alphanumeric characters',
      'string.min': 'Username must be at least 3 characters long',
      'string.max': 'Username must be no more than 50 characters long'
    }),
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address'
    }),
  password: Joi.string()
    .min(6)
    .max(128)
    .required()
    .messages({
      'string.min': 'Password must be at least 6 characters long',
      'string.max': 'Password must be no more than 128 characters long'
    }),
  display_name: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .allow('')
});

const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

const updateProfileSchema = Joi.object({
  display_name: Joi.string()
    .min(1)
    .max(100)
    .optional()
    .allow(''),
  avatar_url: Joi.string()
    .uri()
    .optional()
    .allow('')
});

// Helper function to generate JWT token
const generateToken = (playerId) => {
  return jwt.sign(
    { playerId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// POST /api/auth/register - Register a new player
router.post('/register', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message,
        details: error.details
      });
    }

    const { username, email, password, display_name } = value;

    // Check if username or email already exists
    const existingPlayer = await Player.findOne({
      where: {
        [require('sequelize').Op.or]: [
          { username },
          { email }
        ]
      }
    });

    if (existingPlayer) {
      const field = existingPlayer.username === username ? 'username' : 'email';
      return res.status(409).json({
        error: 'Conflict',
        message: `A player with this ${field} already exists`
      });
    }

    // Create new player
    const player = await Player.create({
      username,
      email,
      password_hash: password, // Will be hashed by the model hook
      display_name: display_name || username,
      is_online: true
    });

    // Generate token
    const token = generateToken(player.id);

    res.status(201).json({
      message: 'Player registered successfully',
      token,
      player: {
        id: player.id,
        username: player.username,
        email: player.email,
        display_name: player.display_name,
        avatar_url: player.avatar_url,
        is_online: player.is_online,
        created_at: player.created_at
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register player'
    });
  }
});

// POST /api/auth/login - Login a player
router.post('/login', async (req, res) => {
  try {
    // Validate request body
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { username, password } = value;

    // Find player by username
    const player = await Player.findOne({ 
      where: { username },
      include: [
        {
          model: require('../models').Country,
          as: 'country',
          attributes: ['id', 'name', 'is_claimed', 'owner_id']
        }
      ]
    });

    if (!player) {
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid username or password'
      });
    }

    // Check password
    const isValidPassword = await player.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Authentication Failed',
        message: 'Invalid username or password'
      });
    }

    // Check if player is banned
    if (player.is_banned) {
      const now = new Date();
      if (!player.ban_expires || now < player.ban_expires) {
        return res.status(403).json({
          error: 'Access Denied',
          message: 'Account is banned',
          ban_reason: player.ban_reason,
          ban_expires: player.ban_expires
        });
      } else {
        // Ban has expired, unban the player
        await player.update({
          is_banned: false,
          ban_reason: null,
          ban_expires: null
        });
      }
    }

    // Update player online status
    await player.update({ 
      is_online: true,
      last_active: new Date()
    });

    // Generate token
    const token = generateToken(player.id);

    res.json({
      message: 'Login successful',
      token,
      player: {
        id: player.id,
        username: player.username,
        email: player.email,
        display_name: player.display_name,
        avatar_url: player.avatar_url,
        is_online: true,
        country_id: player.country_id,
        country: player.country,
        current_position: player.current_position,
        resources: player.resources,
        countries_owned: player.countries_owned,
        wars_declared: player.wars_declared,
        wars_won: player.wars_won,
        territory_conquered: player.territory_conquered,
        total_playtime: player.total_playtime,
        last_active: new Date()
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to login'
    });
  }
});

// POST /api/auth/logout - Logout a player
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update player offline status
    await req.player.update({ is_online: false });

    res.json({
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to logout'
    });
  }
});

// GET /api/auth/profile - Get current player profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // Reload player with associations
    const player = await Player.findByPk(req.player.id, {
      include: [
        {
          model: require('../models').Country,
          as: 'country',
          attributes: ['id', 'name', 'is_claimed', 'owner_id', 'soldier_count', 'color']
        },
        {
          model: require('../models').Country,
          as: 'ownedCountries',
          attributes: ['id', 'name', 'soldier_count', 'area_km2', 'resources', 'color']
        }
      ],
      attributes: { exclude: ['password_hash'] }
    });

    res.json({
      player
    });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch profile'
    });
  }
});

// PUT /api/auth/profile - Update player profile
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    // Update player
    await req.player.update(value);

    // Reload player
    const updatedPlayer = await Player.findByPk(req.player.id, {
      attributes: { exclude: ['password_hash'] }
    });

    res.json({
      message: 'Profile updated successfully',
      player: updatedPlayer
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update profile'
    });
  }
});

// GET /api/auth/verify - Verify token validity
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    player: {
      id: req.player.id,
      username: req.player.username,
      display_name: req.player.display_name,
      is_online: req.player.is_online,
      country_id: req.player.country_id,
      role: req.player.role
    }
  });
});

// GET /api/auth/stats - Get player statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = {
      countries_owned: req.player.countries_owned,
      wars_declared: req.player.wars_declared,
      wars_won: req.player.wars_won,
      territory_conquered: req.player.territory_conquered,
      total_playtime: req.player.total_playtime,
      resources: req.player.resources,
      movement_speed: req.player.movement_speed,
      current_position: req.player.current_position
    };

    // Get additional stats from database
    const { CountryHistory, War, BorderPush } = require('../models');

    // Recent activity
    const recentActivity = await CountryHistory.getPlayerHistory(req.player.id, 10);
    
    // Active wars
    const activeWars = await War.findAll({
      where: { 
        declared_by: req.player.id,
        status: 'active'
      },
      include: [
        {
          model: require('../models').Country,
          as: 'aggressorCountry',
          attributes: ['id', 'name']
        },
        {
          model: require('../models').Country,
          as: 'defenderCountry',
          attributes: ['id', 'name']
        }
      ]
    });

    // Border pushes participated
    const borderPushes = await BorderPush.findAll({
      where: { player_id: req.player.id },
      limit: 5,
      order: [['started_at', 'DESC']],
      include: [
        {
          model: require('../models').Country,
          as: 'sourceCountry',
          attributes: ['id', 'name']
        },
        {
          model: require('../models').Country,
          as: 'targetCountry',
          attributes: ['id', 'name']
        }
      ]
    });

    res.json({
      stats,
      recent_activity: recentActivity,
      active_wars: activeWars,
      recent_border_pushes: borderPushes
    });

  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch statistics'
    });
  }
});

module.exports = router;