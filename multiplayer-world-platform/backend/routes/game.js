const express = require('express');
const Joi = require('joi');
const { War, Country, BorderPush, CountryHistory } = require('../models');
const { authenticateToken, requireCountryOwner, requireCountryMember, validateCoordinates } = require('../middleware/auth');

const router = express.Router();

// Validation schemas
const declareWarSchema = Joi.object({
  target_country_id: Joi.string().uuid().required(),
  reason: Joi.string().max(500).optional()
});

const borderPushSchema = Joi.object({
  target_country_id: Joi.string().uuid().required(),
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  direction_lat: Joi.number().min(-1).max(1).required(),
  direction_lng: Joi.number().min(-1).max(1).required()
});

// POST /api/game/declare-war - Declare war on another country (owner only)
router.post('/declare-war', authenticateToken, async (req, res) => {
  try {
    // Validate request
    const { error, value } = declareWarSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { target_country_id, reason } = value;

    // Check if player owns a country
    if (!req.player.country_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You must own a country to declare war'
      });
    }

    const sourceCountry = await Country.findByPk(req.player.country_id);
    if (!sourceCountry || sourceCountry.owner_id !== req.player.id) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Only country owners can declare war'
      });
    }

    // Find target country
    const targetCountry = await Country.findByPk(target_country_id);
    if (!targetCountry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Target country not found'
      });
    }

    if (!targetCountry.is_claimed) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot declare war on unclaimed countries'
      });
    }

    if (sourceCountry.id === targetCountry.id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Cannot declare war on your own country'
      });
    }

    // Check if war already exists
    const existingWar = await War.findOne({
      where: {
        [require('sequelize').Op.or]: [
          {
            aggressor_country_id: sourceCountry.id,
            defender_country_id: targetCountry.id
          },
          {
            aggressor_country_id: targetCountry.id,
            defender_country_id: sourceCountry.id
          }
        ],
        status: 'active'
      }
    });

    if (existingWar) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'War already exists between these countries'
      });
    }

    // Check cooldown
    const cooldown = parseInt(process.env.WAR_DECLARATION_COOLDOWN_MS) || 300000; // 5 minutes
    const lastWar = await War.findOne({
      where: {
        declared_by: req.player.id
      },
      order: [['declared_at', 'DESC']]
    });

    if (lastWar) {
      const timeSinceLastWar = Date.now() - lastWar.declared_at.getTime();
      if (timeSinceLastWar < cooldown) {
        const timeLeft = cooldown - timeSinceLastWar;
        return res.status(429).json({
          error: 'Rate Limited',
          message: 'War declaration is on cooldown',
          cooldown_ms: cooldown,
          time_left_ms: timeLeft
        });
      }
    }

    // TODO: Check if countries are neighbors (would use PostGIS)
    // For now, allow war between any countries

    // Create war
    const war = await War.create({
      aggressor_country_id: sourceCountry.id,
      defender_country_id: targetCountry.id,
      declared_by: req.player.id,
      reason: reason || `War declared by ${req.player.username}`
    });

    // Update player statistics
    await req.player.increment('wars_declared');

    // Record history
    await CountryHistory.recordWarDeclared(
      sourceCountry.id, 
      war.id, 
      req.player.id, 
      targetCountry.id
    );

    // Broadcast war declaration
    const io = req.app.get('io');
    if (io) {
      io.emit('war:declared', {
        war_id: war.id,
        aggressor: {
          id: sourceCountry.id,
          name: sourceCountry.name,
          owner: req.player.username
        },
        defender: {
          id: targetCountry.id,
          name: targetCountry.name
        },
        declared_at: war.declared_at,
        reason: war.reason
      });
    }

    res.status(201).json({
      message: 'War declared successfully',
      war: {
        id: war.id,
        aggressor_country: sourceCountry,
        defender_country: targetCountry,
        declared_by: req.player.username,
        declared_at: war.declared_at,
        reason: war.reason,
        status: war.status
      }
    });

  } catch (error) {
    console.error('War declaration error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to declare war'
    });
  }
});

