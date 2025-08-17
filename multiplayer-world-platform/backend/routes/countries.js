const express = require('express');
const Joi = require('joi');
const { Country, Player, CountryHistory } = require('../models');
const { authenticateToken, requireCountryOwner, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const joinCountrySchema = Joi.object({
  spawn_lat: Joi.number().min(-90).max(90).optional(),
  spawn_lng: Joi.number().min(-180).max(180).optional()
});

// GET /api/countries - Get all countries with their status
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, claimed, search } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = {};
    
    if (claimed !== undefined) {
      whereClause.is_claimed = claimed === 'true';
    }
    
    if (search) {
      whereClause.name = {
        [require('sequelize').Op.iLike]: `%${search}%`
      };
    }

    const countries = await Country.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: Player,
          as: 'owner',
          attributes: ['id', 'username', 'display_name'],
          required: false
        }
      ],
      attributes: [
        'id', 'name', 'iso_code', 'is_claimed', 'claimed_at',
        'soldier_count', 'max_soldiers', 'area_km2', 'population',
        'terrain_type', 'color', 'is_at_war', 'active_wars',
        'wars_won', 'wars_lost', 'territory_gained', 'territory_lost',
        'resources', 'last_activity'
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['name', 'ASC']]
    });

    res.json({
      countries: countries.rows,
      pagination: {
        total: countries.count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(countries.count / limit)
      }
    });

  } catch (error) {
    console.error('Countries fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch countries'
    });
  }
});

// GET /api/countries/:id - Get specific country details
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const country = await Country.findByPk(req.params.id, {
      include: [
        {
          model: Player,
          as: 'owner',
          attributes: ['id', 'username', 'display_name', 'avatar_url']
        },
        {
          model: Player,
          as: 'soldiers',
          attributes: ['id', 'username', 'display_name', 'is_online', 'last_active'],
          limit: 20,
          order: [['last_active', 'DESC']]
        }
      ]
    });

    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    // Get recent history
    const recentHistory = await CountryHistory.getCountryTimeline(country.id, 10);

    // Get war information if at war
    let activeWars = [];
    if (country.is_at_war) {
      const { War } = require('../models');
      activeWars = await War.findAll({
        where: {
          [require('sequelize').Op.or]: [
            { aggressor_country_id: country.id },
            { defender_country_id: country.id }
          ],
          status: 'active'
        },
        include: [
          {
            model: Country,
            as: 'aggressorCountry',
            attributes: ['id', 'name', 'color']
          },
          {
            model: Country,
            as: 'defenderCountry',
            attributes: ['id', 'name', 'color']
          },
          {
            model: Player,
            as: 'declarer',
            attributes: ['id', 'username', 'display_name']
          }
        ]
      });
    }

    res.json({
      country,
      recent_history: recentHistory,
      active_wars: activeWars
    });

  } catch (error) {
    console.error('Country fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch country'
    });
  }
});

// POST /api/countries/:id/join - Join a country as a soldier
router.post('/:id/join', authenticateToken, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = joinCountrySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const countryId = req.params.id;
    const { spawn_lat, spawn_lng } = value;

    // Find the country
    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    // Check if player is already in a country
    if (req.player.country_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You must leave your current country before joining another'
      });
    }

    // Check if country can accept new soldiers
    if (!country.canAcceptNewSoldier()) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Country has reached maximum soldier capacity'
      });
    }

    // If country is unclaimed, player becomes the owner
    let becameOwner = false;
    if (!country.is_claimed) {
      await country.claimCountry(req.player.id);
      becameOwner = true;
      
      // Record history
      await CountryHistory.recordClaimed(country.id, req.player.id);
      
      // Update player stats
      await req.player.increment('countries_owned');
    } else {
      // Just add as soldier
      await country.addSoldier();
      
      // Record history
      await CountryHistory.recordSoldierJoined(country.id, req.player.id);
    }

    // Update player's country and position
    const updateData = { country_id: country.id };
    
    if (spawn_lat !== undefined && spawn_lng !== undefined) {
      updateData.current_position = {
        type: 'Point',
        coordinates: [spawn_lng, spawn_lat]
      };
    }
    
    await req.player.update(updateData);

    // Reload country with updated data
    const updatedCountry = await Country.findByPk(country.id, {
      include: [
        {
          model: Player,
          as: 'owner',
          attributes: ['id', 'username', 'display_name']
        }
      ]
    });

    res.json({
      message: becameOwner ? 'Country claimed successfully' : 'Joined country successfully',
      country: updatedCountry,
      became_owner: becameOwner
    });

  } catch (error) {
    console.error('Join country error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to join country'
    });
  }
});

