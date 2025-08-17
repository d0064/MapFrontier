module.exports = (sequelize, DataTypes) => {
  const Country = sequelize.define('Country', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    iso_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
      unique: true,
      comment: 'ISO 3166-1 alpha-3 country code'
    },
    original_boundaries: {
      type: DataTypes.GEOMETRY('MULTIPOLYGON'),
      allowNull: false,
      comment: 'Original country boundaries from OpenStreetMap'
    },
    current_boundaries: {
      type: DataTypes.GEOMETRY('MULTIPOLYGON'),
      allowNull: false,
      comment: 'Current boundaries including conquered/lost territory'
    },
    capital_position: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: true,
      comment: 'Capital city coordinates'
    },
    is_claimed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    owner_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'players',
        key: 'id'
      }
    },
    claimed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    soldier_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    max_soldiers: {
      type: DataTypes.INTEGER,
      defaultValue: function() {
        return parseInt(process.env.MAX_PLAYERS_PER_COUNTRY) || 50;
      },
      validate: {
        min: 1
      }
    },
    defense_strength: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 5.0
      },
      comment: 'Defensive multiplier for border resistance'
    },
    resources: {
      type: DataTypes.INTEGER,
      defaultValue: 1000,
      validate: {
        min: 0
      }
    },
    resource_generation_rate: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 10.0
      },
      comment: 'Resources generated per minute'
    },
    area_km2: {
      type: DataTypes.FLOAT,
      allowNull: false,
      validate: {
        min: 0
      },
      comment: 'Area in square kilometers'
    },
    original_area_km2: {
      type: DataTypes.FLOAT,
      allowNull: false,
      validate: {
        min: 0
      },
      comment: 'Original area in square kilometers'
    },
    population: {
      type: DataTypes.BIGINT,
      defaultValue: 0,
      comment: 'Estimated population'
    },
    terrain_type: {
      type: DataTypes.ENUM('plains', 'mountains', 'desert', 'forest', 'coastal', 'islands'),
      defaultValue: 'plains'
    },
    terrain_modifier: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 3.0
      },
      comment: 'Movement and expansion speed modifier based on terrain'
    },
    is_at_war: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    active_wars: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    wars_won: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    wars_lost: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    territory_lost: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Territory lost in square kilometers'
    },
    territory_gained: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Territory gained in square kilometers'
    },
    color: {
      type: DataTypes.STRING(7),
      allowNull: true,
      validate: {
        is: /^#[0-9A-Fa-f]{6}$/
      },
      comment: 'Hex color code for map visualization'
    },
    last_activity: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'countries',
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['iso_code']
      },
      {
        fields: ['is_claimed']
      },
      {
        fields: ['owner_id']
      },
      {
        fields: ['is_at_war']
      },
      {
        fields: ['soldier_count']
      },
      {
        type: 'SPATIAL',
        fields: ['original_boundaries']
      },
      {
        type: 'SPATIAL',
        fields: ['current_boundaries']
      },
      {
        type: 'SPATIAL',
        fields: ['capital_position']
      }
    ],
    hooks: {
      beforeCreate: async (country) => {
        // Set current boundaries to original boundaries initially
        if (!country.current_boundaries && country.original_boundaries) {
          country.current_boundaries = country.original_boundaries;
        }
        
        // Generate random color if not provided
        if (!country.color) {
          country.color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
        }
        
        // Set original area
        if (!country.original_area_km2) {
          country.original_area_km2 = country.area_km2;
        }
      },
      beforeUpdate: async (country) => {
        if (country.changed('is_claimed') || country.changed('soldier_count')) {
          country.last_activity = new Date();
        }
      }
    }
  });

  // Instance methods
  Country.prototype.canAcceptNewSoldier = function() {
    return this.soldier_count < this.max_soldiers;
  };

  Country.prototype.addSoldier = async function() {
    if (!this.canAcceptNewSoldier()) {
      throw new Error('Country has reached maximum soldier capacity');
    }
    
    this.soldier_count += 1;
    return await this.save();
  };

  Country.prototype.removeSoldier = async function() {
    if (this.soldier_count <= 0) {
      throw new Error('No soldiers to remove');
    }
    
    this.soldier_count -= 1;
    
    // If no soldiers left and country is claimed, unclaim it
    if (this.soldier_count === 0 && this.is_claimed) {
      this.is_claimed = false;
      this.owner_id = null;
      this.claimed_at = null;
    }
    
    return await this.save();
  };

  Country.prototype.claimCountry = async function(playerId) {
    if (this.is_claimed) {
      throw new Error('Country is already claimed');
    }
    
    this.is_claimed = true;
    this.owner_id = playerId;
    this.claimed_at = new Date();
    this.soldier_count = 1; // Owner becomes first soldier
    
    return await this.save();
  };

  Country.prototype.generateResources = async function() {
    const resourcesGenerated = Math.floor(this.resource_generation_rate);
    this.resources += resourcesGenerated;
    
    return await this.save();
  };

  Country.prototype.consumeResources = async function(amount) {
    if (this.resources < amount) {
      return false;
    }
    
    this.resources -= amount;
    return await this.save();
  };

  Country.prototype.updateBoundaries = async function(newBoundaries) {
    this.current_boundaries = newBoundaries;
    
    // Calculate new area (this would require PostGIS functions in production)
    // For now, we'll estimate based on the change
    // this.area_km2 = calculateAreaFromGeometry(newBoundaries);
    
    return await this.save();
  };

  Country.prototype.getNeighbors = async function() {
    // This would use PostGIS ST_Touches or ST_Intersects to find neighboring countries
    // For now, return empty array - would need to implement with raw SQL query
    return [];
  };

  Country.prototype.isNeighbor = async function(otherCountryId) {
    // Check if this country borders another country
    // Would use PostGIS ST_Touches function
    return false; // Placeholder
  };

  Country.prototype.canDeclareWarOn = async function(targetCountryId) {
    // Check if war can be declared (must be neighbors, not already at war, etc.)
    const isNeighbor = await this.isNeighbor(targetCountryId);
    
    if (!isNeighbor) {
      return { canDeclare: false, reason: 'Countries must be neighbors to declare war' };
    }
    
    if (this.is_at_war) {
      return { canDeclare: false, reason: 'Country is already at war' };
    }
    
    return { canDeclare: true };
  };

  // Associations
  Country.associate = function(models) {
    // A country belongs to an owner (player)
    Country.belongsTo(models.Player, {
      foreignKey: 'owner_id',
      as: 'owner'
    });
    
    // A country has many soldiers (players)
    Country.hasMany(models.Player, {
      foreignKey: 'country_id',
      as: 'soldiers'
    });
    
    // A country can be involved in multiple wars
    Country.hasMany(models.War, {
      foreignKey: 'aggressor_country_id',
      as: 'warsAsAggressor'
    });
    
    Country.hasMany(models.War, {
      foreignKey: 'defender_country_id',
      as: 'warsAsDefender'
    });
    
    // A country can have multiple border pushes
    Country.hasMany(models.BorderPush, {
      foreignKey: 'target_country_id',
      as: 'borderPushesAgainst'
    });
    
    Country.hasMany(models.BorderPush, {
      foreignKey: 'source_country_id',
      as: 'borderPushesFrom'
    });
    
    // Country history for tracking changes
    Country.hasMany(models.CountryHistory, {
      foreignKey: 'country_id',
      as: 'history'
    });
  };

  return Country;
};