// POST /api/game/border-push - Initiate a border push (requires active war)
router.post('/border-push', authenticateToken, requireCountryMember, validateCoordinates, async (req, res) => {
  try {
    // Validate request
    const { error, value } = borderPushSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation Error',
        message: error.details[0].message
      });
    }

    const { target_country_id, direction_lat, direction_lng } = value;
    const { lat, lng } = req.coordinates;

    // Find active war
    const war = await War.findOne({
      where: {
        aggressor_country_id: req.player.country_id,
        defender_country_id: target_country_id,
        status: 'active'
      }
    });

    if (!war) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No active war exists between these countries'
      });
    }

    // Check border push cooldown
    const cooldown = parseInt(process.env.BORDER_PUSH_COOLDOWN_MS) || 5000;
    const lastPush = await BorderPush.findOne({
      where: { player_id: req.player.id },
      order: [['started_at', 'DESC']]
    });

    if (lastPush && lastPush.status === 'active') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'You already have an active border push'
      });
    }

    if (lastPush) {
      const timeSinceLastPush = Date.now() - lastPush.started_at.getTime();
      if (timeSinceLastPush < cooldown) {
        const timeLeft = cooldown - timeSinceLastPush;
        return res.status(429).json({
          error: 'Rate Limited',
          message: 'Border push is on cooldown',
          time_left_ms: timeLeft
        });
      }
    }

    // Check if player has enough resources
    const resourceCost = 10;
    if (req.player.resources < resourceCost) {
      return res.status(400).json({
        error: 'Insufficient Resources',
        message: `Not enough resources for border push. Required: ${resourceCost}`
      });
    }

    // TODO: Validate position is near border (would use PostGIS)
    // TODO: Get terrain modifier based on position

    // Create border push
    const borderPush = await BorderPush.create({
      war_id: war.id,
      player_id: req.player.id,
      source_country_id: req.player.country_id,
      target_country_id: target_country_id,
      push_position: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      push_direction: {
        type: 'Point',
        coordinates: [direction_lng, direction_lat]
      },
      push_strength: 1.0, // Base strength
      terrain_modifier: 1.0, // Would be calculated based on terrain
      resources_consumed: resourceCost
    });

    // Consume resources
    await req.player.consumeResources(resourceCost);

    // Broadcast border push
    const io = req.app.get('io');
    if (io) {
      io.to(`country_${req.player.country_id}`).emit('border_push:started', {
        push_id: borderPush.id,
        player: req.player.username,
        position: { lat, lng },
        direction: { lat: direction_lat, lng: direction_lng },
        war_id: war.id
      });

      io.to(`country_${target_country_id}`).emit('border_push:incoming', {
        push_id: borderPush.id,
        attacker_country: req.player.country_id,
        position: { lat, lng },
        war_id: war.id
      });
    }

    res.status(201).json({
      message: 'Border push initiated',
      border_push: {
        id: borderPush.id,
        position: { lat, lng },
        direction: { lat: direction_lat, lng: direction_lng },
        push_strength: borderPush.push_strength,
        push_speed: borderPush.push_speed,
        war_id: war.id
      }
    });

  } catch (error) {
    console.error('Border push error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to initiate border push'
    });
  }
});

// POST /api/game/border-push/:id/join - Join an existing border push
router.post('/border-push/:id/join', authenticateToken, requireCountryMember, async (req, res) => {
  try {
    const borderPush = await BorderPush.findByPk(req.params.id, {
      include: [
        { model: War, as: 'war' }
      ]
    });

    if (!borderPush) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Border push not found'
      });
    }

    if (borderPush.status !== 'active') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Border push is not active'
      });
    }

    // Check if player is in the attacking country
    if (req.player.country_id !== borderPush.source_country_id) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only join border pushes from your own country'
      });
    }

    // Add player support to the push
    await borderPush.addSupportingSoldier();

    // Broadcast update
    const io = req.app.get('io');
    if (io) {
      io.to(`country_${borderPush.source_country_id}`).emit('border_push:support_added', {
        push_id: borderPush.id,
        supporter: req.player.username,
        total_supporters: borderPush.supporting_soldiers,
        new_strength: borderPush.push_strength,
        new_speed: borderPush.push_speed
      });
    }

    res.json({
      message: 'Joined border push successfully',
      supporting_soldiers: borderPush.supporting_soldiers,
      push_strength: borderPush.push_strength,
      push_speed: borderPush.push_speed
    });

  } catch (error) {
    console.error('Join border push error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to join border push'
    });
  }
});