// POST /api/countries/:id/leave - Leave a country
router.post('/:id/leave', authenticateToken, async (req, res) => {
  try {
    const countryId = req.params.id;

    // Check if player is in this country
    if (req.player.country_id !== countryId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You are not a member of this country'
      });
    }

    const country = await Country.findByPk(countryId);
    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    const wasOwner = country.owner_id === req.player.id;

    // Remove soldier from country
    await country.removeSoldier();

    // Update player
    await req.player.update({ 
      country_id: null,
      current_position: null 
    });

    // Record history
    await CountryHistory.recordSoldierLeft(country.id, req.player.id);

    // If was owner and country became unclaimed, update player stats
    if (wasOwner && !country.is_claimed) {
      await req.player.decrement('countries_owned');
      await CountryHistory.recordUnclaimed(country.id, req.player.id);
    }

    res.json({
      message: 'Left country successfully',
      was_owner: wasOwner,
      country_unclaimed: wasOwner && !country.is_claimed
    });

  } catch (error) {
    console.error('Leave country error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to leave country'
    });
  }
});

// GET /api/countries/:id/soldiers - Get country soldiers
router.get('/:id/soldiers', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const country = await Country.findByPk(req.params.id);
    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    const soldiers = await Player.findAndCountAll({
      where: { country_id: req.params.id },
      attributes: [
        'id', 'username', 'display_name', 'avatar_url',
        'is_online', 'last_active', 'resources', 'movement_speed'
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [
        ['is_online', 'DESC'],
        ['last_active', 'DESC']
      ]
    });

    res.json({
      soldiers: soldiers.rows,
      pagination: {
        total: soldiers.count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(soldiers.count / limit)
      }
    });

  } catch (error) {
    console.error('Soldiers fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch soldiers'
    });
  }
});

// GET /api/countries/:id/history - Get country history
router.get('/:id/history', optionalAuth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const country = await Country.findByPk(req.params.id);
    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    const history = await CountryHistory.getCountryTimeline(req.params.id, parseInt(limit));

    res.json({
      history
    });

  } catch (error) {
    console.error('Country history fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch country history'
    });
  }
});

// GET /api/countries/:id/boundaries - Get country boundaries (GeoJSON)
router.get('/:id/boundaries', optionalAuth, async (req, res) => {
  try {
    const country = await Country.findByPk(req.params.id, {
      attributes: ['id', 'name', 'current_boundaries', 'original_boundaries', 'color']
    });

    if (!country) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Country not found'
      });
    }

    // In a real implementation, this would convert PostGIS geometry to GeoJSON
    // For now, return placeholder GeoJSON
    const geoJson = {
      type: 'Feature',
      properties: {
        id: country.id,
        name: country.name,
        color: country.color
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          // Placeholder coordinates - would be actual country boundaries
          [0, 0], [1, 0], [1, 1], [0, 1], [0, 0]
        ]]
      }
    };

    res.json({
      boundaries: geoJson
    });

  } catch (error) {
    console.error('Boundaries fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch country boundaries'
    });
  }
});

// PUT /api/countries/:id/settings - Update country settings (owner only)
router.put('/:id/settings', authenticateToken, requireCountryOwner, async (req, res) => {
  try {
    const { max_soldiers, defense_strength } = req.body;
    
    const updateData = {};
    
    if (max_soldiers !== undefined) {
      const maxAllowed = parseInt(process.env.MAX_PLAYERS_PER_COUNTRY) || 50;
      if (max_soldiers < 1 || max_soldiers > maxAllowed) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `Max soldiers must be between 1 and ${maxAllowed}`
        });
      }
      updateData.max_soldiers = max_soldiers;
    }
    
    if (defense_strength !== undefined) {
      if (defense_strength < 0.1 || defense_strength > 5.0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Defense strength must be between 0.1 and 5.0'
        });
      }
      updateData.defense_strength = defense_strength;
    }

    await req.country.update(updateData);

    res.json({
      message: 'Country settings updated successfully',
      country: req.country
    });

  } catch (error) {
    console.error('Country settings update error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update country settings'
    });
  }
});

// GET /api/countries/search - Search countries
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q, claimed, at_war, limit = 20 } = req.query;

    if (!q || q.length < 2) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Search query must be at least 2 characters long'
      });
    }

    const whereClause = {
      [require('sequelize').Op.or]: [
        { name: { [require('sequelize').Op.iLike]: `%${q}%` } },
        { iso_code: { [require('sequelize').Op.iLike]: `%${q}%` } }
      ]
    };

    if (claimed !== undefined) {
      whereClause.is_claimed = claimed === 'true';
    }

    if (at_war !== undefined) {
      whereClause.is_at_war = at_war === 'true';
    }

    const countries = await Country.findAll({
      where: whereClause,
      include: [
        {
          model: Player,
          as: 'owner',
          attributes: ['id', 'username', 'display_name'],
          required: false
        }
      ],
      attributes: [
        'id', 'name', 'iso_code', 'is_claimed', 'soldier_count',
        'area_km2', 'color', 'is_at_war'
      ],
      limit: parseInt(limit),
      order: [['name', 'ASC']]
    });

    res.json({
      countries
    });

  } catch (error) {
    console.error('Country search error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to search countries'
    });
  }
});

module.exports = router;