const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const Player = sequelize.define('Player', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 50],
        isAlphanumeric: true
      }
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    display_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      validate: {
        len: [1, 100]
      }
    },
    avatar_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    is_online: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    last_active: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    total_playtime: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Total playtime in seconds'
    },
    countries_owned: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    wars_declared: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    wars_won: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    territory_conquered: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      comment: 'Total territory conquered in square kilometers'
    },
    current_position: {
      type: DataTypes.GEOMETRY('POINT'),
      allowNull: true,
      comment: 'Current latitude/longitude position'
    },
    movement_speed: {
      type: DataTypes.FLOAT,
      defaultValue: 1.0,
      validate: {
        min: 0.1,
        max: 10.0
      }
    },
    last_movement: {
      type: DataTypes.DATE,
      allowNull: true
    },
    resources: {
      type: DataTypes.INTEGER,
      defaultValue: 100,
      validate: {
        min: 0
      }
    },
    role: {
      type: DataTypes.ENUM('player', 'moderator', 'admin'),
      defaultValue: 'player'
    },
    is_banned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    ban_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ban_expires: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'players',
    indexes: [
      {
        fields: ['username']
      },
      {
        fields: ['email']
      },
      {
        fields: ['is_online']
      },
      {
        fields: ['last_active']
      },
      {
        type: 'SPATIAL',
        fields: ['current_position']
      }
    ],
    hooks: {
      beforeCreate: async (player) => {
        if (player.password_hash) {
          const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
          player.password_hash = await bcrypt.hash(player.password_hash, saltRounds);
        }
      },
      beforeUpdate: async (player) => {
        if (player.changed('password_hash')) {
          const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
          player.password_hash = await bcrypt.hash(player.password_hash, saltRounds);
        }
        
        // Update last_active when player comes online
        if (player.changed('is_online') && player.is_online) {
          player.last_active = new Date();
        }
      }
    }
  });

  // Instance methods
  Player.prototype.validatePassword = async function(password) {
    return await bcrypt.compare(password, this.password_hash);
  };

  Player.prototype.toJSON = function() {
    const values = { ...this.get() };
    delete values.password_hash;
    return values;
  };

  Player.prototype.updatePosition = function(lat, lng) {
    this.current_position = {
      type: 'Point',
      coordinates: [lng, lat]
    };
    this.last_movement = new Date();
    return this.save();
  };

  Player.prototype.canMove = function() {
    if (!this.last_movement) return true;
    
    const cooldown = parseInt(process.env.MOVEMENT_COOLDOWN_MS) || 1000;
    const timeSinceLastMove = Date.now() - this.last_movement.getTime();
    
    return timeSinceLastMove >= cooldown;
  };

  Player.prototype.consumeResources = function(amount) {
    if (this.resources < amount) {
      return false;
    }
    
    this.resources -= amount;
    return this.save();
  };

  // Associations
  Player.associate = function(models) {
    // A player can own multiple countries
    Player.hasMany(models.Country, {
      foreignKey: 'owner_id',
      as: 'ownedCountries'
    });
    
    // A player belongs to a country as a soldier
    Player.belongsTo(models.Country, {
      foreignKey: 'country_id',
      as: 'country'
    });
    
    // A player can declare multiple wars
    Player.hasMany(models.War, {
      foreignKey: 'declared_by',
      as: 'declaredWars'
    });
    
    // A player can participate in multiple border pushes
    Player.hasMany(models.BorderPush, {
      foreignKey: 'player_id',
      as: 'borderPushes'
    });
    
    // Player movement history
    Player.hasMany(models.PlayerMovement, {
      foreignKey: 'player_id',
      as: 'movementHistory'
    });
  };

  return Player;
};