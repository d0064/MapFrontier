module.exports = (sequelize, DataTypes) => {
  const BorderPush = sequelize.define('BorderPush', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    war_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'wars',
        key: 'id'
      }
    },
    player_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'players',
        key: 'id'
      },
      comment: 'Player who initiated the border push'
    },
    source_country_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'countries',
        key: 'id'
      },
      comment: 'Country pushing the border'
    },
    target_country_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'countries',
        key: 'id'
      },
      comment: 'Country being pushed against'
    },
    push_position: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: false,
      comment: 'Geographic position where the push is happening'
    },
    push_direction: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: false,
      comment: 'Direction vector of the push (normalized)'
    },
    started_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active', 'successful', 'failed', 'cancelled'),
      defaultValue: 'active'
    },
    push_strength: {
      type: DataTypes.FLOAT,
      allowNull: false,
      validate: {
        min: 0.1,
        max: 10.0
      },
      comment: 'Strength of the push based on soldier count and resources'
    },
    resistance_strength: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 10.0
      },
      comment: 'Resistance from defending country'
    },
    terrain_modifier: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 5.0
      },
      comment: 'Terrain difficulty modifier'
    },
    distance_pushed: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Distance pushed in meters'
    },
    territory_gained: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Territory gained in square kilometers'
    },
    resources_consumed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    supporting_soldiers: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 1
      },
      comment: 'Number of soldiers supporting this push'
    },
    defending_soldiers: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Number of soldiers defending against this push'
    },
    duration_seconds: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    push_speed: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 5.0
      },
      comment: 'Speed of border expansion in meters per second'
    },
    last_update: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'border_pushes',
    indexes: [
      {
        fields: ['war_id']
      },
      {
        fields: ['player_id']
      },
      {
        fields: ['source_country_id']
      },
      {
        fields: ['target_country_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['started_at']
      },
      {
        fields: ['last_update']
      },
      {
        type: 'SPATIAL',
        fields: ['push_position']
      }
    ],
    hooks: {
      beforeCreate: async (borderPush) => {
        // Calculate initial push speed based on various factors
        const baseSpeed = 1.0; // meters per second
        const strengthMultiplier = borderPush.push_strength / borderPush.resistance_strength;
        const terrainMultiplier = 1 / borderPush.terrain_modifier;
        
        borderPush.push_speed = baseSpeed * strengthMultiplier * terrainMultiplier;
        
        // Ensure speed is within bounds
        borderPush.push_speed = Math.max(0.1, Math.min(5.0, borderPush.push_speed));
      },
      beforeUpdate: async (borderPush) => {
        if (borderPush.changed('status') && borderPush.status !== 'active') {
          borderPush.ended_at = new Date();
          
          // Calculate duration
          if (borderPush.started_at) {
            const durationMs = borderPush.ended_at.getTime() - borderPush.started_at.getTime();
            borderPush.duration_seconds = Math.floor(durationMs / 1000);
          }
        }
        
        // Update last_update timestamp
        borderPush.last_update = new Date();
      },
      afterUpdate: async (borderPush) => {
        // Update war statistics
        if (borderPush.changed('status') && borderPush.status !== 'active') {
          const { War } = sequelize.models;
          await War.increment('total_border_pushes', {
            where: { id: borderPush.war_id }
          });
        }
      }
    }
  });

  // Instance methods
  BorderPush.prototype.calculateCurrentProgress = function() {
    if (this.status !== 'active') {
      return {
        distance: this.distance_pushed,
        territory: this.territory_gained,
        isActive: false
      };
    }
    
    const now = new Date();
    const elapsedSeconds = (now.getTime() - this.last_update.getTime()) / 1000;
    const additionalDistance = this.push_speed * elapsedSeconds;
    
    return {
      distance: this.distance_pushed + additionalDistance,
      territory: this.territory_gained, // Territory calculation would be more complex
      isActive: true
    };
  };

  BorderPush.prototype.updateProgress = async function() {
    if (this.status !== 'active') {
      return this;
    }
    
    const progress = this.calculateCurrentProgress();
    this.distance_pushed = progress.distance;
    this.last_update = new Date();
    
    // Simple territory calculation (in practice, this would use PostGIS)
    // Assuming circular expansion for simplicity
    const radiusKm = this.distance_pushed / 1000; // Convert to km
    this.territory_gained = Math.PI * radiusKm * radiusKm;
    
    return await this.save();
  };

  BorderPush.prototype.addSupportingSoldier = async function() {
    this.supporting_soldiers += 1;
    
    // Recalculate push strength
    const baseStrength = 1.0;
    const soldierMultiplier = Math.sqrt(this.supporting_soldiers);
    this.push_strength = baseStrength * soldierMultiplier;
    
    // Recalculate push speed
    const strengthMultiplier = this.push_strength / this.resistance_strength;
    const terrainMultiplier = 1 / this.terrain_modifier;
    const baseSpeed = 1.0;
    
    this.push_speed = Math.max(0.1, Math.min(5.0, baseSpeed * strengthMultiplier * terrainMultiplier));
    
    return await this.save();
  };

  BorderPush.prototype.addDefendingSoldier = async function() {
    this.defending_soldiers += 1;
    
    // Increase resistance
    const baseResistance = 1.0;
    const defenseMultiplier = Math.sqrt(this.defending_soldiers);
    this.resistance_strength = baseResistance * defenseMultiplier;
    
    // Recalculate push speed
    const strengthMultiplier = this.push_strength / this.resistance_strength;
    const terrainMultiplier = 1 / this.terrain_modifier;
    const baseSpeed = 1.0;
    
    this.push_speed = Math.max(0.1, Math.min(5.0, baseSpeed * strengthMultiplier * terrainMultiplier));
    
    return await this.save();
  };

  BorderPush.prototype.stopPush = async function(reason = 'cancelled') {
    if (this.status !== 'active') {
      throw new Error('Border push is not active');
    }
    
    // Update final progress
    await this.updateProgress();
    
    this.status = reason === 'successful' ? 'successful' : 'cancelled';
    this.ended_at = new Date();
    
    return await this.save();
  };

  BorderPush.prototype.canParticipate = function(playerId) {
    // Check if player can participate in this border push
    // Would need to verify player's country membership and position
    return true; // Placeholder
  };

  // Static methods
  BorderPush.findActivePushes = function() {
    return BorderPush.findAll({
      where: { status: 'active' },
      include: [
        { model: sequelize.models.Player, as: 'player' },
        { model: sequelize.models.Country, as: 'sourceCountry' },
        { model: sequelize.models.Country, as: 'targetCountry' },
        { model: sequelize.models.War, as: 'war' }
      ]
    });
  };

  BorderPush.findPushesByWar = function(warId) {
    return BorderPush.findAll({
      where: { war_id: warId },
      order: [['started_at', 'DESC']]
    });
  };

  // Associations
  BorderPush.associate = function(models) {
    // Border push belongs to a war
    BorderPush.belongsTo(models.War, {
      foreignKey: 'war_id',
      as: 'war'
    });
    
    // Border push initiated by a player
    BorderPush.belongsTo(models.Player, {
      foreignKey: 'player_id',
      as: 'player'
    });
    
    // Border push from source country
    BorderPush.belongsTo(models.Country, {
      foreignKey: 'source_country_id',
      as: 'sourceCountry'
    });
    
    // Border push against target country
    BorderPush.belongsTo(models.Country, {
      foreignKey: 'target_country_id',
      as: 'targetCountry'
    });
  };

  return BorderPush;
};