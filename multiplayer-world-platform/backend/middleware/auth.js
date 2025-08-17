const jwt = require('jsonwebtoken');
const { Player } = require('../models');

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'No token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find the player in the database
    const player = await Player.findByPk(decoded.playerId, {
      attributes: { exclude: ['password_hash'] }
    });

    if (!player) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Invalid token - player not found'
      });
    }

    // Check if player is banned
    if (player.is_banned) {
      const now = new Date();
      if (!player.ban_expires || now < player.ban_expires) {
        return res.status(403).json({
          error: 'Access denied',
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

    // Update last active timestamp
    await player.update({ 
      last_active: new Date(),
      is_online: true 
    });

    req.player = player;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Token has expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Invalid token'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed'
    });
  }
};

// Middleware to check if player is a country owner
const requireCountryOwner = async (req, res, next) => {
  try {
    const countryId = req.params.countryId || req.body.countryId;
    
    if (!countryId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Country ID is required'
      });
    }

    const { Country } = require('../models');
    const country = await Country.findByPk(countryId);

    if (!country) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Country not found'
      });
    }

    if (!country.is_claimed || country.owner_id !== req.player.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Only the country owner can perform this action'
      });
    }

    req.country = country;
    next();
  } catch (error) {
    console.error('Country owner check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify country ownership'
    });
  }
};

// Middleware to check if player belongs to a country
const requireCountryMember = async (req, res, next) => {
  try {
    const countryId = req.params.countryId || req.body.countryId;
    
    if (!countryId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Country ID is required'
      });
    }

    if (req.player.country_id !== countryId) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You must be a member of this country to perform this action'
      });
    }

    const { Country } = require('../models');
    const country = await Country.findByPk(countryId);

    if (!country) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Country not found'
      });
    }

    req.country = country;
    next();
  } catch (error) {
    console.error('Country member check error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify country membership'
    });
  }
};

// Middleware to check admin/moderator privileges
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.player) {
      return res.status(401).json({
        error: 'Access denied',
        message: 'Authentication required'
      });
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.player.role)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Insufficient privileges'
      });
    }

    next();
  };
};

// Middleware to check if player can move (cooldown check)
const checkMovementCooldown = (req, res, next) => {
  if (!req.player.canMove()) {
    const cooldown = parseInt(process.env.MOVEMENT_COOLDOWN_MS) || 1000;
    const timeLeft = cooldown - (Date.now() - req.player.last_movement.getTime());
    
    return res.status(429).json({
      error: 'Rate limited',
      message: 'Movement is on cooldown',
      cooldown_ms: cooldown,
      time_left_ms: Math.max(0, timeLeft)
    });
  }
  
  next();
};

// Middleware to validate position coordinates
const validateCoordinates = (req, res, next) => {
  const { lat, lng, latitude, longitude } = req.body;
  
  const finalLat = lat || latitude;
  const finalLng = lng || longitude;
  
  if (finalLat === undefined || finalLng === undefined) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Latitude and longitude are required'
    });
  }
  
  const latNum = parseFloat(finalLat);
  const lngNum = parseFloat(finalLng);
  
  if (isNaN(latNum) || isNaN(lngNum)) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Invalid coordinate values'
    });
  }
  
  if (latNum < -90 || latNum > 90) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Latitude must be between -90 and 90'
    });
  }
  
  if (lngNum < -180 || lngNum > 180) {
    return res.status(400).json({
      error: 'Bad request',
      message: 'Longitude must be between -180 and 180'
    });
  }
  
  req.coordinates = { lat: latNum, lng: lngNum };
  next();
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.player = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const player = await Player.findByPk(decoded.playerId, {
      attributes: { exclude: ['password_hash'] }
    });

    if (player && !player.is_banned) {
      await player.update({ 
        last_active: new Date(),
        is_online: true 
      });
      req.player = player;
    } else {
      req.player = null;
    }
  } catch (error) {
    req.player = null;
  }

  next();
};

module.exports = {
  authenticateToken,
  requireCountryOwner,
  requireCountryMember,
  requireRole,
  checkMovementCooldown,
  validateCoordinates,
  optionalAuth
};