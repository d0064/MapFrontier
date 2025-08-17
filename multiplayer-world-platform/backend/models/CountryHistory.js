module.exports = (sequelize, DataTypes) => {
  const CountryHistory = sequelize.define('CountryHistory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    country_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'countries',
        key: 'id'
      }
    },
    event_type: {
      type: DataTypes.ENUM(
        'claimed', 
        'unclaimed', 
        'owner_changed', 
        'border_changed', 
        'war_declared', 
        'war_ended',
        'territory_gained',
        'territory_lost',
        'soldier_joined',
        'soldier_left'
      ),
      allowNull: false
    },
    old_value: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Previous state before the change'
    },
    new_value: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'New state after the change'
    },
    player_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'players',
        key: 'id'
      },
      comment: 'Player who triggered the event'
    },
    related_country_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'countries',
        key: 'id'
      },
      comment: 'Related country for events like wars'
    },
    war_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'wars',
        key: 'id'
      },
      comment: 'Related war if applicable'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Human-readable description of the event'
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Additional event-specific data'
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'country_history',
    indexes: [
      {
        fields: ['country_id']
      },
      {
        fields: ['event_type']
      },
      {
        fields: ['player_id']
      },
      {
        fields: ['related_country_id']
      },
      {
        fields: ['war_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['country_id', 'timestamp']
      }
    ]
  });

  // Static methods for creating specific event types
  CountryHistory.recordClaimed = async function(countryId, playerId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'claimed',
      player_id: playerId,
      new_value: { owner_id: playerId, claimed_at: new Date() },
      description: `Country claimed by player ${playerId}`,
      metadata
    });
  };

  CountryHistory.recordUnclaimed = async function(countryId, previousOwnerId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'unclaimed',
      old_value: { owner_id: previousOwnerId },
      new_value: { owner_id: null },
      description: `Country became unclaimed`,
      metadata
    });
  };

  CountryHistory.recordOwnerChanged = async function(countryId, oldOwnerId, newOwnerId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'owner_changed',
      player_id: newOwnerId,
      old_value: { owner_id: oldOwnerId },
      new_value: { owner_id: newOwnerId },
      description: `Country ownership changed from ${oldOwnerId} to ${newOwnerId}`,
      metadata
    });
  };

  CountryHistory.recordBorderChanged = async function(countryId, playerId, oldBoundaries, newBoundaries, territoryChange, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'border_changed',
      player_id: playerId,
      old_value: { boundaries: oldBoundaries },
      new_value: { boundaries: newBoundaries },
      description: `Country borders changed, territory ${territoryChange > 0 ? 'gained' : 'lost'}: ${Math.abs(territoryChange)} km²`,
      metadata: {
        ...metadata,
        territory_change: territoryChange
      }
    });
  };

  CountryHistory.recordWarDeclared = async function(countryId, warId, playerId, targetCountryId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'war_declared',
      player_id: playerId,
      related_country_id: targetCountryId,
      war_id: warId,
      description: `War declared against country ${targetCountryId}`,
      metadata
    });
  };

  CountryHistory.recordWarEnded = async function(countryId, warId, winnerCountryId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'war_ended',
      war_id: warId,
      new_value: { winner_country_id: winnerCountryId },
      description: winnerCountryId === countryId ? 'War won' : 'War lost',
      metadata
    });
  };

  CountryHistory.recordTerritoryGained = async function(countryId, playerId, amount, fromCountryId, warId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'territory_gained',
      player_id: playerId,
      related_country_id: fromCountryId,
      war_id: warId,
      new_value: { territory_gained: amount },
      description: `Gained ${amount} km² of territory from country ${fromCountryId}`,
      metadata
    });
  };

  CountryHistory.recordTerritoryLost = async function(countryId, amount, toCountryId, warId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'territory_lost',
      related_country_id: toCountryId,
      war_id: warId,
      old_value: { territory_lost: amount },
      description: `Lost ${amount} km² of territory to country ${toCountryId}`,
      metadata
    });
  };

  CountryHistory.recordSoldierJoined = async function(countryId, playerId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'soldier_joined',
      player_id: playerId,
      description: `Player ${playerId} joined as soldier`,
      metadata
    });
  };

  CountryHistory.recordSoldierLeft = async function(countryId, playerId, metadata = {}) {
    return await CountryHistory.create({
      country_id: countryId,
      event_type: 'soldier_left',
      player_id: playerId,
      description: `Player ${playerId} left the country`,
      metadata
    });
  };

  // Query methods
  CountryHistory.getCountryTimeline = function(countryId, limit = 50) {
    return CountryHistory.findAll({
      where: { country_id: countryId },
      include: [
        {
          model: sequelize.models.Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        },
        {
          model: sequelize.models.Country,
          as: 'relatedCountry',
          attributes: ['id', 'name']
        },
        {
          model: sequelize.models.War,
          as: 'war',
          attributes: ['id', 'status', 'declared_at']
        }
      ],
      order: [['timestamp', 'DESC']],
      limit
    });
  };

  CountryHistory.getEventsByType = function(eventType, limit = 100) {
    return CountryHistory.findAll({
      where: { event_type: eventType },
      include: [
        {
          model: sequelize.models.Country,
          as: 'country',
          attributes: ['id', 'name']
        },
        {
          model: sequelize.models.Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        }
      ],
      order: [['timestamp', 'DESC']],
      limit
    });
  };

  CountryHistory.getPlayerHistory = function(playerId, limit = 50) {
    return CountryHistory.findAll({
      where: { player_id: playerId },
      include: [
        {
          model: sequelize.models.Country,
          as: 'country',
          attributes: ['id', 'name']
        }
      ],
      order: [['timestamp', 'DESC']],
      limit
    });
  };

  CountryHistory.getWarHistory = function(warId) {
    return CountryHistory.findAll({
      where: { war_id: warId },
      include: [
        {
          model: sequelize.models.Country,
          as: 'country',
          attributes: ['id', 'name']
        },
        {
          model: sequelize.models.Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        }
      ],
      order: [['timestamp', 'ASC']]
    });
  };

  CountryHistory.getRecentActivity = function(hours = 24, limit = 100) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return CountryHistory.findAll({
      where: {
        timestamp: {
          [sequelize.Op.gte]: since
        }
      },
      include: [
        {
          model: sequelize.models.Country,
          as: 'country',
          attributes: ['id', 'name']
        },
        {
          model: sequelize.models.Player,
          as: 'player',
          attributes: ['id', 'username', 'display_name']
        }
      ],
      order: [['timestamp', 'DESC']],
      limit
    });
  };

  // Associations
  CountryHistory.associate = function(models) {
    // History belongs to a country
    CountryHistory.belongsTo(models.Country, {
      foreignKey: 'country_id',
      as: 'country'
    });
    
    // History may be triggered by a player
    CountryHistory.belongsTo(models.Player, {
      foreignKey: 'player_id',
      as: 'player'
    });
    
    // History may involve another country
    CountryHistory.belongsTo(models.Country, {
      foreignKey: 'related_country_id',
      as: 'relatedCountry'
    });
    
    // History may be related to a war
    CountryHistory.belongsTo(models.War, {
      foreignKey: 'war_id',
      as: 'war'
    });
  };

  return CountryHistory;
};