module.exports = (sequelize, DataTypes) => {
  const War = sequelize.define('War', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    aggressor_country_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'countries',
        key: 'id'
      }
    },
    defender_country_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'countries',
        key: 'id'
      }
    },
    declared_by: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'players',
        key: 'id'
      },
      comment: 'Player who declared the war (must be owner of aggressor country)'
    },
    declared_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    status: {
      type: DataTypes.ENUM('active', 'ended', 'ceasefire'),
      defaultValue: 'active'
    },
    ended_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    ended_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'players',
        key: 'id'
      },
      comment: 'Player who ended the war'
    },
    winner_country_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'countries',
        key: 'id'
      }
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for declaring war'
    },
    territory_exchanged: {
      type: DataTypes.FLOAT,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'Territory exchanged in square kilometers'
    },
    duration_minutes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      },
      comment: 'War duration in minutes'
    },
    total_border_pushes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    aggressor_soldiers_participated: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    defender_soldiers_participated: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    max_simultaneous_pushes: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    }
  }, {
    tableName: 'wars',
    indexes: [
      {
        fields: ['aggressor_country_id']
      },
      {
        fields: ['defender_country_id']
      },
      {
        fields: ['declared_by']
      },
      {
        fields: ['status']
      },
      {
        fields: ['declared_at']
      },
      {
        fields: ['ended_at']
      },
      {
        unique: true,
        fields: ['aggressor_country_id', 'defender_country_id'],
        where: {
          status: 'active'
        },
        name: 'unique_active_war_between_countries'
      }
    ],
    hooks: {
      beforeCreate: async (war) => {
        // Validate that aggressor and defender are different countries
        if (war.aggressor_country_id === war.defender_country_id) {
          throw new Error('A country cannot declare war on itself');
        }
      },
      afterCreate: async (war) => {
        // Update country war status
        const { Country } = sequelize.models;
        
        await Country.update(
          { 
            is_at_war: true, 
            active_wars: sequelize.literal('active_wars + 1') 
          },
          { where: { id: [war.aggressor_country_id, war.defender_country_id] } }
        );
      },
      beforeUpdate: async (war) => {
        if (war.changed('status') && war.status === 'ended') {
          war.ended_at = new Date();
          
          // Calculate duration
          if (war.declared_at) {
            const durationMs = war.ended_at.getTime() - war.declared_at.getTime();
            war.duration_minutes = Math.floor(durationMs / (1000 * 60));
          }
        }
      },
      afterUpdate: async (war) => {
        if (war.changed('status') && war.status === 'ended') {
          // Update country war status
          const { Country } = sequelize.models;
          
          // Decrease active wars count
          await Country.update(
            { active_wars: sequelize.literal('GREATEST(active_wars - 1, 0)') },
            { where: { id: [war.aggressor_country_id, war.defender_country_id] } }
          );
          
          // Check if countries should still be marked as at war
          for (const countryId of [war.aggressor_country_id, war.defender_country_id]) {
            const country = await Country.findByPk(countryId);
            if (country && country.active_wars <= 0) {
              await country.update({ is_at_war: false, active_wars: 0 });
            }
          }
          
          // Update war statistics
          if (war.winner_country_id) {
            await Country.increment('wars_won', { 
              where: { id: war.winner_country_id } 
            });
            
            const loserCountryId = war.winner_country_id === war.aggressor_country_id 
              ? war.defender_country_id 
              : war.aggressor_country_id;
              
            await Country.increment('wars_lost', { 
              where: { id: loserCountryId } 
            });
          }
        }
      }
    }
  });

  // Instance methods
  War.prototype.canEndWar = function(playerId) {
    // Only the war declarer or country owners can end the war
    return this.declared_by === playerId;
  };

  War.prototype.endWar = async function(endedBy, winnerCountryId = null, reason = null) {
    if (this.status !== 'active') {
      throw new Error('War is not active');
    }
    
    this.status = 'ended';
    this.ended_by = endedBy;
    this.winner_country_id = winnerCountryId;
    this.ended_at = new Date();
    
    return await this.save();
  };

  War.prototype.getDuration = function() {
    const endTime = this.ended_at || new Date();
    const startTime = this.declared_at;
    
    return Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60)); // minutes
  };

  War.prototype.isActive = function() {
    return this.status === 'active';
  };

  War.prototype.getWarSummary = function() {
    return {
      id: this.id,
      aggressor_country_id: this.aggressor_country_id,
      defender_country_id: this.defender_country_id,
      declared_at: this.declared_at,
      status: this.status,
      duration_minutes: this.getDuration(),
      territory_exchanged: this.territory_exchanged,
      total_border_pushes: this.total_border_pushes,
      winner_country_id: this.winner_country_id
    };
  };

  // Associations
  War.associate = function(models) {
    // War belongs to aggressor country
    War.belongsTo(models.Country, {
      foreignKey: 'aggressor_country_id',
      as: 'aggressorCountry'
    });
    
    // War belongs to defender country
    War.belongsTo(models.Country, {
      foreignKey: 'defender_country_id',
      as: 'defenderCountry'
    });
    
    // War declared by a player
    War.belongsTo(models.Player, {
      foreignKey: 'declared_by',
      as: 'declarer'
    });
    
    // War ended by a player
    War.belongsTo(models.Player, {
      foreignKey: 'ended_by',
      as: 'ender'
    });
    
    // War has a winner country
    War.belongsTo(models.Country, {
      foreignKey: 'winner_country_id',
      as: 'winnerCountry'
    });
    
    // War has many border pushes
    War.hasMany(models.BorderPush, {
      foreignKey: 'war_id',
      as: 'borderPushes'
    });
  };

  return War;
};