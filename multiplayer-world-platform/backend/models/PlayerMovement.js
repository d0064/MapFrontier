module.exports = (sequelize, DataTypes) => {
  const PlayerMovement = sequelize.define('PlayerMovement', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    player_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'players',
        key: 'id'
      }
    },
    from_position: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: true,
      comment: 'Starting position of movement'
    },
    to_position: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: false,
      comment: 'Ending position of movement'
    },
    country_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'countries',
        key: 'id'
      },
      comment: 'Country the player moved within'
    },
    movement_type: {
      type: DataTypes.ENUM('walk', 'run', 'teleport', 'spawn', 'border_cross'),
      defaultValue: 'walk'
    },
    distance_meters: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    duration_seconds: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    speed_mps: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 100.0
      },
      comment: 'Speed in meters per second'
    },
    resources_consumed: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    is_valid: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Whether the movement was within allowed boundaries'
    },
    violation_reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Reason if movement was invalid'
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'player_movements',
    indexes: [
      {
        fields: ['player_id']
      },
      {
        fields: ['country_id']
      },
      {
        fields: ['movement_type']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['is_valid']
      },
      {
        type: 'SPATIAL',
        fields: ['from_position']
      },
      {
        type: 'SPATIAL',
        fields: ['to_position']
      }
    ],
    hooks: {
      beforeCreate: async (movement) => {
        // Calculate distance if not provided
        if (movement.from_position && movement.to_position && movement.distance_meters === 0) {
          // In a real implementation, this would use PostGIS ST_Distance
          // For now, using a simple approximation
          movement.distance_meters = 100; // Placeholder
        }
        
        // Calculate speed if duration is provided
        if (movement.duration_seconds > 0 && movement.distance_meters > 0) {
          movement.speed_mps = movement.distance_meters / movement.duration_seconds;
        }
      }
    }
  });

  // Instance methods
  PlayerMovement.prototype.validateMovement = async function() {
    // Check if movement is within country boundaries
    // This would use PostGIS functions to check if points are within country polygons
    
    if (!this.country_id) {
      this.is_valid = false;
      this.violation_reason = 'Movement outside of any country boundaries';
      return false;
    }
    
    // Additional validation logic would go here
    this.is_valid = true;
    return true;
  };

  PlayerMovement.prototype.calculateResourceCost = function() {
    // Calculate resource cost based on distance and movement type
    const baseCost = 1;
    const distanceMultiplier = Math.ceil(this.distance_meters / 1000); // 1 resource per km
    
    switch (this.movement_type) {
      case 'run':
        return baseCost * distanceMultiplier * 2;
      case 'teleport':
        return baseCost * distanceMultiplier * 10;
      case 'walk':
      default:
        return baseCost * distanceMultiplier;
    }
  };

  // Static methods
  PlayerMovement.getPlayerTrail = function(playerId, limit = 100) {
    return PlayerMovement.findAll({
      where: { player_id: playerId },
      order: [['timestamp', 'DESC']],
      limit: limit
    });
  };

  PlayerMovement.getMovementsInArea = function(bounds, startTime, endTime) {
    // This would use PostGIS to find movements within a bounding box
    // For now, return empty array
    return [];
  };

  PlayerMovement.getCountryMovements = function(countryId, startTime, endTime) {
    const whereClause = { country_id: countryId };
    
    if (startTime && endTime) {
      whereClause.timestamp = {
        [sequelize.Op.between]: [startTime, endTime]
      };
    }
    
    return PlayerMovement.findAll({
      where: whereClause,
      include: [
        {
          model: sequelize.models.Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        }
      ],
      order: [['timestamp', 'DESC']]
    });
  };

  // Associations
  PlayerMovement.associate = function(models) {
    // Movement belongs to a player
    PlayerMovement.belongsTo(models.Player, {
      foreignKey: 'player_id',
      as: 'player'
    });
    
    // Movement happens within a country
    PlayerMovement.belongsTo(models.Country, {
      foreignKey: 'country_id',
      as: 'country'
    });
  };

  return PlayerMovement;
};