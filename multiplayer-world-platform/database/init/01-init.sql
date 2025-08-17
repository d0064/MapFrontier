-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create sample countries (simplified geometries for demo)
-- In production, you would import actual country boundaries from OpenStreetMap

-- Create a temporary table for country data
CREATE TEMP TABLE temp_countries (
    name VARCHAR(100),
    iso_code VARCHAR(3),
    area_km2 FLOAT,
    population BIGINT,
    terrain_type VARCHAR(20),
    capital_lat FLOAT,
    capital_lng FLOAT,
    boundary_points TEXT
);

-- Insert sample country data
INSERT INTO temp_countries VALUES
('United States', 'USA', 9833517, 331900000, 'plains', 38.9072, -77.0369, '(-125,49),(-66,49),(-66,25),(-125,25),(-125,49)'),
('Canada', 'CAN', 9984670, 38000000, 'forest', 45.4215, -75.6972, '(-141,69),(-52,69),(-52,42),(-141,42),(-141,69)'),
('Brazil', 'BRA', 8515767, 215300000, 'forest', -15.8267, -47.9218, '(-74,-5),(-35,-5),(-35,-34),(-74,-34),(-74,-5)'),
('Russia', 'RUS', 17098242, 146000000, 'plains', 55.7558, 37.6176, '(20,77),(180,77),(180,41),(20,41),(20,77)'),
('China', 'CHN', 9596960, 1440000000, 'mountains', 39.9042, 116.4074, '(73,53),(135,53),(135,18),(73,18),(73,53)'),
('Australia', 'AUS', 7692024, 25700000, 'desert', -35.2809, 149.1300, '(113,-10),(154,-10),(154,-44),(113,-44),(113,-10)'),
('India', 'IND', 3287263, 1380000000, 'plains', 28.6139, 77.2090, '(68,37),(97,37),(97,8),(68,8),(68,37)'),
('Argentina', 'ARG', 2780400, 45400000, 'plains', -34.6118, -58.3960, '(-73,-22),(-53,-22),(-53,-55),(-73,-55),(-73,-22)'),
('Kazakhstan', 'KAZ', 2724900, 19400000, 'plains', 51.1694, 71.4491, '(46,55),(87,55),(87,40),(46,40),(46,55)'),
('Algeria', 'DZA', 2381741, 44700000, 'desert', 36.7538, 3.0588, '(-8,37),(12,37),(12,19),(-8,19),(-8,37)'),
('Democratic Republic of Congo', 'COD', 2344858, 95900000, 'forest', -4.4419, 15.2663, '(12,5),(31,5),(31,-13),(12,-13),(12,5)'),
('Saudi Arabia', 'SAU', 2149690, 35000000, 'desert', 24.7136, 46.6753, '(34,32),(55,32),(55,16),(34,16),(34,32)'),
('Mexico', 'MEX', 1964375, 128900000, 'desert', 19.4326, -99.1332, '(-117,32),(-86,32),(-86,14),(-117,14),(-117,32)'),
('Indonesia', 'IDN', 1904569, 273500000, 'islands', -6.2088, 106.8456, '(95,-6),(141,-6),(141,-11),(95,-11),(95,-6)'),
('Sudan', 'SDN', 1861484, 44900000, 'desert', 15.5007, 32.5599, '(22,22),(38,22),(38,9),(22,9),(22,22)'),
('Libya', 'LBY', 1759540, 6900000, 'desert', 32.8872, 13.1913, '(9,33),(25,33),(25,20),(9,20),(9,33)'),
('Iran', 'IRN', 1648195, 84900000, 'mountains', 35.6892, 51.3890, '(44,40),(63,40),(63,25),(44,25),(44,40)'),
('Mongolia', 'MNG', 1564110, 3300000, 'plains', 47.8864, 106.9057, '(87,52),(120,52),(120,42),(87,42),(87,52)'),
('Peru', 'PER', 1285216, 33000000, 'mountains', -12.0464, -77.0428, '(-81,0),(-68,0),(-68,-18),(-81,-18),(-81,0)'),
('Chad', 'TCD', 1284000, 16900000, 'desert', 12.1348, 15.0557, '(14,23),(24,23),(24,8),(14,8),(14,23)');

-- Insert countries into the actual table
INSERT INTO countries (
    name, 
    iso_code, 
    original_boundaries, 
    current_boundaries, 
    capital_position,
    area_km2,
    original_area_km2,
    population,
    terrain_type,
    terrain_modifier,
    color
)
SELECT 
    name,
    iso_code,
    ST_GeomFromText('POLYGON((' || boundary_points || '))', 4326),
    ST_GeomFromText('POLYGON((' || boundary_points || '))', 4326),
    ST_GeomFromText('POINT(' || capital_lng || ' ' || capital_lat || ')', 4326),
    area_km2,
    area_km2,
    population,
    terrain_type::terrain_enum,
    CASE 
        WHEN terrain_type = 'mountains' THEN 1.5
        WHEN terrain_type = 'desert' THEN 1.2
        WHEN terrain_type = 'forest' THEN 1.3
        WHEN terrain_type = 'islands' THEN 2.0
        ELSE 1.0
    END,
    '#' || LPAD(TO_HEX((RANDOM() * 16777215)::INTEGER), 6, '0')
FROM temp_countries;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_countries_boundaries ON countries USING GIST (current_boundaries);
CREATE INDEX IF NOT EXISTS idx_countries_original_boundaries ON countries USING GIST (original_boundaries);
CREATE INDEX IF NOT EXISTS idx_countries_capital ON countries USING GIST (capital_position);
CREATE INDEX IF NOT EXISTS idx_players_position ON players USING GIST (current_position);

-- Create a sample admin user (password: admin123)
INSERT INTO players (
    username, 
    email, 
    password_hash, 
    display_name, 
    role,
    resources
) VALUES (
    'admin',
    'admin@multiplayer-world.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU4qRZJ8KLhE8Whe', -- admin123
    'Administrator',
    'admin',
    10000
);

-- Create some sample bot players for testing
INSERT INTO players (
    username, 
    email, 
    password_hash, 
    display_name,
    resources
) VALUES 
('bot1', 'bot1@test.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU4qRZJ8KLhE8Whe', 'Bot Player 1', 500),
('bot2', 'bot2@test.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU4qRZJ8KLhE8Whe', 'Bot Player 2', 500),
('bot3', 'bot3@test.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LeU4qRZJ8KLhE8Whe', 'Bot Player 3', 500);

-- Update statistics
ANALYZE countries;
ANALYZE players;

-- Show initialization results
SELECT 'Database initialized successfully!' as status;
SELECT COUNT(*) as total_countries FROM countries;
SELECT COUNT(*) as total_players FROM players;