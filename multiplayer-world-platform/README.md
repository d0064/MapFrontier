# Multiplayer World Platform

A massively multiplayer web platform using OpenStreetMap data as the base map where users can interact globally in a persistent territorial strategy game.

## Features

### 🌍 Countries & Ownership
- Players can join any unclaimed country
- First player becomes the Country Owner with full control
- Owners control war declarations, defense policies, and border expansions
- Additional players become Soldiers executing actions within owner's rules

### 🚶 Soldiers & Movement
- Real-time movement within country borders
- Live position tracking on the global map
- Movement restrictions based on country ownership and war status

### ⚔️ War Mechanics & Border Pushing
- Owners declare war on neighboring countries
- Realistic border expansion requiring sufficient soldiers
- Physics-like mechanics for incremental territory movement
- Animated contested regions during border disputes
- Terrain modifiers (mountains, rivers as natural barriers)

### 💰 Economy & Logistics
- Resource consumption for movement and attacks
- Supply line management and disruption mechanics
- Strategic resource allocation by country owners

### 🗺️ Interactive Map
- OpenStreetMap integration with Leaflet.js
- Dynamic border visualization
- Real-time soldier position updates
- Zoom, pan, and detailed country information
- Animated contested regions during conflicts

### 🔄 Real-time Multiplayer
- Persistent world state with central server
- WebSocket-based real-time updates
- Scalable architecture supporting thousands of players
- Historical data tracking and war logs

## Tech Stack

### Frontend
- **React** - Modern UI framework
- **Leaflet.js** - Interactive map library
- **Socket.io-client** - Real-time communication
- **Tailwind CSS** - Styling and animations

### Backend
- **Node.js** - Runtime environment
- **Express** - Web framework
- **Socket.io** - WebSocket server
- **PostgreSQL + PostGIS** - Geospatial database
- **JWT** - Authentication

### Infrastructure
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration

## Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- PostgreSQL with PostGIS extension

### Installation

1. Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd multiplayer-world-platform
npm run install:all
```

2. Start the development environment:
```bash
# Using Docker (recommended)
npm run docker:up

# Or run locally
npm run dev
```

3. Access the platform:
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

### Environment Setup

Copy the environment files and configure:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Update the configuration values in the `.env` files.

## Game Mechanics

### Country Ownership
1. **Claiming**: Click on any gray (unclaimed) country to join
2. **Ownership**: First player becomes Owner, others become Soldiers
3. **Hierarchy**: Owners make strategic decisions, Soldiers execute them

### Movement System
- Soldiers can move freely within their country's borders
- Movement speed affected by terrain and resources
- Real-time position updates visible to all players

### War & Conquest
1. **Declaration**: Only Owners can declare war on neighbors
2. **Border Push**: Requires war declaration and sufficient soldiers
3. **Resistance**: Defending soldiers slow expansion progress
4. **Terrain**: Mountains, rivers, and cities affect expansion speed

### Victory Conditions
- Control the most territory
- Maintain the longest-running empire
- Achieve specific conquest objectives

## API Documentation

### REST Endpoints
- `GET /api/countries` - Get all countries and their status
- `POST /api/countries/:id/join` - Join a country
- `POST /api/countries/:id/declare-war` - Declare war (Owner only)
- `GET /api/players/:id/position` - Get player position

### WebSocket Events
- `player:move` - Player movement update
- `country:claimed` - Country ownership change
- `war:declared` - War declaration
- `border:update` - Border change during conflict

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions, please use the GitHub Issues page or join our Discord server.