// POST /api/game/border-push/:id/defend - Defend against a border push
router.post('/border-push/:id/defend', authenticateToken, requireCountryMember, async (req, res) => {
  try {
    const borderPush = await BorderPush.findByPk(req.params.id);

    if (!borderPush) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Border push not found'
      });
    }

    if (borderPush.status !== 'active') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Border push is not active'
      });
    }

    // Check if player is in the defending country
    if (req.player.country_id !== borderPush.target_country_id) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'You can only defend against pushes targeting your country'
      });
    }

    // Add player defense to the push
    await borderPush.addDefendingSoldier();

    // Broadcast update
    const io = req.app.get('io');
    if (io) {
      io.to(`country_${borderPush.target_country_id}`).emit('border_push:defense_added', {
        push_id: borderPush.id,
        defender: req.player.username,
        total_defenders: borderPush.defending_soldiers,
        new_resistance: borderPush.resistance_strength,
        new_speed: borderPush.push_speed
      });
    }

    res.json({
      message: 'Joined defense successfully',
      defending_soldiers: borderPush.defending_soldiers,
      resistance_strength: borderPush.resistance_strength,
      push_speed: borderPush.push_speed
    });

  } catch (error) {
    console.error('Defend border push error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to defend against border push'
    });
  }
});

// POST /api/game/end-war/:id - End a war (owner only)
router.post('/end-war/:id', authenticateToken, async (req, res) => {
  try {
    const war = await War.findByPk(req.params.id);

    if (!war) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'War not found'
      });
    }

    if (war.status !== 'active') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'War is not active'
      });
    }

    if (!war.canEndWar(req.player.id)) {
      return res.status(403).json({
        error: 'Access Denied',
        message: 'Only the war declarer can end the war'
      });
    }

    // End the war
    await war.endWar(req.player.id);

    // End all active border pushes for this war
    await BorderPush.update(
      { status: 'cancelled' },
      { 
        where: { 
          war_id: war.id, 
          status: 'active' 
        } 
      }
    );

    // Record history
    await CountryHistory.recordWarEnded(war.aggressor_country_id, war.id, null);
    await CountryHistory.recordWarEnded(war.defender_country_id, war.id, null);

    // Broadcast war end
    const io = req.app.get('io');
    if (io) {
      io.emit('war:ended', {
        war_id: war.id,
        ended_by: req.player.username,
        duration_minutes: war.getDuration()
      });
    }

    res.json({
      message: 'War ended successfully',
      duration_minutes: war.getDuration()
    });

  } catch (error) {
    console.error('End war error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to end war'
    });
  }
});

// GET /api/game/wars - Get active wars
router.get('/wars', async (req, res) => {
  try {
    const { status = 'active', limit = 50 } = req.query;

    const wars = await War.findAll({
      where: { status },
      include: [
        {
          model: Country,
          as: 'aggressorCountry',
          attributes: ['id', 'name', 'color', 'soldier_count']
        },
        {
          model: Country,
          as: 'defenderCountry',
          attributes: ['id', 'name', 'color', 'soldier_count']
        },
        {
          model: require('../models').Player,
          as: 'declarer',
          attributes: ['id', 'username', 'display_name']
        }
      ],
      limit: parseInt(limit),
      order: [['declared_at', 'DESC']]
    });

    res.json({ wars });

  } catch (error) {
    console.error('Wars fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch wars'
    });
  }
});

// GET /api/game/border-pushes - Get active border pushes
router.get('/border-pushes', async (req, res) => {
  try {
    const { war_id, status = 'active', limit = 50 } = req.query;

    const whereClause = { status };
    if (war_id) {
      whereClause.war_id = war_id;
    }

    const borderPushes = await BorderPush.findAll({
      where: whereClause,
      include: [
        {
          model: Country,
          as: 'sourceCountry',
          attributes: ['id', 'name', 'color']
        },
        {
          model: Country,
          as: 'targetCountry',
          attributes: ['id', 'name', 'color']
        },
        {
          model: require('../models').Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        },
        {
          model: War,
          as: 'war',
          attributes: ['id', 'declared_at']
        }
      ],
      limit: parseInt(limit),
      order: [['started_at', 'DESC']]
    });

    // Calculate current progress for active pushes
    const pushesWithProgress = borderPushes.map(push => {
      const progress = push.calculateCurrentProgress();
      return {
        ...push.toJSON(),
        current_progress: progress
      };
    });

    res.json({ border_pushes: pushesWithProgress });

  } catch (error) {
    console.error('Border pushes fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch border pushes'
    });
  }
});

module.exports = router;